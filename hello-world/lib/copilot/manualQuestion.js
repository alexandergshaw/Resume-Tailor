import { classifyQuestionType } from "./questionType.js";

// AC-O1/AC-O5: the "user typed a question instead of speaking it" contract,
// shared by ManualQuestion.js (the input control) and, in a later wave,
// useLiveSession's and useRoomQuestions' addManualQuestion. It lives here
// rather than inline in the component or either hook for two independent
// reasons:
//
// 1. normalizeManualQuestion is the ONE decision behind "is this
//    submittable, and what exact string gets submitted" — the component
//    needs it for its own disabled state, and both hooks need the identical
//    answer, since the component's normalization is only a UX preview, not
//    the value either hook can trust. Three copies of that predicate is how
//    they drift; one copy shared by all three cannot.
//
// 2. submitPracticeQuestion composes a SEQUENCE of side effects
//    (advanceAsked -> abandonAnswer -> resetAnswer -> setDrillQuestion ->
//    addToFeed) across three different hooks' worth of state. The order is
//    load-bearing — advanceAsked must bank the question currently on the
//    card before setDrillQuestion replaces it, or the outgoing question is
//    lost from the asked list and the generator can hand it back again as
//    if it had never been asked. vitest.config.js's own `environment: "node"`
//    comment is explicit that extracting a decision out of a component or
//    hook into `lib/` like this remains the FIRST choice, not a fallback
//    forced by some inability to test a component — a per-file
//    `// @vitest-environment jsdom` docblock can mount one when that's truly
//    what's needed (app/copilot/useCopilotDashboard.wiring.test.js is the
//    precedent, and four files in this feature use it). The reason to reach
//    for this extraction instead is narrower and still decisive: a plain
//    function over injected callbacks makes the ORDER directly assertable
//    with nothing else in play, where inlined as five calls in a row inside
//    a React event handler, observing that same order would need a full
//    `PracticeClient` render just to watch the callbacks fire in sequence.
//    Extracted, the order itself is the thing under test.

// NOT mirroring a server limit — a typed question never reaches
// app/api/copilot/detect/route.js at all (skipping that route, and its own
// confirmQuestion round trip, is the entire feature). The route a typed
// question DOES reach is app/api/copilot/answer/route.js, which trims
// `question` and applies no length cap to it whatsoever. So this constant is
// the ONLY bound standing between a pasted wall of text and a model request
// — it has to be a sane limit on its own merits, not a copy of someone
// else's.
export const MAX_MANUAL_QUESTION_CHARS = 1200;

// Unicode-aware: a typed question is not restricted to ASCII, so the "has
// actual content" floor has to recognize a letter or digit in any script,
// not just [a-z0-9].
const HAS_LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

// Deliberately NOT cleanQuestion() (./questions.js). That helper repairs
// SPEECH — it drops leading filler ("great, so, um..."), fixes transcription
// stutter, and appends a question mark to interrogatives. Typed text has
// none of those problems, and running it through cleanQuestion would mean
// someone sees a different question on the card than the one they typed.
// This function only ever collapses whitespace; it never rewrites wording.
export function normalizeManualQuestion(raw) {
  if (typeof raw !== "string") return { ok: false, question: "" };

  let question = raw.replace(/\s+/g, " ").trim();
  if (question.length > MAX_MANUAL_QUESTION_CHARS) {
    // Re-trim after the cut: collapsing already removed every run down to a
    // single space, so the only way a trailing space can appear is the cut
    // landing exactly on one of those single spaces.
    question = question.slice(0, MAX_MANUAL_QUESTION_CHARS).trim();
  }

  if (!HAS_LETTER_OR_DIGIT_RE.test(question)) return { ok: false, question: "" };
  return { ok: true, question };
}

// AC-O5: practice mode's one Add does two things — replace the drill
// question on the card AND drop a feed entry (with a drafted answer) for
// the one just left behind. See the module comment above for why the order
// of these five calls is the entire point of testing this as its own
// function rather than as inline handler code.
export function submitPracticeQuestion(
  raw,
  { advanceAsked, abandonAnswer, resetAnswer, setDrillQuestion, addToFeed },
) {
  const { ok, question } = normalizeManualQuestion(raw);
  if (!ok) return false;

  // Bank the question currently on the card before it's replaced.
  advanceAsked();
  // Same abandon-then-reset order "Next question" already uses: a recording
  // still running belongs to the question being left, and must be dropped
  // before the state describing it is cleared.
  abandonAnswer();
  resetAnswer();

  // classifyQuestionType is the zero-cost local classifier the embedded
  // engine already uses — the card renders a type chip the instant the
  // question appears, before any request could return one.
  setDrillQuestion(question, classifyQuestionType(question));
  addToFeed(question);
  return true;
}
