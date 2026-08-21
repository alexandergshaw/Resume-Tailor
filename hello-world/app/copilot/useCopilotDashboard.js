"use client";

import { useCallback, useMemo, useState } from "react";
import { appendSpeechSample, computeLivePace, computeLiveFillers } from "@/lib/copilot/livePace";

// AC-I2/AC-N1: the copilot dashboard's delivery readings — talking pace and
// the verbal-filler reading beside it — for BOTH live mode and practice
// mode. Both modes render the same two numbers next to each other, so both
// call this same hook rather than maintaining separate implementations, the
// same reasoning that made livePace.js import answerMetrics.js's thresholds
// instead of restating them.
//
// `pace` and `fillers` are derived from the SAME `speechSamples` list, over
// the SAME window, on purpose: they are rendered side by side, and a viewer
// comparing them is only comparing one moment of speech to itself if both
// numbers were derived from that one moment. A second, independently-
// windowed list here could each be internally correct and still describe
// two different spans of speech, which would make the pairing on screen a
// lie even though neither number was wrong.
//
// What counts as a filler, the rolling window, and when a reading is too
// thin to report are entirely lib/copilot/livePace.js's job — this hook is
// a straight pass-through, memoized only because `speechSamples` (unlike a
// handful of cheap string derivations) grows an array this recomputes a
// window scan over.
export function useCopilotDashboard() {
  const [speechSamples, setSpeechSamples] = useState([]);

  // Called by the caller from onTranscript, for the user's own FINAL
  // frames only — appendSpeechSample already drops frames with unusable
  // (missing/non-numeric) timing, so a caller does not need to pre-filter
  // before calling this.
  const recordSpeechSample = useCallback(({ text, start, duration } = {}) => {
    setSpeechSamples((prev) => appendSpeechSample(prev, { text, start, duration }));
  }, []);

  const pace = useMemo(() => computeLivePace(speechSamples), [speechSamples]);
  const fillers = useMemo(() => computeLiveFillers(speechSamples), [speechSamples]);

  // Called by the caller when a new session starts, so a session that just
  // ended cannot leave its speech window bleeding into the next one.
  const resetForSession = useCallback(() => {
    setSpeechSamples([]);
  }, []);

  return {
    pace,
    fillers,
    recordSpeechSample,
    resetForSession,
  };
}
