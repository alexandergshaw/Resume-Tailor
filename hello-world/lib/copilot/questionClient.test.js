import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchNextQuestion } from "./questionClient.js";
import { ENGINE_STORAGE_KEY } from "@/app/settings/engine";

// readEngine() reads localStorage, which the node test env lacks — install a
// minimal fake on globalThis, same approach as app/settings/engine.test.js.
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

describe("fetchNextQuestion", () => {
  it("posts the posting, asked list, and engine from readEngine() to /api/copilot/question", async () => {
    store[ENGINE_STORAGE_KEY] = "embedded";
    mockFetch(200, { question: "Tell me about yourself.", type: "behavioral", source: "bank", exhausted: false });

    await fetchNextQuestion({ posting: "Senior Engineer at Acme", asked: ["What is your greatest weakness?"] });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/copilot/question");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({
      posting: "Senior Engineer at Acme",
      asked: ["What is your greatest weakness?"],
      engine: "embedded",
    });
  });

  it("falls back to the default engine when nothing is persisted", async () => {
    mockFetch(200, { question: "Why this role?", type: "motivational", source: "bank", exhausted: false });

    await fetchNextQuestion({ posting: "p", asked: [] });

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).engine).toBe("gemini");
  });

  it("forwards interviewType when the caller provides one", async () => {
    mockFetch(200, { question: "Why this role?", type: "motivational", source: "bank", exhausted: false });

    await fetchNextQuestion({ posting: "p", asked: [], interviewType: "phone_screen" });

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).interviewType).toBe("phone_screen");
  });

  it("omits interviewType from the request body entirely when the caller does not pass it", async () => {
    mockFetch(200, { question: "Why this role?", type: "motivational", source: "bank", exhausted: false });

    await fetchNextQuestion({ posting: "p", asked: [] });

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.body).not.toContain("interviewType");
    expect(Object.keys(JSON.parse(opts.body))).toEqual(["posting", "asked", "engine"]);
  });

  it("throws an Error carrying the server's error message on a non-OK response", async () => {
    mockFetch(400, { error: "Posting text is required." });

    await expect(fetchNextQuestion({ posting: "", asked: [] })).rejects.toThrow(
      "Posting text is required.",
    );
  });

  it("falls back to a status-code message when the error body has none", async () => {
    mockFetch(500, {});

    await expect(fetchNextQuestion({ posting: "p", asked: [] })).rejects.toThrow(
      "Question request failed (500).",
    );
  });

  it("falls back to a status-code message when the error body is not valid JSON", async () => {
    mockFetch(503, null, { json: false });

    await expect(fetchNextQuestion({ posting: "p", asked: [] })).rejects.toThrow(
      "Question request failed (503).",
    );
  });

  it("returns a successful response parsed and unmodified", async () => {
    const payload = {
      question: "Describe a time you led a project.",
      type: "behavioral",
      source: "bank",
      exhausted: false,
    };
    mockFetch(200, payload);

    const result = await fetchNextQuestion({ posting: "p", asked: [] });

    expect(result).toEqual(payload);
  });
});
