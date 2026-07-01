"use client";

import { useSyncExternalStore } from "react";

// Shared store for the document-generation engine. It lives here (rather than in
// page.js) so the top-bar control and the page's tailoring logic read/write the
// same value across the layout boundary — the same pattern as the color-mode
// store. Persisted to localStorage under the existing "tailorEngine" key.

export const ENGINE_STORAGE_KEY = "tailorEngine";

export const ENGINE_OPTIONS = [
  {
    value: "gemini",
    label: "Gemini (AI)",
    hint: "Gemini — AI rewrites your uploaded resume's lines.",
  },
  {
    value: "external",
    label: "Resume Tailor API",
    hint: "Resume Tailor API — returns a finished .docx from the service's template.",
  },
  {
    value: "embedded",
    label: "Embedded (no AI)",
    hint: "Embedded — deterministic in-app engine. No AI; reads the posting from a URL or text, then tailors offline.",
  },
];

export const ENGINES = ENGINE_OPTIONS.map((o) => o.value);
export const DEFAULT_ENGINE = "gemini";

const listeners = new Set();

// Coerce any input to a known engine; unknown values fall back to the default.
export function normalizeEngine(value) {
  return ENGINES.includes(value) ? value : DEFAULT_ENGINE;
}

export function readEngine() {
  if (typeof localStorage === "undefined") return DEFAULT_ENGINE;
  try {
    return normalizeEngine(localStorage.getItem(ENGINE_STORAGE_KEY));
  } catch {
    return DEFAULT_ENGINE;
  }
}

export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setEngine(next) {
  const engine = normalizeEngine(next);
  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, engine);
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((cb) => cb());
}

export function useEngine() {
  const engine = useSyncExternalStore(subscribe, readEngine, () => DEFAULT_ENGINE);
  return { engine, setEngine };
}
