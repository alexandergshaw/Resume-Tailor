// node (this repo's default environment). The ROUTE's half of chunk C: that
// the resolver is actually wired in, that only the TOKEN crosses into the
// answer prompt, and that a cold cache costs the answer nothing.
//
// Written BEFORE the implementation exists (step 4b): the whole file fails on
// the missing `@/lib/copilot/answerCodeLanguage` module until wave 2 lands,
// and then on the unwired route until wave 3 does.
//
// A NEW FILE rather than an extension of `route.test.js`, which is already at
// this project's line budget — and because this band needs a mock
// (`answerCodeLanguage`) no other route suite has.
//
// WHY A ROUTE-LEVEL SPY AT ALL, when `answerCodeLanguage.test.js` already
// proves the gates: because every prompt-side and response-side criterion in
// chunk C is green against a resolver that is never wired in. That is the same
// class of defect as the masked fixture BL-2 describes, one layer out — "a
// correct helper that is never wired is this repo's most common way to finish
// green and broken".
//
// WHERE THE GATES ARE ASSERTED, stated so nobody looks for them here: §B.4
// puts all four gates INSIDE `startCodeLanguageResolution`, as the first
// statement, so the route calls it unconditionally and the module decides.
// A route-level spy therefore cannot observe the gates — it can only observe
// that the route hands the module everything the gates need, and that the
// route adds no second gate of its own (which is what AC-C11b and AC-C11d
// forbid). The gate matrix itself lives in
// `lib/copilot/answerCodeLanguage.test.js`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/copilot/answerCodeLanguage", () => ({
  startCodeLanguageResolution: vi.fn(),
  peekCodeLanguage: vi.fn(),
  generateCodeLanguage: vi.fn(),
}));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache, companyFactsCache } from "@/lib/copilot/answerSessionCache";
import { startCodeLanguageResolution, peekCodeLanguage } from "@/lib/copilot/answerCodeLanguage";
// The ADDRESSABLE emitted-precedence unit (AC-C15b2) and the points builder,
// asserted directly. See the "the emitted precedence block" describe below for
// why they are exercised from this file rather than from `answerPrompts.test.js`.
import { codeLanguageLines, buildPointsPrompt } from "@/lib/copilot/answerPrompts";
import { interviewType } from "@/lib/copilot/interviewTypes";

const ROUTE_SOURCE = readFileSync(fileURLToPath(new URL("./route.js", import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// AC-C8d5: EVERY input to the builder is pinned verbatim — the description,
// the prep notes and the question — because the résumé and prep notes reach
// the same prompt (`answerPrompts.js:246`/`:363`/`:369`), and an unpinned
// profile naming Java would make the assertions below depend on a value
// nobody chose. None of the strings below names a programming language.

const DESCRIPTION = [
  "Senior Backend Engineer, Meridian Freight",
  "SALARYBANDMARKER: $145,000 - $180,000 annually.",
  "We run 12 dispatch depots and an on-call rotation across three regions.",
  "Our stack is primarily Go on the backend, with TypeScript on the front end.",
].join("\n");

// The two spans asserted absent from every answer prompt. Chosen from parts of
// the posting that carry no language name at all, so their absence is about
// the DESCRIPTION not crossing rather than about a token being filtered.
const DESCRIPTION_MARKERS = ["SALARYBANDMARKER", "12 dispatch depots", "three regions"];

const PROFILE = [
  "Senior engineer, dispatch and logistics.",
  "Led a platform team of six through a two-year replatform.",
].join("\n");

const QUESTION = "Implement a cache that evicts the least recently used entry.";

const TITLE = "Senior Backend Engineer";

const ANSWER_PAYLOAD = {
  points: ["Name the constraint first.", "Then the trade-off you took."],
  cues: ["The constraint", "The trade-off"],
  type: "technical",
};

function jsonRequest(body) {
  return { json: async () => body };
}

// One `applications` row answers all three of `fetchApplicationDocs`,
// `fetchPostingDescription` and `fetchPostingEmployer` — each issues its own
// `.select(...).eq(...).eq(...).maybeSingle()` against the same table.
//
// `company` is deliberately EMPTY: a known employer would start the
// company-facts search (`answerCompanyFacts.js:63-64`) and put a third Gemini
// call on every request here, which this file has no reason to reason about.
function mockUserWithPosting({ description = DESCRIPTION, title = TITLE } = {}) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => ({ data: [], error: null })),
      maybeSingle: vi.fn(async () => {
        if (table === "applications") {
          return {
            data: {
              id: "app-1",
              resume_used_id: null,
              cover_letter_id: null,
              positions: { description, company: "", title },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from,
  });
}

// POSITIVE identification of each call, per AC-C9d: the answer/points prompts
// are the ones carrying `The interviewer asked:`; the worked-example prompt
// says `The candidate was just asked:` instead and is the only other call.
// A growing EXCLUSION list is exactly what AC-C9d says not to build.
const ANSWER_PROMPT_MARKER = "The interviewer asked:";

function mockGeminiPerCall() {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async (req) => {
    const text = String(req?.contents?.[0]?.parts?.[0]?.text || "");
    if (text.includes(ANSWER_PROMPT_MARKER)) return { text: JSON.stringify(ANSWER_PAYLOAD) };
    // The worked-example call. Unparseable on purpose: its result is an aid
    // beside the answer and falls back to the deterministic archetype, which
    // keeps this file's subject to one thing.
    return { text: "not json at all" };
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

function chunkStream(chunks) {
  return (async function* () {
    for (const text of chunks) yield { text };
  })();
}

function mockGeminiStreaming() {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContentStream = vi.fn().mockResolvedValue(chunkStream([JSON.stringify(ANSWER_PAYLOAD)]));
  const generateContent = vi.fn(async () => ({ text: "not json at all" }));
  getGeminiClient.mockReturnValue({ models: { generateContentStream, generateContent } });
  return generateContentStream;
}

async function drain(res) {
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

// Every prompt this request actually sent to an ANSWER call, whichever entry
// point built it.
function answerPrompts(spy) {
  return spy.mock.calls
    .map((call) => String(call[0]?.contents?.[0]?.parts?.[0]?.text || ""))
    .filter((text) => text.includes(ANSWER_PROMPT_MARKER));
}

const draft = (body) =>
  POST(
    jsonRequest({
      question: QUESTION,
      profile: PROFILE,
      applicationId: "app-1",
      interviewType: "technical",
      codeLanguage: "auto",
      engine: "gemini",
      ...body,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  // `wantsEmbedded` reads `process.env` directly, not the mocked
  // `getServerEnv` — without a key present, a request that omits `engine`
  // silently takes the embedded branch and passes or fails by accident of the
  // developer's own `.env.local`. (Every request here names its engine too.)
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  answerContextCache.clear();
  companyFactsCache.clear();
  startCodeLanguageResolution.mockReset();
  peekCodeLanguage.mockReset();
  peekCodeLanguage.mockReturnValue(null);
  mockUserWithPosting();
});

afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------

describe("the route STARTS the resolution, with everything its gates need (AC-C8d4, AC-C11)", () => {
  it("calls it exactly once per request", async () => {
    mockGeminiPerCall();
    await draft();
    expect(startCodeLanguageResolution).toHaveBeenCalledTimes(1);
  });

  it("hands it the posting description, the title, the override, the engine and the cache key", async () => {
    mockGeminiPerCall();
    await draft();
    const bag = startCodeLanguageResolution.mock.calls[0][0];
    expect(bag.description).toBe(DESCRIPTION);
    expect(bag.title).toBe(TITLE);
    expect(bag.override).toBe("auto");
    expect(bag.engine).toBe("gemini");
    expect(bag.applicationId).toBe("app-1");
    // The key EXACTLY, separator included — not `toContain("user-1")`, which
    // admits any decoration and any ordering.
    expect(bag.cacheKey).toBe("user-1::app-1");
  });

  it("PEEKS UNDER THE KEY IT STARTED UNDER — the two must be the same string (B-2, M-6)", async () => {
    // Two ways to get this wrong, both of which leave every other assertion in
    // this file green:
    //
    //  * decorate one side (`${contextCacheKey}::lang`) and the resolver's
    //    result is unreadable FOREVER — everything imported, everything
    //    called, all four gates firing, the model billed on every posting, and
    //    precedence step 3 permanently empty;
    //  * peek on `applicationId` alone and one user's resolved language is
    //    served to every user of the same posting id — cross-user bleed, which
    //    is worse than inert.
    //
    // Neither is visible to a call-count assertion or to a `toContain` on one
    // side, so the two arguments are compared to EACH OTHER, and each is
    // separately pinned to the user-scoped literal.
    mockGeminiPerCall();
    await draft();

    expect(startCodeLanguageResolution).toHaveBeenCalledTimes(1);
    expect(peekCodeLanguage).toHaveBeenCalledTimes(1);
    const startedWith = startCodeLanguageResolution.mock.calls[0][0].cacheKey;
    const peekedWith = peekCodeLanguage.mock.calls[0][0];
    expect(peekedWith).toBe(startedWith);
    expect(peekedWith).toBe("user-1::app-1");
    // And it is scoped by the USER, not by the application alone.
    expect(peekedWith).not.toBe("app-1");
    expect(peekedWith.startsWith("user-1")).toBe(true);
  });

  it("inspects nothing about the question text (AC-C11)", async () => {
    // "Nothing about the question is inspected server-side." Revision 4
    // required a deterministic language-name parser over the question to gate
    // the resolver, while D20 forbade the same parser on grounds that are
    // engine-independent — "how would you **go** about scaling this?", "a
    // **C**-level summary", "your **R**&D experience". Both halves were
    // withdrawn: precedence step 1 is arbitrated by the PROMPT.
    //
    // Every other case in this file sends the same question, so a
    // question-text gate would be invisible to all of them.
    mockGeminiPerCall();
    await draft({ question: "Write a SQL query for the top 5 customers by revenue this quarter." });
    const first = startCodeLanguageResolution.mock.calls[0][0];
    const firstPeek = peekCodeLanguage.mock.calls[0][0];

    startCodeLanguageResolution.mockClear();
    peekCodeLanguage.mockClear();
    await draft({ question: "Tell me about a time you disagreed with your manager." });
    const second = startCodeLanguageResolution.mock.calls[0][0];

    expect(startCodeLanguageResolution).toHaveBeenCalledTimes(1);
    expect(peekCodeLanguage).toHaveBeenCalledTimes(1);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(peekCodeLanguage.mock.calls[0][0]).toBe(firstPeek);
    expect(Object.keys(second)).not.toContain("question");
  });

  it("hands it the REGISTRY descriptor, never a hand-rolled predicate (CONF-6)", async () => {
    // D4 made code-bearing a property of the registry entry precisely so a new
    // format cannot be added in one place and behave inconsistently in
    // another. A boolean computed at the route reintroduces the second list.
    mockGeminiPerCall();
    await draft({ interviewType: "system-design" });
    const bag = startCodeLanguageResolution.mock.calls[0][0];
    expect(bag.descriptor).toBeTruthy();
    expect(bag.descriptor.value).toBe("system-design");
    expect(bag.descriptor.codeBearing).toBe(true);

    startCodeLanguageResolution.mockClear();
    await draft({ interviewType: "behavioral" });
    expect(startCodeLanguageResolution.mock.calls[0][0].descriptor.codeBearing).toBe(false);
  });

  it("forwards the request's engine so the module's own embedded gate can fire (AC-C21)", async () => {
    // The route must not decide this itself — but it must not SWALLOW it
    // either, or the module's first gate has nothing to read.
    mockGeminiPerCall();
    await draft({ engine: "embedded" });
    expect(startCodeLanguageResolution).toHaveBeenCalledTimes(1);
    expect(startCodeLanguageResolution.mock.calls[0][0].engine).toBe("embedded");
  });

  it("forwards a NON-Auto override rather than skipping the call (AC-C11c is the module's gate)", async () => {
    mockGeminiPerCall();
    await draft({ codeLanguage: "java" });
    expect(startCodeLanguageResolution.mock.calls[0][0].override).toBe("java");
  });

  it("normalizes an unrecognised body value to `auto` before handing it on (AC-C24b)", async () => {
    mockGeminiPerCall();
    await draft({ codeLanguage: "brainfuck" });
    expect(startCodeLanguageResolution.mock.calls[0][0].override).toBe("auto");
    startCodeLanguageResolution.mockClear();
    await draft({ codeLanguage: undefined });
    expect(startCodeLanguageResolution.mock.calls[0][0].override).toBe("auto");
  });

  it("starts it in ANSWER mode too — practice mode is answer mode (AC-C11b)", async () => {
    // `answerCompanyFacts.js` returns null for `mode === "answer"`. Copying
    // that gate faithfully ships a live-only feature with AC-C1's practice
    // control inert.
    mockGeminiPerCall();
    await draft({ mode: "answer" });
    expect(startCodeLanguageResolution).toHaveBeenCalledTimes(1);
    expect(peekCodeLanguage).toHaveBeenCalledTimes(1);
  });

  it("starts it on the STREAMING path too — live mode is the streaming path", async () => {
    const stream = mockGeminiStreaming();
    const res = await draft({ stream: true });
    await drain(res);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(startCodeLanguageResolution).toHaveBeenCalledTimes(1);
  });
});

describe("the peek is consulted once, at POST scope, and never awaited (AC-C13, §C)", () => {
  it("peeks exactly once per request on the non-streaming path", async () => {
    mockGeminiPerCall();
    await draft();
    expect(peekCodeLanguage).toHaveBeenCalledTimes(1);
  });

  it("peeks exactly once per request on the streaming path", async () => {
    // §C rejects peeking inside the producer with cause: `streamAnswer` takes
    // the token as a PARAMETER, so a peek in there would also require
    // threading `cacheKey` into a capped file — and the resolver was started
    // microseconds earlier IN THE SAME REQUEST, so it cannot have settled
    // either way.
    const stream = mockGeminiStreaming();
    const res = await draft({ stream: true });
    await drain(res);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(peekCodeLanguage).toHaveBeenCalledTimes(1);
  });

  it("answers even when the resolution never settles — nothing awaits it", async () => {
    // AC-C13's real property, asserted by construction rather than by a clock:
    // a request that awaited the resolver would never return here.
    startCodeLanguageResolution.mockReturnValue(new Promise(() => {}));
    mockGeminiPerCall();
    const res = await draft();
    const data = await res.json();
    expect(data.points.length).toBeGreaterThan(0);
  });

  it("answers PROMPTLY, not merely eventually — no deadline is raced (AC-C13's named Fails if)", async () => {
    // "Eventually returns" is NOT the criterion. `settleWithin(promise, 2500,
    // { fallback: null })` around the resolution returns eventually too — it
    // just adds 2.5 seconds to EVERY answer request, which is the exact
    // latency regression AC-C13 names, and it sits comfortably inside vitest's
    // default 5 s timeout so a "the request returns" assertion never sees it.
    //
    // Bounded well above the ~tens of milliseconds this fully-mocked request
    // actually costs and well below the 2500 ms deadline the criterion names,
    // so it discriminates without being a machine-speed lottery.
    startCodeLanguageResolution.mockReturnValue(new Promise(() => {}));
    mockGeminiPerCall();
    const started = Date.now();
    const res = await draft();
    await res.json();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("does not import `settleWithin` into the route at all (AC-C13's Fails if, structurally)", () => {
    // The clock bound above is the behavioural half; this is the structural
    // one, and it cannot flake. `settleWithin` races a promise against a
    // deadline and BLOCKS up to `FACTS_DEADLINE_MS = 2500`
    // (`answerSessionCache.js:197-204`) — the opposite of what this criterion
    // requires. The route does not name it today (verified: zero occurrences),
    // and the company-facts wait that legitimately uses it lives behind
    // `resolveCompanyFacts` in its own module.
    expect(ROUTE_SOURCE).not.toContain("settleWithin");
  });

  it("falls to no token on a cold cache, and says nothing about a posting language (AC-C13c, AC-C16b)", async () => {
    peekCodeLanguage.mockReturnValue(null);
    const gemini = mockGeminiPerCall();
    await draft();
    const [prompt] = answerPrompts(gemini);
    expect(prompt).toBeTruthy();
    for (const language of ["Python", "JavaScript", "TypeScript", "Java", "C#", "Go", "SQL"]) {
      expect(prompt).not.toContain(language);
    }
  });

  it("carries NO token from one request into the next (n16 — cross-request bleed)", async () => {
    // `m50` closed cross-user bleed through the KEY; this is the same hazard
    // one layer out, where the route keeps its own `let __lastResolvedLanguage`
    // and falls back to it when the peek misses. Every other case here sets
    // its own `peekCodeLanguage` return and is satisfied either way, because
    // none of them makes a SECOND request whose peek misses.
    peekCodeLanguage.mockReturnValueOnce("Python").mockReturnValue(null);

    const first = mockGeminiPerCall();
    await draft();
    expect(answerPrompts(first).some((p) => p.includes("Python"))).toBe(true);

    // Second request, cold peek. Nothing about the first may survive into it.
    const second = mockGeminiPerCall();
    await draft();
    const prompts = answerPrompts(second);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).not.toContain("Python");
    }
  });

  it("hands the resolver the WHOLE description — the route does not clamp it (AC-C8b2)", async () => {
    // AC-C8b2 requires the validator to compare against the same string the
    // resolver was shown, which `codeLanguagePrompt.js` guarantees by clamping
    // once, privately, on both sides. A second clamp at the route breaks that
    // by construction: the model sees less than the validator will admit
    // quotes from, so a legitimate quote from the truncated tail is rejected
    // and the abstention rate rises for a reason nothing reports.
    //
    // The ordinary fixture is ~200 characters, so any route-side cap is
    // invisible to it. This one is deliberately long.
    const long = `${DESCRIPTION}\n${"We run a large service estate and hire carefully. ".repeat(200)}TAILMARKER`;
    expect(long.length).toBeGreaterThan(9000);
    mockUserWithPosting({ description: long });
    mockGeminiPerCall();
    await draft();

    const bag = startCodeLanguageResolution.mock.calls[0][0];
    expect(bag.description).toBe(long);
    expect(bag.description).toContain("TAILMARKER");
  });

  it("does not consult the cache with an application-less key that could collide", async () => {
    // AC-C14: with no posting selected — live mode's default — the resolution
    // falls to pseudocode with no error, no notice and no empty language.
    peekCodeLanguage.mockReturnValue(null);
    mockGeminiPerCall();
    const res = await draft({ applicationId: "" });
    const data = await res.json();
    expect(data.error).toBeUndefined();
    expect(data.points.length).toBeGreaterThan(0);
  });
});

describe("only the TOKEN crosses into the answer prompt (AC-C9)", () => {
  it("carries the resolved token and provably not the posting description", async () => {
    peekCodeLanguage.mockReturnValue("Go");
    const gemini = mockGeminiPerCall();
    await draft();

    const prompts = answerPrompts(gemini);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      // The token IS there — the positive control, without which the absences
      // below are satisfied by a route that resolves nothing at all.
      expect(prompt).toContain("Go");
      for (const marker of DESCRIPTION_MARKERS) {
        expect(prompt).not.toContain(marker);
      }
    }
  });

  it("carries neither on the STREAMING path either (AC-C9b)", async () => {
    // Sited here rather than left to `idealProjectWiring.test.js`, which
    // sends no `stream` key at all and therefore never reaches `streamAnswer`
    // — and no `interviewType`, so `general` is normalized in and this feature
    // is never exercised there.
    peekCodeLanguage.mockReturnValue("Python");
    const stream = mockGeminiStreaming();
    const res = await draft({ stream: true });
    await drain(res);

    const prompt = String(stream.mock.calls[0][0]?.contents?.[0]?.parts?.[0]?.text || "");
    expect(prompt).toContain(ANSWER_PROMPT_MARKER);
    expect(prompt).toContain("Python");
    for (const marker of DESCRIPTION_MARKERS) {
      expect(prompt).not.toContain(marker);
    }
  });

  it("carries it on the STREAMING ANSWER path — the fourth prompt call site (AC-C12)", async () => {
    // AC-C12 requires the token on all six response paths. `mode: "answer"`
    // and `stream: true` is the combination no other case here exercises, and
    // it is a distinct call site: `streamAnswer` branches on `isAnswerMode` at
    // `route.js:304`, so the answer-mode builder inside the producer is
    // separately reachable from the points-mode one.
    peekCodeLanguage.mockReturnValue("TypeScript");
    const stream = mockGeminiStreaming();
    const res = await draft({ stream: true, mode: "answer" });
    await drain(res);

    expect(stream).toHaveBeenCalledTimes(1);
    const prompt = String(stream.mock.calls[0][0]?.contents?.[0]?.parts?.[0]?.text || "");
    expect(prompt).toContain("TypeScript");
    for (const marker of DESCRIPTION_MARKERS) {
      expect(prompt).not.toContain(marker);
    }
  });

  it("carries it in ANSWER mode's prompt too (AC-C12)", async () => {
    peekCodeLanguage.mockReturnValue("SQL");
    const gemini = mockGeminiPerCall();
    await draft({ mode: "answer" });

    const prompts = answerPrompts(gemini);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toContain("SQL");
      for (const marker of DESCRIPTION_MARKERS) {
        expect(prompt).not.toContain(marker);
      }
    }
  });

  it("emits nothing for a non-code-bearing interview type — both halves of the gate", async () => {
    // `codeLanguageLines` gates on the descriptor AND on having a
    // `codeLanguage` at all. A token cached for this application must not
    // reach a behavioral request's prompt.
    peekCodeLanguage.mockReturnValue("Go");
    const gemini = mockGeminiPerCall();
    await draft({ interviewType: "behavioral", codeLanguage: "csharp" });

    for (const prompt of answerPrompts(gemini)) {
      expect(prompt).not.toContain("CODE LANGUAGE");
      expect(prompt).not.toContain("C#");
    }
  });
});

describe("the emitted precedence carries the LABEL, never the storage slug (§B.1, D-13)", () => {
  it("says C#, not csharp", async () => {
    // "The candidate has said they want csharp." is wrong output. The two
    // vocabularies exist precisely so the storage layer and the prose layer
    // cannot be confused for one another, and `codeLanguageLabel` is the only
    // bridge between them.
    //
    // A whole-prompt assertion over language NAMES is normally unsound here,
    // because the builders interpolate the résumé and prep notes — which is
    // why every input to this request is pinned above and none of them names
    // a language. `csharp` in particular appears nowhere in this fixture.
    peekCodeLanguage.mockReturnValue(null);
    const gemini = mockGeminiPerCall();
    await draft({ codeLanguage: "csharp" });

    const prompts = answerPrompts(gemini);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toContain("C#");
      expect(prompt).not.toContain("csharp");
    }
  });

  it("never lets an UNRECOGNISED body value reach the prompt as a preference (m40)", async () => {
    // The normalizer's output is asserted on the resolver's bag above; this is
    // the other consumer. A route that normalizes for the gate and passes the
    // RAW body value to the prompt builder emits "The candidate has said they
    // want Auto." for `codeLanguage: "brainfuck"` — violating AC-C16b's
    // property on a reachable, client-controlled path that no other case here
    // inspects.
    peekCodeLanguage.mockReturnValue(null);
    const gemini = mockGeminiPerCall();
    await draft({ codeLanguage: "brainfuck" });

    const prompts = answerPrompts(gemini);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toContain("The candidate has not stated a language preference.");
      expect(prompt).not.toMatch(/\bAuto\b/);
      expect(prompt).not.toContain("brainfuck");
    }
  });

  it("says Pseudocode, not pseudocode, on the row where the two differ only by case", async () => {
    // The check's MATERIAL-2 — the row revision 3 of the plan got wrong, and
    // the hardest kind of mismatch to notice by eye.
    peekCodeLanguage.mockReturnValue(null);
    const gemini = mockGeminiPerCall();
    await draft({ codeLanguage: "pseudocode" });

    for (const prompt of answerPrompts(gemini)) {
      expect(prompt).toContain("Pseudocode");
    }
  });
});

describe("the override and the resolved token BOTH reach the prompt (AC-C11d)", () => {
  it("does not suppress step 3 server-side when an override is set", async () => {
    // Gating the PEEK on `Auto` is the withdrawn server-side gate returning in
    // a different place. The reachable state is narrow but real: an `Auto`
    // question warms the cache, the user then sets an override inside the
    // 30-minute TTL, and the model must still see both so it can apply
    // precedence (step 2 over step 3).
    peekCodeLanguage.mockReturnValue("Python");
    const gemini = mockGeminiPerCall();
    await draft({ codeLanguage: "java" });

    const prompts = answerPrompts(gemini);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toContain("Java");
      expect(prompt).toContain("Python");
    }
  });
});

// ---------------------------------------------------------------------------
// AC-C15 / AC-C15b / AC-C15b2 / AC-C16 / AC-C16b, asserted over the emitted
// precedence line ALONE.
//
// WHY THIS BLOCK IS IN THIS FILE. `codeLanguageLines` lives in
// `answerPrompts.js`, whose test file (A-12) is an EXISTING suite this author
// may not modify — and measured, that gap is not a refinement: AC-C15,
// AC-C15b and AC-C15b2 otherwise have no assertion anywhere. Two criteria,
// zero coverage, in a chunk whose whole subject is what the prompt says.
// A-12 must still carry its own copy; this is the floor, not the ceiling.
//
// WHY THE SCOPE IS THE RETURNED ARRAY AND NOT THE PROMPT. AC-C8d's own
// *Fails if* forbids the whole-prompt form: the builders interpolate the prep
// notes (`answerPrompts.js:246`/`:363`) and the résumé (`:369`), so a
// candidate whose résumé says "Built services in Java and Python" puts both
// names into every prompt for reasons that have nothing to do with the
// resolver. **No whole-prompt assertion over language names can ever be
// sound.** That is what AC-C15b2 exists to make writable, and it is why this
// unit is a named surface rather than an implied one.
describe("the emitted precedence block (AC-C15, AC-C15b, AC-C15b2, AC-C16b)", () => {
  const TECHNICAL = interviewType("technical");
  const GENERAL = interviewType("general");

  const block = (codeLanguage, descriptor = TECHNICAL) =>
    codeLanguageLines(descriptor, codeLanguage).join("\n");

  // The four numbered steps, read off the emitted text rather than off array
  // positions, so an implementation that returns one joined string and one
  // that returns six lines are both readable.
  function steps(text) {
    const found = {};
    text.split("\n").forEach((line, index) => {
      const match = /^\s*([1-4])\.\s+(.*)$/.exec(line);
      if (match && found[match[1]] === undefined) found[match[1]] = { index, text: match[2].trim() };
    });
    return found;
  }

  it("takes the descriptor and ONE object — §B.8's cross-wave contract", () => {
    // `codeLanguage` is `{ override, resolved } | undefined`. W1-C writes this
    // function in wave 1; W3-A produces its argument in wave 3 — the only
    // cross-agent contract in the plan whose consumer is written first, and
    // the one place a shape disagreement cannot surface until two waves later,
    // with the repair reaching back into a file its author does not own.
    //
    // A three-positional `(descriptor, override, resolved)` shape is the
    // natural thing to reach for and is what an unguided implementation
    // produces; `Function.prototype.length` is what separates them.
    expect(codeLanguageLines.length).toBe(2);

    // And behaviourally: one object argument must carry BOTH facts.
    const both = block({ override: "java", resolved: "Python" });
    expect(both).toContain("Java");
    expect(both).toContain("Python");
  });

  it("returns [] for a non-code-bearing descriptor, even with a language supplied", () => {
    expect(codeLanguageLines(GENERAL, { override: "java", resolved: "Python" })).toEqual([]);
    expect(codeLanguageLines(undefined, { override: "java", resolved: "Python" })).toEqual([]);
  });

  it("returns [] when no codeLanguage was supplied, even under a code-bearing type", () => {
    // Both halves of the gate are load-bearing and are tested independently:
    // an implementation gated on only one of them is green on every ordinary
    // request and wrong on exactly one path.
    expect(codeLanguageLines(TECHNICAL, undefined)).toEqual([]);
    expect(codeLanguageLines(TECHNICAL, null)).toEqual([]);
  });

  it("emits something under a code-bearing type — the positive control", () => {
    expect(codeLanguageLines(TECHNICAL, { override: "auto", resolved: null }).length).toBeGreaterThan(0);
  });

  it("emits FOUR steps, in order (AC-C15)", () => {
    // Order is the substance of the criterion, not its presentation: key order
    // and instruction-following are prompt-driven, since `route.js:248` sets
    // no `responseSchema`. Two steps, or four in the wrong order, is a
    // different precedence — and "the posting first, the candidate second" is
    // the inversion that quietly overrides what the user just told us.
    const text = block({ override: "java", resolved: "Python" });
    const found = steps(text);
    for (const n of ["1", "2", "3", "4"]) {
      expect(found[n], `step ${n} is missing`).toBeTruthy();
    }
    const order = [found["1"].index, found["2"].index, found["3"].index, found["4"].index];
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // And each step is the step it claims to be.
    expect(found["1"].text).toMatch(/question/i);
    expect(found["4"].text).toMatch(/pseudocode/i);
  });

  it("emits FOUR numbered lines and NOTHING after step 4 (AC-C15, both directions)", () => {
    // A LOWER BOUND CANNOT DETECT AN ADDITION. `steps()` above keeps the first
    // match for each digit, so a second, contradicting block appended after
    // the four steps — "Ignore the ordering above. Actually:", "1. Whatever
    // the posting says.", "2. Nothing else matters." — is invisible to every
    // ordering, wording and no-language assertion in this describe: the first
    // block still reads correctly, and the added lines name no language.
    //
    // So the block is bounded from both ends: exactly four numbered lines,
    // numbered 1-4 in order, and step 4 is the last line there is.
    const lines = codeLanguageLines(TECHNICAL, { override: "java", resolved: "Python" })
      .join("\n")
      .split("\n")
      .filter((line) => line.trim() !== "");
    const numbered = lines.filter((line) => /^\s*\d+\./.test(line));
    expect(numbered).toHaveLength(4);
    expect(numbered.map((line) => /^\s*(\d+)\./.exec(line)[1])).toEqual(["1", "2", "3", "4"]);
    expect(lines[lines.length - 1]).toBe(numbered[3]);
  });

  it("words step 2 as the candidate's stated preference, by equality (AC-C16)", () => {
    expect(steps(block({ override: "java", resolved: null }))["2"].text).toBe(
      "The candidate has said they want Java.",
    );
  });

  it("emits the LABEL in step 2, never the storage slug (§B.1, D-13)", () => {
    // Scoped to the emitted line, which is the sound form of the assertion the
    // route-level case makes against pinned fixtures.
    const csharp = steps(block({ override: "csharp", resolved: null }))["2"].text;
    expect(csharp).toBe("The candidate has said they want C#.");
    expect(csharp).not.toContain("csharp");

    // The row where slug and label differ only by case — the hardest kind to
    // notice, and the one revision 3 of the plan got wrong.
    const pseudo = steps(block({ override: "pseudocode", resolved: null }))["2"].text;
    expect(pseudo).toBe("The candidate has said they want Pseudocode.");
  });

  it("says the candidate stated NO preference when the control reads Auto (AC-C16b)", () => {
    // Not "they want Auto." `Auto` is a control state meaning "infer", not a
    // language, and a prompt that reports it as a preference has invented one
    // the user never expressed — while §0.7d's whole point is that `Auto` is
    // in neither the resolver's set nor the response's.
    const text = block({ override: "auto", resolved: "Python" });
    expect(steps(text)["2"].text).toBe("The candidate has not stated a language preference.");
    expect(text).not.toMatch(/\bAuto\b/);
  });

  it("words step 3 as a DERIVED GUESS, never as a fact about the employer (AC-C15b)", () => {
    const text = block({ override: "auto", resolved: "Python" });
    expect(steps(text)["3"].text).toBe(
      "The posting selected for this application reads as a Python role. That is inferred from the posting's own wording — treat it as a guess, never as a fact about the employer, and do not mention the posting or its wording in your answer.",
    );

    // The banned phrasing, named by the criterion as its own failure. It puts
    // an unqualified claim about the employer's stack into a prompt whose own
    // emitted rules are `answerPrompts.js:228` and `:239`, while the token is
    // by construction not in that block.
    expect(text).not.toMatch(/the language resolved for this application is/i);
    // And the hedge itself is present, so a reworded-but-still-hedged line
    // fails the equality pin above rather than this property.
    expect(text).toMatch(/treat it as a guess/i);
  });

  it("says nothing was established when there is no token (AC-C16b, AC-C8d)", () => {
    const text = block({ override: "auto", resolved: null });
    expect(steps(text)["3"].text).toBe("Nothing in the selected posting resolved to a language.");
    // AC-C8d's prompt-side half, in its sound scope: when the resolver
    // abstains, is not called, or returns something the validator rejects,
    // step 3 names NO language.
    for (const language of ["Python", "JavaScript", "TypeScript", "Java", "C#", "Go", "SQL"]) {
      expect(text).not.toContain(language);
    }
    expect(text).not.toContain("none");
  });
});

describe("buildPointsPrompt's two employer rules are unchanged (AC-C20, automatable half)", () => {
  // "Given §0.7 (ii), this is the load-bearing criterion of the whole
  // crossing" — and it was previously anchored to the wrong file position and
  // enforced by nothing. These two strings are what stop the answering model
  // turning a posting-derived guess into a claim about the employer.
  //
  // TWO PINNED REQUESTS, ONE PER BRANCH, because the two strings are MUTUALLY
  // EXCLUSIVE: `answerPrompts.js:217` is `if (companyKnown && factsBlock)` and
  // `:230` is `} else if (companyKnown) {`, so no single invocation emits
  // both. Expecting one request to emit both — or repairing the resulting
  // failure as `includes(A) || includes(B)` — pins NEITHER string by equality
  // and reproduces the trivially-satisfiable defect this criterion already
  // suffered once.
  //
  // Asserted against the builder directly rather than through a request: the
  // route case that would emit them needs a company on the posting, which
  // starts the company-facts search and puts a third Gemini call on every
  // request in this file for no gain.
  const RULE_WITH_FACTS =
    'A statement about the employer may come ONLY from VERIFIED COMPANY FACTS above. Do not claim research you were not given — never write "my research indicates", "I understand <the company> is", or any equivalent, about anything not in that block.';
  const RULE_WITHOUT_FACTS =
    "No verified facts about the employer were available for this answer. Do not assert anything about the employer — what they do, their market, their size, or any recent development. Where the question is about the employer, say what the candidate would want to find out and connect it to their own experience.";

  const TECHNICAL = interviewType("technical");
  const build = (companyFacts) =>
    buildPointsPrompt(QUESTION, "", PROFILE, TECHNICAL, "", "", "", companyFacts);

  it("Request A — company known, facts survived: emits the VERIFIED-FACTS rule and only it", () => {
    const prompt = build({ companyKnown: true, block: "Meridian Freight runs 12 depots. (source: example.test)" });
    expect(prompt).toContain(RULE_WITH_FACTS);
    expect(prompt).not.toContain(RULE_WITHOUT_FACTS);
  });

  it("Request B — company known, nothing survived: emits the ASSERT-NOTHING rule and only it", () => {
    // The common branch, and the one that matters most here: it fires when no
    // facts are available, i.e. the FIRST question of every session — the same
    // turn on which chunk C's cold-cache pseudocode answer is produced.
    const prompt = build({ companyKnown: true, block: "" });
    expect(prompt).toContain(RULE_WITHOUT_FACTS);
    expect(prompt).not.toContain(RULE_WITH_FACTS);
  });

  it("no employer known: emits neither — the byte-identity branch", () => {
    const prompt = build(undefined);
    expect(prompt).not.toContain(RULE_WITH_FACTS);
    expect(prompt).not.toContain(RULE_WITHOUT_FACTS);
  });
});

describe("the embedded branches are NOT wired, and must not be (AC-C21, D21)", () => {
  it("answers on the embedded engine without reaching a prompt builder for a token", async () => {
    // The two embedded branches return before the four Gemini prompt call
    // sites, and AC-C12 must not be read as an instruction to reach them:
    // `code` is always null on that engine, and `language` lives inside it.
    peekCodeLanguage.mockReturnValue("Go");
    const gemini = mockGeminiPerCall();
    const res = await draft({ engine: "embedded" });
    const data = await res.json();

    expect(data.points.length).toBeGreaterThan(0);
    expect(gemini).not.toHaveBeenCalled();
  });
});
