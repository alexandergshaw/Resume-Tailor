"use client";

import { useSyncExternalStore } from "react";

// Shared store for the copilot "include coding solution" preference. It lives
// beside the engine and answer-as-me stores (same useSyncExternalStore +
// localStorage pattern) so the live control that writes it and the places that
// read it when a draft is requested share one value across the layout boundary.
// Persisted to localStorage under "copilot-include-coding-solution".

export const INCLUDE_CODING_SOLUTION_STORAGE_KEY = "copilot-include-coding-solution";

// OFF is the safe default: a user must never start getting a coding section
// appended to their answers without having chosen it.
export const DEFAULT_INCLUDE_CODING_SOLUTION = false;

const listeners = new Set();

// Only the exact string "true" is ON; null, empty, garbage and non-strings all
// resolve OFF so an unreadable store can never switch the coding section on.
export function normalizeIncludeCodingSolution(value) {
  return value === "true";
}

export function readIncludeCodingSolution() {
  if (typeof localStorage === "undefined") return DEFAULT_INCLUDE_CODING_SOLUTION;
  try {
    return normalizeIncludeCodingSolution(localStorage.getItem(INCLUDE_CODING_SOLUTION_STORAGE_KEY));
  } catch {
    return DEFAULT_INCLUDE_CODING_SOLUTION;
  }
}

export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setIncludeCodingSolution(next) {
  try {
    localStorage.setItem(INCLUDE_CODING_SOLUTION_STORAGE_KEY, next ? "true" : "false");
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((cb) => cb());
}

export function useIncludeCodingSolution() {
  const includeCodingSolution = useSyncExternalStore(
    subscribe,
    readIncludeCodingSolution,
    () => DEFAULT_INCLUDE_CODING_SOLUTION,
  );
  return { includeCodingSolution, setIncludeCodingSolution };
}
