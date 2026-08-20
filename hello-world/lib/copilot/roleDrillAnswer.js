// AC-R1 — the pure decisions behind recording an answer in the "Speak as"
// role drill. Practice mode's answer-recording machinery
// (usePracticeCaptureSession, usePracticeAnswer, AnswerReview, AnswerFeedback)
// is reused as-is for this mode; what differs is mode-specific and lives
// here, as plain functions of their arguments, so the step-5 contract tests
// can pin every case without a jsdom render — the same discipline
// spokenPace.js and practiceNotices.js already follow.
//
// Deliberately no React, no DOM, nothing from app/.

import { sttNoticeFor, videoNoticeFor } from "./practiceNotices.js";

// The critique route's own cap on the incoming `question` field. Held here
// (rather than re-derived from the route) because this is the one place
// that needs to enforce it before the request is ever sent.
export const MAX_ROLE_QUESTION_CHARS = 600;

// Builds the single-line prompt sent to the critique route for a role-drill
// answer: the role, then the situation's prompt, then its context, as one
// sentence a model can grade against. A missing `roleLabel` drops the
// prefix entirely rather than emitting "Speaking as : ..." — a dangling
// colon would read as a bug, not as "no role selected". Whitespace runs
// (including the newlines the situation bank sometimes carries) collapse to
// a single space so the question reaches the model as one line, matching
// how usePracticeAnswer's own question strings are shaped.
export function roleAnswerQuestion({ roleLabel, situation }) {
  if (!situation) return "";
  const parts = [];
  if (roleLabel) parts.push(`Speaking as ${roleLabel}:`);
  if (situation.prompt) parts.push(situation.prompt);
  if (situation.context) parts.push(situation.context);
  const oneLine = parts.join(" ").replace(/\s+/g, " ").trim();
  return oneLine.slice(0, MAX_ROLE_QUESTION_CHARS);
}

// The `context` object usePracticeAnswer's `doneAnswer` takes, shaped for
// this mode. AC-R1.4: no résumé, cover letter, prep context or posting
// exists in a role drill, so those fields are hard-pinned to their "absent"
// values rather than threaded through from a caller that has nothing to put
// in them — a caller that gained a posting somehow could not smuggle it in
// here. `metrics` is deliberately absent: doneAnswer computes that itself
// from the recorded answer and merges it in, so a context carrying one would
// be a second, competing source of truth.
export function roleAnswerContext({ roleLabel, situation, includeFrames, isSaveEnabled }) {
  return {
    question: roleAnswerQuestion({ roleLabel, situation }),
    type: "general",
    interviewType: "general",
    posting: null,
    profile: "",
    applicationId: null,
    includeFrames: Boolean(includeFrames),
    isSaveEnabled,
  };
}

// AC-R1.2/AC-R1.8: recording can start only once the capture session is
// actually live (never mid-connect, idle, or errored), there is a situation
// on screen to answer, and no answer is already in flight or settling.
// Wrapped in Boolean(...) because a plain `&&` chain here would return the
// first falsy operand itself (e.g. `null` when `situation` is missing)
// rather than a real `false`, which is what every caller — and this
// module's own tests — expect back.
export function canStartRoleAnswer({ status, situation, answering, settling }) {
  return Boolean(status === "live" && situation && !answering && !settling);
}

// The role-drill engine sentence: same shape as practiceNotices.js's
// engineNoticeFor (silent/frames/embedded branches), but never mentions a
// posting or prep context — this mode has neither, so claiming either is
// sent would be false. Kept local to this module rather than added to
// engineNoticeFor because the two describe genuinely different requests:
// bolting a role-drill branch onto engineNoticeFor would force every future
// reader of that function to work out which sentence applies to which mode.
//
// BUG (privacy audit, three findings, all in this function):
//
// 1. The non-embedded branches now name "body-language measurements"
//    explicitly. app/api/copilot/critique/route.js builds
//    buildDeliveryNotes(metrics) and buildBodyLanguageFacts(metrics.bodyLanguage)
//    UNCONDITIONALLY on the Gemini path, and usePracticeAnswer's startAnswer
//    runs the BodyLanguageSampler on every answer regardless of the
//    "Include camera frames" switch. A numeric read of the user's head
//    orientation, posture, lean, gesture rate and how much of the frame
//    their face fills reaches Google even with that switch off. The old
//    sentence named only the transcript, which let the frames switch read
//    as THE control over camera data when it never was one — the frames
//    switch only ever added still images on top of a measurement stream
//    that was already being sent.
//
// 2. The embedded branch is now two sentences instead of one. The old
//    single sentence's "no AI provider" guarantee was true, but a reader
//    could come away believing the embedded engine keeps the audio local
//    too. It does not: lib/copilot/practiceSession.js streams the answer
//    audio to Deepgram or ElevenLabs (lib/copilot/stt/) on every engine,
//    embedded included. The second sentence says so plainly, pointing back
//    at the STT sentence this one is always concatenated after rather than
//    re-naming the provider and risking the two drifting apart.
function roleEngineNoticeFor({ isEmbedded, framesWillUpload }) {
  if (isEmbedded) {
    return (
      "Your feedback is generated on this server with no AI provider — your answer, the role, the situation and your measurements are never sent to Google. " +
      "Your audio still goes to the transcription provider named above."
    );
  }
  if (framesWillUpload) {
    return "Your answer transcript, the role you picked, the situation text, and the pace, filler and body-language measurements taken during your answer are sent to Google Gemini for feedback, along with up to three still frames from each answer.";
  }
  return "Your answer transcript, the role you picked, the situation text, and the pace, filler and body-language measurements taken during your answer are sent to Google Gemini for feedback.";
}

// BUG (privacy audit, third finding): videoNoticeFor's save-ON sentence
// (practiceNotices.js) says only "Your answer video is uploaded..." — true
// for practice mode's own save path, but lib/supabase/practiceAnswers.js's
// savePracticeAnswer stores far more than the clip: the question, the
// transcript, the metrics (body language included) and the critique all go
// in alongside it. Naming only the video understated what saving actually
// keeps. The save-OFF sentence has no such gap — nothing is stored either
// way — so it is untouched and still sourced from videoNoticeFor; only the
// save-ON sentence gets its own wording here. practiceNotices.js itself is
// deliberately left alone: practice mode's own save notice has the same
// gap, but that is a separate, pre-existing issue out of scope for this fix.
function roleVideoNoticeFor(saveEnabled) {
  if (!saveEnabled) return videoNoticeFor(false);
  return "Your answer video, its transcript, those measurements and the feedback are saved to your own Supabase storage, private to your account, and listed in your practice history until you delete it.";
}

// AC-R1.2/AC-R1.8 (Wave 3, BLOCKER 2): whether an armed "start speaking then
// arm the recorder the instant the situation is ready" press should fire
// now. This is the practiceFlow.js `autoStartDecision` shape (see that
// file's own long comment for the general argument) — re-derived rather
// than imported because that function's own inputs (`question`/`armedFrom`,
// compared via normalizeQuestion) are about a QUESTION FEED this mode
// doesn't have; a role drill has one situation on screen at a time, not a
// stream of candidate questions to diff against.
//
// The bug this exists to fix: the OLD hook-local re-derivation's only "wait"
// case was `status === "connecting"`. With no situation yet — a cold tab,
// a role change to a role with no cached situation, or a failed fetch — the
// armed press read as un-startable and was silently DROPPED, with nothing
// re-arming it once a situation actually landed. The camera and microphone
// were still acquired (permission prompt, camera light on) for a press that
// then recorded nothing, with no message anywhere. Read in order:
//
//   1. `!armed` — nothing is asking for a start. "drop": there is no press
//      to disarm, this is just the resting state.
//   2. `status === "idle" | "error"` — no capture session is running (or it
//      failed). Auto-start must not lie in wait and fire the instant a
//      LATER, unrelated session comes up — "drop", not "wait". Checked
//      before the situation-pending case below on purpose: a session that
//      isn't live can't record regardless of what the situation is doing.
//   3. `answering || settling` — something is already being recorded, or
//      still draining. Starting again would collide with a take already in
//      progress. "drop".
//   4. `status === "connecting"` — the session is on its way up. "wait":
//      the press is still legitimately pending, and the moment it turns
//      "live" this function runs again.
//   5. `situationPending` — BLOCKER 1's fix: `useRoleDrill` deliberately
//      keeps the PREVIOUS situation on screen while a new one fetches, so a
//      truthy `situation` here is not evidence the user has actually SEEN
//      the one about to be recorded against. "wait" — including when there
//      is no situation at all yet (a cold mount): the press must survive
//      until one lands, never be discarded for arriving a moment early.
//   6. `!situation` — nothing on screen and nothing coming (a failed
//      fetch, situationPending already false by this point). Holding the
//      press armed forever would fire it against whatever eventually
//      arrives, minutes later, with no press from the user. "drop".
//   7. Otherwise: a live session, a situation actually on screen, and
//      nothing already recording. "start".
export function roleAutoStartDecision({ armed, status, situation, situationPending, answering, settling }) {
  if (!armed) return "drop";
  if (status === "idle" || status === "error") return "drop";
  if (answering || settling) return "drop";
  if (status === "connecting") return "wait";
  if (situationPending) return "wait";
  if (!situation) return "drop";
  return "start";
}

// AC-R1.12 (moved from useRoleAnswer.js, Wave 3): the sentence read aloud by
// RoleDrillControls' own persistently-mounted live region. Moved here for
// the reason this file's own header gives — a decision left inside a React
// hook is only reachable through a jsdom render, and this repo's vitest runs
// `environment: "node"` by default, so nothing inside a hook module can be
// mutation-tested at all.
//
// `hasAnswer` (new) covers the gap an adversarial review found: the region
// spoke for `answering`/`settling` only, and was `""` in exactly the state
// where the review AND feedback panels both mount — a user who pressed Done
// without watching the screen heard "Finishing your answer", then silence,
// while two panels of results appeared with no announcement at all. Pass
// `hasAnswer: !answering && !settling && !!answerMetrics` — the SAME
// condition the caller already gates the review panel's own mount on, not a
// second, competing "is there something to show" computation.
//
// Every branch's wording is deliberately distinct from its neighbours: React
// bails on an unchanged setState, so an announcement byte-identical to the
// one already committed produces NO DOM mutation and a screen reader says
// nothing at all (see recordingStatusMessage.test cases pinning this).
export function recordingStatusMessage({ answering, settling, hasAnswer } = {}) {
  if (answering) return "Recording your answer.";
  if (settling) return "Finishing your answer…";
  if (hasAnswer) return "Your review and feedback are ready.";
  return "";
}

// AC-R1.11: the full notice shown above the role-drill controls. This is a
// separate function from practiceNotices.js's buildPrivacyNotice, not a
// thin wrapper around it, because buildPrivacyNotice's engine sentence
// asserts "the posting details, and your prep context are sent" — true in
// practice mode, false here, since a role drill has no posting and no prep
// context to send. Composing the two would require this caller to
// individually override or strip that claim on every call, which is a
// standing invitation for the false sentence to leak back in the next time
// buildPrivacyNotice's wording changes. The STT and video sentences ARE
// identical in meaning across both modes (same STT socket, same Supabase
// upload), so those two are imported from practiceNotices.js and reused
// rather than duplicated — a second copy of either sentence is exactly how
// the two drift apart the next time one of them is reworded.
export function roleRecordingPrivacyNotice({ sttProviderName, isEmbedded, framesWillUpload, saveEnabled }) {
  const sttNotice = sttNoticeFor(sttProviderName);
  const engineNotice = roleEngineNoticeFor({ isEmbedded, framesWillUpload });
  const videoNotice = roleVideoNoticeFor(saveEnabled);
  return `${sttNotice} ${engineNotice} ${videoNotice}`;
}
