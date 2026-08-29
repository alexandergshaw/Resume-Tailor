"use client";

import { useCallback } from "react";
import { useCodeLanguage, useCodeLanguageChange } from "../useCodeLanguage";
import { discardDraftedAnswers, codeLanguageChangeAnnouncement } from "@/lib/copilot/choiceChangeInvalidation";
import { codeLanguageLabel } from "@/lib/copilot/codeLanguages";

// A-25/D-1: the practice tab's code-language store read AND its change
// subscriber, in one hook module — out of PracticeClient.js by necessity
// (D-1: PracticeClient.interviewTypeWiring.test.js is a source-text test
// asserting that file names neither `discardAnswerWork` nor
// `discardDraftedAnswers`, calling them "chunk C's seams") and to hold that
// file's own line-count flag down (D-3).
//
// AC-C25/A17 (binding): a language change invalidates exactly the app's
// DRAFTED output — the model's guesses, in the old language — and calls the
// narrower `discardDraftedAnswers` seam and NOTHING ELSE. It has no claim on
// the candidate's own recording (usePracticeAnswer's `abandonInProgressAnswer`
// / `resetAnswerState` — the latter's `revokeReplay()` is
// `URL.revokeObjectURL`, IRREVERSIBLE), on the session's score average
// (`clearSessionScores` — the rubric is the interview type, not the
// language), or on the practice question list (`resetQuestions` — the
// candidate keeps the question they are mid-answer on). A language does not
// make any of those wrong; only the drafts built in the old one are.
//
// D-7 (amended): this module adds no staleness caption and no second
// "drafted before the change" writer. Chunk C resolves a language and puts a
// token in a prompt; it emits no code, so there is nothing on screen yet for
// a caption to describe a difference in. The visible mark and its wording
// belong to chunk B.
//
// R-3 (a11y finding 2, HIGH), added after the above: `discardDraftedAnswers`
// blanks every drafted answer in the room, on BOTH origins, and leaves the
// status region silent (`answerStatusMessage("idle") === ""` — see
// `codeLanguageChangeAnnouncement`'s own doc). Unlike a staleness caption,
// this is not optional decoration — without it the wipe has no report at
// all. `onAnnounce` is optional so this hook's own store-read tests, which
// pass none, keep working with nothing to call.
export function usePracticeCodeLanguage({ invalidateRoomDrafts, onAnnounce }) {
  const { codeLanguage, setCodeLanguage } = useCodeLanguage();

  // Origin is forwarded from the store's own argument, never a literal
  // "local" — a change made in another window must be handled identically
  // here (discardDraftedAnswers behaves the same on both origins; see its
  // own comment), but the shape stays consistent with every other duty
  // composer in this app, which all take the origin the store actually saw.
  const onCodeLanguageChangeSubscriber = useCallback(
    (next, prev, meta) => {
      discardDraftedAnswers({ origin: meta.origin, invalidateRoomDrafts });
      if (onAnnounce) {
        onAnnounce(
          codeLanguageChangeAnnouncement({
            surface: "practice",
            origin: meta.origin,
            label: codeLanguageLabel(next),
          }),
        );
      }
    },
    [invalidateRoomDrafts, onAnnounce],
  );
  useCodeLanguageChange(onCodeLanguageChangeSubscriber);

  return { codeLanguage, setCodeLanguage };
}
