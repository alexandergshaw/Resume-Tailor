"use client";

import { useCallback } from "react";
import { matchVoiceCue } from "@/lib/copilot/voiceCues";
import { qualifiesForCue } from "@/lib/copilot/cuePolicy";

// AC-T1.13 (Group T amendment, section A)/AC-V2. Owns ONE decision: given a
// transcript frame useLiveSession.js has just received, may this frame carry
// a voice cue at all, and if so what did lib/copilot/voiceCues.js's
// matchVoiceCue say about its text. Split out of useLiveSession.js purely to
// keep that file under this project's 1000-line cap — the same reasoning
// useSessionLogRecorder.js/useDraftAnswer.js already give for their own
// splits out of the same file.
//
// AC-V2: the actual "may this frame qualify" DECISION now lives in
// lib/copilot/cuePolicy.js's qualifiesForCue — this hook is only the React
// binding around it (reading `useCallback`'s dep array off `source`) plus the
// one step cuePolicy.js deliberately does NOT do: running matchVoiceCue on
// the frame's text once qualifiesForCue says to. See cuePolicy.js's own
// header for the in-person identity gate this used to document here, and for
// why the frame's `speakerAttribution` (the five-value axis, not a two-value
// flag) is what widens this hook's old behaviour rather than a change made
// in this file.
//
// Deliberately does NOT decide what to DO with a match — pin the current
// question, release it, or open the company brief. That is
// useLiveSession.js's job, the same "decide vs act" boundary voiceCues.js
// itself draws around matchVoiceCue (see that module's own header: it "does
// not decide whether an AMBIGUOUS match should be acted on either"). This
// hook only answers "does this frame qualify to be evaluated for a cue at
// all", then hands the caller matchVoiceCue's raw result for that frame's
// text — it never re-implements any part of what matchVoiceCue, resolvePin,
// resolveCueAction or latestQuestionEntry already decide.
export function useVoiceCues(source) {
  return useCallback(
    (frame, snapshot, speakerAttribution) => {
      const q = qualifiesForCue({ frame, snapshot, source, speakerAttribution });
      if (!q || q.blocked) return q;
      const match = matchVoiceCue(frame?.transcript);
      // AC-V2.8: the frame's own speaker snapshot travels WITH the match to
      // useCueActions.js, which has to ask cuePolicy.js the same "can this
      // session tell voices apart" question a moment later and has no other
      // way to see the evidence — useLiveSession.js owns `speakerSnapshotRef`
      // and passes useCueActions only `speakerAttributionRef`, and that file
      // sits at its 1000-line cap, so it cannot be given another argument.
      //
      // Riding on the match is not a workaround for the cap, though; it is the
      // more correct channel either way. `resolveCueAction` decides about THIS
      // frame, so it should see the evidence as it stood when THIS frame was
      // qualified, not whatever a ref happens to hold by the time the action
      // runs. Same reason useLiveSession.js reads `speakerSnapshot()`
      // synchronously at frame time rather than off React state.
      //
      // A `{ blocked: "identity" }` marker returns above and never carries
      // this: resolveCueAction answers it before the attribution arm is
      // reached, so there is no evidence question to ask about it.
      return match ? { ...match, snapshot } : match;
    },
    [source],
  );
}
