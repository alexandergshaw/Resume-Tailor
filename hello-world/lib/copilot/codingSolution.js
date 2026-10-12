// N161 — the worked-solution CONTRACT for a detected coding / pseudocode
// question (lib/copilot/detectCodingChallenge.js decides what is one). Pure,
// no React, no network, client/server shared.
//
// The response field is `codingSolution`, a SEPARATE field from `points` /
// `type` (the type enum is unchanged — detect and answer routes both pin it),
// and for a detected question it REPLACES the spoken answer:
//
//   codingSolution = { approach, language, code, complexity, edgeCases: string[] }
//
// THE CODE IS NEVER TOUCHED. `code` is validated for SHAPE only and handed on
// byte-for-byte. It must never pass through deriveAnswerFromPoints (collapses
// whitespace), sanitizeTechTermDetail / isFirstPersonClaim (split sentences and
// drop first-person lines) or answerLines — each of those would delete the
// indentation, a "# I keep two pointers" comment, or an imperative line from
// CORRECT code. Role-term flags do not apply to it either.
//
// The embedded engine has no model and no code producer, so it cannot write a
// solution honestly: embeddedCodingFallback is a marker, never code.

import {
  AUTO,
  CONTROL_OPTIONS,
  PSEUDOCODE,
  codeLanguageLabel,
  normalizeCodeLanguageChoice,
  normalizeLanguageToken,
} from "@/lib/copilot/codeLanguages";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

// AC-5 steps 2-4 over `{ override, resolved }` (step 1 — a language the
// question itself names — is a MODEL instruction, not decidable here): the
// candidate's stated preference, as a LABEL and never the storage slug; else the
// posting-resolved language; else pseudocode. Takes no descriptor on purpose:
// codeLanguageLines (answerPrompts.js) is gated on `descriptor.codeBearing`,
// which a coding question under a general or phone-screen session fails, and a
// coding answer needs a language regardless of the session's format.
export function resolveCodingLanguageLabel(codeLanguage) {
  const override = normalizeCodeLanguageChoice(codeLanguage?.override);
  if (override !== AUTO) return codeLanguageLabel(override);
  const resolved = nonEmptyString(codeLanguage?.resolved);
  return resolved ? resolved.trim() : codeLanguageLabel(PSEUDOCODE);
}

// The prompt block for the same four steps. Always non-empty — see above.
export function codingLanguageDirective(codeLanguage) {
  const override = normalizeCodeLanguageChoice(codeLanguage?.override);
  const resolved = nonEmptyString(codeLanguage?.resolved);
  const preferenceLine =
    override !== AUTO
      ? `The candidate has said they want ${codeLanguageLabel(override)}.`
      : "The candidate has not stated a language preference.";
  const postingLine = resolved
    ? `The posting selected for this application reads as a ${resolved.trim()} role. That is inferred from the posting's own wording — treat it as a guess, never as a fact about the employer, and do not mention the posting or its wording in your answer.`
    : "Nothing in the selected posting resolved to a language.";
  return [
    "--- CODE LANGUAGE ---",
    "Choose the language of the code in this order:",
    "1. A language the interviewer's question itself names, or an explicit request for pseudocode — if the question gives one, use that.",
    `2. ${preferenceLine}`,
    `3. ${postingLine}`,
    "4. Otherwise, write pseudocode.",
  ];
}

// The display language for a model-reported token: a well-formed token is
// honoured even outside the control vocabulary ("Rust"), shown in the
// control's own capitalisation when it is one of the nine; a missing or
// malformed one falls back to the deterministic label.
function displayLanguage(raw, languageFallback) {
  const reported = nonEmptyString(raw);
  if (!reported) return languageFallback;
  const token = normalizeLanguageToken(reported);
  if (token === PSEUDOCODE) {
    return reported.trim().toLowerCase() === PSEUDOCODE ? codeLanguageLabel(PSEUDOCODE) : languageFallback;
  }
  const known = CONTROL_OPTIONS.find((option) => option.value !== AUTO && option.label.toLowerCase() === token.toLowerCase());
  return known ? known.label : token;
}

// The model's `codingSolution`, validated. Returns the five-field object only
// when approach, code and complexity are all non-empty strings; `edgeCases` is
// the one part allowed empty (a trivial problem may genuinely have none) and is
// coerced to string[]. Anything else is `null` — the caller degrades to the
// ordinary answer path, never a half-built solution.
export function normalizeCodingSolution(parsed, { languageFallback = codeLanguageLabel(PSEUDOCODE) } = {}) {
  const raw = parsed?.codingSolution;
  if (!raw || typeof raw !== "object") return null;
  const approach = nonEmptyString(raw.approach);
  const code = nonEmptyString(raw.code);
  const complexity = nonEmptyString(raw.complexity);
  if (!approach || !code || !complexity) return null;
  const edgeCases = (Array.isArray(raw.edgeCases) ? raw.edgeCases : [])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
  return {
    approach: approach.trim(),
    language: displayLanguage(raw.language, languageFallback),
    code: raw.code,
    complexity: complexity.trim(),
    edgeCases,
  };
}

// What the answer route returns for a detected coding question: `codingSolution`
// and `type`, and NOTHING else — no points, cues, answer or aids, because the
// worked solution replaces the spoken answer rather than sitting beside it.
// `null` when the question is not a coding ask OR the model's payload is not a
// whole solution (normalizeCodingSolution yields null), so the route falls
// through to its ordinary path — which, with no points either, is the usual
// empty-answer error rather than a half-built solution. `validTypes` is the
// route's own type enum, handed in so this module never keeps a second copy; a
// coding question with no valid model-reported type defaults to technical.
export function codingResponseFields({ parsed, isCoding, codeLanguage, validTypes }) {
  if (!isCoding) return null;
  const codingSolution = normalizeCodingSolution(parsed, {
    languageFallback: resolveCodingLanguageLabel(codeLanguage),
  });
  if (!codingSolution) return null;
  return { codingSolution, type: validTypes.includes(parsed?.type) ? parsed.type : "technical" };
}

// The embedded engine's honest answer to a coding question: a marker the UI can
// word as "switch to the AI engine", and NO code of any kind.
export function embeddedCodingFallback(type) {
  return {
    codingFallback: "The on-device engine can't write a worked code solution. Switch to the AI engine for approach, code, complexity, and edge cases.",
    type,
  };
}
