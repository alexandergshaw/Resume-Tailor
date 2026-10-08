// N150 Wave B (B3) — fetchTechTerms added to answerClient.js, mirroring
// fetchProjectExampleLive so the three producers' namespace probe
// (techTermsFetchAvailable) sees a real export. RED on HEAD: answerClient.js
// has no fetchTechTerms export, so the named import is undefined and the first
// call throws.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTechTerms } from "./answerClient.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTechTerms", () => {
  it("POSTs to the tech-terms route carrying the application, the question and an engine", async () => {
    const body = { techTerms: { status: "ready", terms: ["SLA"] } };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchTechTerms({ applicationId: "app-1", question: "Tell me about retries." });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/copilot/answer/tech-terms");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body);
    expect(sent.applicationId).toBe("app-1");
    expect(sent.question).toBe("Tell me about retries.");
    expect(typeof sent.engine).toBe("string");
    expect(out).toEqual(body);
  });

  it("forwards the watchdog's abort signal so a given-up request can be stopped", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ techTerms: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await fetchTechTerms({ applicationId: "a", question: "q", signal: controller.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("throws on a non-ok response (the caller turns every rejection into failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) })));
    await expect(fetchTechTerms({ applicationId: "a", question: "q" })).rejects.toThrow();
  });
});
