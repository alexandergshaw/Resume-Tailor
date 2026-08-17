"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readEngine } from "../settings/engine";

// The tech-watch briefing's data hook: GET /api/techwatch, on mount, on a
// window-size change, on an interval, and on window focus. Mirrors
// useExperiencePages.js's fetch-on-mount shape (401 -> signedOut rather than
// an error) but adds the polling/focus refresh AC-9 asks for, which nothing
// else in app/hooks does yet.
//
// It also owns a SECOND, dependent load: for every technology chunk A found
// no public lifecycle feed for (a `sources` row with `note === "no lifecycle
// feed"`), it asks a grounded-search route to fill the gap. That request is
// deliberately decoupled from the briefing's own loading/error state (see
// `lifecycleGaps` below) - a search that takes tens of seconds must never
// make the primary briefing wait on it, and a failure there must never look
// like a failure of the briefing itself.

const WINDOW_STORAGE_KEY = "techwatch:windowHours";
const ALLOWED_WINDOW_HOURS = [24, 72, 168];
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

// This hook owns "techwatch:windowHours" exclusively. The panel persists its
// OWN "techwatch:expanded" key instead - if both read/wrote the same key
// they would fight for it on mount, one clobbering whatever the other just
// read.
function readStoredWindowHours() {
  if (typeof window === "undefined") return DEFAULT_WINDOW_HOURS;
  try {
    const raw = window.localStorage.getItem(WINDOW_STORAGE_KEY);
    const parsed = Number(raw);
    return ALLOWED_WINDOW_HOURS.includes(parsed) ? parsed : DEFAULT_WINDOW_HOURS;
  } catch {
    return DEFAULT_WINDOW_HOURS;
  }
}

function writeStoredWindowHours(hours) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WINDOW_STORAGE_KEY, String(hours));
  } catch {
    // Storage can throw (private browsing, quota) - the in-memory choice
    // still applies for the rest of this session, it just won't survive a
    // reload. Not worth surfacing as an error on a read-only briefing.
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// The technologies worth a grounded search: every `sources` row chunk A
// marked "no lifecycle feed", resolved to a label. `watchlist.entries` is
// the authoritative label (it is what the rest of the panel already
// displays for that technology); a source row's own `label` is only a
// fallback for the (untested but possible) case a technology dropped out of
// the watchlist between the two reads.
function lifecycleGapTechnologies(data) {
  if (!data) return [];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const gapSources = sources.filter((s) => s && s.note === "no lifecycle feed");
  if (gapSources.length === 0) return [];
  const entries = Array.isArray(data?.watchlist?.entries) ? data.watchlist.entries : [];
  const labelById = new Map(entries.map((e) => [e.id, e.label]));
  return gapSources.map((s) => ({ id: s.technologyId, label: labelById.get(s.technologyId) || s.label }));
}

// `fetchImpl` defaults to the global fetch so real callers need not pass one;
// every test in useTechWatch.test.js supplies its own mock instead.
export function useTechWatch({ intervalMs = DEFAULT_INTERVAL_MS, fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);

  const [windowHours, setWindowHoursState] = useState(() => readStoredWindowHours());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Never null - see AC-9: "error is "" when clear, never null."
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [lifecycleGaps, setLifecycleGaps] = useState({ rows: [], loading: false, error: "" });

  // Recreated whenever `windowHours` changes so the query string it builds
  // always reflects the CURRENT choice, and so the mount/window-change effect
  // below (which depends on this identity) re-fires exactly when the window
  // does.
  const load = useCallback(async () => {
    if (!doFetch) return;
    setLoading(true);
    try {
      const res = await doFetch(`/api/techwatch?windowHours=${windowHours}`);
      if (res.status === 401) {
        // A 401 is "you are signed out", not a failure worth alarming the
        // user about - the panel renders nothing at all for it (AC-9),
        // rather than an error banner nobody can act on.
        setSignedOut(true);
        setError("");
        return;
      }
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error(json.error || "Could not load the briefing.");
      }
      setSignedOut(false);
      setData(json);
      setError("");
      // Only stamped on an actual successful load. A failed reload keeps
      // the LAST GOOD data on screen (see the catch branch below, which
      // never touches `data`), so it must also keep the last good
      // `lastLoadedAt` - otherwise the panel's "as of" line would claim
      // freshness the data never had.
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      // Deliberately does not touch `data`: keeping the last good briefing
      // on screen through a failed refresh is the whole point of this
      // catch branch (AC-9's "a failed reload keeps the last good data").
      setError(err?.message || "Could not load the briefing.");
    } finally {
      setLoading(false);
    }
  }, [doFetch, windowHours]);

  // Fetch on mount, and again whenever `windowHours` changes (either from
  // setWindowHours below or from the stored value read at init).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Re-requests on a timer. Cleared on unmount and whenever `load`'s own
  // identity changes, so a stale interval never keeps firing against an old
  // window choice's closure.
  useEffect(() => {
    if (!intervalMs) return undefined;
    const id = setInterval(() => {
      load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  // Re-requests when the tab regains focus - a briefing about outages and
  // exploits is exactly the kind of thing that should be current the moment
  // someone actually looks at it again, not just every 15 minutes.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function onFocus() {
      load();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const setWindowHours = useCallback((hours) => {
    const next = ALLOWED_WINDOW_HOURS.includes(hours) ? hours : DEFAULT_WINDOW_HOURS;
    writeStoredWindowHours(next);
    setWindowHoursState(next);
  }, []);

  // Recomputed on every `data` change, but the effect below keys off
  // `gapKey` (its sorted-id fingerprint) rather than this array's own
  // identity or `data`'s - a poll that returns the SAME gaps must not fire a
  // fresh grounded search, or every 15-minute refresh compounds model spend
  // silently for an answer that has not changed.
  const gapTechnologies = useMemo(() => lifecycleGapTechnologies(data), [data]);
  const gapKey = useMemo(
    () => gapTechnologies.map((t) => t.id).sort().join(","),
    [gapTechnologies],
  );

  useEffect(() => {
    if (!doFetch) return undefined;
    if (!gapKey) {
      // No gaps (or no briefing yet) - AC-4's "skip the request entirely".
      // Guarded so this doesn't re-fire an identical reset on every render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLifecycleGaps((prev) =>
        prev.rows.length === 0 && !prev.loading && !prev.error ? prev : { rows: [], loading: false, error: "" },
      );
      return undefined;
    }

    let cancelled = false;
    setLifecycleGaps((prev) => ({ ...prev, loading: true, error: "" }));

    (async () => {
      try {
        const res = await doFetch("/api/techwatch/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ technologies: gapTechnologies, engine: readEngine() }),
        });
        const json = await readJson(res);
        if (cancelled) return;
        if (!res.ok) {
          // Progressive enhancement, not a briefing failure - AC-5: "leaves
          // the panel exactly as chunk A rendered it". Never touches `data`.
          setLifecycleGaps({ rows: [], loading: false, error: json.error || "Could not load AI-sourced lifecycle answers." });
          return;
        }
        setLifecycleGaps({ rows: Array.isArray(json.rows) ? json.rows : [], loading: false, error: "" });
      } catch (err) {
        if (cancelled) return;
        setLifecycleGaps({ rows: [], loading: false, error: err?.message || "Could not load AI-sourced lifecycle answers." });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `gapTechnologies` is intentionally omitted - see `gapKey`'s comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapKey, doFetch]);

  return {
    data,
    loading,
    error,
    signedOut,
    lastLoadedAt,
    lifecycleGaps,
    windowHours,
    setWindowHours,
    reload: load,
  };
}
