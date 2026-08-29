// node (this repo's default environment). `lib/copilot/answerCodeLanguage.js`
// — the resolver's call wrapper, its four gates, and the peek.
//
// Written BEFORE the implementation exists (step 4b): every case fails on the
// missing `./answerCodeLanguage.js` module until wave 2 lands.
//
// THREE THINGS THIS FILE EXISTS FOR, each guarding a defect that has already
// been proven to hide exactly here:
//
//  1. THE RESOLVER MUST BE OBSERVABLE (BL-2 / AC-C8d3 / AC-C28b constraint 2).
//     Behind a working AC-C8b validator, FOUR different implementations produce
//     identical post-validation output on a posting that names no language: an
//     abstaining resolver, a maximally fabricating one whose answer the
//     validator rejects, one that returns junk, and one that NEVER CALLS THE
//     RESOLVER AT ALL. The validator masks the resolver completely — the test
//     passes hardest against a feature that does not exist. So the RAW
//     pre-validation value has to be observable in production, and it is
//     asserted here rather than inferred.
//  2. THE `|| fallback` IDIOM IS BANNED AT THE PEEK SITE (CONF-5/BL-4). The
//     precedent this mirrors is `companyFactsCache.peek(cacheKey) || []`, and
//     copying that truthiness test sends a cached `"none"` — which is TRUTHY —
//     straight into precedence step 3, with every other criterion green.
//     Shape alone is no guard: an object is truthy too. The case below asserts
//     the observable effect (a cached abstention peeks as `null`), paired with
//     its positive control, so it cannot be satisfied by a peek that returns
//     `null` for everything.
//  3. THE GATES RUN FIRST, AND `mode` IS NOT ONE OF THEM. `answerCompanyFacts.js`
//     — the precedent whose shape this copies — returns early for
//     `mode === "answer"`, because `buildAnswerPrompt` had nowhere to put the
//     result. Practice mode IS answer mode, so an implementer copying the
//     precedent faithfully ships a live-only feature with AC-C1's practice
//     control inert (AC-C11b).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

// A DELEGATING spy on the validator — the real one still runs, so every
// mapping row below still exercises the real algorithm. What the spy adds is
// the ability to assert **which haystack the wrapper handed it**, which is the
// one thing no amount of testing the validator in isolation can reach: pinning
// `options.description` at the unit level says nothing about what
// `generateCodeLanguage` passes AS `description`.
vi.mock("./codeLanguagePrompt.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, validateResolvedLanguage: vi.fn(actual.validateResolvedLanguage) };
});

import {
  startCodeLanguageResolution,
  peekCodeLanguage,
  generateCodeLanguage,
} from "./answerCodeLanguage.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { codeLanguageCache, companyFactsCache } from "./answerSessionCache.js";
import { interviewType } from "./interviewTypes.js";
import { AUTO, NONE } from "./codeLanguages.js";
import {
  CODE_LANGUAGE_SYSTEM,
  buildCodeLanguagePrompt,
  validateResolvedLanguage,
} from "./codeLanguagePrompt.js";

// ---------------------------------------------------------------------------
// Fixtures, pinned verbatim (AC-C8d5).

// `SALARYBANDMARKER` sits OUTSIDE every span quoted below, so "the description
// is never logged" is a real assertion rather than a coincidence of overlap.
const DESCRIPTION = [
  "Senior Backend Engineer, Meridian Freight",
  "Our stack is primarily Go on the backend, with TypeScript on the front end.",
  "SALARYBANDMARKER: compensation is reviewed annually.",
  "You will own dispatch reliability and the on-call rotation.",
].join("\n");

const QUOTE = "primarily Go on the backend";

// Deliberately NOT a substring of DESCRIPTION. The job title is framing for
// the tie-break and is NEVER evidence (AC-C6c) — a validator handed
// `${title}\n${description}` as its haystack is the plausible, wrong reading
// ("validate against what the model saw"), and it is only detectable if the
// title cannot be found in the posting body.
const TITLE = "Staff Dispatch Reliability Engineer";

const KEY = "user-1::app-1";

const BASE = {
  engine: "gemini",
  descriptor: interviewType("technical"),
  override: AUTO,
  applicationId: "app-1",
  description: DESCRIPTION,
  title: TITLE,
  cacheKey: KEY,
};

const json = (value) => JSON.stringify(value);

// A client shaped exactly like the one `generateIdealProjectExample` is handed
// (`answerAids.js:104-108`): `client.models.generateContent(...)`.
function clientReturning(text) {
  return { models: { generateContent: vi.fn(async () => ({ text })) } };
}

function clientThatThrows() {
  return {
    models: {
      generateContent: vi.fn(() => {
        throw new Error("client exploded synchronously");
      }),
    },
  };
}

function clientThatRejects() {
  return { models: { generateContent: vi.fn(() => Promise.reject(new Error("network gone"))) } };
}

// Installs the module-level client `startCodeLanguageResolution` builds for
// itself, and hands back the `generateContent` spy.
function installModel(text) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async () => ({ text }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

// One macrotask — enough for the loader's whole await chain to settle. Real
// timers throughout; nothing here races a clock.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  // `vi.restoreAllMocks()` does NOT clear a `vi.fn()` created in a `vi.mock`
  // factory, and this repo sets neither `clearMocks` nor `restoreMocks`.
  // `mockReset`, not `mockClear`, because cases below install THROWING
  // implementations that `mockClear` would leave standing.
  getServerEnv.mockReset();
  getGeminiClient.mockReset();
  // `mockClear`, NOT `mockReset` — this one delegates to the real validator
  // and `mockReset` would strip the implementation it wraps.
  validateResolvedLanguage.mockClear();
  // The cache is module scope and outlives an `it()` block — the same reason
  // every route suite clears `answerContextCache`/`companyFactsCache`.
  codeLanguageCache.clear();
  companyFactsCache.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  codeLanguageCache.clear();
  companyFactsCache.clear();
});

// ---------------------------------------------------------------------------

describe("generateCodeLanguage — AC-C8d2's mapping table, model mocked (AC-C8e, D-12)", () => {
  const call = (text, description = DESCRIPTION) =>
    generateCodeLanguage({
      client: clientReturning(text),
      geminiModel: "gemini-2.5-flash",
      description,
      title: TITLE,
    });

  const rows = [
    ["an abstention", json({ language: "none", evidence: "" }), NONE],
    ["a member whose evidence IS a substring", json({ language: "Go", evidence: QUOTE }), "Go"],
    ["a member whose evidence is NOT a substring", json({ language: "Java", evidence: "we are a Java shop" }), NONE],
    ["empty evidence", json({ language: "Go", evidence: "" }), NONE],
    ["a missing evidence field", json({ language: "Go" }), NONE],
    ["whitespace-only evidence", json({ language: "Go", evidence: " " }), NONE],
    ["evidence with no word character", json({ language: "Go", evidence: "------" }), NONE],
    ["an out-of-vocabulary language", json({ language: "Rust", evidence: QUOTE }), NONE],
    ["the control sentinel as a language", json({ language: "Auto", evidence: QUOTE }), NONE],
    ["a lowercased member", json({ language: "go", evidence: QUOTE }), NONE],
    ["unparseable JSON", "not json at all", NONE],
    ["an empty model response", "", NONE],
    ["a JSON array", json([{ language: "Go", evidence: QUOTE }]), NONE],
  ];

  for (const [name, text, expected] of rows) {
    it(`maps ${name} to ${expected}`, async () => {
      await expect(call(text)).resolves.toBe(expected);
    });
  }

  it("maps evidence at 200 characters to the language and at 201 to none", async () => {
    // Boundary rows carried through the WRAPPER as well as the validator: the
    // wrapper is where a `?? NONE` could be dropped, and where a second,
    // looser copy of the bounds would live if anyone wrote one.
    const line = "We run a large service estate in Go and expect every engineer to keep runbooks current. ".repeat(4);
    const description = line;
    await expect(call(json({ language: "Go", evidence: line.slice(0, 200) }), description)).resolves.toBe("Go");
    await expect(call(json({ language: "Go", evidence: line.slice(0, 201) }), description)).resolves.toBe(NONE);
  });

  it("maps evidence at 6 characters to the language and at 5 to none", async () => {
    const line = "Golang is what the dispatch platform is written in, end to end.";
    await expect(call(json({ language: "Go", evidence: line.slice(0, 6) }), line)).resolves.toBe("Go");
    await expect(call(json({ language: "Go", evidence: line.slice(0, 5) }), line)).resolves.toBe(NONE);
  });

  it("resolves to none — never rejects, never returns null — on a THROWN client", async () => {
    // BL-2's other half. `answerAids.js:111-113` states this contract
    // unconditionally, and AC-C8e's cost argument depends on it:
    // `createTtlCache` NEVER caches a rejection (`answerSessionCache.js:106-112`),
    // so a rejecting loader means a fresh Gemini call on EVERY code-bearing
    // `Auto` question of that application, and AC-C11's "at most one call per
    // application per TTL" — the whole cost story — becomes false.
    const result = await generateCodeLanguage({
      client: clientThatThrows(),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
    });
    expect(result).toBe(NONE);
    expect(result).not.toBeNull();
  });

  it("resolves to none on a REJECTED promise", async () => {
    await expect(
      generateCodeLanguage({ client: clientThatRejects(), geminiModel: "m", description: DESCRIPTION, title: TITLE }),
    ).resolves.toBe(NONE);
  });

  it("resolves to none with no description, and makes NO model call at all", async () => {
    // The empty-prompt exit: `buildCodeLanguagePrompt` returns "" for a blank
    // description, and there is nothing to ask.
    const client = clientReturning(json({ language: "Go", evidence: QUOTE }));
    await expect(
      generateCodeLanguage({ client, geminiModel: "m", description: "   ", title: TITLE }),
    ).resolves.toBe(NONE);
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it("sends EXACTLY the audited system instruction — not merely some string (AC-C7b/C7c/C7d/C28)", async () => {
    // BL-1: `CODE_LANGUAGE_SYSTEM` is "the ONLY home of AC-C7b, AC-C7c,
    // AC-C7d and AC-C28". Nine cases next door pin that constant's TEXT; this
    // is the one that pins its USE. Without it, `systemInstruction: "Answer
    // with JSON."` drops every one of those rules from the wire while every
    // source-review criterion they exist for stays green — the audited
    // constant and the transmitted one being different objects is the whole
    // failure mode, and it is silent.
    const client = clientReturning(json({ language: "Go", evidence: QUOTE }));
    await generateCodeLanguage({ client, geminiModel: "gemini-2.5-flash", description: DESCRIPTION, title: TITLE });

    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    const req = client.models.generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-2.5-flash");
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.systemInstruction).toBe(CODE_LANGUAGE_SYSTEM);
    // R-267 rides along: `tools` belongs inside `config` or the SDK drops it
    // silently. This call has none, and that is the assertion.
    expect(req.config.tools).toBeUndefined();
    expect(req.tools).toBeUndefined();
    expect(req.config.thinkingConfig).toBeUndefined();
  });

  it("sends EXACTLY the audited prompt — the builder's output, not a paraphrase", async () => {
    // The same shape one layer down. A wrapper can call
    // `buildCodeLanguagePrompt` (keeping the empty-input exit green), throw
    // the result away, and send an inline `"Which language is this role built
    // around?"` plus the description — at which point the allowed-answers
    // list, rule 4's restatement, the JSON shape and the 6-to-200 evidence
    // instruction never reach the model, and every builder assertion next door
    // is still green because the builder is still correct.
    const client = clientReturning(json({ language: "Go", evidence: QUOTE }));
    await generateCodeLanguage({ client, geminiModel: "m", description: DESCRIPTION, title: TITLE });

    const text = String(client.models.generateContent.mock.calls[0][0]?.contents?.[0]?.parts?.[0]?.text || "");
    expect(text).toBe(buildCodeLanguagePrompt({ description: DESCRIPTION, title: TITLE }));
  });

  it("never sends the question — there is no question on this path (AC-C6b)", async () => {
    const client = clientReturning(json({ language: "Go", evidence: QUOTE }));
    await generateCodeLanguage({ client, geminiModel: "m", description: DESCRIPTION, title: TITLE });
    const text = String(client.models.generateContent.mock.calls[0][0]?.contents?.[0]?.parts?.[0]?.text || "");
    expect(text).toContain(QUOTE); // positive control: the posting IS there
    expect(text).not.toMatch(/interviewer asked/i);
    expect(text).not.toMatch(/candidate was just asked/i);
  });
});

describe("the validator's HAYSTACK is the posting description, and only that (AC-C8b, AC-C8b2)", () => {
  // THE DEGENERATE VALIDATOR, by the route the bounds do not close. Every
  // mapping row above is satisfied by a wrapper that hands the validator the
  // PROMPT, or `${title}\n${description}`, or posting-plus-résumé — because no
  // ordinary fixture quotes a span that is in one and not the other. And once
  // the haystack is the prompt, a model quoting its own instructions back
  // (`{ language: "Python", evidence: "Python, JavaScript" }`) is certified
  // for ANY posting, including one that names no language at all. That is
  // exactly the failure the evidence mechanism exists to close, and the reason
  // it went through two mechanism changes.
  //
  // Asserted two ways, deliberately: the IDENTITY of what is handed over, and
  // the BEHAVIOUR that identity produces. The identity assertion alone could
  // be satisfied by a second, wider comparison done elsewhere; the behavioural
  // rows alone could be satisfied by a haystack that happens to exclude these
  // particular spans.
  const call = (text) =>
    generateCodeLanguage({
      client: clientReturning(text),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
    });

  it("hands the validator the description itself — not the prompt, not the title, not a concatenation", async () => {
    await call(json({ language: "Go", evidence: QUOTE }));
    expect(validateResolvedLanguage).toHaveBeenCalledTimes(1);
    const options = validateResolvedLanguage.mock.calls[0][1];
    expect(options.description).toBe(DESCRIPTION);
    // And nothing ELSE is handed over that a validator could prefer or
    // concatenate. `{ description, resume: … }` leaves this assertion's
    // first half true while the haystack is quietly twice as wide — §B.4's
    // call is `validateResolvedLanguage(parsed, { description })`, exactly.
    expect(Object.keys(options)).toEqual(["description"]);
  });

  it("rejects a quote taken from the PROMPT's own instructions", async () => {
    // The span is DERIVED from whatever prompt the builder actually writes,
    // not pinned to a sentence — the property under test is "in the prompt,
    // not in the posting", and hard-coding an instruction line would couple
    // this case to prompt wording that §B.9.2 is free to revise.
    const prompt = buildCodeLanguagePrompt({ description: DESCRIPTION, title: TITLE });
    const collapse = (s) => s.replace(/\s+/g, " ");
    const haystack = collapse(DESCRIPTION);
    const fromPrompt = prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length >= 20 && line.length <= 200 && /\w/.test(line) && !haystack.includes(collapse(line)));

    // Positive control on the FIXTURE, not on the implementation: if every
    // line of the prompt were also in the posting there would be nothing to
    // test, and this case would be silently vacuous.
    expect(fromPrompt, "the prompt carries no line absent from the posting").toBeTruthy();

    // A model quoting its own instructions back — the exact shape that
    // certifies ANY language for ANY posting once the haystack is the prompt.
    await expect(call(json({ language: "Python", evidence: fromPrompt }))).resolves.toBe(NONE);
  });

  it("rejects a quote taken from the JOB TITLE (AC-C6c — the title is never evidence)", async () => {
    expect(buildCodeLanguagePrompt({ description: DESCRIPTION, title: TITLE })).toContain(TITLE);
    expect(DESCRIPTION).not.toContain(TITLE);
    await expect(call(json({ language: "Go", evidence: TITLE }))).resolves.toBe(NONE);
  });

  it("still admits a quote from the posting body — the positive control", async () => {
    // Without this, a wrapper that hands the validator an EMPTY haystack
    // passes both rejections above and abstains on every posting forever.
    await expect(call(json({ language: "Go", evidence: QUOTE }))).resolves.toBe("Go");
  });
});

describe("the observation affordance — the resolver's RAW output (AC-C8d3, AC-C28b constraint 2)", () => {
  it("records the model's answer BEFORE validation, beside what was admitted", async () => {
    // THE case this whole file is built around. Post-validation, a fabricating
    // resolver is indistinguishable from an abstaining one — both produce no
    // token. The raw value is the ONLY place AC-C7b's abstention is
    // observable, and without it AC-C7b is unenforceable by construction.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await generateCodeLanguage({
      client: clientReturning(json({ language: "Java", evidence: "we are a Java shop through and through" })),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
    });

    expect(result).toBe(NONE);
    expect(info).toHaveBeenCalledTimes(1);
    const payload = info.mock.calls[0][info.mock.calls[0].length - 1];
    expect(payload.rawLanguage).toBe("Java");
    expect(payload.language).toBe(NONE);
    expect(payload.admitted).toBe(false);
  });

  it("records an ABSTENTION as an abstention, not as an absence", async () => {
    // The other half of the pair, and what makes the case above non-vacuous: a
    // fabricating resolver and an abstaining one must leave DIFFERENT records.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await generateCodeLanguage({
      client: clientReturning(json({ language: "none", evidence: "" })),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
    });
    const payload = info.mock.calls[0][info.mock.calls[0].length - 1];
    expect(payload.rawLanguage).toBe(NONE);
    expect(payload.admitted).toBe(true);
  });

  it("records an ADMITTED resolution too — the positive control", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await generateCodeLanguage({
      client: clientReturning(json({ language: "Go", evidence: QUOTE })),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
    });
    const payload = info.mock.calls[0][info.mock.calls[0].length - 1];
    expect(payload.rawLanguage).toBe("Go");
    expect(payload.language).toBe("Go");
    expect(payload.admitted).toBe(true);
    expect(payload.evidence).toContain(QUOTE);
    expect(typeof payload.evidenceLength).toBe("number");
    expect(typeof payload.resolvedAt).toBe("number");
  });

  it("logs the EVIDENCE span and never the description (§B.7 rule 2)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await generateCodeLanguage({
      client: clientReturning(json({ language: "Go", evidence: QUOTE })),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
    });
    const serialized = JSON.stringify(info.mock.calls[0]);
    // Positive control first: the quote IS on the record, which is the whole
    // basis of AC-C8b4's acceptance argument ("a human reading `evidence`
    // beside `language` sees whether the quote supports the claim").
    expect(serialized).toContain(QUOTE);
    // And the rest of the posting is not — this is the user's own job
    // description, and it is logged server-side.
    expect(serialized).not.toContain("SALARYBANDMARKER");
    expect(serialized).not.toContain("on-call rotation");
  });

  it("truncates an over-long quote ABOVE the validator's bound, so it reads as over-long", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const line = "We run a large service estate in Go and expect every engineer to keep runbooks current. ".repeat(6);
    await generateCodeLanguage({
      client: clientReturning(json({ language: "Go", evidence: line.slice(0, 300) })),
      geminiModel: "m",
      description: line,
      title: TITLE,
    });
    const payload = info.mock.calls[0][info.mock.calls[0].length - 1];
    expect(payload.evidence.length).toBeLessThanOrEqual(240);
    // Deliberately above 200: a quote truncated AT the validator's own bound
    // would read as exactly-at-the-limit rather than as over it.
    expect(payload.evidence.length).toBeGreaterThan(200);
  });

  it("carries no user id (§B.7)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await generateCodeLanguage({
      client: clientReturning(json({ language: "Go", evidence: QUOTE })),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
    });
    const payload = info.mock.calls[0][info.mock.calls[0].length - 1];
    expect(Object.keys(payload)).not.toContain("userId");
    expect(Object.keys(payload)).not.toContain("user");
  });

  it("carries the applicationId beside the resolution (test-round ruling 4)", async () => {
    // §B.7's payload names `applicationId` so a log line is correlatable to
    // the posting that was read, but every OTHER case in this file calls
    // `generateCodeLanguage` without it (a fifth, optional argument that
    // leaves those four-argument calls valid and green). This is the one
    // case that supplies it and asserts it lands on the record.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await generateCodeLanguage({
      client: clientReturning(json({ language: "Go", evidence: QUOTE })),
      geminiModel: "m",
      description: DESCRIPTION,
      title: TITLE,
      applicationId: "app-1",
    });
    const payload = info.mock.calls[0][info.mock.calls[0].length - 1];
    expect(payload.applicationId).toBe("app-1");
  });
});

describe("startCodeLanguageResolution — the four gates run FIRST (AC-C11, AC-C11c, AC-C14, AC-C21)", () => {
  it("resolves and caches when all four conjuncts hold — the positive control", async () => {
    const generateContent = installModel(json({ language: "Go", evidence: QUOTE }));
    startCodeLanguageResolution(BASE);
    await flush();

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(peekCodeLanguage(KEY)).toBe("Go");
  });

  const gateRows = [
    ["the embedded engine (AC-C21)", { engine: "embedded" }],
    ["a non-code-bearing interview type", { descriptor: interviewType("general") }],
    ["a behavioral interview type", { descriptor: interviewType("behavioral") }],
    ["no descriptor at all", { descriptor: undefined }],
    ["an explicit language override (AC-C11c)", { override: "java" }],
    ["a Pseudocode override", { override: "pseudocode" }],
    ["no posting selected (AC-C14)", { applicationId: "" }],
    ["a blank description", { description: "   " }],
  ];

  for (const [name, patch] of gateRows) {
    it(`starts nothing for ${name}`, async () => {
      const generateContent = installModel(json({ language: "Go", evidence: QUOTE }));
      startCodeLanguageResolution({ ...BASE, ...patch });
      await flush();

      expect(generateContent).not.toHaveBeenCalled();
      // The ORDERING constraint `answerCompanyFacts.js:41-49` records and three
      // route suites assert: the gates are the FIRST statement, before the
      // client is ever constructed. A module that builds the client and then
      // decides is green on most fixtures and red on the one that matters.
      expect(getServerEnv).not.toHaveBeenCalled();
      expect(getGeminiClient).not.toHaveBeenCalled();
      expect(peekCodeLanguage(KEY)).toBeNull();
    });
  }

  it("is NOT gated on mode — practice mode IS answer mode (AC-C11b)", async () => {
    // `answerCompanyFacts.js:63-64` returns null for `mode === "answer"`
    // because `buildAnswerPrompt` had nowhere to put the result. AC-C12 gives
    // the token somewhere to go and AC-C1 puts the control on both tabs, so
    // copying that gate faithfully ships a live-only feature with the practice
    // control inert. Asserted as behaviour: a `mode` in the bag changes
    // nothing, because there is no parameter for it.
    const generateContent = installModel(json({ language: "Go", evidence: QUOTE }));
    startCodeLanguageResolution({ ...BASE, mode: "answer" });
    await flush();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(peekCodeLanguage(KEY)).toBe("Go");
  });

  it("returns nothing — a void start is what makes the forbidden await unwritable (CONF-4)", () => {
    installModel(json({ language: "Go", evidence: QUOTE }));
    expect(startCodeLanguageResolution(BASE)).toBeUndefined();
  });

  it("swallows a SYNCHRONOUS throw from the client setup (BL-2)", async () => {
    // `getServerEnv()`/`getGeminiClient()` throw synchronously with no key
    // configured, before there is even a promise to await — and
    // `route.js:832-837` turns an escape into a 500 on an otherwise answerable
    // question. The precedent is `answerCompanyFacts.js:83-90`.
    getServerEnv.mockImplementation(() => {
      throw new Error("no Gemini key configured");
    });
    expect(() => startCodeLanguageResolution(BASE)).not.toThrow();
    await flush();
    expect(peekCodeLanguage(KEY)).toBeNull();

    getServerEnv.mockReset();
    getGeminiClient.mockImplementation(() => {
      throw new Error("no Gemini key configured");
    });
    getServerEnv.mockReturnValue({ geminiModel: "m" });
    expect(() => startCodeLanguageResolution(BASE)).not.toThrow();
  });

  it("calls the model at most ONCE per application per TTL (AC-C11's cost bound)", async () => {
    const generateContent = installModel(json({ language: "Go", evidence: QUOTE }));
    startCodeLanguageResolution(BASE);
    await flush();
    startCodeLanguageResolution(BASE);
    await flush();
    startCodeLanguageResolution(BASE);
    await flush();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("caches an ABSTENTION for the TTL and does not retry it (AC-C8f)", async () => {
    // The common case AND the worst case: a posting that legitimately names no
    // language would otherwise pay a model call on every question forever.
    const generateContent = installModel(json({ language: "none", evidence: "" }));
    startCodeLanguageResolution(BASE);
    await flush();
    expect(peekCodeLanguage(KEY)).toBeNull();

    startCodeLanguageResolution(BASE);
    await flush();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(peekCodeLanguage(KEY)).toBeNull();
  });

  it("caches the OBJECT `{ language, resolvedAt }`, never a bare string (D-11)", async () => {
    // The architecture lane's snippet passed `generateCodeLanguage` to
    // `cache.get` directly — a loader returning a bare string — while its own
    // §3.2 specified `{ language, resolvedAt }`. As written, `hit.language` is
    // `undefined` on every hit and the peek returns nothing, forever.
    installModel(json({ language: "Go", evidence: QUOTE }));
    startCodeLanguageResolution(BASE);
    await flush();

    const cached = codeLanguageCache.peek(KEY);
    expect(cached).toEqual({ language: "Go", resolvedAt: expect.any(Number) });
  });

  it("uses its OWN Map — `codeLanguageCache` is not `companyFactsCache` (AC-C10)", () => {
    // The two instances share the `${userId}::${applicationId}` key space by
    // design, which is safe only because they are different Maps
    // (`answerSessionCache.js:164-166`). Aliased, a company-facts entry reads
    // back here as `hit.language === undefined` — the feature silently dead
    // for that application — and a language entry reads back through the facts
    // peek as an object it is not.
    expect(codeLanguageCache).not.toBe(companyFactsCache);

    codeLanguageCache.clear();
    companyFactsCache.clear();
    companyFactsCache.get(KEY, () => Promise.resolve(["a fact"]), { now: Date.now() });
    expect(codeLanguageCache.peek(KEY)).toBeNull();
    expect(codeLanguageCache.size()).toBe(0);
  });

  it("writes nothing into the shared `${userId}::` bucket when there is no application", async () => {
    // `answerContextKey` permits an empty id, so an ungated start would write
    // one user's whole-account entry — and every posting-less live session
    // would then share it.
    installModel(json({ language: "Go", evidence: QUOTE }));
    startCodeLanguageResolution({ ...BASE, applicationId: "", cacheKey: "user-1::" });
    await flush();
    expect(codeLanguageCache.peek("user-1::")).toBeNull();
  });
});

describe("peekCodeLanguage — pure, starts nothing, and never returns `none` (CONF-5/BL-4)", () => {
  // Seeds the cache directly, so these cases are about the peek alone and not
  // about whatever `start` happens to do.
  async function seed(key, value) {
    codeLanguageCache.get(key, () => Promise.resolve(value), { now: Date.now() });
    await flush();
  }

  it("returns null for a cached abstention — the `|| fallback` trap", async () => {
    // `"none"` is TRUTHY. `peek(key) || null` returns it, precedence step 3
    // then emits "the posting resolved to none", and every other criterion in
    // chunk C stays green. Shape is not a guard either: an object is truthy.
    await seed(KEY, { language: NONE, resolvedAt: Date.now() });
    expect(peekCodeLanguage(KEY)).toBeNull();
  });

  it("returns the token for a cached language — the positive control", async () => {
    // Without this, a peek that returns null unconditionally passes the case
    // above and the whole feature ships inert.
    await seed(KEY, { language: "Python", resolvedAt: Date.now() });
    expect(peekCodeLanguage(KEY)).toBe("Python");
  });

  it("returns null for a miss, and starts nothing", async () => {
    const generateContent = installModel(json({ language: "Go", evidence: QUOTE }));
    expect(peekCodeLanguage("user-9::app-9")).toBeNull();
    await flush();
    expect(generateContent).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("returns null while the resolution is still in flight", async () => {
    codeLanguageCache.get(KEY, () => new Promise(() => {}), { now: Date.now() });
    expect(peekCodeLanguage(KEY)).toBeNull();
  });

  it("never hands back a promise", async () => {
    codeLanguageCache.get(KEY, () => new Promise(() => {}), { now: Date.now() });
    expect(peekCodeLanguage(KEY)).not.toBeInstanceOf(Promise);
    await seed("user-2::app-2", { language: "SQL", resolvedAt: Date.now() });
    const hit = peekCodeLanguage("user-2::app-2");
    expect(hit).not.toBeInstanceOf(Promise);
    expect(typeof hit).toBe("string");
  });

  it("holds for THIRTY minutes, not ten — AC-C10b's entire content is the number", async () => {
    // AC-C10b is a decision, not a default: 30 matches `companyFactsCache`
    // (likewise model-derived, likewise changing far less often than which
    // résumé is attached) RATHER THAN `answerContextCache`'s 10. A case that
    // only peeks at t≈0 and t=31min is satisfied by a 10-minute TTL and
    // asserts nothing about the number at all, so the reading at t≈20min is
    // the whole point of this case.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-28T10:00:00Z"));
    await seed(KEY, { language: "Go", resolvedAt: Date.now() });
    expect(peekCodeLanguage(KEY)).toBe("Go");

    // Past `answerContextCache`'s 10 minutes, and past any 15.
    vi.setSystemTime(new Date("2026-08-28T10:20:00Z"));
    expect(peekCodeLanguage(KEY)).toBe("Go");

    // The last second before the bound. Readings at 20 min and 29.5 min are
    // still satisfied by a 29m59s TTL; this one is not, so the constant is
    // pinned rather than bracketed.
    vi.setSystemTime(new Date("2026-08-28T10:29:59Z"));
    expect(peekCodeLanguage(KEY)).toBe("Go");

    // And past it.
    vi.setSystemTime(new Date("2026-08-28T10:31:00Z"));
    expect(peekCodeLanguage(KEY)).toBeNull();
  });
});
