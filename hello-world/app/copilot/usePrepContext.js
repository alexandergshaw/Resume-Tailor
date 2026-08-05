"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export const PREP_STORAGE_KEY = "copilot-prep-context";

// Real external store — the same shape app/settings/engine.js's useEngine
// uses: a module-level listener set, `subscribe` registering/unregistering,
// and the setter (below) notifying after every write. CopilotClient and
// PracticeClient can both be mounted at once (practice mode renders inside
// CopilotClient), and each calls usePrepContext() independently — without a
// real store, an edit in one is invisible to the other until a fresh mount:
// switching back to live mode would show stale text, and editing there
// would silently overwrite the newer value (BUG-14).
const listeners = new Set();

function notify() {
  listeners.forEach((cb) => cb());
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// `null` specifically means "this key has never been written," distinct
// from `""` ("written, and explicitly empty") — `getItem` already makes
// this distinction natively. The fallback effect below depends on telling
// these apart: collapsing both to "" (as `|| ""` would) made a deliberate
// clear look identical to "nothing stored yet" and re-fire the fallback,
// silently refilling a field the user had just cleared (BUG-13).
function readStoredProfile() {
  try {
    return window.localStorage.getItem(PREP_STORAGE_KEY);
  } catch {
    return null;
  }
}

// /copilot is statically prerendered, so the server (and the client's first
// hydration pass) always see this same `null`, exactly matching each other;
// React then transparently repaints with the real client value right after,
// with no hydration-mismatch warning. Same reasoning as useEngine's
// getServerSnapshot.
function getServerSnapshot() {
  return null;
}

// Shared "prep context" (résumé summary / target role / notes) the copilot
// grounds its answers and critiques in — used by both the live session
// (CopilotClient) and practice mode (PracticeClient), which can be mounted
// at the same time. Seeded from localStorage first, falling back to the
// user's saved "additional context" from the main app when nothing is
// stored locally yet (attempted at most once per mount — see BUG-13), and
// persisted back to localStorage — and broadcast to every other mounted
// instance — on every change. All storage access is wrapped in try/catch —
// a private-browsing or quota-limited browser degrades to an unsaved,
// in-memory value rather than throwing.
//
// Returns `[profile, setProfile]`, the same shape as useState — callers that
// need extra side effects on change (CopilotClient clears its answer cache)
// wrap the setter themselves rather than this hook knowing about it.
export function usePrepContext() {
  const stored = useSyncExternalStore(subscribe, readStoredProfile, getServerSnapshot);
  const [fallback, setFallback] = useState("");
  // Only populated when persistence itself fails (quota exceeded, private
  // browsing): the edit still has to be visible in THIS tab even though it
  // never reached storage and so can never show up in `stored`. Cleared the
  // moment a write actually succeeds, since `stored` is authoritative again
  // at that point.
  const [unsavedOverride, setUnsavedOverride] = useState(null);
  // Latches the fallback fetch below to at most once per mount, regardless
  // of what `stored` does afterwards — see BUG-13's fix.
  const fallbackAttemptedRef = useRef(false);

  // Nothing has ever been stored locally (`stored === null`) — fall back to
  // the user's saved "additional context" from the main app. Latched so it
  // can fire at most once per mount: without the ref guard, a value that
  // legitimately transitions null -> non-null -> null again (extremely
  // unlikely in practice — it would require the key being externally
  // removed, not something this hook ever does itself) would otherwise be
  // free to re-fire it. The original effect in CopilotClient ran once on
  // mount and had neither behavior; this restores that (BUG-13).
  useEffect(() => {
    if (stored !== null) return undefined;
    if (fallbackAttemptedRef.current) return undefined;
    fallbackAttemptedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user-context");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.additionalContext) setFallback(json.additionalContext);
      } catch {
        // best effort — the field just stays empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stored]);

  // Precedence: an unsaved local edit (write failed) beats the store, which
  // beats the fetched fallback. Once anything has ever been stored (even
  // ""), that's the source of truth — respects a deliberate clear rather
  // than falling back to the fetched value. Only before the very first
  // write does the fallback show through.
  const profile = unsavedOverride !== null ? unsavedOverride : stored !== null ? stored : fallback;

  const setProfileAndPersist = useCallback((val) => {
    try {
      window.localStorage.setItem(PREP_STORAGE_KEY, val);
      setUnsavedOverride(null);
    } catch {
      // Quota exceeded / private browsing: the edit still needs to be
      // visible in this tab even though it can't persist.
      setUnsavedOverride(val);
    }
    notify();
  }, []);

  return [profile, setProfileAndPersist];
}
