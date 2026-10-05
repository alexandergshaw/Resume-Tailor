// N102 AC-5 (server half) + AC-6 (HARD SAFETY, bundled) + AC-4 (OFF identity)
// -- the first-person persona framing on the Gemini wire.
//
// Every assertion is taken off `generateContent.mock.calls[0][0]` -- the exact
// object handed to the SDK -- for the reason route.promptInjection.test.js's
// header records (MEMORY: gemini-tools-nesting: an injected fake cannot see the
// layer that drops your argument). The mock/harness here is the same shape as
// that landed suite; `engine: "gemini"` is MANDATORY on every payload so the
// request does not fall into the embedded branch and leave `generateContent`
// uncalled (route.js:268; the trap route.promptInjection documents at :72-83).
//
// WHY THE SUBSTRING ASSERTIONS ARE WIDE. The exact wording of the directive is
// the implementer's to tune for live quality (AC-10 / [ENV]); the CONTRACT is
// that the ON wire instructs first-person-as-the-user AND forbids inventing
// personal facts, as ONE bundled unit. So the tests match wide families of
// phrasing, never a literal sentence -- rewording the directive does not red
// them; DELETING either half does.
//
// RED-ON-HEAD: the system instruction is a request-invariant constant today
// (route.js:335, `const systemInstruction = SYSTEM_PROMPT;`); no answerAsMe
// branch exists, so the ON wire is identical to the OFF wire and carries
// neither directive. The bundling and first-person cases red; the OFF-identity
// and strict-coercion cases are the voice-only / fail-safe guards.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));
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

function payload(extra = {}) {
  return {
    engine: "gemini",
    messages: [{ role: "user", content: "Reply to this recruiter email for me." }],
    ...extra,
  };
}

let generateContent;

function reinstallClient() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  });
  generateContent = vi.fn(async () => ({ text: "ok" }));
  getServerEnv.mockReturnValue({ geminiModel: "gemini-test" });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  extractUrls.mockReturnValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  reinstallClient();
});

async function callWire(body) {
  const res = await POST(jsonRequest(payload(body)));
  expect(
    generateContent,
    `generateContent was never called -- the request fell into the embedded branch or threw. POST returned status ${res?.status}.`,
  ).toHaveBeenCalledTimes(1);
  return generateContent.mock.calls[0][0];
}

function systemInstructionOf(wire) {
  return String(wire?.config?.systemInstruction ?? "");
}

// Capture a fresh wire's system instruction, re-arming the mock each time so
// one call cannot be mistaken for another.
async function systemInstructionFor(body) {
  vi.clearAllMocks();
  reinstallClient();
  return systemInstructionOf(await callWire(body));
}

// Deliberately WIDE phrasing families -- the point is the idea is present, not
// how it reads.
const FIRST_PERSON =
  /first[-\s]?person|as (?:the user|yourself|me|them|themselves)|in (?:the user'?s|your|my) voice|speak as (?:the user|them|me)|(?:write|draft|respond|reply)[^.]{0,60}\bas (?:the user|yourself|me|them)\b/i;
const NO_FABRICATION =
  /\bnever\s+(?:invent|fabricat|make up)|do not\s+(?:invent|fabricat|make up)|only\s+(?:from|using)\s+(?:the\s+)?(?:facts|information|details)(?:\s+(?:given|provided))?|not\s+(?:to\s+)?(?:invent|fabricat)|without\s+(?:inventing|fabricating)/i;

describe("AC-5 server: the ON wire instructs first-person-as-the-user", () => {
  it("with answerAsMe=true the systemInstruction tells the model to answer AS the user", async () => {
    const on = systemInstructionOf(await callWire({ answerAsMe: true }));
    expect(on).toMatch(FIRST_PERSON);
  });

  it("with the flag OFF the first-person directive is ABSENT", async () => {
    // The discriminating OFF guard: OFF must reproduce today's assistant voice,
    // so the first-person framing must not be present. This catches an
    // always-on build that ignores the flag.
    const off = systemInstructionOf(await callWire({ answerAsMe: false }));
    expect(off).not.toMatch(FIRST_PERSON);
  });
});

// The portion the ON arm APPENDS, isolated from the baseline. This is
// load-bearing: SYSTEM_PROMPT already contains a SALARY-specific truthfulness
// clause ("never invent a specific pay figure"), which the NO_FABRICATION
// family would otherwise match on the full wire -- making the no-fab half
// vacuous (the no-fab-deleted mutant would survive, satisfied by the salary
// clause). Scoping to the appended directive measures the GENERAL personal-fact
// guard the directive is supposed to carry, independent of the salary clause.
async function appendedDirective(flagBody) {
  const bare = await systemInstructionFor({});
  const on = await systemInstructionFor(flagBody);
  expect(on.startsWith(bare), "the ON wire must preserve SYSTEM_PROMPT verbatim and append").toBe(true);
  return on.slice(bare.length);
}

describe("AC-6 HARD SAFETY: first-person voice and no-fabrication are bundled", () => {
  it("the APPENDED directive carries BOTH the first-person voice AND the no-fabrication clause", async () => {
    // The make-wrong-impossible assertion: both substrings present in the SAME
    // appended unit. The mutation control (delete the no-fab clause from the
    // directive constant) reds exactly this case while the first-person case
    // above stays green -- proving the two halves are joined, not independently
    // present, and that the no-fab half is NOT being satisfied by the baseline
    // salary clause.
    const directive = await appendedDirective({ answerAsMe: true });
    expect(directive, "first-person voice missing from the appended directive").toMatch(FIRST_PERSON);
    expect(directive, "no-fabrication clause missing from the appended directive").toMatch(NO_FABRICATION);
  });

  it("the appended directive names the personal facts it must not invent", async () => {
    // Positive, specific: the guard is about biographical facts (experience,
    // credentials, employers, titles, dates, metrics), not a vague "be
    // honest". Wide alternation over the enumerated kinds; at least two must
    // appear so a one-word stub cannot pass.
    const directive = await appendedDirective({ answerAsMe: true });
    const kinds = [
      /experience/i,
      /credential/i,
      /employer/i,
      /\btitles?\b/i,
      /\bdates?\b/i,
      /metric/i,
      /biographical/i,
    ];
    const hits = kinds.filter((re) => re.test(directive)).length;
    expect(hits, `expected >=2 named fact kinds in the directive: ${directive}`).toBeGreaterThanOrEqual(2);
  });

  it("OFF appends nothing, so no general no-fabrication guard is added when the flag is off", async () => {
    // The guard rides in ONLY with the as-me directive. Proven by byte-identity
    // to the baseline (the AC-4 block also pins off === bare); here, framed as
    // the directive being empty. The salary clause lives in the baseline and is
    // deliberately NOT measured.
    const bare = await systemInstructionFor({});
    const off = await systemInstructionFor({ answerAsMe: false });
    expect(off).toBe(bare);
    expect(off.slice(bare.length)).toBe("");
  });
});

describe("AC-4 / AC-5: OFF reproduces today's voice; ON appends to it", () => {
  it("the OFF wire is identical to the no-flag baseline wire", async () => {
    // AC-4 baseline-equality (GUARD): with the flag off, the systemInstruction
    // is what it is today -- same string as a request that never mentions the
    // flag. SYSTEM_PROMPT is a module-local const (not exported, and this test
    // does not force an export per standing rule 6), so the baseline is read
    // from a live no-flag request rather than imported.
    const bare = await systemInstructionFor({});
    const off = await systemInstructionFor({ answerAsMe: false });
    expect(off).toBe(bare);
    expect(bare.length).toBeGreaterThan(0);
  });

  it("the ON wire STARTS WITH the baseline and then differs (appends, never replaces)", async () => {
    const bare = await systemInstructionFor({});
    const on = await systemInstructionFor({ answerAsMe: true });
    expect(on).not.toBe(bare);
    // The base prompt is preserved verbatim and the directive is appended,
    // never substituted -- the career-assistant guidance still applies.
    expect(on.startsWith(bare)).toBe(true);
    expect(on.length).toBeGreaterThan(bare.length);
  });
});

describe("AC-5 server: the server re-applies the safe-OFF default (strict === true)", () => {
  // The server must not trust a malformed flag from a direct caller. Only the
  // boolean `true` turns the persona on; any other shape is OFF. A mutant that
  // loosens `=== true` to a truthy check lets the string "true" (or 1) through
  // -- these cases catch it.
  const malformed = [
    ["the string \"true\"", "true"],
    ["the number 1", 1],
    ["the string \"1\"", "1"],
    ["the string \"yes\"", "yes"],
    ["an object", {}],
  ];

  it.each(malformed)("a %s value does NOT turn the persona on", async (_label, value) => {
    const bare = await systemInstructionFor({});
    const wire = await systemInstructionFor({ answerAsMe: value });
    expect(wire).toBe(bare);
    expect(wire).not.toMatch(FIRST_PERSON);
  });
});

// --- AC-10: ENV-gated, never green in CI ------------------------------------
//
// The LIVE behaviours -- does Gemini actually speak first person, and does it
// actually decline to invent facts under the directive -- are owner-env,
// verified against the real service with a real key, and MUST NOT be gated in
// CI (AC-10). Skipped unless GEMINI_API_KEY is present so this leg is never a
// false green offline. The offline AC-6 proxy above is what CI enforces.
const describeLive = process.env.GEMINI_API_KEY ? describe : describe.skip;
describeLive("AC-10 [ENV]: live first-person + live no-fabrication", () => {
  it("the live model's reply reads in first person as the user (owner-env)", () => {
    // Intentionally a placeholder: wiring a live call belongs to the owner's
    // env run, not CI. This block exists so the boundary is declared in the
    // suite, not silently omitted.
    expect(Boolean(process.env.GEMINI_API_KEY)).toBe(true);
  });
});
