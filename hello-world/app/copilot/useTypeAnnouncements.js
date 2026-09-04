"use client";

import { useCallback, useRef, useState } from "react";
import {
  invalidateLiveAnswers,
  interviewTypeChangeAnnouncement,
  joinInterviewTypeAnnouncements,
  claimStorageAnnouncement,
} from "@/lib/copilot/choiceChangeInvalidation";
import { useInterviewTypeChange, getInterviewTypeStorageBlocked } from "./useInterviewType";
import { useLiveCodeLanguageChange } from "./useLiveCodeLanguageChange";
import { interviewTypeLabel } from "@/lib/copilot/interviewTypes";

// Headroom extraction (wave 2), NOT a feature — split out of CopilotClient.js
// to keep that file under CopilotClient.extraction.test.js's 950-line cap,
// the same reason useCaptureSetup.js was pulled out of it before (see that
// file's own doc for the pattern this follows). Owns the type-CHANGE
// announcement concern end to end: the live/practice announcement state, the
// two subscribers that populate it (interview-type and code-language
// changes), the practice-surface callback PracticeClient reports through,
// and the join that folds both slots into the one string CopilotClient's
// consolidated live region renders. `mode`, `redraftCurrentAnswer`, the
// shared answer-cache/draft-generation refs, `setStaleTypeChangeAt`
// (Contract 8's stale-card timestamp) and the ambient cue/brief text all
// stay arguments — every one of them is also read or set by code that stays
// behind in CopilotClient.js.
export function useTypeAnnouncements({
  mode,
  redraftCurrentAnswer,
  answerCacheRef,
  draftGenRef,
  setStaleTypeChangeAt,
  cueText,
  briefText,
}) {
  // Contract 7/8: this surface's own announcement and practice's own.
  const [typeAnnouncement, setTypeAnnouncement] = useState("");
  const [practiceTypeAnnouncement, setPracticeTypeAnnouncement] = useState("");
  const announcedStorageBlockRef = useRef(false); // AC-A15b: once per tab; touched in the handler only.
  // Step-9c-iii: each slot's ambient "cue|brief" signature when SET, compared
  // at render time near the join — see joinInterviewTypeAnnouncements's doc.
  const [typeAmbientAtSet, setTypeAmbientAtSet] = useState("");
  const [practiceAmbientAtSet, setPracticeAmbientAtSet] = useState("");

  // C.2: the ONE live-surface subscriber (closes over redraftCurrentAnswer).
  // AC-A15b: canRedraft reads the caller's `mode`, taken as an argument here.
  const onInterviewTypeChanged = useCallback(
    (next, prev, meta) => {
      const blocked = getInterviewTypeStorageBlocked();
      // BLOCKER-1: claim ONLY when this text is actually spoken (same
      // predicate the join uses) — else it silences the other surface.
      const announceBlocked = blocked && mode === "live" && !announcedStorageBlockRef.current;
      if (announceBlocked) announcedStorageBlockRef.current = true;
      invalidateLiveAnswers({
        clearAnswerCache: () => answerCacheRef.current.clear(),
        bumpDraftGeneration: () => {
          draftGenRef.current += 1;
        },
        redraftCurrentAnswer,
        canRedraft: meta.origin === "local" && mode === "live",
      });
      // Contract 8: a foreign change may leave an on-screen card drafted
      // under the old type — CurrentAnswerPanel dims it once its own `at`
      // predates this timestamp.
      if (meta.origin === "foreign") setStaleTypeChangeAt(Date.now());
      setTypeAnnouncement(
        interviewTypeChangeAnnouncement({
          surface: "live",
          origin: meta.origin,
          label: interviewTypeLabel(next),
          hadRecording: false,
          hadReview: false,
          storageBlocked: announceBlocked,
        }),
      );
      setTypeAmbientAtSet(`${cueText}|${briefText}`);
    },
    [mode, redraftCurrentAnswer, cueText, briefText],
  );
  useInterviewTypeChange(onInterviewTypeChanged);

  // AC-C25/CONF-1: the code-language subscriber, in its own module (D-1, D-2)
  // — origin-blind, unlike the interview-type one above, since a language
  // change destroys nothing for a foreign click to protect (see that
  // module's own header). R-3 (a11y finding 2, HIGH): `onForeignChange`
  // reports a foreign change with nothing local to explain it; local stays
  // silent, like the live/local row above (stable callbacks below — F5).
  useLiveCodeLanguageChange({
    canRedraft: mode === "live",
    clearAnswerCache: useCallback(() => answerCacheRef.current.clear(), []),
    bumpDraftGeneration: useCallback(() => { draftGenRef.current += 1; }, []),
    redraftCurrentAnswer,
    onForeignChange: useCallback(
      (text) => {
        setTypeAnnouncement(text);
        setTypeAmbientAtSet(`${cueText}|${briefText}`);
      },
      [cueText, briefText],
    ),
  });

  // MATERIAL-1: filters PracticeClient's text through the SAME latch above.
  const onPracticeTypeAnnouncement = useCallback(
    (text) => {
      setPracticeTypeAnnouncement(claimStorageAnnouncement(text, announcedStorageBlockRef));
      setPracticeAmbientAtSet(`${cueText}|${briefText}`);
    },
    [cueText, briefText],
  );

  // MATERIAL-2: the one gap the ambient check alone can't close — a round
  // trip back to the SAME mode. CopilotClient's onModeChange calls this.
  const resetTypeAnnouncements = useCallback(() => {
    setTypeAnnouncement("");
    setPracticeTypeAnnouncement("");
  }, []);

  // MATERIAL-1/step-9c-iii: see joinInterviewTypeAnnouncements's own doc.
  const [liveTypeText, practiceTypeText] = joinInterviewTypeAnnouncements({
    mode,
    live: typeAnnouncement,
    practice: practiceTypeAnnouncement,
    liveAmbientAtSet: typeAmbientAtSet,
    practiceAmbientAtSet,
    cueText,
    briefText,
  });
  const consolidatedLiveText = [cueText, briefText, liveTypeText, practiceTypeText]
    .filter(Boolean)
    .join(" ");

  return { consolidatedLiveText, onPracticeTypeAnnouncement, resetTypeAnnouncements };
}
