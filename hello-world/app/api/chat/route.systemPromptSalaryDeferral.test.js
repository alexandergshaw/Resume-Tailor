// N65 step 4 — the general /api/chat prompt must DEFER a posting's salary-number
// question to the dedicated grounded estimate path, not free-text an ungrounded
// figure (the whole point of N65: the panel emits an uncited number today).
//
// This is a PROMPT-CONSTANT change, so the falsifiable bar is what S9/S16 name:
// the model's system instruction must instruct deferral to the "Estimate salary"
// feature. Whether the non-deterministic model always obeys is NOT falsifiable
// by a test — that residue is S16, a manual/adversarial check at 6/8b, and is
// disclosed, never asserted green here.
//
// WHY OFF THE WIRE, not off the source file. route.js builds
// `const systemInstruction = SYSTEM_PROMPT` (route.js:331) and hands it to
// generateContent as `config.systemInstruction`. Reading the object the SDK is
// actually handed proves the directive reaches the model through the real POST
// path, and needs no private export of the module-scope constant (which reading
// raw source would require, or a source-text scan that cannot tell the constant
// from a comment). Same wire-reading idiom as route.promptInjection.test.js.
//
// This is a MANDATED-DIRECTIVE gate (a prompt directive the AC requires), so a
// text match is admissible — but only WITH a canary that proves the matcher
// discriminates. Both are below.
//
// RED on HEAD: SYSTEM_PROMPT (route.js:23-32) has no salary handling at all; its
// only pay-adjacent clause invites "here is what I can infer from the
// title/company". The deferral assertion fails; the canary passes at HEAD,
// proving the matcher is not vacuous.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent: vi.fn(), extractUrls: vi.fn(() => []) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/logChatMessage", () => ({ logChatMessage: vi.fn(async () => {}) }));

import { POST } from "./route.js";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { createClient } from "@/lib/supabase/server";
import { extractUrls } from "@/lib/scrape/fetchUrlContent";

function jsonRequest(body) {
  return { json: async () => body };
}

// `engine: "gemini"` is mandatory (see route.promptInjection.test.js): without a
// key/env, wantsEmbedded(undefined) is true and the route short-circuits into
// the embedded branch, generateContent is never called, and nothing is asserted.
function payload(extra = {}) {
  return { engine: "gemini", messages: [{ role: "user", content: "What does this role pay?" }], ...extra };
}

let generateContent;

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } });
  generateContent = vi.fn(async () => ({ text: "ok" }));
  getServerEnv.mockReturnValue({ geminiModel: "gemini-test" });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  extractUrls.mockReturnValue([]);
});

async function systemInstruction() {
  const res = await POST(jsonRequest(payload()));
  expect(
    generateContent,
    `generateContent was never called — the request fell into the embedded branch or threw (status ${res?.status}).`,
  ).toHaveBeenCalledTimes(1);
  return String(generateContent.mock.calls[0][0]?.config?.systemInstruction ?? "");
}

// The mandated directive: salary/pay questions are routed to the dedicated
// "Estimate salary" estimate feature. Deliberately tolerant of phrasing — the
// affordance name ("Estimate salary" / "salary estimate") or an explicit
// "dedicated … estimate" is what any conformant wording lands on. It is NOT a
// bare "estimate" + "pay" co-occurrence (that would pass on unrelated prose).
const DEFERS_SALARY = /estimate salary|salary[- ]estimate|dedicated[^.]{0,60}(salary|pay|compensation)[^.]{0,30}estimate|(salary|pay|compensation)[^.]{0,30}estimate (feature|tool|button|affordance|option)/i;

describe("N65 S9/S16 — /api/chat defers a posting's salary number to the estimate feature", () => {
  it("the system instruction directs salary questions to the dedicated estimate path", async () => {
    // RED on HEAD: SYSTEM_PROMPT has no salary-deferral directive.
    expect(DEFERS_SALARY.test(await systemInstruction())).toBe(true);
  });

  it("CANARY: the deferral matcher discriminates (fires on a conformant sentence, not on ordinary prose)", async () => {
    // Positive: a plausible conformant directive matches.
    expect(DEFERS_SALARY.test("For a posting's pay, use the Estimate salary feature rather than guessing a number.")).toBe(true);
    expect(DEFERS_SALARY.test("Point the user at the dedicated salary estimate instead of stating a figure.")).toBe(true);
    // Negative: unrelated career prose does NOT match — so the RED above is a
    // real absence, not a matcher that never fires.
    expect(DEFERS_SALARY.test("You are a concise, friendly career assistant. Answer briefly in plain prose.")).toBe(false);
    // And the CURRENT prompt (with its "infer from the title/company" clause)
    // must not accidentally satisfy the matcher — pins why HEAD is red.
    expect(
      DEFERS_SALARY.test(
        "only if the description text is literally empty say something like 'here is what I can infer from the title/company'",
      ),
    ).toBe(false);
  });
});
