"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createChoiceStore } from "@/lib/copilot/choiceStore";
import { AUTO, normalizeCodeLanguageChoice } from "@/lib/copilot/codeLanguages";

// The SECOND caller of lib/copilot/choiceStore.js's factory (contract 1) —
// the first time that contract is exercised with two real instances rather
// than one. Mirrors app/copilot/useInterviewType.js case for case (AC-C4
// says so explicitly), because every piece of state this store needs —
// value, blocked flag, listener sets, baseline — lives inside the factory's
// own closure (FD-1). There is no module-level `let` here to reintroduce;
// doing so would make this store and the interview-type store move
// together, invisible to any single-instance test.

export const CODE_LANGUAGE_STORAGE_KEY = "copilot-code-language";

const store = createChoiceStore({
  storageKey: CODE_LANGUAGE_STORAGE_KEY,
  defaultValue: AUTO,
  normalize: normalizeCodeLanguageChoice,
  crossWindow: true,
});

// Adopt whatever this tab's storage already holds, once, at construction —
// the same point a foreign `storage` event re-hydrates from later. On the
// server, or in a node test that never stubs `localStorage`, this is a
// no-op (`typeof localStorage === "undefined"`).
store.hydrate();

export function getCodeLanguage() {
  return store.get();
}

export function setCodeLanguage(value) {
  store.set(value);
}

// cb(next, prev, { origin }) — origin is "local" (this document called
// setCodeLanguage) or "foreign" (a storage event from another tab/window).
export function onCodeLanguageChanged(cb) {
  return store.subscribeChange(cb);
}

// Primitive boolean, sticky true for the life of the tab once a
// setItem/getItem failure is observed. Reports the environment, not the
// outcome of one write.
export function getCodeLanguageStorageBlocked() {
  return store.getStorageBlocked();
}

// Test-only. Resets this store's value, blocked flag, and both listener
// sets. Production never calls this.
export function __resetCodeLanguageForTests() {
  store.__resetForTests();
}

export function useCodeLanguage() {
  const codeLanguage = useSyncExternalStore(store.subscribe, store.get, store.getServerSnapshot);

  const setCodeLanguageCallback = useCallback((value) => {
    store.set(value);
  }, []);

  return { codeLanguage, setCodeLanguage: setCodeLanguageCallback };
}

// The effect body only subscribes and returns the unsubscribe — no setState
// runs in it. Because the dep array is [handler], every call site must pass
// a stable useCallback.
export function useCodeLanguageChange(handler) {
  useEffect(() => onCodeLanguageChanged(handler), [handler]);
}

// The client snapshot is a primitive boolean, and the server snapshot is
// the literal `false`.
export function useCodeLanguageStorageBlocked() {
  return useSyncExternalStore(store.subscribe, store.getStorageBlocked, () => false);
}
