// AC-Q4 - the browser clients for the two "Speak as" routes.
//
// Two properties matter beyond "it posts JSON": the selected engine is passed
// on every call (otherwise the Embedded engine silently calls Gemini), and
// NOTHING about the user is sent. The drill is about how a role sounds; the
// resume, cover letter, prep context and posting have no business in it. That
// is asserted as an exact key set, not as "does not contain a resume" - a
// negative assertion of that shape passes against a client that sends
// everything under a different name.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/settings/engine", () => ({ readEngine: vi.fn(() => "embedded") }));

import { fetchRoleSituation, fetchRoleResponse } from "./roleDrillClient.js";
import { readEngine } from "@/app/settings/engine";

function mockFetch(payload, { ok = true, status = 200 } = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  });
  globalThis.fetch = fn;
  return fn;
}

function bodyOf(fn, call = 0) {
  return JSON.parse(fn.mock.calls[call][1].body);
}

beforeEach(() => {
  vi.clearAllMocks();
  readEngine.mockReturnValue("embedded");
});

afterEach(() => {
  delete globalThis.fetch;
});

describe("fetchRoleSituation", () => {
  it("posts the role, the asked prompts and the engine - and nothing else", async () => {
    const fn = mockFetch({ role: "manager", situation: { id: "manager-x", prompt: "p", context: "c" }, source: "embedded", exhausted: false });
    const asked = ["an earlier prompt"];
    const got = await fetchRoleSituation({ role: "manager", asked });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe("/api/copilot/role-situation");
    expect(fn.mock.calls[0][1].method).toBe("POST");
    expect(bodyOf(fn)).toEqual({ role: "manager", asked, engine: "embedded" });
    expect(got.situation.prompt).toBe("p");
  });

  it("passes whichever engine is selected", async () => {
    readEngine.mockReturnValue("gemini");
    const fn = mockFetch({ situation: { id: "a", prompt: "p", context: "c" } });
    await fetchRoleSituation({ role: "professor", asked: [] });
    expect(bodyOf(fn).engine).toBe("gemini");
  });

  it("throws the server's own message on a failure", async () => {
    mockFetch({ error: "Sign in to use the interview copilot." }, { ok: false, status: 401 });
    await expect(fetchRoleSituation({ role: "manager", asked: [] })).rejects.toThrow(
      "Sign in to use the interview copilot.",
    );
  });

  it("throws something naming the status when the body has no message", async () => {
    mockFetch({}, { ok: false, status: 500 });
    await expect(fetchRoleSituation({ role: "manager", asked: [] })).rejects.toThrow(/500/);
  });
});

describe("fetchRoleResponse", () => {
  it("posts the role, the situation and the engine - and nothing else", async () => {
    const fn = mockFetch({ lines: [{ label: "L", text: "T." }], cadence: [], terms: [], termsUsed: [], avoid: [], source: "embedded" });
    await fetchRoleResponse({
      role: "clinician",
      situationId: "clinician-consent",
      situationPrompt: "A patient asks...",
    });

    expect(fn.mock.calls[0][0]).toBe("/api/copilot/role-response");
    expect(bodyOf(fn)).toEqual({
      role: "clinician",
      situationId: "clinician-consent",
      situationPrompt: "A patient asks...",
      engine: "embedded",
    });
  });

  it("passes whichever engine is selected", async () => {
    // Without this, a client that hardcodes `engine: "embedded"` passes every
    // other assertion in this file - and a Gemini user then silently gets the
    // deterministic answer forever, under a caption claiming no AI provider
    // was involved.
    readEngine.mockReturnValue("gemini");
    const fn = mockFetch({ lines: [] });
    await fetchRoleResponse({ role: "manager", situationId: "x", situationPrompt: "y" });
    expect(bodyOf(fn).engine).toBe("gemini");
  });

  it("throws the server's own message on a failure", async () => {
    mockFetch({ error: "nope" }, { ok: false, status: 503 });
    await expect(
      fetchRoleResponse({ role: "manager", situationId: "x", situationPrompt: "y" }),
    ).rejects.toThrow("nope");
  });
});

describe("both clients - an error page that is not JSON", () => {
  // A proxy or a crashed route answers with HTML. Without questionClient.js's
  // `res.json().catch(() => ({}))` guard the client throws a SyntaxError from
  // the parse, and the user is shown "Unexpected token < in JSON" instead of
  // the failure that actually happened.
  function mockHtmlError() {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
  }

  it("still reports the status for a situation request", async () => {
    mockHtmlError();
    await expect(fetchRoleSituation({ role: "manager", asked: [] })).rejects.toThrow(/502/);
  });

  it("still reports the status for a response request", async () => {
    mockHtmlError();
    await expect(
      fetchRoleResponse({ role: "manager", situationId: "x", situationPrompt: "y" }),
    ).rejects.toThrow(/502/);
  });
});
