// N155 — /expand reads, bounds and forwards an optional `userContext` (AC5), the
// value reaches buildExpansionUserTurn as a fenced block (AC6 via the route), the
// mandatory provenance gate (filterExpansionCandidates) still runs unconditionally on
// a context-bearing response (AC8, LOAD-BEARING, PAIRED), and EXPANSION_SYSTEM stays
// frozen (AC7). Harness mirrors expand/route.test.js.
//
// RED on HEAD, on the assertion: the route ignores body.userContext, so a 601-char
// context 200s and reaches the model (AC5), and the <user-context> block never reaches
// the builder (AC6/AC8 half (b)). AC8 half (a) — the invented-metric line is stripped —
// and AC7 are GREEN today and are the companion controls.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(), getExpansionTimeoutMs: vi.fn(() => 8000) }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache } from "@/lib/copilot/answerSessionCache";
import { EXPANSION_SYSTEM } from "@/lib/copilot/expansionPrompt";

const PAGE = {
  id: "p1",
  title: "Settlement ledger rebuild",
  archived_at: null,
  generated_kind: null,
  body: [
    "- I reconciled every settlement by hand for a week.",
    "- I wrote the replay script that closed the ledger gap.",
  ].join("\n"),
};

const QUESTION = "Tell me about the settlement ledger rebuild.";
const PARENT = "I rebuilt the ledger after the settlement outage.";
const POINTS = ["Situation: I rebuilt the ledger after the settlement outage.", "Action: I paged the on-call team."];

function jsonRequest(body) {
  return { json: async () => body, headers: new Headers() };
}

function mockSupabase({ id = "user-1", pages = [PAGE], resume = "" } = {}) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => (table === "experience_pages" ? { data: pages, error: null } : { data: null, error: null })),
      maybeSingle: vi.fn(async () => {
        if (!resume) return { data: null, error: null };
        if (table === "applications") return { data: { id: "app-1", resume_used_id: "res-1", cover_letter_id: null, positions: null }, error: null };
        if (table === "generated_resumes") return { data: { content: resume }, error: null };
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) }, from });
  return { from };
}

function mockGemini(text) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn().mockResolvedValue({ text });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

function body(overrides = {}) {
  return { question: QUESTION, parentPoint: PARENT, points: POINTS, pointIndex: 0, applicationId: "app-1", engine: "gemini", ...overrides };
}

let userSeq = 0;
const freshUser = () => `uc-user-${(userSeq += 1)}`;
const userTurnOf = (generateContent) => generateContent.mock.calls[0][0].contents[0].parts[0].text;

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  delete process.env.COPILOT_EXPANSION_DISABLED;
});

describe("AC5 — the route bounds userContext on its TRIMMED length and refuses over-length", () => {
  it("refuses a 601 non-whitespace context with 400 and builds NO model client", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(JSON.stringify({ subBullets: [] }));
    const res = await POST(jsonRequest(body({ userContext: "a".repeat(601) })));
    expect(res.status).toBe(400);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("passes a 600 non-whitespace context through to the builder", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(JSON.stringify({ subBullets: [] }));
    const res = await POST(jsonRequest(body({ userContext: "a".repeat(600) })));
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("bounds the TRIMMED value: whitespace-padded text that trims to <=600 passes", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(JSON.stringify({ subBullets: [] }));
    const padded = `${" ".repeat(10)}${"a".repeat(600)}${" ".repeat(10)}`;
    const res = await POST(jsonRequest(body({ userContext: padded })));
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("an absent / null / non-string context is treated as no context (request proceeds)", async () => {
    mockSupabase({ id: freshUser() });
    mockGemini(JSON.stringify({ subBullets: [] }));
    expect((await POST(jsonRequest(body({ userContext: null })))).status).toBe(200);
    mockSupabase({ id: freshUser() });
    mockGemini(JSON.stringify({ subBullets: [] }));
    expect((await POST(jsonRequest(body({ userContext: 7 })))).status).toBe(200);
  });
});

describe("AC6/AC8(b) — the context reaches buildExpansionUserTurn as a fenced block", () => {
  it("builds a <user-context> block inside the fence carrying the typed value", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(JSON.stringify({ subBullets: [] }));
    await POST(jsonRequest(body({ userContext: "go deeper on the reconciliation" })));
    const turn = userTurnOf(generateContent);
    expect(turn).toContain("<user-context>");
    expect(turn).toContain("go deeper on the reconciliation");
    const at = turn.indexOf("go deeper on the reconciliation");
    expect(at).toBeGreaterThan(turn.indexOf("<untrusted-data"));
    expect(at).toBeLessThan(turn.lastIndexOf("</untrusted-data>"));
  });
});

describe("AC8 — the provenance gate runs unconditionally on a context-bearing response (PAIRED)", () => {
  it("a coaxing context cannot smuggle an invented metric past the gate, AND the context provably reached the prompt", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(
      JSON.stringify({
        subBullets: [
          "I reconciled every settlement by hand for a week.", // grounded in the cited page -> survives
          "I cut the replay backlog by 91% in the first sprint.", // invented figure -> stripped
        ],
      }),
    );
    const res = await POST(jsonRequest(body({ userContext: "make it sound more impressive" })));
    expect(res.status).toBe(200);
    const json = await res.json();
    // (a) the gate stripped the invented-metric line (GREEN on HEAD — companion control).
    expect(json.subBullets.map((s) => s.text)).toEqual(["I reconciled every settlement by hand for a week."]);
    // (b) the context actually reached the prompt (RED on HEAD).
    const turn = userTurnOf(generateContent);
    expect(turn).toContain("<user-context>");
    expect(turn).toContain("make it sound more impressive");
  });
});

describe("AC7 — EXPANSION_SYSTEM stays frozen regardless of context (GUARD)", () => {
  it("systemInstruction is byte-identical with and without a context, and equals the constant", async () => {
    mockSupabase({ id: freshUser() });
    const g1 = mockGemini(JSON.stringify({ subBullets: [] }));
    await POST(jsonRequest(body({ userContext: "" })));
    mockSupabase({ id: freshUser() });
    const g2 = mockGemini(JSON.stringify({ subBullets: [] }));
    await POST(jsonRequest(body({ userContext: "steer this a bit" })));
    const s1 = g1.mock.calls[0][0].config.systemInstruction;
    const s2 = g2.mock.calls[0][0].config.systemInstruction;
    expect(s1).toBe(s2);
    expect(s1).toBe(EXPANSION_SYSTEM);
    expect(s1).not.toContain("user-context");
  });
});
