import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSttToken } from "./token";

// token.js talks to the fetch global this node test environment doesn't
// provide a real version of. Stubbed here and restored afterward so this
// file doesn't leak into others.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchSttToken", () => {
  it("posts to /api/copilot/token and returns the parsed body including the provider field", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "test-token",
            expiresIn: 60,
            provider: "deepgram",
          }),
      }),
    );

    const body = await fetchSttToken();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/copilot/token", {
      method: "POST",
    });
    expect(body).toEqual({
      token: "test-token",
      expiresIn: 60,
      provider: "deepgram",
    });
  });

  it("throws an Error carrying the server's error message on a non-OK response", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "provider unavailable" }),
      }),
    );

    await expect(fetchSttToken()).rejects.toThrow("provider unavailable");
  });

  it("falls back to a status-code message when the error body has no error field", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      }),
    );

    await expect(fetchSttToken()).rejects.toThrow("Token request failed (503).");
  });

  it("falls back to a status-code message when the error body is not JSON", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      }),
    );

    await expect(fetchSttToken()).rejects.toThrow("Token request failed (401).");
  });
});
