// node (this repo's default environment). The resolver's prompt, its system
// instruction, and its validator — the three things reconciliation BL-1
// forbids leaving to an implementer, because `CODE_LANGUAGE_SYSTEM` and the
// prompt body are the ONLY home of AC-C7b, AC-C7c, AC-C7d and AC-C28.
//
// Written BEFORE the implementation exists (step 4b): every case fails on the
// missing `./codeLanguagePrompt.js` module until wave 1 lands.
//
// WHY THE EVIDENCE BOUNDS ARE THE MOST IMPORTANT CASES IN THIS FILE, and why
// they are asserted at both edges rather than "somewhere sensible":
//
//   * WITHOUT A MAXIMUM, the whole description is a valid quote and the check
//     degenerates to `description.includes(description)` — true for EVERY
//     language and every posting. The wrong constant is already in scope in
//     the same module: AC-C28b requires a locally-restated posting cap, which
//     is 20000, and an implementer who has just written that has it to hand.
//   * WITHOUT A MINIMUM, `{ language: "Java", evidence: " " }` is a member,
//     non-empty, under any cap, and `description.includes(" ")` is true of
//     essentially every posting — so it passes EVERY automatable criterion in
//     chunk C, for any language and any posting. It is also the failure an
//     HONEST model produces: asked for a language and a supporting span over
//     a posting that supports none, its two exits are `none` and the smallest
//     thing it can call a quote.
//   * And the six-character floor alone does not close the second one: six
//     SPACES clear it. `/\w/` is the rule that does, so it is tested against
//     a span that passes the length floor rather than against `" "` alone.
//
// The other thing this file holds: **the one permitted transformation**.
// Whitespace-run collapsing on both operands, and nothing else — no regex over
// language names, no word boundaries, no aliases, no case folding, no
// per-member table. Four consecutive rounds of tuned patterns preceded this
// rule (`/\bC#\b/` can never match; `/\bNode\b/i` admitted JavaScript from a
// Kubernetes posting), and the fifth fix was to change the KIND of rule.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CODE_LANGUAGE_SYSTEM,
  buildCodeLanguagePrompt,
  validateResolvedLanguage,
} from "./codeLanguagePrompt.js";
import { RESOLVER_LANGUAGES, NONE } from "./codeLanguages.js";

const SOURCE = readFileSync(fileURLToPath(new URL("./codeLanguagePrompt.js", import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// Fixtures. AC-C8d5: pinned verbatim, never described — "a posting naming no
// programming language at all" is decidable by a reader but not decidable
// IDENTICALLY by two readers.

// Names several languages, one of them clearly primary, and carries a span
// that crosses a line break — the whitespace-collapse case.
const DESCRIPTION_MULTI = [
  "Senior Backend Engineer, Meridian Freight",
  "Our stack is primarily Go on the backend",
  "with TypeScript and React on the front end.",
  "Nice to have: exposure to Java on a legacy billing service.",
  "You will own dispatch reliability and the on-call rotation.",
].join("\n");

// Names NO programming language, and carries the adversarial span AC-C8b4
// requires by name: "manage node pools" is about Kubernetes, and "node" is
// what a pattern-based matcher read as JavaScript.
const DESCRIPTION_NONE = [
  "Platform Engineer, Harborline",
  "You will manage node pools and node affinity across three regions,",
  "own the cluster upgrade path, and keep dispatch healthy.",
  "We care about calm operations and clear writing.",
].join("\n");

// A single-line description long enough to slice exact-length quotes out of,
// so the 5/6 and 200/201 boundaries are exact string operations rather than
// hand-counted literals.
const DESCRIPTION_BOUNDS =
  "Our platform team runs a large service estate in Go and expects every engineer to keep runbooks current. ".repeat(4);

const quoteOfLength = (n) => DESCRIPTION_BOUNDS.slice(0, n);

// AC-C8b2's fixture: a description that overruns the module's own posting cap,
// with a distinctive phrase on each side of the cut.
const CLAMP_HEAD = "The role is built around Go on our dispatch platform. ";
const CLAMP_TAIL = "PHRASEBEYONDTHEPOSTINGCAP";
const DESCRIPTION_OVER_CAP = CLAMP_HEAD + "x".repeat(20000 - CLAMP_HEAD.length) + CLAMP_TAIL;

// §B.9.1 sentence 6 and §B.9.2's restatement of it, pinned by equality because
// reconciliation A20 rules that this rule must be its own unconditional
// sentence AND must be restated in the prompt body. It is the SOLE guard
// against the case AC-C8b explicitly vouches for: a Rails posting that
// mentions JavaScript supplies a genuinely quotable member, so the evidence
// check would certify a wrong-but-evidenced language.
//
// The source holds this ONE string and uses it at both sites (the system
// instruction's sentence 6, and the prompt body), so there is exactly one
// wording to pin here too — kept as two identically-valued constants,
// matching the two call sites, so a source edit that lets the two sites
// diverge again fails at the site that changed rather than at both silently.
const RULE_4_PROMPT_RESTATEMENT =
  'If the language this role is built around is not on that list, answer "none" — do not substitute an allowed answer that the posting merely mentions.';
const RULE_4_SYSTEM_SENTENCE = RULE_4_PROMPT_RESTATEMENT;

// The other four hard rules, pinned by equality for the same reason rule 4 is:
// BL-1 makes this constant "the ONLY home of AC-C7b, AC-C7c, AC-C7d and
// AC-C28", and a source-review criterion whose subject is a string is
// discharged by pinning that string. Rule 2 in particular (SQL) was previously
// unasserted while `SQL` sat in `RESOLVER_LANGUAGES` — which is
// SQL-as-default-backend-answer, live.
const ABSTAIN_DEFAULT_SENTENCE =
  'Answer with a language only when the posting itself names one; when it does not, answer "none".';
const MULTI_LANGUAGE_SENTENCE =
  'When the posting names several, answer with the one the role is actually built around — named in the title, the responsibilities, or the primary stack — never one listed under "nice to have", "exposure to", or a legacy system, and answer "none" if none of them is clearly primary.';
const SQL_SENTENCE =
  'Answer "SQL" only for a role that is itself a data or SQL role, never because SQL appears in a list of skills.';
const NEVER_INFER_SENTENCE =
  "Never infer a language from the company's reputation, the role's seniority, or what similar companies are known to use — only from the words of this posting.";
const QUOTE_REQUIREMENT_SENTENCE =
  'Every answer other than "none" must quote a span of the posting, copied exactly, that supports it.';

const sentencesOf = (text) => String(text).split(/(?<=\.)\s+/).filter(Boolean);

// ---------------------------------------------------------------------------

describe("CODE_LANGUAGE_SYSTEM — the named system-instruction constant (AC-C7c)", () => {
  it("is a non-empty string constant, not a builder", () => {
    // AC-C7c's Fails if: "the rules live only in the user prompt". A constant
    // is what a source reviewer reads.
    expect(typeof CODE_LANGUAGE_SYSTEM).toBe("string");
    expect(CODE_LANGUAGE_SYSTEM.trim()).not.toBe("");
  });

  it("names the whole output set INSIDE the constant, so it is readable on its own", () => {
    // Reconciliation A20's middle complaint, which §0.2 D-10b quoted only two
    // thirds of: "'the list' has no referent inside the source-reviewed
    // constant". Renaming "the list" to "the allowed answers" without moving
    // the referent leaves that defect in place.
    for (const token of RESOLVER_LANGUAGES) {
      expect(CODE_LANGUAGE_SYSTEM).toContain(token);
    }
    expect(CODE_LANGUAGE_SYSTEM).toContain("none");
    // AC-C7c's FIRST rule — "return only a member of the output set" — must be
    // STATED, not merely implied by the members appearing somewhere. Pinned as
    // the FULL sentence, with the word count derived from
    // `RESOLVER_LANGUAGES.length` the same way the source derives it
    // (`RESOLVER_LANGUAGES.length + 1`, for the trailing "or none") — so a
    // literal miscount (the module once said "nine" over eight actual members)
    // cannot silently reappear and still pass this test.
    expect(CODE_LANGUAGE_SYSTEM).toContain(
      `Your answer must be exactly one of these ${RESOLVER_LANGUAGES.length + 1} words: ${RESOLVER_LANGUAGES.join(", ")}, or none.`,
    );
  });

  it("does not offer `Auto` or `Pseudocode` as answers (§0.7d)", () => {
    // A resolver returning either is a defect: `Auto` is a control state
    // meaning "infer", and a resolver returning "Pseudocode" would be
    // asserting the employer's stack is pseudocode.
    expect(CODE_LANGUAGE_SYSTEM).not.toMatch(/\bAuto\b/);
    expect(CODE_LANGUAGE_SYSTEM).not.toMatch(/Pseudocode/i);
  });

  it("carries AC-C7d rule 4 as its OWN sentence, pinned by equality (A20)", () => {
    expect(CODE_LANGUAGE_SYSTEM).toContain(RULE_4_SYSTEM_SENTENCE);
  });

  it("does NOT subordinate rule 4 to the multi-language condition (A20's first complaint)", () => {
    // The property, stated independently of today's wording: whichever
    // sentence carries the "names several" tie-break must NOT also be the one
    // carrying rule 4. Subordinated, the Rails-mentions-JavaScript case
    // escapes it under a natural reading — and a clause that reads as a
    // special case of the one beside it "is exactly the clause an editor
    // trims as redundant".
    expect(RULE_4_SYSTEM_SENTENCE).not.toMatch(/several/i);
    const multi = sentencesOf(CODE_LANGUAGE_SYSTEM).filter((s) => /several/i.test(s));
    expect(multi.length).toBeGreaterThan(0); // positive control: the tie-break exists
    for (const sentence of multi) {
      expect(sentence).not.toContain("do not substitute");
    }
  });

  it("makes no claim about what MOST postings look like (AC-C7b)", () => {
    // Withdrawn in revision 7 and not to come back: an unsupported empirical
    // prior that biases the model to abstain on exactly the postings where the
    // feature should work, and buys no safety AC-C8b does not already provide
    // unconditionally.
    expect(CODE_LANGUAGE_SYSTEM).not.toMatch(/most postings/i);
    expect(CODE_LANGUAGE_SYSTEM).not.toMatch(/\bmost\b[^.]*\bposting/i);
  });

  it("states the abstention DEFAULT as a rule of its own (AC-C7b, AC-C7c rule 2)", () => {
    // A resolver asked "which language?" with no way to decline WILL pick one
    // — the founding failure of AC-V4 one layer removed. The decline option
    // has to be in the constant, not only in the body.
    expect(CODE_LANGUAGE_SYSTEM).toContain(ABSTAIN_DEFAULT_SENTENCE);
  });

  it("carries AC-C7d rules 1 and 3 — the multi-language tie-break — by equality", () => {
    // The modal case. AC-C8b's truth check does NOTHING here: "Java, Python,
    // Go and SQL across our services" evidences all four under every matching
    // rule, so the validator waves through whichever the model picked. The
    // tie-break is a prompt-level rule and this is the whole of it.
    expect(CODE_LANGUAGE_SYSTEM).toContain(MULTI_LANGUAGE_SENTENCE);
  });

  it("carries AC-C7d rule 2 — SQL only for a data/SQL role — by equality", () => {
    // SQL appears in nearly every backend posting. Treating a mention as
    // evidence makes SQL the default answer for general backend work, and
    // `SQL` is in `RESOLVER_LANGUAGES`, so nothing downstream would reject it.
    expect(CODE_LANGUAGE_SYSTEM).toContain(SQL_SENTENCE);
  });

  it("requires a quoted span for every answer other than none, by equality (AC-C8b)", () => {
    expect(CODE_LANGUAGE_SYSTEM).toContain(QUOTE_REQUIREMENT_SENTENCE);
  });

  it("forbids inference from reputation, seniority or comparable companies (AC-C7c, AC-C28)", () => {
    expect(CODE_LANGUAGE_SYSTEM).toContain(NEVER_INFER_SENTENCE);
    expect(CODE_LANGUAGE_SYSTEM).toMatch(/reputation/i);
    // AC-C28: the "what languages others report" input is applied at AUTHORING
    // time, in this constant — never as a data file or a runtime lookup. A
    // constant naming specific employers would be that map by another route.
    expect(CODE_LANGUAGE_SYSTEM).not.toMatch(/\b(Google|Amazon|Microsoft|Meta|Netflix)\b/);
  });

});

describe("codeLanguagePrompt.js is also client-reachable, and carries the instruction (AC-C28b)", () => {
  // `lib/copilot/` is a SHARED client/server directory, and this module holds
  // the system instruction and touches the user's own posting text. There is
  // **no `server-only` package in this repo**, so nothing structural stops it
  // being pulled into a client bundle — only what it imports and what it logs.
  it("imports nothing beyond the pure vocabulary module (A-3)", () => {
    const imports = SOURCE.match(/^\s*import[\s\S]*?from\s*["']([^"']+)["']/gm) || [];
    const specifiers = imports.map((line) => line.match(/["']([^"']+)["']\s*$/)[1]);
    expect(specifiers.every((s) => /(^\.\/codeLanguages(\.js)?$|^@\/lib\/copilot\/codeLanguages(\.js)?$)/.test(s))).toBe(true);
    expect(SOURCE).not.toContain("geminiClient");
    expect(SOURCE).not.toContain("getServerEnv");
  });

  it("logs nothing — ANY console method (§B.7 rule 1)", () => {
    // `console.warn("[codeLanguagePrompt]", description)` here ships the
    // user's own job description into their browser console. Scoped to
    // `console.` rather than `console.info`, because a spy on one method is
    // blind to the other four.
    expect(SOURCE).not.toMatch(/\bconsole\s*\./);
  });

  it("restates the posting cap locally rather than importing it (AC-C28b)", () => {
    // The real definition (`answerContext.js:46`) is unexported, so it is
    // unimportable anyway; what the criterion wants is the constant stated
    // here with its reason, exactly as `idealProjectPrompt.js:36-41` does.
    expect(SOURCE).toContain("20000");
    expect(SOURCE).not.toMatch(/from\s*["'][^"']*answerContext/);
  });
});

describe("buildCodeLanguagePrompt — no question, structurally (AC-C6b)", () => {
  it("declares exactly one parameter", () => {
    // AC-C6b: "there is no parameter for one, and no caller has a question to
    // pass". Enforced the way `applicationDocs.js:44-52` enforces its own —
    // structurally, in the signature — because the `${userId}::${applicationId}`
    // key is wrong by construction if the question influences the resolver:
    // one application, many questions, one cached answer.
    //
    // `Function.prototype.length` is the arity check this repo already uses
    // (`answerPrompts.test.js:259`). It is not fooled by a defaulted second
    // parameter either — that would stop the count at one — so it is paired
    // with the behavioural case below.
    //
    // CORRECTION, recorded because an earlier round of this file argued the
    // opposite and a ruling was nearly made on it: this pin does **not** force
    // a signature that throws on a no-argument call. `function
    // buildCodeLanguagePrompt(options)` with `options?.description` inside
    // gives `length === 1` AND returns `""` when called with nothing — both
    // are asserted below. What the pin forbids is the `= {}` DEFAULT, not the
    // safe behaviour that default is usually reached for.
    expect(buildCodeLanguagePrompt.length).toBe(1);
  });

  it("ignores a question smuggled in on the options object", () => {
    // The behavioural half of the arity pin. `buildIdealProjectPrompt` — the
    // precedent this mirrors — DOES take `{ description, question }` and
    // interpolates the question, which is exactly why that aid is not cached
    // per application. Copying it faithfully is "the single most likely way to
    // build chunk C wrong with every other criterion green".
    const smuggled = "REWRITE THIS LOOP TO BE O(n) IN CLOJURE";
    const prompt = buildCodeLanguagePrompt({
      description: DESCRIPTION_MULTI,
      title: "Senior Backend Engineer",
      question: smuggled,
    });
    expect(prompt).not.toContain(smuggled);
    // Positive control: the description IS in there, so the absence above is
    // about the question and not about an empty prompt.
    expect(prompt).toContain("primarily Go on the backend");
  });

  it("returns the empty string for a missing or blank description", () => {
    // `buildIdealProjectPrompt`'s empty-input contract, and what makes
    // AC-C8e's "no description" exit reachable without a special case.
    expect(buildCodeLanguagePrompt({ description: "" })).toBe("");
    expect(buildCodeLanguagePrompt({ description: "   \n  " })).toBe("");
    expect(buildCodeLanguagePrompt({})).toBe("");
    // And with no argument at all — the precedent's own "never throws on
    // missing arguments" contract, which coexists with the arity pin above via
    // `options?.description` rather than a `= {}` default.
    expect(() => buildCodeLanguagePrompt()).not.toThrow();
    expect(buildCodeLanguagePrompt()).toBe("");
  });

  it("lists every allowed answer, and offers no Auto or Pseudocode", () => {
    const prompt = buildCodeLanguagePrompt({ description: DESCRIPTION_MULTI });
    for (const token of RESOLVER_LANGUAGES) {
      expect(prompt).toContain(token);
    }
    expect(prompt).toContain("none");
    expect(prompt).not.toMatch(/Pseudocode/i);
  });

  it("states the JSON shape and the evidence instruction the validator will enforce", () => {
    // The prompt body is the other half of BL-1's "only home". A model told
    // nothing about the 6-to-200 bound abstains or over-quotes, and every
    // over-quote is an abstention the feature did not have to pay — which is
    // the rate AC-C28e has to measure.
    const prompt = buildCodeLanguagePrompt({ description: DESCRIPTION_MULTI });
    expect(prompt).toContain(
      'Return ONLY JSON of this exact shape: { "language": string, "evidence": string }',
    );
    expect(prompt).toContain(
      '"evidence" is a span of the JOB POSTING above, copied exactly, between 6 and 200 characters, that supports your answer.',
    );
    expect(prompt).toContain('When "language" is "none", "evidence" is the empty string.');
    expect(prompt).toContain(
      "Allowed answers: Python, JavaScript, TypeScript, Java, C#, Go, SQL, or none.",
    );
  });

  it("restates rule 4 in the PROMPT BODY as well (A20, following the precedent's actual practice)", () => {
    // `idealProjectPrompt.js:50` carries the safety rule in the system
    // instruction and `:89` restates it in the body. The precedent duplicates
    // deliberately; removing this line as redundant is the defect A20 predicts.
    const prompt = buildCodeLanguagePrompt({ description: DESCRIPTION_MULTI });
    expect(prompt).toContain(RULE_4_PROMPT_RESTATEMENT);
  });

  it("includes the job title when there is one, and is byte-identical without one (AC-C6c)", () => {
    const titled = buildCodeLanguagePrompt({
      description: DESCRIPTION_MULTI,
      title: "Staff Dispatch Engineer",
    });
    expect(titled).toContain("Staff Dispatch Engineer");

    // "Omitted entirely when it is not present" — asserted as byte identity
    // against the no-title form, so an empty title cannot leave a dangling
    // line behind. Pins the property, not the sentence.
    const untitled = buildCodeLanguagePrompt({ description: DESCRIPTION_MULTI });
    expect(buildCodeLanguagePrompt({ description: DESCRIPTION_MULTI, title: "" })).toBe(untitled);
    expect(buildCodeLanguagePrompt({ description: DESCRIPTION_MULTI, title: "   " })).toBe(untitled);
    expect(untitled).not.toContain("Staff Dispatch Engineer");
  });

  it("never carries the company name (AC-C6c)", () => {
    // The title only. A company name could serve nothing but reputation-based
    // inference, which AC-C7c forbids, and §0.7's bound is "literally
    // evidenced IN THE DESCRIPTION" — a second, unvalidated input widens it.
    // (The employer name here is deliberately absent from the description
    // text, so this cannot pass by accident of the posting quoting it.)
    const prompt = buildCodeLanguagePrompt({
      description: DESCRIPTION_NONE,
      title: "Platform Engineer",
      company: "Northwind Logistics",
    });
    expect(prompt).not.toContain("Northwind Logistics");
  });

  it("clamps the job title, so an uncapped posting field cannot reach a prompt whole", () => {
    const longTitle = `Head of ${"Everything ".repeat(40)}`.trim();
    expect(longTitle.length).toBeGreaterThan(200);
    const prompt = buildCodeLanguagePrompt({ description: DESCRIPTION_MULTI, title: longTitle });
    expect(prompt).toContain(longTitle.slice(0, 200));
    expect(prompt).not.toContain(longTitle);
  });

  it("clamps the description at the module's own posting cap", () => {
    const prompt = buildCodeLanguagePrompt({ description: DESCRIPTION_OVER_CAP });
    expect(prompt).toContain(CLAMP_HEAD.trim());
    expect(prompt).not.toContain(CLAMP_TAIL);
  });
});

describe("validateResolvedLanguage — shape and abstention (AC-C8, §B.9.3 steps 1-2)", () => {
  const opts = { description: DESCRIPTION_MULTI };

  it("rejects anything that is not a plain object with two string fields", () => {
    for (const parsed of [null, undefined, "Python", 42, true, ["Python"], { language: "Go" }, { evidence: "primarily Go" }, { language: "Go", evidence: null }, { language: 7, evidence: "primarily Go" }]) {
      expect(validateResolvedLanguage(parsed, opts)).toBeNull();
    }
  });

  it("admits an abstention with no evidence to show for it", () => {
    // §B.9.3 step 2, and the reason it runs before the bounds: an honest
    // `none` must never have to manufacture a quote to pass. AC-C7b's whole
    // point is that the resolver can say "I don't know" — a resolver asked
    // "which language?" with no way to decline WILL pick one.
    expect(validateResolvedLanguage({ language: "none", evidence: "" }, opts)).toBe(NONE);
    expect(validateResolvedLanguage({ language: "none", evidence: "primarily Go" }, opts)).toBe(NONE);
  });

  it("rejects a non-member even when its quote is genuinely contained", () => {
    // Membership is exact and CASE-SENSITIVE. The order (membership before
    // containment) is a source-review property; what is observable here is
    // that no quote can launder a value the vocabulary does not admit.
    const realQuote = "primarily Go on the backend";
    expect(DESCRIPTION_MULTI).toContain(realQuote);
    for (const language of ["python", "GO", "Auto", "auto", "Pseudocode", "pseudocode", "Rust", "Node"]) {
      expect(validateResolvedLanguage({ language, evidence: realQuote }, opts)).toBeNull();
    }
  });

  it("admits every member when its quote is contained — the positive control", () => {
    // Without this, a validator that returns null unconditionally passes every
    // rejection case in this file.
    const quote = "Nice to have: exposure to Java";
    expect(DESCRIPTION_MULTI).toContain(quote);
    for (const language of RESOLVER_LANGUAGES) {
      expect(validateResolvedLanguage({ language, evidence: quote }, opts)).toBe(language);
    }
  });
});

describe("validateResolvedLanguage — the evidence bounds (AC-C8b3)", () => {
  const opts = { description: DESCRIPTION_BOUNDS };
  const LANGUAGE = "Go";

  it("admits a 200-character quote and rejects a 201-character one", () => {
    const at200 = quoteOfLength(200);
    const at201 = quoteOfLength(201);
    expect(at200).toHaveLength(200);
    expect(at201).toHaveLength(201);
    expect(DESCRIPTION_BOUNDS).toContain(at201); // both are genuinely contained
    expect(validateResolvedLanguage({ language: LANGUAGE, evidence: at200 }, opts)).toBe(LANGUAGE);
    expect(validateResolvedLanguage({ language: LANGUAGE, evidence: at201 }, opts)).toBeNull();
  });

  it("rejects the WHOLE description as a quote — `description.includes(description)`", () => {
    // The degenerate case a missing maximum produces, stated on its own
    // because it is the one that makes the check true for any language and
    // any posting. The wrong constant (20000) is in scope in the same module.
    expect(
      validateResolvedLanguage({ language: LANGUAGE, evidence: DESCRIPTION_BOUNDS }, opts),
    ).toBeNull();
  });

  it("admits a 6-character quote and rejects a 5-character one", () => {
    const at6 = quoteOfLength(6);
    const at5 = quoteOfLength(5);
    expect(validateResolvedLanguage({ language: LANGUAGE, evidence: at6 }, opts)).toBe(LANGUAGE);
    expect(validateResolvedLanguage({ language: LANGUAGE, evidence: at5 }, opts)).toBeNull();
  });

  it("rejects a single space — `Java` evidenced by ` ` would pass every other criterion", () => {
    expect(
      validateResolvedLanguage({ language: "Java", evidence: " " }, { description: DESCRIPTION_MULTI }),
    ).toBeNull();
  });

  it("rejects six SPACES, which clear the length floor and carry nothing", () => {
    // The floor alone does not close the minimum-evidence hole; `/\w/` is what
    // does. A six-space span is contained in essentially every posting.
    const sixSpaces = "      ";
    const description = `We run${sixSpaces}a large estate and we hire carefully.`;
    expect(description).toContain(sixSpaces);
    expect(validateResolvedLanguage({ language: "Java", evidence: sixSpaces }, { description })).toBeNull();
  });

  it("rejects a punctuation-only span with no word character", () => {
    const description = "Backend role. ------ We ship daily and we review every change.";
    expect(validateResolvedLanguage({ language: "Java", evidence: "------" }, { description })).toBeNull();
  });

  it("rejects an EMPTY quote for a real member", () => {
    expect(
      validateResolvedLanguage({ language: "Go", evidence: "" }, { description: DESCRIPTION_MULTI }),
    ).toBeNull();
  });
});

describe("validateResolvedLanguage — containment is an exact substring check (AC-C8b)", () => {
  const opts = { description: DESCRIPTION_MULTI };

  it("rejects a quote the description does not contain", () => {
    expect(
      validateResolvedLanguage({ language: "Java", evidence: "we are a Java shop through and through" }, opts),
    ).toBeNull();
  });

  it("does NOT case-fold either operand", () => {
    // "no regex, no word boundaries, no aliases, no case folding, no
    // per-member table" — the sole permitted transformation is whitespace-run
    // collapsing, and case sensitivity needed OPPOSITE settings for different
    // members under the matcher table this rule replaced.
    expect(
      validateResolvedLanguage({ language: "Go", evidence: "PRIMARILY GO ON THE BACKEND" }, opts),
    ).toBeNull();
  });

  it("collapses whitespace runs on BOTH sides, so a faithful quote crossing a line break is admitted", () => {
    // The one transformation, stated rather than left open because job
    // descriptions are line-wrapped bullets: a model quoting a span that
    // crosses a newline produces a quote that IS accurate and would otherwise
    // be rejected — a systematic, avoidable contributor to the abstention
    // rate AC-C28e has to measure.
    const wrapped = "primarily Go on the backend with TypeScript and React";
    // The literal span is NOT present — the description has a newline where
    // the quote has a space. That is the whole point of this case.
    expect(DESCRIPTION_MULTI).not.toContain(wrapped);
    expect(validateResolvedLanguage({ language: "Go", evidence: wrapped }, opts)).toBe("Go");
  });

  it("collapsing cannot ADMIT a span the description does not contain", () => {
    // It can only stop rejecting one it does. The safety argument for the
    // transformation, asserted rather than asserted-about.
    expect(
      validateResolvedLanguage({ language: "Go", evidence: "primarily   Ruby   on   the   backend" }, opts),
    ).toBeNull();
  });

  it("compares against the CLAMPED description the resolver was shown (AC-C8b2)", () => {
    const opts2 = { description: DESCRIPTION_OVER_CAP };
    // A quote from beyond the cap is one the resolver could not have seen.
    expect(DESCRIPTION_OVER_CAP).toContain(CLAMP_TAIL);
    expect(validateResolvedLanguage({ language: "Go", evidence: CLAMP_TAIL }, opts2)).toBeNull();
    // Positive control: a quote from inside the cap is still admitted, so the
    // rejection above is the clamp and not a broken comparison.
    expect(validateResolvedLanguage({ language: "Go", evidence: CLAMP_HEAD.trim() }, opts2)).toBe("Go");
  });

  it("reads ONLY `description` from its options — no other key can widen the haystack", () => {
    // The third member of the degenerate-validator family, and the one the
    // identity of `options.description` does not close: the wrapper hands over
    // the right description AND a second field, and the validator prefers or
    // concatenates it. `options?.resume ?? options?.description` is one line
    // and reads as defensive.
    //
    // Every decoy below carries the quote; only `description` may be consulted,
    // so all of them must still reject.
    const quote = "we are a Java shop through and through";
    expect(DESCRIPTION_MULTI).not.toContain(quote);
    for (const decoy of ["resume", "posting", "text", "prompt", "title", "profile", "coverLetter"]) {
      expect(
        validateResolvedLanguage(
          { language: "Java", evidence: quote },
          { description: DESCRIPTION_MULTI, [decoy]: quote },
        ),
        `${decoy} widened the haystack`,
      ).toBeNull();
    }
    // Positive control: with the span genuinely in the description, the same
    // shape is admitted — so the rejections above are about the KEY and not
    // about a validator that rejects everything with extra options.
    expect(
      validateResolvedLanguage(
        { language: "Go", evidence: "primarily Go on the backend" },
        { description: DESCRIPTION_MULTI, resume: "irrelevant" },
      ),
    ).toBe("Go");
  });

  it("rejects everything when there is no description to compare against", () => {
    for (const description of ["", null, undefined]) {
      expect(validateResolvedLanguage({ language: "Go", evidence: "primarily Go on the backend" }, { description })).toBeNull();
    }
    expect(() => validateResolvedLanguage({ language: "Go", evidence: "primarily Go" }, {})).not.toThrow();
  });
});

describe("the language<->evidence link is NOT machine-checked — AC-C8b4's stated residual", () => {
  it("admits a REAL span quoted in support of an unrelated language", () => {
    // This is deliberate and must not be "fixed". The validator confirms the
    // quote is real (AC-C8b) and that the language is a member (AC-C8); NOTHING
    // ties the two together, and the acceptance argument is that the evidence
    // is ON THE RECORD for a human to read beside the language — which a regex
    // that silently admitted "node" never left behind.
    //
    // The named adversarial case: a Kubernetes posting containing "manage node
    // pools" and naming no language at all. The resolver must abstain (a
    // review-gate property, AC-C8b4); the VALIDATOR cannot tell, and pretending
    // otherwise here would be the alias table returning under a new name.
    const evidence = "manage node pools and node affinity";
    expect(DESCRIPTION_NONE).toContain(evidence);
    expect(
      validateResolvedLanguage({ language: "JavaScript", evidence }, { description: DESCRIPTION_NONE }),
    ).toBe("JavaScript");
  });
});
