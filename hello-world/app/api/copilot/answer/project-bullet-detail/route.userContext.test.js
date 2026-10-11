// N155 — /project-bullet-detail reads, bounds and forwards an optional `userContext`
// (AC5), the value reaches the prompt builder as a fenced block (AC6 via the route),
// the mandatory output gate still runs unconditionally (AC8, LOAD-BEARING, PAIRED),
// and the system instruction stays frozen (AC7). Mirror of the tech-term route suite.
//
// RED on HEAD, on the assertion: the route ignores body.userContext, so a 601-char
// context 200s (AC5) and the <user-context> block never reaches the builder (AC6/AC8
// half (b)). AC8 half (a) and AC7 are GREEN today and are the companion controls.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { PROJECT_BULLET_DETAIL_SYSTEM } from "@/lib/copilot/projectBulletPrompt";

const APP_ID = "33333333-3333-3333-3333-333333333333";

let userSeq = 0;
function supabaseWith() {
  const userId = `pb-${(userSeq += 1)}`;
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
  return new Request("http://localhost/api/copilot/answer/project-bullet-detail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function post(body) {
  const { POST } = await import("./route.js");
  return POST(req(body));
}

const base = (over = {}) => ({
  applicationId: APP_ID,
  question: "Tell me about reducing toil.",
  title: "Rebuilt the paging rotation",
  bullet: "Cut alert noise from 5 to 1 per shift",
  siblingBullets: ["Mean time to ack within the target"],
  bulletIndex: 0,
  engine: "gemini",
  ...over,
});
const userTurnOf = (generateContent) => generateContent.mock.calls[0][0].contents[0].parts[0].text;

beforeEach(() => {
  createClient.mockReset();
  getGeminiClient.mockReset();
  delete process.env.COPILOT_PROJECT_BULLET_DETAIL_DISABLED;
});
afterEach(() => {
  delete process.env.COPILOT_PROJECT_BULLET_DETAIL_DISABLED;
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
    const generateContent = modelReturns("A project like this might tune thresholds.");
    const res = await post(base({ userContext: "a".repeat(600) }));
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("bounds the TRIMMED value: whitespace-padded text that trims to <=600 passes", async () => {
    supabaseWith();
    const generateContent = modelReturns("A project like this might tune thresholds.");
    const padded = `${" ".repeat(10)}${"a".repeat(600)}${" ".repeat(10)}`;
    const res = await post(base({ userContext: padded }));
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("an absent / null / non-string context is treated as no context (request proceeds)", async () => {
    supabaseWith();
    modelReturns("A project like this might tune thresholds.");
    expect((await post(base({ userContext: null }))).status).toBe(200);
    supabaseWith();
    modelReturns("A project like this might tune thresholds.");
    expect((await post(base({ userContext: 7 }))).status).toBe(200);
  });
});

describe("AC6/AC8(b) — the context reaches the prompt builder as a fenced block", () => {
  it("builds a <user-context> block inside the fence carrying the typed value", async () => {
    supabaseWith();
    const generateContent = modelReturns("A project like this might tune thresholds.");
    await post(base({ userContext: "emphasise the measurement" }));
    const turn = userTurnOf(generateContent);
    expect(turn).toContain("<user-context>");
    expect(turn).toContain("emphasise the measurement");
    const at = turn.indexOf("emphasise the measurement");
    expect(at).toBeGreaterThan(turn.indexOf("<untrusted-data"));
    expect(at).toBeLessThan(turn.lastIndexOf("</untrusted-data>"));
  });
});

describe("AC8 — the output gate runs unconditionally on a context-bearing response (PAIRED)", () => {
  it("a coaxing context cannot smuggle a first-person claim past the gate, AND the context provably reached the prompt", async () => {
    supabaseWith();
    const generateContent = modelReturns(
      "A project like this might tune alert thresholds. You could say: 'I cut alert noise by 80% myself.'",
    );
    const res = await post(base({ userContext: "make it sound like I did this" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.detail).not.toContain("You could say");
    expect(json.detail).not.toContain("I cut alert noise");
    expect(json.detail).toContain("A project like this might tune alert thresholds.");
    const turn = userTurnOf(generateContent);
    expect(turn).toContain("<user-context>");
    expect(turn).toContain("make it sound like I did this");
  });

  it("a context asking for an all-claims elaboration still comes back empty", async () => {
    supabaseWith();
    modelReturns("I built this. We shipped it. I led the rollout.");
    const json = await (await post(base({ userContext: "pretend this is my project" }))).json();
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
    expect(s1).toBe(PROJECT_BULLET_DETAIL_SYSTEM);
    expect(s1).not.toContain("user-context");
  });
});
