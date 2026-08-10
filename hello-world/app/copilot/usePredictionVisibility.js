"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PREDICTION_STORAGE_KEY,
  DEFAULT_SHOW_PREDICTIONS,
  normalizeShowPredictions,
  serializeShowPredictions,
} from "@/lib/copilot/predictionPrefs";

// Split out of CopilotClient.js, same reason useCaptureSetup.js and
// usePrepContext.js were: keeps that file under this repo's 1000-line cap.
// Owns ONE preference — whether the dashboard's PREDICTED next question and
// its pre-drafted answer are shown at all — the same way the microphone
// selection already is (see useCaptureSetup.js's own header): one piece of
// state, one storage key (PREDICTION_STORAGE_KEY,
// lib/copilot/predictionPrefs.js), owned here in CopilotClient and handed
// down to CopilotDashboard (live mode) and PracticeClient (practice mode) as
// props, so a choice made in one mode is never silently contradicted by the
// other. The pure decisions this preference drives — what an unrecognized
// stored value resolves to, and which downstream behaviour it gates — live
// in predictionPrefs.js itself and are tested there; this hook only wires
// that into React state and localStorage.
export function usePredictionVisibility() {
  const [showPredictions, setShowPredictions] = useState(DEFAULT_SHOW_PREDICTIONS);

  // Seed from localStorage, wrapped in try/catch like every other seed in
  // this folder — private browsing and quota errors must not break the
  // page. The setState is deferred a microtask out via
  // Promise.resolve().then(...), the exact same shape the source and
  // microphone seed effects in useCaptureSetup.js already use, which is
  // what keeps this clear of react-hooks/set-state-in-effect (a synchronous
  // setState in an effect body is a lint ERROR in this project).
  useEffect(() => {
    let stored = null;
    try {
      stored = window.localStorage.getItem(PREDICTION_STORAGE_KEY);
    } catch {
      stored = null;
    }
    const resolved = normalizeShowPredictions(stored);
    Promise.resolve().then(() => setShowPredictions(resolved));
  }, []);

  // CopilotDashboard's toggle switch calls this with the new checked value
  // directly (onChange={(e) => onToggleShowPredictions(e.target.checked)}),
  // so this takes an explicit value in rather than flipping the current one
  // — the same shape useCaptureSetup.js's onSourceChange/onMicDeviceChange
  // already use — which is what lets PracticeClient's identical switch drive
  // the exact same state without the two ever disagreeing about what "on"
  // means.
  const onToggleShowPredictions = useCallback((next) => {
    const value = Boolean(next);
    setShowPredictions(value);
    try {
      window.localStorage.setItem(PREDICTION_STORAGE_KEY, serializeShowPredictions(value));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

  return { showPredictions, onToggleShowPredictions };
}
