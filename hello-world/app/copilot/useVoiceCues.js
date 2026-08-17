"use client";

import { useCallback } from "react";
import { matchVoiceCue } from "@/lib/copilot/voiceCues";

// AC-T1.13 (Group T amendment, section A). Owns ONE decision: given a
// transcript frame useLiveSession.js has just received, may this frame carry
// a voice cue at all, and if so what did lib/copilot/voiceCues.js's
// matchVoiceCue say about its text. Split out of useLiveSession.js purely to
// keep that file under this project's 1000-line cap — the same reasoning
// useSessionLogRecorder.js/useDraftAnswer.js already give for their own
// splits out of the same file.
//
// Deliberately does NOT decide what to DO with a match — pin the current
// question, release it, or open the company brief. That is
// useLiveSession.js's job, the same "decide vs act" boundary voiceCues.js
// itself draws around matchVoiceCue (see that module's own header: it "does
// not decide whether an AMBIGUOUS match should be acted on either"). This
// hook only answers "does this frame qualify to be evaluated for a cue at
// all", then hands the caller matchVoiceCue's raw result for that frame's
// text — it never re-implements any part of what matchVoiceCue, resolvePin
// or latestQuestionEntry already decide.
//
// *** THE IN-PERSON GATE — READ BEFORE TOUCHING (AC-T1.13, Group T
// amendment section A) ***
// For source==="inperson", a transcript frame's `speaker` is resolved by
// speakerIdentity.js's `labelFor`, which returns "you" for the argmax tag as
// soon as TWO voices have been observed — with NO confidence requirement at
// all (only `overridden` short-circuits it; read speakerIdentity.js's own
// header comment and `labelFor` before changing anything here). That is a
// DISPLAY guess: question detection itself deliberately routes off
// `shouldEvaluateAsQuestion`, never the label, for exactly this reason (see
// handleUtterance's own comment in useLiveSession.js). A cue evaluator that
// trusted `speaker === "you"` alone would let the INTERVIEWER release the
// candidate's hold mid cold-start, simply because the label happened to land
// on their tag first — the same catastrophic mislabel speakerIdentity.js's
// header describes as the worst failure mode this feature has, just applied
// to cues instead of question detection. So: for "inperson" only, a frame
// also has to show identity has actually SETTLED —
// `overridden === true || confidence === "high"` — before it qualifies at
// all.
//
// `tab`/`system` are deliberately NOT gated this way, and must never be
// "made consistent" with inperson later: those two sources get their "you"
// from a physically separate microphone socket — a structural separation
// with no guess involved, so there is no identity to wait on for them
// (AC-T1.13.2 records this as a stated limitation of the raw-mic channel,
// not a defect this gate is meant to fix).
export function useVoiceCues(source) {
  return useCallback(
    (frame, snapshot) => {
      const { isFinal, textAlreadyDelivered, speaker, transcript } = frame || {};

      // An interim is rewritten several times a second as the provider
      // refines it — matching a cue against interims would fire once per
      // rewrite for one spoken phrase, not once for the phrase itself.
      if (isFinal !== true) return null;

      // R-127: a provider final that re-delivers the exact span of a final
      // already processed, purely to carry `speechFinal`. Both existing
      // accumulation paths in useLiveSession.js's onTranscript guard on this
      // same flag for the same reason — without it, one spoken cue phrase
      // fires twice: a duplicate "does that answer your question" would
      // release the hold it already released, and a duplicate pin phrase
      // would re-pin FORWARD a second time to whatever is latest by then,
      // which may not even be the entry the candidate meant.
      if (textAlreadyDelivered === true) return null;

      // These cues are the candidate's own controls; the interviewer's own
      // speech must never be able to fire one.
      if (speaker !== "you") return null;

      if (source === "inperson") {
        const snap = snapshot || {};
        if (!(snap.overridden === true || snap.confidence === "high")) {
          // AC-T1.13.1: distinguishable from "doesn't qualify at all" (the
          // three `return null`s above) so the caller can log WHY every
          // candidate utterance stays inert while identity is unsettled —
          // the same diagnostic discipline handleUtterance's own `evaluate`
          // gate already uses for "speaker identity suppressed" (see
          // useLiveSession.js).
          return { blocked: "identity" };
        }
      }

      return matchVoiceCue(transcript);
    },
    [source],
  );
}
