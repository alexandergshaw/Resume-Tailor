"use client";

import { useCallback, useSyncExternalStore } from "react";

// D1: whether recorded answers are saved to the user's account, persisted in
// localStorage under its own key alongside the existing practice preferences
// (usePrepContext.js's PREP_STORAGE_KEY, app/settings/engine.js's
// ENGINE_STORAGE_KEY). Built as a real external store — same shape as
// engine.js's useEngine — rather than a mount effect that calls setState:
// getServerSaveEnabledSnapshot keeps the server render and the client's
// first hydration pass identical (no flash/mismatch), and there is no
// separate effect synchronously writing state afterward for the "set state
// in an effect" lint rule to flag. Defaults ON — see AC-D1-4.
//
// AC-J3: extracted out of PracticeClient.js purely to keep that component
// under this repo's line-count gate — behaviour is unchanged.
// `readSaveEnabled` is exported separately, alongside the `useSaveRecordings`
// hook below, because PracticeClient passes the PLAIN FUNCTION (not this
// hook's `saveEnabled` return value) to usePracticeAnswer's doneAnswerFlow
// as `isSaveEnabled` — see BUG-2 in usePracticeAnswer's persistAnswer: the
// upload this gates happens seconds later, after the critique settles, and
// the switch must be re-read at THAT moment, not latched to whatever this
// hook's snapshot was at click time. Do not have PracticeClient pass the
// hook's `saveEnabled` value there instead — that would silently reintroduce
// the exact staleness BUG-2 was filed for.
const SAVE_RECORDINGS_STORAGE_KEY = "copilot-practice-save-recordings";
const DEFAULT_SAVE_ENABLED = true;
const saveEnabledListeners = new Set();

export function readSaveEnabled() {
  if (typeof window === "undefined") return DEFAULT_SAVE_ENABLED;
  try {
    const stored = window.localStorage.getItem(SAVE_RECORDINGS_STORAGE_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
    return DEFAULT_SAVE_ENABLED;
  } catch {
    return DEFAULT_SAVE_ENABLED;
  }
}

function getServerSaveEnabledSnapshot() {
  return DEFAULT_SAVE_ENABLED;
}

function subscribeSaveEnabled(callback) {
  saveEnabledListeners.add(callback);
  return () => saveEnabledListeners.delete(callback);
}

function writeSaveEnabled(on) {
  try {
    window.localStorage.setItem(SAVE_RECORDINGS_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Quota exceeded / private browsing: the choice still applies for the
    // rest of this tab via the listener notification below, it just won't
    // persist across a reload.
  }
  saveEnabledListeners.forEach((cb) => cb());
}

// D1: "Save recordings to my account" — defaults ON. `saveEnabled` drives
// the switch's checked state and the privacy notice, both of which should
// reflect whatever is true RIGHT NOW; see `readSaveEnabled`'s own doc above
// for why the actual upload decision re-reads storage instead of relying on
// this hook's value.
export function useSaveRecordings() {
  const saveEnabled = useSyncExternalStore(
    subscribeSaveEnabled,
    readSaveEnabled,
    getServerSaveEnabledSnapshot,
  );

  const setSaveEnabled = useCallback((on) => {
    writeSaveEnabled(on);
  }, []);

  return { saveEnabled, setSaveEnabled };
}
