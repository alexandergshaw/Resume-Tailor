// The resolver's prompt, its system instruction, and its validator — the
// three things reconciliation BL-1 makes binding: "CODE_LANGUAGE_SYSTEM and
// the prompt body are the ONLY home of AC-C7b, AC-C7c, AC-C7d and AC-C28...
// A design that leaves the prompt to the implementer leaves that guard to
// the implementer." Nothing here is invented at call time; every rule the
// resolver must obey is a string in this file.
//
// CLIENT-REACHABLE, LIKE ITS SIBLING. `lib/copilot/` is a shared
// client/server directory, and this module touches the user's own posting
// text (it builds the prompt that carries it). There is no `server-only`
// package anywhere in this repo, so nothing structural stops this file being
// pulled into a browser bundle. Two rules keep that safe: this module logs
// nothing, of any kind, ever; and it imports nothing beyond the pure
// vocabulary module (./codeLanguages.js) — never the model client, never a
// server-only environment reader. Any observation of what the model actually
// returned belongs one file over, in the module that owns the network call,
// which is server-only because IT imports the client.
//
// THE THREE EVIDENCE BOUNDS ARE THE MOST IMPORTANT LINES IN THIS FILE.
// Without a maximum, the whole description is a valid quote and the
// containment check degenerates to `description.includes(description)` —
// true for every language and every posting. Without a minimum, a single
// space clears "non-empty" and is contained in essentially every posting.
// Six characters alone does not close that second hole either — six spaces
// clear the length floor and still carry nothing — so a word-character
// requirement runs alongside the length bounds, not instead of them.
//
// THE ONE PERMITTED TRANSFORMATION. Containment collapses whitespace runs to
// a single space on both operands, and does nothing else — no regex over
// language names, no word boundaries, no aliases, no case folding, no
// per-member table. Four rounds of tuned pattern-matching preceded this rule
// (a hyphen inside "C#" defeats a word-boundary match; a generic infra term
// like "node" reads as a language it is not); the fix was to change the KIND
// of rule, not to tune the next pattern.
//
// THE LANGUAGE<->EVIDENCE LINK IS NOT MACHINE-CHECKED, DELIBERATELY. This
// module confirms the quoted span is real (it appears in the posting) and
// that the named language is a member of the allowed set. Nothing here ties
// the two together semantically — a quote about container orchestration
// offered in support of "JavaScript" is not caught here. The acceptance
// argument is that the quote is left on the record, in the observation log
// one file over, for a person to read beside the language; a validator that
// tried to bridge that gap itself would be the alias table returning under a
// new name.

import { NONE, RESOLVER_LANGUAGES } from "./codeLanguages.js";

// Restated locally rather than imported. The real posting cap
// (`answerContext.js`) is not exported by that module, and even if it were,
// this file must be safe to call on its own — from either side of the
// client/server boundary — without depending on a route-level constant.
const MAX_POSTING_CHARS = 20000;

// AC-C8b3's floor and ceiling. Six characters is short enough to admit a real
// but terse quote ("in Go", "uses SQL"); two hundred is long enough for a
// sentence-length span without being long enough to make most of a posting a
// valid "quote".
const MIN_EVIDENCE_CHARS = 6;
const MAX_EVIDENCE_CHARS = 200;

// A posting's own title field is framing for the resolver's tie-break only —
// never evidence — but it is still a posting-supplied string and gets the
// same treatment every posting-supplied string gets before it reaches a
// prompt: a cap.
const MAX_TITLE_CHARS = 200;

const clampDescription = (value) => String(value || "").trim().slice(0, MAX_POSTING_CHARS);
const clampTitle = (value) => String(value || "").trim().slice(0, MAX_TITLE_CHARS);
const collapse = (value) => value.replace(/\s+/g, " ");

// A20's required restatement (§B.9.2), held ONCE and used at BOTH sites
// (sentence 6 below, and the prompt body) so the system instruction and the
// prompt body cannot drift into saying this differently. This is the only
// hard rule restated in the body — matching the precedent
// (idealProjectPrompt.js:50,89) — and the only one that needs to be: it is
// the rule a posting that merely mentions a language would otherwise defeat.
const RULE_4_PROMPT_RESTATEMENT =
  'If the language this role is built around is not on that list, answer "none" — do not substitute an allowed answer that the posting merely mentions.';

// The system instruction (AC-C7c). Shaped like IDEAL_PROJECT_SYSTEM
// (idealProjectPrompt.js): a short statement of what the call is for, then
// every hard rule, joined into one paragraph so a source reviewer reads the
// whole contract in one constant.
//
// Sentence 3 names the full output set INSIDE this constant — not only in
// the user prompt — because a source-review criterion whose subject is a
// string must be readable on its own, with no referent living somewhere
// else. Sentence 6 is AC-C7d rule 4, and it is deliberately its OWN sentence
// rather than a clause of sentence 5: subordinating it to "when the posting
// names several" would let a posting that merely mentions an unlisted
// language escape the rule, and a clause that reads as a special case of its
// neighbour is the clause a later edit trims as redundant. Sentence 5 is
// rules 1 and 3 (the multi-language tie-break); sentence 7 is rule 2 (SQL);
// sentence 8 is the never-infer-from-reputation rule.
//
// Deliberately absent, and each absence is its own criterion: any claim
// about what most postings look like (an unsupported prior that would bias
// the model to abstain exactly where this feature should work); the
// employer's name (only the title reaches this call, never the company);
// any interview question (this call decides a language for the whole
// application, not one answer); and any list of companies or the languages
// they are known to use (that guidance is authored into the rules below, at
// review time, never looked up at request time).
const CODE_LANGUAGE_SYSTEM_SENTENCES = [
  "You decide which single programming language, if any, a job posting is built around, for an interview-prep tool that may draft a code answer in it.",
  "Return ONLY the JSON object requested — no prose outside it, no markdown code fences.",
  `Your answer must be exactly one of these ${RESOLVER_LANGUAGES.length + 1} words: ${RESOLVER_LANGUAGES.join(", ")}, or none.`,
  'Answer with a language only when the posting itself names one; when it does not, answer "none".',
  'When the posting names several, answer with the one the role is actually built around — named in the title, the responsibilities, or the primary stack — never one listed under "nice to have", "exposure to", or a legacy system, and answer "none" if none of them is clearly primary.',
  RULE_4_PROMPT_RESTATEMENT,
  'Answer "SQL" only for a role that is itself a data or SQL role, never because SQL appears in a list of skills.',
  "Never infer a language from the company's reputation, the role's seniority, or what similar companies are known to use — only from the words of this posting.",
  'Every answer other than "none" must quote a span of the posting, copied exactly, that supports it.',
];

export const CODE_LANGUAGE_SYSTEM = CODE_LANGUAGE_SYSTEM_SENTENCES.join(" ");

// AC-C6b is discharged STRUCTURALLY, by there being no question parameter
// anywhere in this function — never by an arity assertion alone. A single
// plain parameter (never destructured or defaulted in the signature) keeps
// `buildCodeLanguagePrompt.length === 1` true while still letting a
// no-argument call return "" safely, via optional chaining rather than a
// `= {}` default: a defaulted destructured parameter stops
// `Function.prototype.length` counting at zero, which this module has no
// reason to accept just to look slightly shorter.
//
// A `question` field smuggled onto the options object is ignored, not
// rejected — there is no code path anywhere below that reads it. The
// precedent this mirrors, `buildIdealProjectPrompt`, DOES take a question
// and interpolates it, which is exactly why that aid is not cached per
// application; this one is, so the question can never reach it.
export function buildCodeLanguagePrompt(options) {
  const description = clampDescription(options?.description);
  if (!description) return "";
  const title = clampTitle(options?.title);

  const sections = [
    "You are reading one job posting to decide which single programming language, if any, the role is built around.",
    `--- JOB POSTING ---\n${description}\n--- END JOB POSTING ---`,
  ];

  // Omitted entirely when blank — never an empty line left in its place —
  // so a title of "" or all-whitespace is byte-identical to no title at all.
  if (title) sections.push(`The role's title is "${title}".`);

  sections.push(
    [
      `Allowed answers: ${RESOLVER_LANGUAGES.join(", ")}, or none.`,
      RULE_4_PROMPT_RESTATEMENT,
      'Answer "none" unless the posting itself names a language. A posting that names several gets the one the role is built around, and "none" if none of them is clearly primary.',
    ].join("\n"),
  );

  sections.push(
    [
      'Return ONLY JSON of this exact shape: { "language": string, "evidence": string }',
      '"language" is exactly one of the allowed answers above, spelled exactly as written there.',
      '"evidence" is a span of the JOB POSTING above, copied exactly, between 6 and 200 characters, that supports your answer. Copy it verbatim — do not paraphrase, correct, shorten past 6 characters, or add words that are not in the posting.',
      'When "language" is "none", "evidence" is the empty string.',
    ].join("\n"),
  );

  return sections.join("\n\n");
}

// The full algorithm, six steps, always in this order (§B.9.3). Any step
// failing returns null; the caller that owns the model call maps
// `null -> NONE`, never this function — this function's job is to validate
// a parsed response, not to decide the fallback for one that fails.
//
//   1. Shape       — a plain object, not an array, whose `language` field is
//                     a string. `evidence` is NOT examined yet.
//   2. Abstention  — `language === "none"` returns immediately, with no
//                     evidence required, examined, or expected to exist. An
//                     honest "no language is evidenced" must never be forced
//                     to manufacture a quote to satisfy a shape rule — that
//                     is the exact failure this mechanism exists to prevent,
//                     arriving through the validator instead of the model.
//   3. Membership  — exact, case-sensitive membership in RESOLVER_LANGUAGES.
//                     Runs BEFORE containment, so no quote — however real —
//                     can launder a value the vocabulary does not admit.
//   4. Evidence    — required only now that a language has been named,
//                     measured on the RAW evidence string, before any
//                     transformation: a string, 6-200 characters, containing
//                     at least one word character. This is also where a
//                     missing `evidence` key is rejected, on purpose: step 2
//                     must be able to abstain without one.
//   5. Containment — the ONLY transformation permitted, on both operands, is
//                     collapsing whitespace runs to a single space, then an
//                     exact substring check against the posting the resolver
//                     was actually shown (the same clamp `buildCodeLanguagePrompt`
//                     applies, so this can never compare against a longer
//                     description than the one that was sent).
//   6. Return      — the validated language, unchanged.
export function validateResolvedLanguage(parsed, options) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  if (typeof parsed.language !== "string") return null;

  if (parsed.language === NONE) return NONE;

  if (!RESOLVER_LANGUAGES.includes(parsed.language)) return null;

  const { evidence } = parsed;
  if (typeof evidence !== "string") return null;
  if (evidence.length < MIN_EVIDENCE_CHARS || evidence.length > MAX_EVIDENCE_CHARS) return null;
  if (!/\w/.test(evidence)) return null;

  const description = clampDescription(options?.description);
  if (!collapse(description).includes(collapse(evidence))) return null;

  return parsed.language;
}
