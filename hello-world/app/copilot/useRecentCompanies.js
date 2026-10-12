"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createChoiceStore } from "@/lib/copilot/choiceStore";
import {
  RECENT_COMPANIES_CAP,
  RECENT_COMPANIES_STORAGE_KEY,
  NO_RECENT_COMPANIES,
  addCompany,
  sanitizeRecentCompanies,
} from "@/lib/copilot/recentCompanies";

// N124: the per-viewer list of companies the user recently practiced or interviewed
// for, shared by every PostingPicker (live "Interviewing for", practice "Practice
// for", and the study-plan picker) -- one store, one key. localStorage, not
// Supabase: it is a convenience (an empty or missing list costs one scroll), not
// data, and a company name is not sensitive. The React-free rules live in
// lib/copilot/recentCompanies.js; this file is the persistence wrapper and the hook.
//
// Built on the same factory as useInterviewType.js, which is the matured form of the
// engine.js / answerAsMe.js pattern: every storage read and write is guarded, the
// in-memory list stays authoritative when a write throws (quota, private window), and
// a change made in another tab is adopted. The stored value is a JSON array of
// { company, lastUsedAt } entries, most recent first.
const store = createChoiceStore({
  storageKey: RECENT_COMPANIES_STORAGE_KEY,
  defaultValue: NO_RECENT_COMPANIES,
  normalize: (value) => sanitizeRecentCompanies(value),
  encode: (list) => JSON.stringify(list),
  decode: (raw) => {
    try {
      return raw ? JSON.parse(raw) : NO_RECENT_COMPANIES;
    } catch {
      return NO_RECENT_COMPANIES;
    }
  },
  crossWindow: true,
});

// Adopt whatever this browser already remembers, once, at load -- the "across
// sessions" step. A no-op on the server and where localStorage is unreachable.
store.hydrate();

// There is deliberately no test-only reset or getter here: a test gets a clean store
// by loading a fresh module graph (vi.resetModules), which is also how it models a
// new session, and reads the list through this hook.
export function useRecentCompanies() {
  const recentCompanies = useSyncExternalStore(store.subscribe, store.get, store.getServerSnapshot);

  // Remember the company of an EXPLICITLY chosen posting. A missing posting or a
  // blank company (a title-only posting) writes nothing, so a blank choice can
  // never erase or pad the list.
  const recordCompany = useCallback((posting) => {
    const company = typeof posting?.company === "string" ? posting.company.trim() : "";
    if (!company) return;
    store.set(addCompany(store.get(), { company, lastUsedAt: Date.now() }, RECENT_COMPANIES_CAP));
  }, []);

  return { recentCompanies, recordCompany };
}
