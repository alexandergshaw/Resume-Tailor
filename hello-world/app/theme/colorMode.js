"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "./tokens";

// The active color mode lives on <html data-theme>, seeded before paint by the
// inline script in the root layout. We read it as an external store with
// useSyncExternalStore so components stay in sync without setState-in-effect and
// SSR hydration is handled correctly (server snapshot is always "light").

const listeners = new Set();

// Coerce any input to a valid mode; anything that isn't "dark" is "light".
export function normalizeMode(value) {
  return value === "dark" ? "dark" : "light";
}

// Read the current mode from <html data-theme>. Returns "light" during SSR
// (no document) so the client hydrates against a stable value.
export function readMode() {
  if (typeof document === "undefined") return "light";
  return normalizeMode(document.documentElement.getAttribute("data-theme"));
}

export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// Persist + apply the mode, then notify subscribers so every consumer re-reads.
export function setMode(next) {
  const mode = normalizeMode(next);
  try {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage/DOM may be unavailable */
  }
  listeners.forEach((cb) => cb());
}

export function useColorMode() {
  const mode = useSyncExternalStore(subscribe, readMode, () => "light");
  return {
    mode,
    setMode,
    toggleMode: () => setMode(mode === "dark" ? "light" : "dark"),
  };
}
