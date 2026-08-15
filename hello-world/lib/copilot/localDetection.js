// AC-P1: zero-network question detection. Reuses the exact three primitives
// the embedded engine's own /api/copilot/detect branch already composes
// (detectQuestion, cleanQuestion, classifyQuestionType) so the client-side
// decision and the server's embedded decision can never quietly disagree
// about what counts as a question — moving detection to the client is a
// LATENCY change, never a BEHAVIOR change.

import { detectQuestion, cleanQuestion, hasStarterOpener } from "./questions.js";
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

  // AC-R1.1 (defect #1): detectQuestion's STARTERS check only ever looks at
  // position 0 of the raw text, so an interview lead-in ("Okay, so, um,")
  // sitting in front of a genuine starter phrase blocks it — cleanQuestion
  // strips exactly that lead-in. Retried once against the cleaned text so a
  // lead-in never costs a detection the embedded engine would still make
  // after cleaning.
  //
  // The retry is trusted by asking hasStarterOpener directly against the
  // cleaned text, NOT by re-running it through detectQuestion and checking
  // `reason === "starter"` (the previous, broken rule). cleanQuestion
  // synthesizes a trailing "?" for any interrogative opener that never
  // actually carried one ("why do you want to work here" -> "...here?"), and
  // detectQuestion's punctuation check runs BEFORE its starter check — so
  // detectQuestion(cleaned) would ALWAYS report "punctuation" for exactly
  // these spoken utterances, never "starter", and the old rule discarded
  // every one of them. hasStarterOpener asks the narrower question instead —
  // does what's left after cleaning open with a real starter word? — which
  // is still a STARTERS match and nothing else: a bare statement that picks
  // up a synthesized "." or "?" while cleaning still can't pass, because it
  // still has to open with one of STARTERS, exactly like the raw-text path
  // above. Nothing here loosens what counts as a starter.
  const cleaned = cleanQuestion(utterance);
  if (!cleaned || !hasStarterOpener(cleaned)) return notDecided();
  return { decided: true, question: cleaned, type: classifyQuestionType(cleaned), reason: "starter" };
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
