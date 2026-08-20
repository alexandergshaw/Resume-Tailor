// AC-Q6 - POST /api/copilot/role-situation.
//
// Same contract every other copilot route here follows: sign-in gate with the
// exact shared message, an embedded path that provably never reaches Gemini,
// and a model path that can never dead-end the drill - any failure falls back
// to the deterministic bank and SAYS SO in `source`.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { nextRoleSituation } from "@/lib/copilot/roleSituations";
import { situationsFor } from "@/lib/copilot/roleSituationBank";
import { DEFAULT_ROLE, roleRegister } from "@/lib/copilot/roleRegisters";

function jsonRequest(body) {
  return { json: async () => body };
}

// Collects every `text` the route actually put in front of the model, from
// wherever it sits in the request (contents parts, systemInstruction, ...).
// Deliberately not `JSON.stringify(call)`: that escapes newlines and quotes,
// so comparing a multi-line guidance string against it fails against a route
// that passes the guidance through verbatim - which is what is required.
function promptTextOf(generateContent, call = 0) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") return out.push(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") Object.values(node).forEach(walk);
    return undefined;
  };
  walk(generateContent.mock.calls[call][0]);
  return out.join("\n");
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

function mockGemini(payload, { throws = false } = {}) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = throws
    ? vi.fn().mockRejectedValue(new Error("model down"))
    : vi.fn().mockResolvedValue({ text: JSON.stringify(payload) });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/copilot/role-situation - the gate", () => {
  it("401s when not signed in, with the shared copilot message", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ role: "manager", engine: "embedded" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Sign in to use the interview copilot.");
  });
});

describe("POST /api/copilot/role-situation - embedded engine", () => {
  it("returns the bank's own next situation and never touches Gemini", async () => {
    mockUser();
    const res = await POST(jsonRequest({ role: "professor", asked: [], engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const expected = nextRoleSituation({ role: "professor", asked: [] });
    expect(data.situation.id).toBe(expected.situation.id);
    expect(data.situation.prompt).toBe(expected.situation.prompt);
    expect(data.situation.context).toBe(expected.situation.context);
    expect(data.source).toBe("embedded");
    expect(data.exhausted).toBe(false);
    expect(data.role).toBe("professor");
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("does not ship the answer material with the question", async () => {
    // The bank's situations carry `beats` - what the model answer is built
    // from. The drill's whole premise is that you answer out loud BEFORE
    // seeing how the role would, so the beats must not ride along in the
    // response to the request that asks the question.
    mockUser();
    const data = await (
      await POST(jsonRequest({ role: "professor", asked: [], engine: "embedded" }))
    ).json();
    expect(Object.keys(data.situation).sort()).toEqual(["context", "id", "prompt"]);
    const fromBank = nextRoleSituation({ role: "professor", asked: [] }).situation;
    expect(fromBank.beats.length, "the bank stopped carrying beats").toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain(fromBank.beats[0]);
  });

  it("does not repeat a situation the caller has already been shown", async () => {
    mockUser();
    const first = nextRoleSituation({ role: "manager", asked: [] }).situation;
    const res = await POST(
      jsonRequest({ role: "manager", asked: [first.prompt], engine: "embedded" }),
    );
    expect((await res.json()).situation.id).not.toBe(first.id);
  });

  it("reports exhausted once the whole bank has been shown", async () => {
    mockUser();
    const asked = situationsFor("teacher").map((s) => s.prompt);
    const res = await POST(jsonRequest({ role: "teacher", asked, engine: "embedded" }));
    const data = await res.json();
    expect(data.exhausted).toBe(true);
    expect(data.situation.prompt.length).toBeGreaterThan(0);
  });

  it("falls back to the default role for a junk or missing body", async () => {
    mockUser();
    for (const body of [
      { engine: "embedded" },
      { role: 42, asked: "nope", engine: "embedded" },
      null,
      "not an object at all",
      [],
    ]) {
      const res = await POST(jsonRequest(body));
      expect(res.status, JSON.stringify(body)).toBe(200);
      const data = await res.json();
      expect(data.role).toBe(DEFAULT_ROLE);
      expect(data.situation.prompt.length).toBeGreaterThan(0);
    }
  });

  it("still answers when the request body cannot be parsed at all", async () => {
    mockUser();
    const res = await POST({
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBe(DEFAULT_ROLE);
    expect(data.situation.prompt.length).toBeGreaterThan(0);
  });
});

describe("POST /api/copilot/role-situation - Gemini engine", () => {
  it("returns the model's situation, tagged and given a generated id", async () => {
    mockUser();
    // Long enough to be a real scene: the route holds a model-written
    // situation to the same 80-420 char bound the bank's own contract sets,
    // so a fixture shorter than that would exercise the fallback path
    // instead of the one this test is named for.
    mockGemini({
      prompt:
        "Your director stops you after the leadership sync and asks, with two of your peers still in the room, why the launch slipped a second time.",
      context: "The director already has the dates and wants your read, not a recap.",
    });
    const res = await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }));
    const data = await res.json();
    expect(data.source).toBe("gemini");
    expect(data.situation.prompt).toMatch(/why the launch slipped/);
    expect(data.situation.context).toBe("The director already has the dates and wants your read, not a recap.");
    expect(data.situation.id.startsWith("generated-")).toBe(true);
    expect(data.exhausted).toBe(false);
  });

  it("sends the role's own guidance and the asked list to the model", async () => {
    mockUser();
    const generateContent = mockGemini({ prompt: "A new scene entirely, for you to answer.", context: "c" });
    await POST(
      jsonRequest({ role: "attorney", asked: ["an earlier scene"], engine: "gemini" }),
    );
    const sent = promptTextOf(generateContent);
    expect(sent).toContain(roleRegister("attorney").guidance);
    expect(sent).toContain("an earlier scene");
  });

  it("gives the same generated situation the same id every time", async () => {
    // AC-Q6.4: the id is derived from the prompt text. A clock- or
    // counter-based id would break the panel's per-situation answer cache and
    // make the same scene look new on every request.
    mockUser();
    const payload = { prompt: "Opposing counsel asks you, on the record, to confirm the date.", context: "c" };
    mockGemini(payload);
    const a = await (await POST(jsonRequest({ role: "attorney", asked: [], engine: "gemini" }))).json();
    mockGemini(payload);
    const b = await (await POST(jsonRequest({ role: "attorney", asked: [], engine: "gemini" }))).json();
    expect(a.situation.id).toBe(b.situation.id);
    expect(a.situation.id).not.toBe("generated-");
  });

  it("sanitizes the asked list rather than passing it through", async () => {
    mockUser();
    const generateContent = mockGemini({ prompt: "A brand new scene for the drill.", context: "c" });
    const asked = [
      ...Array.from({ length: 60 }, (_, i) => `asked number ${i}`),
      { not: "a string" },
      null,
      42,
      `${"y".repeat(500)}OVERFLOW`,
    ];
    await POST(jsonRequest({ role: "manager", asked, engine: "gemini" }));
    const sent = promptTextOf(generateContent);
    expect(sent).not.toContain("[object Object]");
    expect(sent).not.toContain("OVERFLOW");
    // Capped to the most recent 40, so the oldest entries are gone and the
    // newest are kept - dropping the newest would defeat the whole point.
    expect(sent).not.toContain("asked number 0");
    expect(sent).toContain("asked number 59");
  });

  it("falls back to the bank when the model throws", async () => {
    mockUser();
    mockGemini(null, { throws: true });
    const res = await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }));
    const data = await res.json();
    expect(data.source).toBe("fallback");
    expect(data.situation.id).toBe(nextRoleSituation({ role: "manager", asked: [] }).situation.id);
  });

  it("falls back when the model returns nothing usable", async () => {
    mockUser();
    mockGemini({ prompt: "   ", context: "" });
    const data = await (await POST(jsonRequest({ role: "manager", asked: [], engine: "gemini" }))).json();
    expect(data.source).toBe("fallback");
    expect(data.situation.prompt.trim().length).toBeGreaterThan(0);
  });

  it("falls back when the model repeats a situation already asked", async () => {
    mockUser();
    const repeated = "Your director asks why the launch slipped.";
    mockGemini({ prompt: repeated, context: "c" });
    const data = await (
      await POST(jsonRequest({ role: "manager", asked: [repeated], engine: "gemini" }))
    ).json();
    expect(data.source).toBe("fallback");
    expect(data.situation.prompt).not.toBe(repeated);
  });
});
