"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createChoiceStore } from "@/lib/copilot/choiceStore";
import { DEFAULT_INTERVIEW_TYPE, normalizeInterviewType } from "@/lib/copilot/interviewTypes";

// Moved out of app/copilot/practice/ (chunk A) and rebuilt over
// lib/copilot/choiceStore.js's factory (contract 1), so this one store can
// be shared by both the live and practice surfaces instead of being owned
// by practice mode alone (A4.1). The React-free primitives live in
// lib/copilot/choiceStore.js; this file is the thin useSyncExternalStore
// wrapper over them, plus the hooks that read and change the value.

// Named "practice" for historical reasons only: this key predates live mode
// having an interview type at all, and both tabs now read and write it. DO
// NOT rename it to match. Every existing user's stored choice lives under
// this exact string; a rename makes their value unreadable and silently
// resets them to "general" on the next visit, with nothing on screen saying
// why. The wrong name is the cheap half of that trade.
export const INTERVIEW_TYPE_STORAGE_KEY = "copilot-practice-interview-type";

const store = createChoiceStore({
  storageKey: INTERVIEW_TYPE_STORAGE_KEY,
  defaultValue: DEFAULT_INTERVIEW_TYPE,
  normalize: normalizeInterviewType,
  crossWindow: true,
});

// Adopt whatever this tab's storage already holds, once, at construction —
// the same point a foreign `storage` event re-hydrates from later. On the
// server, or in a node test that never stubs `localStorage`, this is a
// no-op (`typeof localStorage === "undefined"`).
store.hydrate();

export function getInterviewType() {
  return store.get();
}

export function setInterviewType(value) {
  store.set(value);
}

// cb(next, prev, { origin }) — origin is "local" (this document called
// setInterviewType) or "foreign" (a storage event from another tab/window).
export function onInterviewTypeChanged(cb) {
  return store.subscribeChange(cb);
}

// A13: primitive boolean, sticky true for the life of the tab once a
// setItem/getItem failure is observed. Reports the environment, not the
// outcome of one write.
export function getInterviewTypeStorageBlocked() {
  return store.getStorageBlocked();
}

// Test-only. Resets this store's value, blocked flag, and both listener
// sets. Production never calls this.
export function __resetInterviewTypeForTests() {
  store.__resetForTests();
}

export function useInterviewType() {
  const interviewType = useSyncExternalStore(store.subscribe, store.get, store.getServerSnapshot);

  const setInterviewTypeCallback = useCallback((value) => {
    store.set(value);
  }, []);

  return { interviewType, setInterviewType: setInterviewTypeCallback };
}

// The effect body only subscribes and returns the unsubscribe — no setState
// runs in it. Because the dep array is [handler], every call site must pass
// a stable useCallback.
export function useInterviewTypeChange(handler) {
  useEffect(() => onInterviewTypeChanged(handler), [handler]);
}

// A13/A8c: the client snapshot is a primitive boolean, and the server
// snapshot is the literal `false`.
export function useInterviewTypeStorageBlocked() {
  return useSyncExternalStore(store.subscribe, store.getStorageBlocked, () => false);
}
