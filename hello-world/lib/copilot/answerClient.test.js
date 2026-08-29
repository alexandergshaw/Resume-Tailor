import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { draftAnswer, draftAnswerStreaming } from "./answerClient.js";
import { ENGINE_STORAGE_KEY } from "@/app/settings/engine";

// Minimal NDJSON stream double for draftAnswerStreaming's codeLanguage
// coverage below — the framing itself is answerClient.streaming.test.js's
// job; here it exists only so the request body can be inspected.
function streamingResponse(chunks) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    json: async () => ({}),
  };
}

function frame(obj) {
  return `${JSON.stringify(obj)}\n`;
}

// readEngine() reads localStorage, which the node test env lacks — install a
// minimal fake on globalThis, same approach as questionClient.test.js and
// critiqueClient.test.js.
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

describe("draftAnswer", () => {
  it("posts the question, context, profile, interviewType, applicationId, codeLanguage, mode, and engine from readEngine() to /api/copilot/answer", async () => {
    store[ENGINE_STORAGE_KEY] = "embedded";
    mockFetch(200, { points: ["Situation: led a migration."], type: "behavioral" });

    await draftAnswer({
      question: "Tell me about a time you led a project.",
      context: "Prep notes about the migration.",
      profile: "Experienced engineer.",
      interviewType: "technical_screen",
      applicationId: "app-123",
      codeLanguage: "python",
      mode: "answer",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/copilot/answer");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({
      question: "Tell me about a time you led a project.",
      context: "Prep notes about the migration.",
      profile: "Experienced engineer.",
      interviewType: "technical_screen",
      applicationId: "app-123",
      codeLanguage: "python",
      mode: "answer",
      engine: "embedded",
    });
  });

  it("sends codeLanguage even under a non-code-bearing interview type", async () => {
    // The control's value is forwarded as-is; whether it means anything is
    // the route/prompt layer's call, not this client's.
    mockFetch(200, { points: ["Point one."], type: "general" });

    await draftAnswer({
      question: "Tell me about a conflict with a teammate.",
      context: "",
      profile: "Experienced engineer.",
      interviewType: "general",
      applicationId: "app-1",
      codeLanguage: "auto",
      mode: "points",
    });

    const [, opts] = global.fetch.mock.calls[0];
    const parsed = JSON.parse(opts.body);
    expect(parsed.codeLanguage).toBe("auto");
    expect(typeof parsed.codeLanguage).toBe("string");
    expect(parsed.codeLanguage.length).toBeGreaterThan(0);
  });

  it("falls back to the default engine when nothing is persisted", async () => {
    mockFetch(200, { points: ["Point one."], type: "general" });

    await draftAnswer({ question: "Why this role?", context: "", profile: null });

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).engine).toBe("gemini");
  });

  it("forwards interviewType, applicationId, and mode when the caller provides them", async () => {
    mockFetch(200, { answer: "I led a migration effort.", type: "behavioral", grounding: "resume" });

    await draftAnswer({
      question: "Tell me about a time you led a project.",
      context: "Prep notes.",
      profile: "Experienced engineer.",
      interviewType: "onsite_panel",
      applicationId: "app-456",
      mode: "answer",
    });

    const [, opts] = global.fetch.mock.calls[0];
    const parsed = JSON.parse(opts.body);
    expect(parsed.interviewType).toBe("onsite_panel");
    expect(parsed.applicationId).toBe("app-456");
    expect(parsed.mode).toBe("answer");
  });

  it("omits interviewType, applicationId, and mode from the request body entirely when the caller does not pass them", async () => {
    mockFetch(200, { points: ["Point one."], type: "general" });

    await draftAnswer({
      question: "Why this role?",
      context: "Some prep notes.",
      profile: "Experienced engineer.",
    });

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.body).not.toContain("interviewType");
    expect(opts.body).not.toContain("applicationId");
    expect(opts.body).not.toContain("mode");
    expect(Object.keys(JSON.parse(opts.body))).toEqual(["question", "context", "profile", "engine"]);
  });

  it("throws an Error carrying the server's error message on a non-OK response", async () => {
    mockFetch(400, { error: "Question text is required." });

    await expect(
      draftAnswer({ question: "", context: "", profile: null }),
    ).rejects.toThrow("Question text is required.");
  });

  it("falls back to a status-code message when the error body has none", async () => {
    mockFetch(500, {});

    await expect(
      draftAnswer({ question: "q", context: "", profile: null }),
    ).rejects.toThrow("Answer request failed (500).");
  });

  it("falls back to a status-code message when the error body is not valid JSON", async () => {
    mockFetch(503, null, { json: false });

    await expect(
      draftAnswer({ question: "q", context: "", profile: null }),
    ).rejects.toThrow("Answer request failed (503).");
  });

  it("returns a successful response parsed and unmodified", async () => {
    const payload = {
      points: ["Situation: faced a production outage.", "Action: rolled back the deploy.", "Result: restored service in 10 minutes."],
      type: "behavioral",
    };
    mockFetch(200, payload);

    const result = await draftAnswer({ question: "Describe a challenge you overcame.", context: "", profile: null });

    expect(result).toEqual(payload);
  });

  it("returns a practice-mode sample answer response parsed and unmodified", async () => {
    const payload = {
      answer: "I led a cross-team migration that cut deploy time in half.",
      type: "behavioral",
      grounding: "resume",
    };
    mockFetch(200, payload);

    const result = await draftAnswer({
      question: "Describe a challenge you overcame.",
      context: "",
      profile: null,
      interviewType: "phone_screen",
      applicationId: "app-789",
      mode: "answer",
    });

    expect(result).toEqual(payload);
  });
});

describe("draftAnswerStreaming codeLanguage", () => {
  it("posts codeLanguage alongside the rest of the request body", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "done", points: ["a"], type: "behavioral" })]),
    );

    await draftAnswerStreaming(
      {
        question: "Tell me about a time you led a project.",
        context: "Prep notes.",
        profile: "Experienced engineer.",
        interviewType: "technical_screen",
        applicationId: "app-123",
        codeLanguage: "javascript",
        mode: "points",
      },
      { onPoints: () => {} },
    );

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).codeLanguage).toBe("javascript");
  });

  it("sends codeLanguage, as a non-empty string, even under a non-code-bearing interview type", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamingResponse([frame({ t: "done", points: ["a"], type: "general" })]),
    );

    await draftAnswerStreaming(
      {
        question: "Tell me about a conflict with a teammate.",
        context: "",
        profile: "Experienced engineer.",
        interviewType: "general",
        applicationId: "app-1",
        codeLanguage: "auto",
        mode: "points",
      },
      { onPoints: () => {} },
    );

    const [, opts] = global.fetch.mock.calls[0];
    const parsed = JSON.parse(opts.body);
    expect(typeof parsed.codeLanguage).toBe("string");
    expect(parsed.codeLanguage.length).toBeGreaterThan(0);
  });
});
