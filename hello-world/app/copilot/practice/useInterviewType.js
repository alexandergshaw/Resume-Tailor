"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_INTERVIEW_TYPE, normalizeInterviewType } from "@/lib/copilot/interviewTypes";

// G2: which interview format practice mode should generate questions,
// sample answers, and evaluation for — persisted in localStorage under its
// own key, alongside the existing practice preferences (usePrepContext.js's
// PREP_STORAGE_KEY, app/settings/engine.js's ENGINE_STORAGE_KEY,
// PracticeClient.js's own SAVE_RECORDINGS_STORAGE_KEY). Built as a real
// external store — same shape as those, and as engine.js's useEngine —
// rather than a mount effect that calls setState: the server snapshot
// below equals the default, so hydration never flashes/mismatches, and
// there's no separate effect synchronously writing state afterward for the
// "set state in an effect" lint rule to flag (AC-G2-C-1).
const INTERVIEW_TYPE_STORAGE_KEY = "copilot-practice-interview-type";

const interviewTypeListeners = new Set();

// A stored value that isn't one of INTERVIEW_TYPES's known values — a
// cleared vocabulary entry, an old build's removed type, hand-edited
// storage — reads back as the default rather than being passed through
// unchecked (AC-G2-C-1).
function readInterviewType() {
  if (typeof window === "undefined") return DEFAULT_INTERVIEW_TYPE;
  try {
    return normalizeInterviewType(window.localStorage.getItem(INTERVIEW_TYPE_STORAGE_KEY));
  } catch {
    return DEFAULT_INTERVIEW_TYPE;
  }
}

function getServerInterviewTypeSnapshot() {
  return DEFAULT_INTERVIEW_TYPE;
}

function subscribeInterviewType(callback) {
  interviewTypeListeners.add(callback);
  return () => interviewTypeListeners.delete(callback);
}

function writeInterviewType(value) {
  const normalized = normalizeInterviewType(value);
  try {
    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, normalized);
  } catch {
    // Quota exceeded / private browsing: the choice still applies for the
    // rest of this tab via the listener notification below, it just won't
    // persist across a reload.
  }
  interviewTypeListeners.forEach((cb) => cb());
}

export function useInterviewType() {
  const interviewType = useSyncExternalStore(
    subscribeInterviewType,
    readInterviewType,
    getServerInterviewTypeSnapshot,
  );

  const setInterviewType = useCallback((value) => {
    writeInterviewType(value);
  }, []);

  return { interviewType, setInterviewType };
}
