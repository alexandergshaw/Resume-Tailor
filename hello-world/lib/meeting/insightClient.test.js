// lib/copilot/answerClient.test.js is the model this follows: a thin fetch
// wrapper's whole contract is "what did it send" and "what does it resolve
// to for every response shape the server can plausibly hand back" — no DOM,
// no timers, `environment: "node"` (this repo's default) is enough.

import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchInsights } from "./insightClient.js";

function mockFetch(status, body, { json = true } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: json
      ? async () => body
      : async () => {
          throw new Error("not json");
        },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe("fetchInsights — the request", () => {
  it("posts transcript, topic, knownInsightIds, pageId, and engine to /api/meeting/insights", async () => {
    mockFetch(200, { insights: [], topic: "", topicChanged: false });

    await fetchInsights({
      transcript: "We're moving launch to March.",
      topic: "Launch timeline",
      knownInsightIds: ["i_abc"],
      pageId: "page-1",
      engine: "embedded",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/meeting/insights");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({
      transcript: "We're moving launch to March.",
      topic: "Launch timeline",
      knownInsightIds: ["i_abc"],
      pageId: "page-1",
      engine: "embedded",
    });
  });

  it("threads an AbortSignal straight into fetch when the caller supplies one", async () => {
    mockFetch(200, { insights: [], topic: "", topicChanged: false });
    const controller = new AbortController();

    await fetchInsights({ transcript: "hi", topic: "", knownInsightIds: [], engine: "gemini", signal: controller.signal });

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBe(controller.signal);
  });
});

describe("fetchInsights — a successful read", () => {
  it("resolves ok:true with the route's insights, topic string, and topicChanged verdict", async () => {
    const insights = [{ id: "i_1", text: "The dual write window closes Friday.", kind: "point", source: { kind: "model", pageId: null, pageTitle: null } }];
    mockFetch(200, {
      insights,
      topic: "Migration status",
      topicChanged: true,
      topicConfidence: "high",
      context: { includedPageCount: 1, droppedPageCount: 0, truncated: false, notice: "" },
    });

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    // Exactly these four keys: `includedPageIds` is not a field the route
    // sends (see the client's own doc), and neither `topicConfidence` nor
    // `context` is surfaced until something renders it — a phantom field
    // pinned here is how a client starts documenting a contract the server
    // does not have.
    expect(result).toEqual({ ok: true, insights, topic: "Migration status", topicChanged: true });
  });

  it("carries the route's topicChanged verdict rather than re-deriving one from the strings", async () => {
    // Mutation this catches: dropping `topicChanged` from the resolved shape
    // (or defaulting it to `true`). The route computes it through
    // normalizeTopic, which deliberately does NOT report a trailing period
    // or a trivial rephrase as a change; a client that re-derived it by
    // comparing its own previous topic to this one would.
    mockFetch(200, { insights: [], topic: "Migration status.", topicChanged: false });

    const result = await fetchInsights({ transcript: "x", topic: "Migration status", knownInsightIds: [], engine: "gemini" });

    expect(result.topic).toBe("Migration status.");
    expect(result.topicChanged).toBe(false);
  });

  it("defaults insights to an empty array, topic to null, and topicChanged to false when the route omits them", async () => {
    mockFetch(200, {});

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    expect(result).toEqual({ ok: true, insights: [], topic: null, topicChanged: false });
  });

  it("does not pass a non-array insights field, or a non-boolean topicChanged, through as-is", async () => {
    // Defensive against a malformed/legacy response shape — this client
    // guarantees its `ok: true` shape to callers regardless of what the
    // route actually sent, the same discipline normalizeInsights itself
    // applies server-side.
    mockFetch(200, { insights: "not an array", topic: "T", topicChanged: "yes" });

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    expect(result.insights).toEqual([]);
    expect(result.topicChanged).toBe(false);
  });
});

describe("fetchInsights — never throws on an ordinary failure", () => {
  it("resolves ok:false with the route's own error message on a non-ok response", async () => {
    mockFetch(503, { error: "Insight generation needs the Gemini API key to be configured." });

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Insight generation needs the Gemini API key to be configured." });
  });

  it("falls back to a status-coded message when a non-ok response carries no error field", async () => {
    mockFetch(500, {});

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Insight request failed (500)." });
  });

  it("still resolves ok:false when a non-ok response body isn't JSON at all", async () => {
    mockFetch(502, {}, { json: false });

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Insight request failed (502).");
  });

  it("resolves ok:false, not a rejection, when fetch itself rejects (offline, DNS, ...)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network down"));

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Network down" });
  });

  it("still resolves ok:false with a usable message when the rejection carries none", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error());

    const result = await fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini" });

    expect(result.ok).toBe(false);
    expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("fetchInsights — cancellation is not an ordinary failure", () => {
  it("rejects with the AbortError instead of resolving ok:false when the signal aborts", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    global.fetch = vi.fn().mockRejectedValue(abortError);

    await expect(
      fetchInsights({ transcript: "x", topic: "", knownInsightIds: [], engine: "gemini", signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
