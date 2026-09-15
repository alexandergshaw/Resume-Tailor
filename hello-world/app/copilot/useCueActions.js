"use client";

import { useCallback } from "react";
import { resolveCueAction, CUE_IGNORED_REASONS } from "@/lib/copilot/cuePolicy";

// AC-T1.13/AC-V2.3/C12. The "act" half of useVoiceCues.js's "decide vs act"
// split — split out of useLiveSession.js purely to keep that file under this
// project's 1000-line cap, the same reasoning useSessionLogRecorder.js/
// useDraftAnswer.js already give for their own splits out of the same file.
//
// N18 delta review F1, OWNER RULING: full retirement of the "hold" ("pin")
// and "release" ("unpin") voice cues. This hook used to also own those two
// action branches — each logging `question.pinned`/`question.unpinned` and
// driving a "Question held on screen"/"Question released" polite-region
// announcement — but the hold's surviving effects were harmful with no
// offsetting benefit (see voiceCues.js's own module doc for the full
// reasoning; `lib/copilot/questionPin.js` and `useQuestionPin.js`, the state
// this branch used to call into, are deleted). Only the company branch
// remains live.
//
// m1 (fresh delta review): `cueAnnouncement`/`resetCueAnnouncement` used to
// stay in this hook's return shape, with an inert `IDLE_CUE_ANNOUNCEMENT`
// object (`{ text: "", nonce: 0 }`) standing in for them, on the stated
// reason that "CopilotClient.js and this test suite's mocks still
// destructure them" — that reason was false: no test needed the value read
// through this hook (a mutation of that object's contents survived all
// 4608 app/copilot tests). CopilotClient.js's OWN destructure default
// (`cueAnnouncement = { text: "" }`) already covers a caller that omits the
// key, which is now every caller, real or mocked — see that file's own
// comment on the default. `resetCueAnnouncement` was never even part of
// this hook's return; it was only ever called internally by
// useLiveSession.js's own `start()`, so removing it is invisible outside
// this module. Both are gone from the return below; only `handleVoiceCue`
// remains.
//
// Takes `{ onCompanyCueRef, logEvent, speakerAttributionRef }` — every one of
// them already owned elsewhere in useLiveSession.js — and returns
// `{ handleVoiceCue }`.
export function useCueActions({ onCompanyCueRef, logEvent, speakerAttributionRef }) {
  // C12: the refusal has to happen BEFORE the branch that would carry it
  // out, not after — the old company branch called onCompanyCueRef.current()
  // (which opens the panel and fires the outbound request) and only then
  // decided what to log. Computing `act`/`ignoredReason` up front and
  // returning on `!act` before the action branch runs is what makes
  // AC-V2.3's "a matched company cue is refused" an actual refusal instead
  // of a log line written after the fact.
  const handleVoiceCue = useCallback(
    (match, utterance) => {
      // AC-V2.8: `match.snapshot` is the speaker snapshot as it stood when
      // useVoiceCues.js qualified this very frame — the evidence half of the
      // question, which the attribution flag alone answers wrong in a session
      // whose token route blipped (see cuePolicy.js's `effectiveAttribution`).
      const snapshot = match?.snapshot;
      const { act, ignoredReason } = resolveCueAction({
        match,
        speakerAttribution: speakerAttributionRef.current,
        snapshot,
      });
      // AC-T1.13.1: a `{ blocked: "identity" }` marker never carries an
      // id/action to log as a match — it isn't one, it's qualifiesForCue
      // reporting that identity hasn't settled enough to even try.
      if (match.blocked !== "identity") {
        logEvent("cue.matched", { id: match.id, action: match.action, utterance });
      }
      if (!act) return logEvent("cue.ignored", { reason: ignoredReason });
      if (act === "company") {
        // AC-T1.18: opening the panel is CopilotClient's state — trust its
        // report. Reached only once resolveCueAction has already allowed it.
        const handled = typeof onCompanyCueRef.current === "function" && onCompanyCueRef.current();
        if (!handled) logEvent("cue.ignored", { action: "company", reason: CUE_IGNORED_REASONS.COMPANY_UNAVAILABLE });
      }
    },
    [logEvent, onCompanyCueRef, speakerAttributionRef],
  );

  return { handleVoiceCue };
}
