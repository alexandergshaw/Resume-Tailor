"use client";

import { useSyncExternalStore } from "react";

// Shared store for the chat "answer as me" voice preference. It lives beside the
// engine store (same useSyncExternalStore + localStorage pattern) so the chat
// panel's switch and the chat request builder read/write one value across the
// layout boundary. Persisted to localStorage under "chatAnswerAsMe".

export const ANSWER_AS_ME_STORAGE_KEY = "chatAnswerAsMe";

// OFF is the safe default: a user must never start speaking in their own voice
// without having chosen it.
export const DEFAULT_ANSWER_AS_ME = false;

const listeners = new Set();

// Only the exact string "true" is ON; null, empty, garbage and non-strings all
// resolve OFF so an unreadable store can never switch the persona on.
export function normalizeAnswerAsMe(value) {
  return value === "true";
}

export function readAnswerAsMe() {
  if (typeof localStorage === "undefined") return DEFAULT_ANSWER_AS_ME;
  try {
    return normalizeAnswerAsMe(localStorage.getItem(ANSWER_AS_ME_STORAGE_KEY));
  } catch {
    return DEFAULT_ANSWER_AS_ME;
  }
}

export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setAnswerAsMe(next) {
  try {
    localStorage.setItem(ANSWER_AS_ME_STORAGE_KEY, next ? "true" : "false");
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((cb) => cb());
}

export function useAnswerAsMe() {
  const answerAsMe = useSyncExternalStore(subscribe, readAnswerAsMe, () => DEFAULT_ANSWER_AS_ME);
  return { answerAsMe, setAnswerAsMe };
}
