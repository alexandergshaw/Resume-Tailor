import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/settings/engine", () => ({ readEngine: vi.fn(() => "gemini") }));

import { confirmQuestion } from "./detectClient.js";
import { readEngine } from "@/app/settings/engine";

// AC-R2.1: when the selected engine is embedded, confirmQuestion must decide
// locally and never touch the network — the route's own embedded branch
// would just call the exact same localDetection against the exact same
// string, so the round trip can only ever repeat an answer the client
// already has.
//
// AC-R2.3: confirmQuestion passes `degraded` through unchanged for the
// non-embedded (network) path, so a later change can surface it without
// touching this file again.

function mockFetch(status, body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete globalThis.fetch;
});

describe("confirmQuestion — embedded engine skips the network (AC-R2.1)", () => {
  it("never calls fetch, and returns the { isQuestion, question, type } shape", async () => {
    readEngine.mockReturnValue("embedded");
    global.fetch = vi.fn();

    const result = await confirmQuestion({
      utterance: "Tell me about a time you resolved a conflict.",
      context: "",
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      isQuestion: true,
      question: expect.stringMatching(/conflict/i),
      type: "behavioral",
    });
  });

  it("decides false locally for a non-question, still without touching the network", async () => {
    readEngine.mockReturnValue("embedded");
    global.fetch = vi.fn();

    const result = await confirmQuestion({ utterance: "Great, thanks for sharing.", context: "" });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ isQuestion: false, question: "", type: "general" });
  });
});

describe("confirmQuestion — non-embedded engines still use the route", () => {
  it("posts to /api/copilot/detect with the selected engine", async () => {
    readEngine.mockReturnValue("gemini");
    mockFetch(200, { isQuestion: true, question: "Why this role?", type: "general" });

    await confirmQuestion({ utterance: "So why do you want to work here", context: "ctx" });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/copilot/detect");
    expect(JSON.parse(opts.body)).toEqual({
      utterance: "So why do you want to work here",
      context: "ctx",
      engine: "gemini",
    });
  });

  it("passes `degraded` and `degradedReason` through unchanged (AC-R2.3)", async () => {
    readEngine.mockReturnValue("gemini");
    mockFetch(200, {
      isQuestion: true,
      question: "Tell me about a time you resolved a conflict.",
      type: "behavioral",
      degraded: true,
      degradedReason: "Gemini_LLM_API_Key is not set.",
    });

    const result = await confirmQuestion({ utterance: "Tell me about a time you resolved a conflict.", context: "" });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("Gemini_LLM_API_Key is not set.");
  });

  it("omits `degraded` when the route's happy path omits it", async () => {
    readEngine.mockReturnValue("gemini");
    mockFetch(200, { isQuestion: false, question: "", type: "general" });

    const result = await confirmQuestion({ utterance: "Great, thanks for sharing.", context: "" });

    expect(result.degraded).toBeUndefined();
  });

  it("throws an Error carrying the server's error message on a non-OK response", async () => {
    readEngine.mockReturnValue("gemini");
    mockFetch(401, { error: "Sign in to use the interview copilot." });

    await expect(
      confirmQuestion({ utterance: "What is your name?", context: "" }),
    ).rejects.toThrow("Sign in to use the interview copilot.");
  });
});
