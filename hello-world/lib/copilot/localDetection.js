// AC-P1: zero-network question detection. Reuses the exact three primitives
// the embedded engine's own /api/copilot/detect branch already composes
// (detectQuestion, cleanQuestion, classifyQuestionType) so the client-side
// decision and the server's embedded decision can never quietly disagree
// about what counts as a question — moving detection to the client is a
// LATENCY change, never a BEHAVIOR change.

import { detectQuestion, cleanQuestion } from "./questions.js";
import { classifyQuestionType } from "./questionType.js";

// Mirrors useLiveSession.js's own pre-filter for whether an utterance the
// heuristic missed is still worth a remote confirm. Exported so no caller
// restates the number.
export const MIN_WORDS_FOR_LLM = 4;

function notDecided() {
  return { decided: false, question: "", type: "general", reason: "" };
}

// Runs detectQuestion + cleanQuestion + classifyQuestionType against `text`
// — the embedded branch's own composition — and returns a decided result,
// or null when it doesn't fire.
function attempt(text) {
  const det = detectQuestion(text);
  const isQuestion = !!det.isQuestion && !!det.question;
  if (!isQuestion) return null;
  const question = cleanQuestion(det.question);
  if (!question) return null;
  return { decided: true, question, type: classifyQuestionType(question), reason: det.reason || "" };
}

// AC-P1.1: decide locally, synchronously, from the utterance alone.
export function localDetection(utterance) {
  if (typeof utterance !== "string") return notDecided();

  const direct = attempt(utterance);
  if (direct) return direct;

  // detectQuestion's STARTERS check only ever looks at position 0 of the raw
  // text, so an interview lead-in ("Okay, so, um,") sitting in front of a
  // genuine starter phrase blocks it — cleanQuestion strips exactly that
  // lead-in. Retried once against the cleaned text so a lead-in never costs
  // a detection the embedded engine would still make after cleaning, but
  // trusted ONLY when the retry's own reason is "starter" — the same kind of
  // match the raw text would have produced had the lead-in not been in the
  // way. A retry reason of "punctuation" is a materially weaker signal here:
  // it means cleanQuestion itself SYNTHESIZED a "?" for an interrogative
  // opener that never actually carried one, not a question mark the
  // interviewer actually spoke, and is left to the remote confirm instead.
  const retry = attempt(cleanQuestion(utterance));
  return retry && retry.reason === "starter" ? retry : notDecided();
}

// AC-P1.2: whether a locally-undecided utterance is still worth a network
// round trip. False once localDetection already decided — a local hit costs
// no network at all; otherwise true only when the utterance is long enough
// that the LLM confirm has a real chance of catching an indirect ask the
// heuristic can't see.
export function remoteConfirmNeeded(input) {
  if (input && input.decided) return false;
  const utterance = input && typeof input.utterance === "string" ? input.utterance : "";
  const words = utterance.trim().split(/\s+/).filter(Boolean).length;
  return words >= MIN_WORDS_FOR_LLM;
}
