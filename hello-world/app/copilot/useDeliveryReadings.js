"use client";

import { useCallback, useMemo, useState } from "react";
import { staleAdjusted } from "@/lib/copilot/liveStale";

// ARCH-stats-in-strip r3 §2.7 / §4.2's own named fallback: "the stale-adjust
// moves into useDeliveryReadings(pace, fillers, lastSampleAt, now) and both
// clients shrink by four lines" once either crosses this project's own
// line-count guard. Extracted out of CopilotClient.js/PracticeClient.js for
// exactly that reason.
//
// Two small pieces, kept in one file because they are always used together:
//
//   useLastSampleAt(dashboard) wraps useCopilotDashboard's own
//   `recordSpeechSample`/`resetForSession` with a Date.now() recorded
//   alongside `speechSamples` itself, and hands back the SAME object with
//   those two replaced. It is NOT folded into useCopilotDashboard.js —
//   an existing test pins that hook's returned surface to exactly
//   `pace`/`fillers`/`recordSpeechSample`/`resetForSession` (its own
//   sibling test names it "the surviving contract"), so a fifth field there
//   would regress an existing, unrelated test rather than extend one.
//   Called BEFORE the session hook (useLiveSession/
//   usePracticeCaptureSession), which needs the wrapped callbacks as input.
//
//   useDeliveryReadings applies staleAdjusted (lib/copilot/liveStale.js) to
//   both readings ONCE, so the same adjusted objects reach both the sticky
//   strip and CopilotDashboard (§2.7, AC 30). Called AFTER the session hook,
//   since `now` is that hook's own return value.
export function useLastSampleAt(dashboard) {
  const [lastSampleAt, setLastSampleAt] = useState(null);
  // Destructured to plain locals so the useCallback deps below name a
  // variable, not a member expression — `dashboard` itself is a fresh
  // object every render, but useCopilotDashboard's own two callbacks are
  // each a stable `useCallback(fn, [])`, so these two never actually change.
  const { recordSpeechSample: rawRecord, resetForSession: rawReset } = dashboard;
  const recordSpeechSample = useCallback(
    (frame) => {
      rawRecord(frame);
      setLastSampleAt(Date.now());
    },
    [rawRecord],
  );
  const resetForSession = useCallback(() => {
    rawReset();
    setLastSampleAt(null);
  }, [rawReset]);
  return { ...dashboard, recordSpeechSample, resetForSession, lastSampleAt };
}

export function useDeliveryReadings(pace, fillers, lastSampleAt, now) {
  const paceForDisplay = useMemo(() => staleAdjusted(pace, { lastSampleAt, now }), [pace, lastSampleAt, now]);
  const fillersForDisplay = useMemo(
    () => staleAdjusted(fillers, { lastSampleAt, now }),
    [fillers, lastSampleAt, now],
  );
  return { paceForDisplay, fillersForDisplay };
}
