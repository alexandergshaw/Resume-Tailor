// lib/meeting/insightClient.test.js is the model this follows: a thin fetch
// wrapper's whole contract is "what did it send" and "what does it resolve
// to for every response shape the server can plausibly hand back" — no DOM,
// no timers, `environment: "node"` (this repo's default) is enough.

import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchReferences } from "./referenceClient.js";

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

describe("fetchReferences — the request", () => {
  it("posts insightText, topic, and engine to /api/meeting/references", async () => {
    mockFetch(200, { references: [], dropped: 0, grounded: true });

    await fetchReferences({
      insightText: "Mention the reconciliation win.",
      topic: "Payments migration",
      engine: "gemini",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/meeting/references");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({
      insightText: "Mention the reconciliation win.",
      topic: "Payments migration",
      engine: "gemini",
    });
  });

  // Mutation this catches: dropping the `signal` option (or passing a plain
  // `undefined`) from the fetch call — this is the whole client half of
  // giving a lookup a deadline it controls, rather than trusting the route's
  // own (partial — see the client's header comment) server-side timeouts.
  it("gives the request a deadline it controls, via an AbortSignal", async () => {
    mockFetch(200, { references: [], dropped: 0, grounded: true });

    await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("fetchReferences — a successful lookup", () => {
  it("resolves ok:true with the route's references, dropped count, and grounded verdict", async () => {
    const references = [{ title: "Payments migration runbook", url: "https://example.com/runbook", host: "example.com" }];
    mockFetch(200, { references, dropped: 2, grounded: true, cached: true });

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    // Exactly these four keys: `cached` is not surfaced (see the client's
    // own doc) — nothing renders it, and a passthrough nothing consumes is a
    // phantom field waiting to be pinned by a test.
    expect(result).toEqual({ ok: true, references, dropped: 2, grounded: true });
  });

  it("defaults references to an empty array, dropped to 0, and grounded to false when the route omits them", async () => {
    mockFetch(200, {});

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result).toEqual({ ok: true, references: [], dropped: 0, grounded: false });
  });

  it("does not pass a non-array references field, or a non-number dropped, through as-is", async () => {
    // Defensive against a malformed/legacy response shape — this client
    // guarantees its `ok: true` shape to callers regardless of what the
    // route actually sent.
    mockFetch(200, { references: "not an array", dropped: "two", grounded: "yes" });

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result.references).toEqual([]);
    expect(result.dropped).toBe(0);
    expect(result.grounded).toBe(false);
  });
});

describe("fetchReferences — a 200 that is still a failure", () => {
  // This is the whole reason this describe block exists: route.js answers a
  // model failure with HTTP 200 plus an `error` field on purpose (its own
  // test asserts that field is SENT — see route.js's own comment on why a
  // 5xx would misreport a single lookup's failure as the whole meeting
  // feature breaking). Before this test, nothing on the client side ever
  // asserted that field was READ — `!res.ok` alone let a 200-with-error
  // response through as `{ ok: true, references: [], dropped: 0, grounded:
  // false }`, which renders as a confident (and false) "nothing found"
  // claim instead of a retryable failure.
  it("treats a 200 response carrying an error field as a failure, not a completed empty lookup", async () => {
    mockFetch(200, {
      references: [],
      dropped: 0,
      grounded: false,
      error: "Reference lookup failed. Please try again.",
    });

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Reference lookup failed. Please try again." });
  });

  it("still resolves ok:true when a 200 response carries no error field at all", async () => {
    // Negative half of the pair above — without it, a client that treated
    // EVERY 200 as a failure would also pass the positive test vacuously.
    mockFetch(200, { references: [], dropped: 0, grounded: true });

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result.ok).toBe(true);
  });
});

describe("fetchReferences — a client-controlled deadline", () => {
  // Mutation this catches: removing the AbortSignal.timeout handling (or
  // mis-detecting its error name) so a timed-out request either rejects
  // uncaught or falls through to the generic "Could not reach the reference
  // service." message instead of a message that actually tells the user
  // what happened and that Retry will simply try again.
  it("resolves ok:false with a retryable timeout message when the deadline expires", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    );

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Reference lookup timed out. Try again." });
  });

  it("also treats a plain AbortError the same way, in case the runtime names it that instead", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("The user aborted a request."), { name: "AbortError" }),
    );

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Reference lookup timed out. Try again." });
  });
});

describe("fetchReferences — never throws on an ordinary failure", () => {
  it("resolves ok:false with the route's own error message on a non-ok response", async () => {
    mockFetch(503, { error: "References need the Gemini engine." });

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "embedded" });

    expect(result).toEqual({ ok: false, error: "References need the Gemini engine." });
  });

  it("falls back to a status-coded message when a non-ok response carries no error field", async () => {
    mockFetch(500, {});

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Reference request failed (500)." });
  });

  it("still resolves ok:false when a non-ok response body isn't JSON at all", async () => {
    mockFetch(502, {}, { json: false });

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Reference request failed (502).");
  });

  it("resolves ok:false, not a rejection, when fetch itself rejects (offline, DNS, ...)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network down"));

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result).toEqual({ ok: false, error: "Network down" });
  });

  it("still resolves ok:false with a usable message when the rejection carries none", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error());

    const result = await fetchReferences({ insightText: "x", topic: "", engine: "gemini" });

    expect(result.ok).toBe(false);
    expect(result.error.length).toBeGreaterThan(0);
  });
});
