import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { critiqueAnswer } from "./critiqueClient.js";
import { ENGINE_STORAGE_KEY } from "@/app/settings/engine";

// readEngine() reads localStorage, which the node test env lacks — install a
// minimal fake on globalThis, same approach as questionClient.test.js.
function installStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  return store;
}

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

let store;
beforeEach(() => {
  store = installStorage();
});

afterEach(() => {
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

describe("critiqueAnswer", () => {
  it("posts the question, type, answer, posting, profile, metrics, frames, and engine from readEngine() to /api/copilot/critique", async () => {
    store[ENGINE_STORAGE_KEY] = "embedded";
    mockFetch(200, {
      score: 7,
      verdict: "Solid",
      strengths: [],
      improvements: [],
      missing: [],
      star: null,
      delivery: null,
      source: "local",
    });

    const posting = { title: "Senior Engineer", company: "Acme", description: "Build things." };
    const profile = { resumeText: "Experienced engineer." };
    const metrics = { fillerWordCount: 2, wpm: 130 };
    const frames = ["data:image/jpeg;base64,AAAA"];

    await critiqueAnswer({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "I led a migration effort.",
      posting,
      profile,
      metrics,
      frames,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/copilot/critique");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "I led a migration effort.",
      posting,
      profile,
      metrics,
      frames,
      engine: "embedded",
    });
  });

  it("falls back to the default engine when nothing is persisted", async () => {
    mockFetch(200, { score: 5, verdict: "Okay", strengths: [], improvements: [], missing: [], star: null, delivery: null, source: "local" });

    await critiqueAnswer({
      question: "Why this role?",
      type: "motivational",
      answer: "Because I care about the mission.",
      posting: null,
      profile: null,
      metrics: null,
      frames: [],
    });

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).engine).toBe("gemini");
  });

  it("forwards interviewType when the caller provides one", async () => {
    mockFetch(200, { score: 5, verdict: "Okay", strengths: [], improvements: [], missing: [], star: null, delivery: null, source: "local" });

    await critiqueAnswer({
      question: "Why this role?",
      type: "motivational",
      answer: "Because I care about the mission.",
      posting: null,
      profile: null,
      metrics: null,
      frames: [],
      interviewType: "technical_screen",
    });

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).interviewType).toBe("technical_screen");
  });

  it("omits interviewType from the request body entirely when the caller does not pass it", async () => {
    mockFetch(200, { score: 5, verdict: "Okay", strengths: [], improvements: [], missing: [], star: null, delivery: null, source: "local" });

    await critiqueAnswer({
      question: "Why this role?",
      type: "motivational",
      answer: "Because I care about the mission.",
      posting: null,
      profile: null,
      metrics: null,
      frames: [],
    });

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.body).not.toContain("interviewType");
    expect(Object.keys(JSON.parse(opts.body))).toEqual([
      "question",
      "type",
      "answer",
      "posting",
      "profile",
      "metrics",
      "frames",
      "engine",
    ]);
  });

  it("throws an Error carrying the server's error message on a non-OK response", async () => {
    mockFetch(400, { error: "Answer text is required." });

    await expect(
      critiqueAnswer({
        question: "q",
        type: "behavioral",
        answer: "",
        posting: null,
        profile: null,
        metrics: null,
        frames: [],
      }),
    ).rejects.toThrow("Answer text is required.");
  });

  it("falls back to a status-code message when the error body has none", async () => {
    mockFetch(500, {});

    await expect(
      critiqueAnswer({
        question: "q",
        type: "behavioral",
        answer: "a",
        posting: null,
        profile: null,
        metrics: null,
        frames: [],
      }),
    ).rejects.toThrow("Critique request failed (500).");
  });

  it("falls back to a status-code message when the error body is not valid JSON", async () => {
    mockFetch(503, null, { json: false });

    await expect(
      critiqueAnswer({
        question: "q",
        type: "behavioral",
        answer: "a",
        posting: null,
        profile: null,
        metrics: null,
        frames: [],
      }),
    ).rejects.toThrow("Critique request failed (503).");
  });

  it("returns a successful response parsed and unmodified", async () => {
    const payload = {
      score: 8,
      verdict: "Strong answer with a clear STAR structure.",
      strengths: ["Quantified the impact"],
      improvements: ["Tighten the opening"],
      missing: ["Result"],
      star: { situation: true, task: true, action: true, result: false },
      delivery: { fillerWordCount: 1, pace: "good" },
      source: "gemini",
    };
    mockFetch(200, payload);

    const result = await critiqueAnswer({
      question: "Describe a challenge you overcame.",
      type: "behavioral",
      answer: "I resolved a production incident.",
      posting: null,
      profile: null,
      metrics: null,
      frames: [],
    });

    expect(result).toEqual(payload);
  });
});
