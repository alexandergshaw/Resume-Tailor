// Pure, over injected callbacks. No React, no imports — node (this repo's
// default environment) proves every case with nothing else in play.
//
// This file composes the duties that run when a persisted choice — the
// interview type, and (R-3) now the code language too — changes. It exists
// because `PracticeClient` cannot be
// rendered under test — its own comment says so at `PracticeClient.js:371`
// — so a duty sequence inlined into its change callback would be
// unfalsifiable. What proves these are WIRED, not merely correct in
// isolation, is `app/copilot/practice/PracticeClient.interviewTypeWiring.test.js`;
// neither file is sufficient without the other.
//
// AC-A17 / FD-2 / FD-3 — the naming rule: composers are named for what they
// DO, not for what triggers them. `discardAnswerWork` was matched by NAME
// against chunk C's code-language control before anyone read what it calls —
// it reaches `resetAnswerState`, whose `revokeReplay()`
// (`usePracticeAnswer.js:243` -> `:230-236`) is `URL.revokeObjectURL`, which
// is IRREVERSIBLE, and it also calls `abandonInProgressAnswer`, which
// destroys a take still being recorded. Neither has any claim on a language
// change: the recording is the candidate SPEAKING, and no language moves a
// word of it. `discardDraftedAnswers` is the narrower seam that change
// actually needs — the model's drafts, and nothing the candidate produced.
//
// Three nested scopes, each calling the next, never inlining it:
// `discardPracticeWork` -> `discardQuestionAndScoreWork` + `discardAnswerWork`
// -> `discardDraftedAnswers`. The subset chunk C calls and the subset chunk A
// calls are therefore the SAME code, not copies that can drift.
//
// The A12 origin split, throughout: a change made in ANOTHER BROWSER WINDOW
// must never abandon a recording in progress or reset the state describing a
// finished one — that is destroying a candidate's take because of a click
// they may not have made deliberately. `resetQuestions()` is deferred rather
// than dropped on a foreign change, because the candidate keeps the question
// they are mid-answer on. `clearSessionScores()` and `invalidateRoomDrafts()`
// are origin-blind: neither destroys user-authored content or unmounts
// anything, so there is nothing for the split to protect there.

// AC-A17 / A17 amendment — the NARROWEST seam: the model's DRAFTED answers
// and nothing else. This is what chunk C's code-language control calls. It
// must never reach `resetAnswerState` or `abandonInProgressAnswer` (see the
// module header) — a language change cannot invalidate a recording of the
// candidate SPEAKING, nor the state around it.
export function discardDraftedAnswers({
  origin, // "local" | "foreign" — kept for a stable call shape across every duty composer in this file; both origins behave identically here (see module header).
  invalidateRoomDrafts, // useRoomQuestions.invalidateDrafts
}) {
  invalidateRoomDrafts();
}

// FD-2 — the answer-side subset for a change that DOES invalidate the
// candidate's own answer work, in addition to the drafts. Chunk A's own use;
// NOT chunk C's (see `discardDraftedAnswers` above for why).
export function discardAnswerWork({
  origin, // "local" | "foreign"
  abandonInProgressAnswer, // usePracticeAnswer.abandonInProgressAnswer
  resetAnswerState, // usePracticeAnswer.resetAnswerState
  invalidateRoomDrafts, // useRoomQuestions.invalidateDrafts (AC-A21b)
}) {
  if (origin === "local") {
    // Order is load-bearing: a recording still running belongs to the
    // question being left and must be dropped BEFORE the state describing it
    // is cleared — the coupling `PracticeClient`'s own `onNextQuestion`
    // already relies on.
    abandonInProgressAnswer();
    resetAnswerState();
  }
  // Never gated on origin (AC-A12): clearing a draft body costs a redraft;
  // the entries, their ids, their text and their buttons all survive.
  discardDraftedAnswers({ origin, invalidateRoomDrafts });
}

// The QUESTION-and-RUBRIC side: what an interview type moves and a language
// does not.
export function discardQuestionAndScoreWork({
  origin, // "local" | "foreign"
  resetQuestions, // usePracticeQuestions.resetQuestions
  markQuestionsStale, // usePracticeQuestions.markQuestionsStaleForNewFormat
  clearSessionScores, // usePracticeAnswer.clearSessionScores (AC-A11b)
}) {
  if (origin === "local") {
    resetQuestions();
  } else {
    // Deferred, not dropped: the candidate keeps the question they are
    // mid-answer on, and the next request already fetches under the new type.
    markQuestionsStale();
  }
  // Origin-blind (AC-A11b): the rubric changed either way, so a surviving
  // average silently mixes two incommensurable scales into one number. This
  // destroys no user-authored content and unmounts nothing.
  clearSessionScores();
}

// Chunk A's practice subscriber calls this one: both halves, in a fixed
// order, never inlined (see module header — the differential test in
// choiceChangeInvalidation.test.js is what this delegation exists to satisfy).
export function discardPracticeWork({
  origin,
  resetQuestions,
  markQuestionsStale,
  clearSessionScores,
  abandonInProgressAnswer,
  resetAnswerState,
  invalidateRoomDrafts,
}) {
  discardQuestionAndScoreWork({
    origin,
    resetQuestions,
    markQuestionsStale,
    clearSessionScores,
  });
  discardAnswerWork({
    origin,
    abandonInProgressAnswer,
    resetAnswerState,
    invalidateRoomDrafts,
  });
}

// AC-A15 / AC-A17 — the live surface's duty list. The clear and the bump run
// unconditionally (AC-A12: this is exactly the practice-tab -> live-tab
// direction that rule exists for, since `CopilotClient` stays mounted across
// the mode switch). Only the model call is gated, and it must be gated on
// the caller's `canRedraft`, never re-derived here — see AC-A15b.
export function invalidateLiveAnswers({
  clearAnswerCache, // () => answerCacheRef.current.clear()
  bumpDraftGeneration, // () => { draftGenRef.current += 1 }
  redraftCurrentAnswer, // useLiveSession.redraftCurrentAnswer
  canRedraft, // boolean — origin === "local" && mode === "live" (AC-A15b)
}) {
  clearAnswerCache();
  bumpDraftGeneration();
  if (canRedraft) {
    redraftCurrentAnswer();
  }
}

// ux-chunk-a.md §9.3's copy table. When both `hadRecording` and `hadReview`
// are true, the recording row wins — losing an in-progress take is the
// larger loss.
//
// The storage clause COMPOSES with the row, it does not REPLACE it. It used
// to return early, which meant a blocked tab announced
// "Interview type set to X. Not saved…" for a change made in ANOTHER window
// — attributing it to this one — and dropped the report of what the change
// destroyed, on the one change where that report is the only one there is.
// Every row now builds first and the clause is appended, so nothing the user
// needs to hear is displaced by the browser fact.
//
// The clause has two forms, and the difference is not cosmetic. "Not saved"
// is a claim about a write THIS window attempted and lost, so it belongs
// only on a LOCAL change. A foreign change was written by the other window
// (a `storage` event only fires for a write that succeeded), so on that row
// the clause states the browser fact and claims no failed write.
//
// Two rows deliberately DEPART from the table, both because these strings
// exist only to be READ ALOUD and the table was written for the eye:
//
//   - The storage row's em dash is a PERIOD here. `·` and `—` are silent at
//     default screen-reader punctuation settings (`SessionSetup.js:148-150`,
//     and the prior incident at `ux-chunk-a.md:342`), so the table's dash
//     produced "Not saved this browser is blocking stored settings." The
//     visual twin — `InterviewTypePicker.js:39`'s helper text, which nobody
//     reads aloud — already used a period; the two now match.
//   - The practice/foreign row NAMES WHAT WAS DESTROYED. The table's "It
//     applies from your next question" describes `markQuestionsStale` alone
//     and is the opposite of what a foreign change does to what is already
//     on screen: `clearSessionScores` and `invalidateRoomDrafts` are both
//     origin-blind (`:66-68`, `:86-89`), so the session average and every
//     room card's drafted answer are gone before the sentence is spoken.
//     Nothing else announces that — `QuestionFeed`'s own status region reads
//     `answerStatusMessage`, which returns `""` for the `"idle"` status
//     `invalidateDrafts` leaves behind (`lib/copilot/answerStatus.js:53-56`),
//     so this sentence is the ONLY report of the wipe. It says what is gone
//     and what survives, plainly and without alarm, because the change was
//     the user's own — made in their other window.
export function interviewTypeChangeAnnouncement({
  surface, // "live" | "practice"
  origin, // "local" | "foreign"
  label, // interviewTypeLabel(next)
  hadRecording, // boolean — an answer was being recorded or settling
  hadReview, // boolean — a finished take's review was on screen
  storageBlocked, // boolean — this call is the one that carries the storage clause
}) {
  const row = interviewTypeChangeRow({ surface, origin, label, hadRecording, hadReview });
  if (!storageBlocked) return row;
  // The live/local row is deliberately empty, so the clause needs a subject
  // of its own there — this is the sentence that state used to produce, and
  // still does.
  const lead = row || `Interview type set to ${label}.`;
  const clause =
    origin === "local"
      ? "Not saved. This browser is blocking stored settings."
      : "This browser is blocking stored settings.";
  return `${lead} ${clause}`;
}

// The row itself, storage aside. Not exported: `interviewTypeChangeAnnouncement`
// above is the whole contract, and a second entry point that skips the clause
// is exactly how a caller ends up announcing a change without it.
function interviewTypeChangeRow({ surface, origin, label, hadRecording, hadReview }) {
  if (surface === "live") {
    if (origin === "foreign") {
      return `Interview type changed to ${label} in another window. The answer on screen was drafted before the change.`;
    }
    // The answer-status region already reports it (CopilotDashboard.js:540);
    // a second string in the same consolidated node mid-interview is noise.
    return "";
  }

  // surface === "practice"
  if (origin === "foreign") {
    return `Interview type changed to ${label} in another window. Your score average and drafted answers were cleared. The question on screen stays until you ask for the next one.`;
  }

  if (hadRecording) {
    return `Interview type set to ${label}. Practice questions cleared and your recording was discarded.`;
  }
  if (hadReview) {
    return `Interview type set to ${label}. Practice questions cleared and your last answer's review was closed.`;
  }
  return `Interview type set to ${label}. Practice questions cleared.`;
}

// R-3 remediation — HIGH a11y finding 2. `discardDraftedAnswers` blanks
// every drafted answer in the room and leaves `status: "idle"` behind
// (`useRoomQuestions.js`'s `invalidateDrafts`), and `answerStatusMessage`
// returns `""` for `"idle"` (`lib/copilot/answerStatus.js:53-56`) — exactly
// the silent status region `interviewTypeChangeRow`'s own comment above
// names as the reason ITS sentence is the only report of an equivalent wipe.
// Chunk C reused that seam without the sentence; this is the sentence.
//
// Three rows, not four, because two of the four (surface, origin) pairs are
// not gaps:
//   - practice, either origin — `discardDraftedAnswers` runs unconditionally
//     on both (see its own comment), so both need the report.
//   - live, local — deliberately `""`. `invalidateLiveAnswers` redrafts and
//     the answer-status region reports drafting, same reasoning as
//     `interviewTypeChangeRow`'s live/local row above. A second sentence here
//     would be the exact defect chunk A shipped once already: two
//     announcements for one user action.
//   - live, foreign — `invalidateLiveAnswers` is origin-blind
//     (`useLiveCodeLanguageChange.js`'s own header), so this window's answer
//     is redrawn by a change nothing in this window explains. That absence
//     of a local action is what earns the sentence, even though the redraft
//     itself still runs.
export function codeLanguageChangeAnnouncement({ surface, origin, label }) {
  if (surface === "live") {
    if (origin === "foreign") {
      return `Code language changed to ${label} in another window. Your current answer is being redrafted.`;
    }
    return "";
  }

  // surface === "practice"
  if (origin === "foreign") {
    return `Code language changed to ${label} in another window. Drafted answers were cleared.`;
  }
  return `Code language set to ${label}. Drafted answers were cleared.`;
}

// Step-9 review (MATERIAL-1/BLOCKER-1): CopilotClient is mounted in every
// mode and PracticeClient writes its own announcement into a second slot
// CopilotClient joins alongside its own — each side's own suite proves its
// half correct in isolation, and composing them wrong is what shipped the
// live sentence on the practice/roles tab, then (in the first fix) silenced
// the practice tab entirely by consuming a shared latch for a sentence that
// was about to be discarded. Pure and React-free, alongside
// interviewTypeChangeAnnouncement above (the builder these two compose),
// so this composition is node-testable and CANNOT be mocked away by a
// caller that only mocks a hook module (`useLiveSession.js`'s three
// existing consumers each `vi.mock` it wholesale, without these exports —
// living here instead of in either capped component file is what keeps
// them working with no change of their own).

// Speaks each surface's text only while it is showing (roles gets neither —
// no picker, no dependence on the type) AND only while nothing ELSE has
// changed since it was set. Step-9c-iii (2nd pass): the caller stamps
// `liveAmbientAtSet`/`practiceAmbientAtSet` with `${cueText}|${briefText}`
// AT THE MOMENT each slot is written (inside the change handler that is
// already the single writer of both) — comparing that stamp against the
// CURRENT `cueText`/`briefText` here, at render time, is what excludes a
// stale slot the instant an unrelated cue/brief update would otherwise
// repeat it, with no effect, no flushSync, and no render-tick sweeper: a
// tick that touches neither `cueText` nor `briefText` (the ticking session
// clock, for one) leaves the ambient signature unchanged and therefore
// never excludes anything, so a full sentence is never truncated mid-read.
// NOT filtered to only the non-empty entries (that would destroy the
// positional pair the caller destructures) — the caller's own
// `.filter(Boolean)` does that.
export function joinInterviewTypeAnnouncements({
  mode,
  live,
  practice,
  liveAmbientAtSet,
  practiceAmbientAtSet,
  cueText,
  briefText,
}) {
  const ambient = `${cueText}|${briefText}`;
  return [
    mode === "live" && liveAmbientAtSet === ambient ? live : "",
    mode === "practice" && practiceAmbientAtSet === ambient ? practice : "",
  ];
}

// The once-per-tab storage clause is one browser fact, not one per surface,
// and this is its single OWNER: the only place that writes `latchRef`.
//
// Manual-regression MATERIAL: owning the latch was previously read as
// EXCLUSIVE ACCESS to it. The practice side always asked for the storage
// sentence (`alreadyAnnounced` was hardcoded false) and this function could
// only answer with the text or `""`. So on a storage-blocked tab the FIRST
// practice change spoke, and every change after it — including one that
// discarded an in-progress take, including a foreign change whose wipe of
// the score average and every room draft this module's own comment calls
// "the ONLY report of the wipe" — was announced as nothing at all. Only
// practice collapsed; the live surface computes its own gate at
// `CopilotClient.js:386` and falls back to its ordinary row.
//
// The fix keeps ownership here and removes the blindness: a caller that has
// BOTH sentences hands both, and the owner picks. It never has to answer a
// spent latch with silence, because it was given something else to say.
//
//   { storage, ordinary }  a caller that can build either row. `storage`
//                          when the latch is free (and it is then spent),
//                          `ordinary` when it is already spent. When storage
//                          is healthy the two are the same string and the
//                          latch is not touched at all.
//   "a string"             a caller that has only the one sentence. Same
//                          behaviour as before, `""` included — the live
//                          surface never comes through here (it gates
//                          inline), so this shape is only ever a caller that
//                          has genuinely nothing else to say.
//
// Note what this does NOT do: it does not let the practice side decide when
// the clause has been spent. It still cannot see the latch and still cannot
// write it. It only stopped being forced to bet everything on one sentence.
export function claimStorageAnnouncement(candidate, latchRef) {
  const pair = typeof candidate === "string" ? { storage: candidate, ordinary: "" } : candidate;
  if (!pair.storage.includes("blocking stored settings")) return pair.storage;
  if (latchRef.current) return pair.ordinary;
  latchRef.current = true;
  return pair.storage;
}

