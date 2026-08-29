// The code-language VOCABULARY and its normalizers. Pure, zero imports, no
// React, no logging of any kind. This module is CLIENT-REACHABLE — `lib/copilot/` is a
// shared client/server directory (51 non-test files under `app/copilot/`
// import from it, including `CodeLanguagePicker`) — so whatever lives here ships to the
// browser bundle. That is the whole reason this file exists on its own: the
// resolver's system instruction (the resolver's system-prompt constant, in
// `codeLanguagePrompt.js`) and the model call that reads it
// (`answerCodeLanguage.js`, which also owns every diagnostic-logging line)
// must never be reachable from here, directly or transitively. There is no
// `server-only` package anywhere in this repo, so importing the Gemini
// client would NOT fail the build or the bundle — the module boundary is the
// only thing keeping that instruction, and the user's own posting text, out
// of the browser. Do not import anything into this file, and do not merge it
// with either of the other two resolver modules.
//
// THREE DIFFERENT VOCABULARIES live here. Collapsing any two of them is the
// defect this module exists to prevent:
//
//   * CONTROL_OPTIONS — what the user picks, and what is stored, sent in the
//     request body, and used as (part of) the cache key. Nine lowercase
//     slugs, `auto` first and defaulted, `pseudocode` a real preference.
//   * RESOLVER_LANGUAGES — the resolver's own output set: seven capitalised
//     language names. It contains neither sentinel and no `Pseudocode` — a
//     resolver returning "Auto" would otherwise put "the language resolved
//     for this application is Auto" into the answer prompt.
//   * The response reference list (RESOLVER_LANGUAGES + `Pseudocode`) that
//     `normalizeLanguageToken` checks a `code.language` value AGAINST — as a
//     CONTRAST, never a restriction. A well-formed token outside it (e.g.
//     "Rust") is admitted and displayed verbatim, because a question naming
//     Rust must be able to yield a Rust label.
//
// A SLUG MUST NEVER REACH A PROMPT. The prompt emits the LABEL, always, via
// `codeLanguageLabel(value)` — the only bridge between the control's slugs
// and prose. "The candidate has said they want csharp." is wrong output.
// The row this is easiest to get wrong on is `pseudocode`: the slug and its
// label differ only by case (`pseudocode` vs `Pseudocode`), and the rule is
// unconditional — the prompt always emits the capitalised label, on every
// row, with no exception for the row where they look almost the same.

/** The control's "no preference stated" sentinel. Always a non-empty string
 * — never `""` — so it survives a request-body field, a `localStorage`
 * value, and a cache key without being confused with an omitted field. */
export const AUTO = "auto";

/** The resolver's abstention token. Never a control option, never sent to
 * the model as an allowed answer — it is what the resolver's absence of an
 * answer becomes after validation, and it is cached like any other result. */
export const NONE = "none";

/** Deliberately one string doing two jobs: it is both a real control option
 * (a user may choose pseudocode on purpose) and the block label produced by
 * `normalizeLanguageToken` for anything that does not resolve to a real
 * language. That coincidence is intentional — it is what makes rendering an
 * abstention and a user-chosen Pseudocode identical, a no-op on this branch. */
export const PSEUDOCODE = "pseudocode";

/** The resolver's own output set: seven capitalised language names, in the
 * exact order the resolver prompt's "Allowed answers" line is generated
 * from — reordering this array silently rewrites that prompt. Contains
 * neither sentinel and no `Pseudocode`. `validateResolvedLanguage` admits
 * these exactly and case-sensitively. */
export const RESOLVER_LANGUAGES = [
  "Python",
  "JavaScript",
  "TypeScript",
  "Java",
  "C#",
  "Go",
  "SQL",
];

/** The nine options the control renders, in AC-C1's order. `value` is the
 * lowercase slug that is stored, sent, and keyed on; `label` is the prose
 * form a prompt may emit. `csharp` deliberately avoids `#` in a storage
 * value or a JSON body field. */
export const CONTROL_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "go", label: "Go" },
  { value: "sql", label: "SQL" },
  { value: "pseudocode", label: "Pseudocode" },
];

const CONTROL_VALUES = CONTROL_OPTIONS.map((option) => option.value);

const LABEL_BY_VALUE = new Map(CONTROL_OPTIONS.map((option) => [option.value, option.label]));

/** The CONTROL normalizer (AC-C4, A19). Round-trips any of the nine stored
 * slugs unchanged; anything else — an out-of-vocabulary string, a stale
 * value, a resolver token like `"Python"`, `null`, a non-string — folds to
 * `AUTO` and never throws. This is handed a raw `localStorage.getItem()`
 * result (`null` on a miss) and a raw JSON body field, so it must accept
 * anything without throwing. Deliberately does not accept a resolver token:
 * the two vocabularies stay separate. */
export function normalizeCodeLanguageChoice(value) {
  return CONTROL_VALUES.includes(value) ? value : AUTO;
}

/** The only bridge from a stored slug to prose (§B.1). Always returns one of
 * AC-C1's nine labels — an unrecognised input is normalized to `AUTO` first,
 * so this never throws and never echoes a slug back out. */
export function codeLanguageLabel(value) {
  return LABEL_BY_VALUE.get(normalizeCodeLanguageChoice(value)) ?? "Auto";
}

const TOKEN_CHARSET = /^[A-Za-z0-9+#._\- ]+$/;
const WHITESPACE_RUN = /\s{2,}/;
const MIN_TOKEN_LENGTH = 1;
const MAX_TOKEN_LENGTH = 24;

/** SHAPE validation for `code.language` (AC-C19, D22) — never membership.
 * Ships INERT in chunk C: nothing produces a `code` object until chunk B, so
 * this has no production caller yet, the same disposition
 * `isCodeBearingInterviewType` had in chunk A. Still fully unit-tested,
 * because AC-C19 is classified automatable.
 *
 * Rule, in order: stringify and trim; reject anything outside 1-24
 * characters; reject anything outside the charset `[A-Za-z0-9+#._- ]`;
 * reject a whitespace run (two or more consecutive whitespace characters);
 * fold the internal sentinels `auto`/`none` (case-insensitive) to
 * `PSEUDOCODE`; anything else that reaches this point is returned verbatim,
 * membership in any list intentionally never checked. A well-formed token
 * outside every named vocabulary (e.g. "Rust") is admitted as-is — the
 * response reference list is a contrast, never a restriction. Anything that
 * fails any step becomes `PSEUDOCODE`, and this never throws. */
export function normalizeLanguageToken(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length < MIN_TOKEN_LENGTH || trimmed.length > MAX_TOKEN_LENGTH) return PSEUDOCODE;
  if (!TOKEN_CHARSET.test(trimmed)) return PSEUDOCODE;
  if (WHITESPACE_RUN.test(trimmed)) return PSEUDOCODE;
  const lower = trimmed.toLowerCase();
  if (lower === AUTO || lower === NONE) return PSEUDOCODE;
  return trimmed;
}
