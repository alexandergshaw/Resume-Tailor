// N155 — /tech-term-detail reads, bounds and forwards an optional `userContext`
// (AC5), the value reaches the prompt builder as a fenced block (AC6 via the route),
// the mandatory output gate still runs unconditionally on a context-bearing response
// (AC8, LOAD-BEARING, PAIRED), and the system instruction stays frozen (AC7).
//
// RED on HEAD, on the assertion: the route exists and simply ignores body.userContext,
// so a 601-char context 200s (AC5 reds), the <user-context> block never reaches the
// builder (AC6/AC8 half (b) reds). AC8 half (a) and AC7 are GREEN today (the gate and
// the frozen constant already hold) — they are the companion controls that make AC8
// non-zero-power and keep AC7 a guard.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { TECH_TERM_DETAIL_SYSTEM } from "@/lib/copilot/techTermPrompt";

const APP_ID = "22222222-2222-2222-2222-222222222222";

let userSeq = 0;
function supabaseWith() {
  const userId = `d-${(userSeq += 1)}`;
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: APP_ID, user_id: userId, positions: { id: "p1", title: "SRE" } }, error: null });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => chain),
  });
}

function modelReturns(text) {
  const generateContent = vi.fn(async () => ({ text }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

function req(body) {
  return new Request("http://localhost/api/copilot/answer/tech-term-detail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function post(body) {
  const { POST } = await import("./route.js");
  return POST(req(body));
}

const base = (over = {}) => ({ applicationId: APP_ID, question: "Tell me about retries.", term: "idempotency keys", engine: "gemini", ...over });
const userTurnOf = (generateContent) => generateContent.mock.calls[0][0].contents[0].parts[0].text;

beforeEach(() => {
  createClient.mockReset();
  getGeminiClient.mockReset();
  delete process.env.COPILOT_TECH_TERM_DETAIL_DISABLED;
});
afterEach(() => {
  delete process.env.COPILOT_TECH_TERM_DETAIL_DISABLED;
});

describe("AC5 — the route bounds userContext on its TRIMMED length and refuses over-length", () => {
  it("refuses a 601 non-whitespace context with 400 and builds NO model client", async () => {
    supabaseWith();
    const generateContent = modelReturns("unused");
    const res = await post(base({ userContext: "a".repeat(601) }));
    expect(res.status).toBe(400);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("passes a 600 non-whitespace context through to the builder", async () => {
    supabaseWith();
    const generateContent = modelReturns("Idempotency keys dedupe retried requests.");
    const res = await post(base({ userContext: "a".repeat(600) }));
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("bounds the TRIMMED value: whitespace-padded text that trims to <=600 passes", async () => {
    supabaseWith();
    const generateContent = modelReturns("Idempotency keys dedupe retried requests.");
    const padded = `${" ".repeat(10)}${"a".repeat(600)}${" ".repeat(10)}`; // raw 620, trimmed 600
    const res = await post(base({ userContext: padded }));
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("an absent / null / non-string context is treated as no context (request proceeds)", async () => {
    supabaseWith();
    modelReturns("Idempotency keys dedupe retried requests.");
    expect((await post(base({ userContext: null }))).status).toBe(200);
    supabaseWith();
    modelReturns("Idempotency keys dedupe retried requests.");
    expect((await post(base({ userContext: 7 }))).status).toBe(200);
  });
});

describe("AC6/AC8(b) — the context reaches the prompt builder as a fenced block", () => {
  it("builds a <user-context> block inside the fence carrying the typed value", async () => {
    supabaseWith();
    const generateContent = modelReturns("Idempotency keys dedupe retried requests.");
    await post(base({ userContext: "focus on the failure modes" }));
    const turn = userTurnOf(generateContent);
    expect(turn).toContain("<user-context>");
    expect(turn).toContain("focus on the failure modes");
    // Inside the untrusted-data fence, as DATA.
    const at = turn.indexOf("focus on the failure modes");
    expect(at).toBeGreaterThan(turn.indexOf("<untrusted-data"));
    expect(at).toBeLessThan(turn.lastIndexOf("</untrusted-data>"));
  });
});

describe("AC8 — the output gate runs unconditionally on a context-bearing response (PAIRED)", () => {
  it("a coaxing context cannot smuggle a first-person claim past the gate, AND the context provably reached the prompt", async () => {
    supabaseWith();
    const generateContent = modelReturns(
      "Idempotency keys dedupe retried requests. You could say: 'I used idempotency keys to stop double charges.'",
    );
    const res = await post(base({ userContext: "make it sound like I did this" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // (a) the gate stripped the fabricated first-person line (GREEN on HEAD — the
    //     companion control that keeps this test non-zero-power).
    expect(json.detail).not.toContain("I used");
    expect(json.detail).not.toContain("You could say");
    expect(json.detail).toContain("Idempotency keys dedupe retried requests.");
    // (b) the context actually reached the prompt (RED on HEAD — a build that
    //     ignored userContext would pass (a) alone, which is why both halves run).
    const turn = userTurnOf(generateContent);
    expect(turn).toContain("<user-context>");
    expect(turn).toContain("make it sound like I did this");
  });

  it("a context asking for an all-claims detail still comes back empty", async () => {
    supabaseWith();
    modelReturns("I used Redis here. We built the cache. I led the rollout.");
    const json = await (await post(base({ userContext: "pretend this is my experience" }))).json();
    expect(json.detail).toBe("");
    expect(json.empty).toBe(true);
  });
});

describe("AC7 — the system instruction stays frozen regardless of context (GUARD)", () => {
  it("systemInstruction is byte-identical with and without a context, and equals the constant", async () => {
    supabaseWith();
    const g1 = modelReturns("A.");
    await post(base({ userContext: "" }));
    supabaseWith();
    const g2 = modelReturns("B.");
    await post(base({ userContext: "steer this a bit" }));
    const s1 = g1.mock.calls[0][0].config.systemInstruction;
    const s2 = g2.mock.calls[0][0].config.systemInstruction;
    expect(s1).toBe(s2);
    expect(s1).toBe(TECH_TERM_DETAIL_SYSTEM);
    expect(s1).not.toContain("user-context");
  });
});
