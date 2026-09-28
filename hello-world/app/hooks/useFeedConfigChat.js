"use client";

import { useCallback, useState } from "react";

// N60 second chunk, Step D (AC2-C1, AC2-C2, AC2-C3, AC2-S6 UI half). The
// client state for the chat-driven configuration surface, kept in a hook
// (AC2-F1: new client state lives in a hook, not in app/page.js or
// LiveFeedTab.js) rather than in the panel component itself.
//
// `draft` is the ONE thing on screen for review -- a fresh chat turn REPLACES
// it wholesale (never merges with a prior turn, AC2-C1's membership clause),
// and editing a field through one of the setters below mutates it in place so
// what gets applied is what the person actually confirmed, not the original
// derivation (AC2-C2). `draft` is sent to the apply route byte-for-byte on
// accept: it carries no `autoTailorEnabled`/`auto_tailor_enabled` field
// because nothing here ever adds one (AC2-C3) -- the write path's own
// sanitizer (sanitizeChatDerivedSavedSearch) is the structural guarantee;
// this hook simply never gives it anything to carry.

const IDLE = "idle";
const LOADING = "loading";
const LIMITED = "limited";
const ERROR = "error";

const EMPTY_DRAFT = {
  name: null,
  jobKeywords: [],
  maxYearsExp: "any",
  selectedCategories: [],
  selectedCompanies: [],
  excludedCompanies: [],
  excludedTitleKeywords: [],
  autoTailorMinIntervalMinutes: null,
  emailOnNewJobs: false,
};

/**
 * @param {{ onApplied?: (row: object) => void }} [options]
 */
export function useFeedConfigChat({ onApplied } = {}) {
  const [status, setStatus] = useState(IDLE);
  const [draft, setDraft] = useState(null);

  const sendMessage = useCallback(async (message) => {
    setStatus(LOADING);
    try {
      const res = await fetch("/api/feed-config/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.status === 429) {
        setStatus(LIMITED);
        return;
      }
      if (!res.ok) {
        setStatus(ERROR);
        return;
      }
      const json = await res.json();
      setDraft({ ...EMPTY_DRAFT, ...(json?.config || {}) });
      setStatus(IDLE);
    } catch {
      setStatus(ERROR);
    }
  }, []);

  const updateDraft = useCallback((field, value) => {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const accept = useCallback(async () => {
    if (!draft) return;
    try {
      const res = await fetch("/api/feed-config/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        setStatus(ERROR);
        return;
      }
      const json = await res.json();
      setDraft(null);
      setStatus(IDLE);
      if (typeof onApplied === "function" && json?.search) {
        onApplied(json.search);
      }
    } catch {
      setStatus(ERROR);
    }
  }, [draft, onApplied]);

  return {
    status,
    draft,
    sendMessage,
    accept,
    setJobKeywords: (value) => updateDraft("jobKeywords", value),
    setMaxYearsExp: (value) => updateDraft("maxYearsExp", value),
    setSelectedCategories: (value) => updateDraft("selectedCategories", value),
    setSelectedCompanies: (value) => updateDraft("selectedCompanies", value),
    setExcludedCompanies: (value) => updateDraft("excludedCompanies", value),
    setExcludedTitleKeywords: (value) => updateDraft("excludedTitleKeywords", value),
    setAutoTailorMinIntervalMinutes: (value) => updateDraft("autoTailorMinIntervalMinutes", value),
    setEmailOnNewJobs: (value) => updateDraft("emailOnNewJobs", value),
  };
}
