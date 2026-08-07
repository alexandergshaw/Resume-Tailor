// AC-N2: practice mode's repeat loop, with the clicks taken out of it.
//
// Reported: "the workflow for the practice page needs to be a lot less clicks.
// next question should kick off the 'start answering' and should also queue up
// the sample answer". Today one rep costs Next question -> Start answering ->
// Done, plus a fourth click and a wait if the sample answer is wanted. After
// this it costs Next question -> Done, and the sample answer is already there.
//
// Both decisions live here as plain functions rather than inside PracticeClient
// for the reason that file's own header already gives: this repo runs vitest
// with `environment: "node"` and no jsdom, so a decision embedded in a
// component or an effect cannot be tested at all. The wiring stays in React;
// the rules are here.
//
// The hard part is not "start recording" — it is that the question arrives
// ASYNCHRONOUSLY. `onNextQuestion` fires a fetch; the question lands some time
// later, and only then is there anything to answer. So the press ARMS the
// intent and the arrival consumes it, which means every way the arrival can go
// wrong has to be answered explicitly: the fetch fails, the bank is exhausted,
// the session was never live, the user hit Start answering manually in the
// gap. Each of those must DISARM rather than leave a press pending that fires
// minutes later, at the worst possible moment, in a recorded practice session.

import { normalizeQuestion } from "./questions.js";

// Whether an armed "give me the next question and start recording my
// answer" intent should fire now.
//
//   armed — set by the press (Next question / Try again in PracticeClient),
//           cleared the moment this function returns anything but "wait".
//           Outranks every other input: an unarmed call is always "wait",
//           whatever else is true, because nothing is asking for a start.
//   armedFrom — the question that was on screen at the moment this press
//           armed, captured by PracticeClient before the fetch that's
//           supposed to replace it. See check 4 below for why this exists.
//
// Checked in this order once `armed` is true:
//
//   1. `loading` — the PREVIOUS question is still on screen while the next
//      one is in flight (PracticeClient clears `question` only once the new
//      one lands, not the moment the fetch starts), so a non-empty
//      `question` here is not evidence of arrival. Starting on it would
//      record an answer to the question the user just moved off. Returns
//      "wait": the press is still legitimately pending.
//
//   2. `answering` / `settling` — something is already recording, or still
//      draining the previous answer's trailing transcript. The user hit
//      Start answering manually in the gap, or Done hasn't finished
//      settling yet. Starting again would abandon or collide with a take
//      already in progress. Returns "disarm": this press's moment has
//      passed, and a fetch that finishes lands into a session already
//      recording something else.
//
//   3. `status !== "live"` — the capture session was never started, or has
//      stopped/errored. The question should simply appear and wait for the
//      user; auto-start must not lie in wait and fire the instant Start
//      session is later pressed, which would read as the recorder starting
//      on its own with no warning. Returns "disarm".
//
//   4. `question` unchanged from `armedFrom` once `loading` has finished —
//      this is the one that is NOT "is there a question". usePracticeQuestions'
//      fetch catch sets an error and DELIBERATELY leaves `currentQuestion` in
//      place (its own comment says so), so a FAILED fetch does not produce an
//      empty question — it produces the exact same, PREVIOUS one, with
//      `loading` back to false. That means "is there a question" is not
//      evidence one arrived: the exhausted-bank case and the failed-fetch
//      case both end up with `loading: false`, but only one of them actually
//      has something new to answer. The only sound evidence a fetch
//      delivered is that the question CHANGED, so this compares `question`
//      against `armedFrom` — what was on screen at the moment the press
//      armed — via `normalizeQuestion`, the same normalization the rest of
//      the flow already uses, so case/whitespace differences can't
//      masquerade as a new question. Still-equal means either the fetch
//      failed (bank not exhausted, same question left in place) or it
//      returned nothing at all (`question` and `armedFrom` both empty).
//      Either way there is nothing new to answer. Returns "disarm". An empty
//      `armedFrom` with a real `question` is the one exception: the first
//      question of a session has no predecessor to be equal to, so that is a
//      genuine arrival, not a failure.
//
// Every one of 2-4 disarms rather than waits, on purpose: a press that
// stays "pending" is the dangerous state, because it can fire on some LATER,
// unrelated render — during a different question, or after the user has
// walked away from the screen entirely. Disarming means the shortcut simply
// didn't apply this time, and the user still has the manual "Start
// answering" button sitting right there.
export function autoStartDecision(args) {
  const { armed, status, question, armedFrom, loading, answering, settling } = args || {};
  if (!armed) return "wait";
  if (loading) return "wait";
  if (answering || settling) return "disarm";
  if (status !== "live") return "disarm";
  if (!question || !String(question).trim()) return "disarm";
  if (normalizeQuestion(question) === normalizeQuestion(armedFrom)) return "disarm";
  return "start";
}

// Whether a draft of the sample answer should be fetched now for `question`,
// so it is READY by the time the user reveals it — never SHOWN early. Only
// `useSampleAnswer`'s reveal path is allowed to put a draft on screen; this
// decision exists purely to pre-pay the network cost, the same bet the
// dashboard's pre-draft already makes for a PREDICTED question, applied here
// to whatever question actually landed.
//
//   loading — the question itself isn't settled yet; queuing a draft for
//             text that's about to be replaced would draft the wrong thing.
//   visible — the reveal panel already owns fetching for this question
//             (useSampleAnswer's `reveal`); queuing here would race it.
//   hasCached — already fetched (by a prior queue, a prior reveal, or a
//               dashboard pre-draft) — never pay twice for the same draft.
//   queuedFor — the question this hook last queued a draft for, compared via
//               `normalizeQuestion` (the same normalization the cache itself
//               is keyed by) so trivial case/whitespace differences don't
//               defeat the dedupe, and a re-render for the same question
//               never re-queues it.
export function shouldQueueSampleAnswer(args) {
  const { question, loading, visible, hasCached, queuedFor } = args || {};
  if (loading) return false;
  if (visible) return false;
  if (hasCached) return false;
  const q = typeof question === "string" ? question.trim() : "";
  if (!q) return false;
  if (normalizeQuestion(queuedFor) === normalizeQuestion(question)) return false;
  return true;
}
