"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Collapse from "@mui/material/Collapse";
import Snackbar from "@mui/material/Snackbar";
import TabHeader from "./TabHeader";
import styles from "../page.module.css";
import JobFilterControls from "./JobFilterControls";
import SavedSearchStrip from "./SavedSearchStrip";
import AutoApplyQueueTab from "./AutoApplyQueueTab";
import AutofillProfileDialog from "./AutofillProfileDialog";
import FeedPostingCard from "./feed/FeedPostingCard";
import FeedToolbar from "./feed/FeedToolbar";
import FeedFilterSummary from "./feed/FeedFilterSummary";
import FeedEmailAlerts from "./feed/FeedEmailAlerts";
import FeedSearchFields from "./feed/FeedSearchFields";
import { buildBookmarklet, profileHasValues } from "@/lib/autofill/buildBookmarklet";
import { openPostingBeside } from "@/lib/window/openPostingBeside";
import {
  FILTERS_STORAGE_KEY,
  ADVANCED_STORAGE_KEY,
  PANEL_OPEN_STORAGE_KEY,
  AUTO_REFRESH_MS,
  STALE_THRESHOLD_MS,
  DEFAULT_FILTERS,
  DEFAULT_ADVANCED,
  REMOTE_LABELS,
  SINCE_LABELS,
  loadFilters,
  loadAdvanced,
  companyName,
  loadPanelOpen,
  buildQueryString,
  formatRelative,
  sourceHealthFailureCount,
  freshnessLabel,
} from "@/lib/feed/liveFeedClient";

export default function LiveFeedTab({
  currentUser,
  savedSearches = [],
  setSavedSearches,
  setSavedSearchAutoTailor,
  deleteSavedSearch,
  GREENHOUSE_COMPANIES = [],
  COMPANY_CATEGORIES = [],
  onTailor,
  canTailor = false,
}) {
  const [filters, setFilters] = useState(loadFilters);
  const [advanced, setAdvanced] = useState(loadAdvanced);
  const [advancedOpen, setAdvancedOpen] = useState(loadPanelOpen);
  // Which view is active: the live feed list, or the auto-apply queue that the
  // cron fills from these saved searches.
  const [view, setView] = useState("feed"); // "feed" | "queue"
  const [queueCount, setQueueCount] = useState(0);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState(null);
  // Per-saved-search count of postings ingested since the search was last
  // opened, keyed by saved-search id. Drives the notification bubbles.
  const [unviewedCounts, setUnviewedCounts] = useState({});
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [sourceHealth, setSourceHealth] = useState(null);
  const [busyIds, setBusyIds] = useState({});
  // Autofill profile (used by the per-card "Auto Fill" bookmarklet) and its editor.
  const [autofillProfile, setAutofillProfile] = useState({});
  const [autofillDialogOpen, setAutofillDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState("");
  // Ticking "now" used for relative-time labels and staleness, kept in state so
  // render stays pure (no Date.now() calls during render).
  const [nowTs, setNowTs] = useState(0);

  // The combined filter object sent to the API (quick + advanced).
  const activeFilters = useMemo(
    () => ({ ...filters, ...advanced }),
    [filters, advanced],
  );

  // Guards against overlapping fetches and stale responses after unmount.
  const fetchSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const filtersRef = useRef(activeFilters);
  // Keep a ref to the latest cursor so the auto-refresh closure stays stable.
  const nextCursorRef = useRef(null);

  // Tick "now" forward on an interval so relative times and staleness update.
  useEffect(() => {
    const first = setTimeout(() => setNowTs(Date.now()), 0);
    const id = setInterval(() => setNowTs(Date.now()), 30000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    filtersRef.current = activeFilters;
  }, [activeFilters]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch the auto-apply queue count once so the toggle badge is accurate even
  // before the user opens the queue view. AutoApplyQueueTab keeps it in sync
  // afterwards via onCountChange.
  useEffect(() => {
    if (!currentUser) {
      const handle = setTimeout(() => setQueueCount(0), 0);
      return () => clearTimeout(handle);
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auto-apply-queue", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setQueueCount(Array.isArray(data.items) ? data.items.length : 0);
      } catch {
        // ignore — badge simply stays at its last known value
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Load the saved autofill profile once signed in so the per-card "Auto Fill"
  // bookmarklet has values to inject.
  useEffect(() => {
    if (!currentUser) {
      const handle = setTimeout(() => setAutofillProfile({}), 0);
      return () => clearTimeout(handle);
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user-profile", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAutofillProfile(data.profile && typeof data.profile === "object" ? data.profile : {});
      } catch {
        // ignore — Auto Fill will prompt the user to fill their profile
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Persist filters whenever they change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // ignore quota / serialization errors
    }
  }, [filters]);

  // Persist advanced filters separately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ADVANCED_STORAGE_KEY, JSON.stringify(advanced));
    } catch {
      // ignore quota / serialization errors
    }
  }, [advanced]);

  // Persist the filter panel's open/close state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, String(advancedOpen));
    } catch {
      // ignore quota / serialization errors
    }
  }, [advancedOpen]);

  const loadPage = useCallback(async (active, { append } = {}) => {
    const seq = ++fetchSeqRef.current;
    const cursor = append ? nextCursorRef.current : null;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      const qs = buildQueryString(active, append ? cursor : null);
      const res = await fetch(`/api/feed?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      // Ignore out-of-order responses.
      if (!mountedRef.current || seq !== fetchSeqRef.current) return;

      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setNextCursor(data.nextCursor ?? null);
      setLastUpdatedAt(data.lastUpdatedAt ?? null);
      setSourceHealth(data.sourceHealth ?? null);
    } catch (err) {
      if (!mountedRef.current || seq !== fetchSeqRef.current) return;
      setError(err.message || "Failed to load feed.");
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  // Initial load + reload when filters change (debounced for text inputs).
  useEffect(() => {
    const handle = setTimeout(() => {
      loadPage(activeFilters, { append: false });
    }, 300);
    return () => clearTimeout(handle);
  }, [activeFilters, loadPage]);

  // Auto-refresh the top of the feed on an interval without disturbing scroll.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadPage(filtersRef.current, { append: false });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadPage]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      if (currentUser) {
        // Trigger a fresh ingest; the backend lock prevents overlap.
        await fetch("/api/feed/refresh", { method: "POST" }).catch(() => {});
      }
      await loadPage(filtersRef.current, { append: false });
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [currentUser, loadPage]);

  const setBusy = (id, value) =>
    setBusyIds((prev) => ({ ...prev, [id]: value }));

  const postState = useCallback(async (postingId, action) => {
    const res = await fetch("/api/feed/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postingId, action }),
    });
    return res.ok;
  }, []);

  const handleHide = useCallback(
    async (posting) => {
      if (!currentUser) return;
      setBusy(posting.id, true);
      // Optimistically remove from the list.
      setItems((prev) => prev.filter((p) => p.id !== posting.id));
      const ok = await postState(posting.id, "hide");
      if (!ok) {
        // Re-add on failure by reloading the page.
        loadPage(filtersRef.current, { append: false });
      }
    },
    [currentUser, postState, loadPage],
  );

  // Tailor a résumé + cover letter for a single posting using the same flow as
  // the Posting URL / Job Description tabs. Progress is reflected in the shared
  // StatusBar via the parent's onTailor handler.
  const handleTailorPosting = useCallback(
    async (posting) => {
      if (typeof onTailor !== "function") return;
      setBusy(posting.id, true);
      setError("");
      try {
        const tailorError = await onTailor(posting);
        if (tailorError) setError(tailorError);
      } finally {
        if (mountedRef.current) setBusy(posting.id, false);
      }
    },
    [onTailor],
  );

  // Open the posting and copy an autofill bookmarklet (built from the user's
  // saved profile) to the clipboard. Browsers block scripting a third-party
  // page from here, so the user runs the bookmarklet on the posting itself.
  const handleAutoFill = useCallback(
    async (posting) => {
      if (!posting?.url) return;
      if (!profileHasValues(autofillProfile)) {
        setAutofillDialogOpen(true);
        return;
      }
      const bookmarklet = buildBookmarklet(autofillProfile);
      // Open the posting synchronously within the click gesture FIRST. Chrome
      // only grants popup-window placement (separate right-half window) when
      // window.open runs before any await; otherwise it downgrades to a tab.
      if (typeof window !== "undefined") {
        const opened = openPostingBeside(posting.url);
        if (!opened) window.open(posting.url, "_blank", "noopener,noreferrer");
      }
      let copied = false;
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(bookmarklet);
          copied = true;
        }
      } catch {
        // clipboard may be blocked; the posting is already open
      }
      setSnackbar(
        copied
          ? "Posting opened. Autofill bookmarklet copied — run it on the posting page (or use your saved Auto Fill bookmark)."
          : "Posting opened. Use your saved Auto Fill bookmark on the posting page.",
      );
    },
    [autofillProfile],
  );

  const updateFilter = useCallback(
    (key, value) => setFilters((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // Merge a patch into the advanced filters. Any manual edit clears the active
  // saved-search highlight (mirrors Job Search behavior).
  const updateAdvanced = useCallback((patch) => {
    setAdvanced((prev) => ({ ...prev, ...patch }));
    setActiveSavedSearchId(null);
  }, []);

  // Individual setters passed to the shared JobFilterControls.
  const setJobKeywords = useCallback((v) => updateAdvanced({ jobKeywords: v }), [updateAdvanced]);
  const setMaxYearsExp = useCallback((v) => updateAdvanced({ maxYearsExp: v }), [updateAdvanced]);
  const setSelectedCategories = useCallback((v) => updateAdvanced({ selectedCategories: v }), [updateAdvanced]);
  const setSelectedCompanies = useCallback((v) => updateAdvanced({ selectedCompanies: v }), [updateAdvanced]);
  const setExcludedCompanies = useCallback((v) => updateAdvanced({ excludedCompanies: v }), [updateAdvanced]);
  const setExcludedTitleKeywords = useCallback((v) => updateAdvanced({ excludedTitleKeywords: v }), [updateAdvanced]);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setAdvanced(DEFAULT_ADVANCED);
    setActiveSavedSearchId(null);
  }, []);

  // Map a saved_searches row/entry into the advanced control shape, resolving
  // company slugs back into the {slug,name} objects the controls expect.
  const applySavedSearch = useCallback(
    (entry) => {
      if (!entry) return;
      const keywords = Array.isArray(entry.jobKeywords)
        ? entry.jobKeywords.filter((s) => typeof s === "string" && s.trim())
        : [];
      const companies = (Array.isArray(entry.selectedCompanies) ? entry.selectedCompanies : [])
        .map((slug) => GREENHOUSE_COMPANIES.find((c) => c.slug === slug) || slug)
        .filter(Boolean);
      const excludedCompanies = GREENHOUSE_COMPANIES.filter((c) =>
        (Array.isArray(entry.excludedCompanies) ? entry.excludedCompanies : []).includes(c.slug),
      );
      setAdvanced({
        jobKeywords: keywords,
        maxYearsExp: typeof entry.maxYearsExp === "string" ? entry.maxYearsExp : "any",
        selectedCategories: Array.isArray(entry.selectedCategories) ? entry.selectedCategories : [],
        selectedCompanies: companies,
        excludedCompanies,
        excludedTitleKeywords: Array.isArray(entry.excludedTitleKeywords)
          ? entry.excludedTitleKeywords.filter((s) => typeof s === "string" && s.trim())
          : [],
      });
      setActiveSavedSearchId(entry.id);
      setAdvancedOpen(true);
      // Opening a saved search clears its "new postings" bubble.
      if (entry.id) {
        setUnviewedCounts((prev) =>
          prev[entry.id] ? { ...prev, [entry.id]: 0 } : prev,
        );
        // Persist the view timestamp for server-backed searches (UUID ids).
        if (currentUser && typeof entry.id === "string" && !entry.id.startsWith("ss-")) {
          fetch(`/api/saved-searches/${encodeURIComponent(entry.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ markViewed: true }),
          }).catch(() => {});
        }
      }
    },
    [GREENHOUSE_COMPANIES, currentUser],
  );

  // Fetch the count of new, unviewed postings for each saved search so the
  // strip can show notification bubbles. Re-runs when the set of saved-search
  // ids changes (e.g. after creating or deleting one).
  const savedSearchIdsKey = savedSearches.map((s) => s.id).join(",");
  useEffect(() => {
    if (!currentUser || savedSearches.length === 0) {
      // Reset the derived counts when there's nothing to fetch (mount/inputs cleared).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnviewedCounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/saved-searches/unviewed-counts", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        setUnviewedCounts(json?.counts && typeof json.counts === "object" ? json.counts : {});
      } catch {
        // Bubbles are best-effort; ignore fetch failures.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, savedSearchIdsKey]);

  // Merge the unviewed counts into the entries handed to the strip.
  const savedSearchesWithCounts = useMemo(
    () =>
      savedSearches.map((entry) => ({
        ...entry,
        unviewedCount: unviewedCounts[entry.id] || 0,
      })),
    [savedSearches, unviewedCounts],
  );

  const saveCurrentSearch = useCallback(async () => {
    if (typeof setSavedSearches !== "function") return;
    const defaultName =
      (advanced.jobKeywords || []).join(" ").trim() ||
      (advanced.selectedCategories || [])[0] ||
      "Untitled search";
    const name =
      typeof window !== "undefined"
        ? window.prompt("Name this saved search:", defaultName)?.trim()
        : "";
    if (!name) return;

    const payload = {
      name,
      jobKeywords: [...(advanced.jobKeywords || [])],
      maxYearsExp: advanced.maxYearsExp || "any",
      selectedCategories: [...(advanced.selectedCategories || [])],
      selectedCompanies: (advanced.selectedCompanies || [])
        .map((c) => (typeof c === "string" ? c : c?.slug))
        .filter(Boolean),
      excludedCompanies: (advanced.excludedCompanies || []).map((c) => c.slug).filter(Boolean),
      excludedTitleKeywords: [...(advanced.excludedTitleKeywords || [])],
    };

    const mapRow = (row) => ({
      id: row.id,
      name: row.name || "",
      jobKeywords: Array.isArray(row.job_keywords) ? row.job_keywords : [],
      maxYearsExp: row.max_years_exp || "any",
      selectedCategories: Array.isArray(row.selected_categories) ? row.selected_categories : [],
      selectedCompanies: Array.isArray(row.selected_companies) ? row.selected_companies : [],
      excludedCompanies: Array.isArray(row.excluded_companies) ? row.excluded_companies : [],
      excludedTitleKeywords: Array.isArray(row.excluded_title_keywords) ? row.excluded_title_keywords : [],
      autoTailorEnabled: !!row.auto_tailor_enabled,
      autoTailorDailyCap: Number.isFinite(row.auto_tailor_daily_cap) ? row.auto_tailor_daily_cap : 10,
      emailOnNewJobs: !!row.email_on_new_jobs,
      notifyEmail: row.notify_email || "",
    });

    if (currentUser) {
      try {
        const res = await fetch("/api/saved-searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.search) {
            const entry = mapRow(json.search);
            setSavedSearches((prev) => [entry, ...prev]);
            setActiveSavedSearchId(entry.id);
            return;
          }
        }
      } catch {
        // fall through to local-only save
      }
    }

    const localEntry = {
      id: `ss-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...payload,
      autoTailorEnabled: false,
      autoTailorDailyCap: 10,
      emailOnNewJobs: false,
      notifyEmail: "",
    };
    setSavedSearches((prev) => [localEntry, ...prev]);
    setActiveSavedSearchId(localEntry.id);
  }, [advanced, currentUser, setSavedSearches]);

  // Count of active filters for the summary / toggle badge.
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (advanced.jobKeywords?.length) n += 1;
    if (advanced.maxYearsExp && advanced.maxYearsExp !== "any") n += 1;
    if (advanced.selectedCategories?.length) n += 1;
    if (advanced.selectedCompanies?.length) n += 1;
    if (advanced.excludedCompanies?.length) n += 1;
    if (advanced.excludedTitleKeywords?.length) n += 1;
    if (filters.q) n += 1;
    if (filters.location) n += 1;
    if (filters.remote) n += 1;
    if (filters.since) n += 1;
    return n;
  }, [advanced, filters]);

  // Removable summary chips for each currently-applied filter.
  const activeFilterChips = useMemo(() => {
    const chips = [];
    if (filters.q) {
      chips.push({ key: "q", label: `“${filters.q}”`, onDelete: () => updateFilter("q", "") });
    }
    if (filters.location) {
      chips.push({ key: "location", label: filters.location, onDelete: () => updateFilter("location", "") });
    }
    if (filters.remote) {
      chips.push({
        key: "remote",
        label: REMOTE_LABELS[filters.remote] || filters.remote,
        onDelete: () => updateFilter("remote", ""),
      });
    }
    if (filters.since) {
      chips.push({
        key: "since",
        label: SINCE_LABELS[filters.since] || `Since ${filters.since}d`,
        onDelete: () => updateFilter("since", ""),
      });
    }
    if (advanced.maxYearsExp && advanced.maxYearsExp !== "any") {
      chips.push({
        key: "maxYears",
        label: `≤ ${advanced.maxYearsExp} yrs`,
        onDelete: () => setMaxYearsExp("any"),
      });
    }
    (advanced.jobKeywords || []).forEach((kw) => {
      chips.push({
        key: `kw:${kw}`,
        label: kw,
        onDelete: () => setJobKeywords((advanced.jobKeywords || []).filter((k) => k !== kw)),
      });
    });
    (advanced.selectedCategories || []).forEach((cat) => {
      chips.push({
        key: `cat:${cat}`,
        label: cat,
        onDelete: () => setSelectedCategories((advanced.selectedCategories || []).filter((c) => c !== cat)),
      });
    });
    (advanced.selectedCompanies || []).forEach((co) => {
      const name = companyName(co);
      chips.push({
        key: `co:${name}`,
        label: name,
        onDelete: () =>
          setSelectedCompanies((advanced.selectedCompanies || []).filter((c) => companyName(c) !== name)),
      });
    });
    (advanced.excludedCompanies || []).forEach((co) => {
      const name = companyName(co);
      chips.push({
        key: `exco:${name}`,
        label: `Exclude: ${name}`,
        onDelete: () =>
          setExcludedCompanies((advanced.excludedCompanies || []).filter((c) => companyName(c) !== name)),
      });
    });
    (advanced.excludedTitleKeywords || []).forEach((kw) => {
      chips.push({
        key: `exkw:${kw}`,
        label: `Exclude: ${kw}`,
        onDelete: () =>
          setExcludedTitleKeywords((advanced.excludedTitleKeywords || []).filter((k) => k !== kw)),
      });
    });
    return chips;
  }, [
    filters,
    advanced,
    updateFilter,
    setMaxYearsExp,
    setJobKeywords,
    setSelectedCategories,
    setSelectedCompanies,
    setExcludedCompanies,
    setExcludedTitleKeywords,
  ]);

  const isStale = useMemo(() => {
    if (!lastUpdatedAt || !nowTs) return false;
    return nowTs - new Date(lastUpdatedAt).getTime() > STALE_THRESHOLD_MS;
  }, [lastUpdatedAt, nowTs]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return "";
    return formatRelative(lastUpdatedAt, nowTs);
  }, [lastUpdatedAt, nowTs]);

  // Toolbar status text (WCAG 1.4.1 -- staleness must be legible without the
  // dot's colour) and the total failure count across every source, not just
  // Greenhouse (a total Lever/Ashby/RSS/AI-search outage used to read as
  // perfect health). See lib/feed/liveFeedClient.js for both.
  const freshnessText = freshnessLabel({
    lastUpdatedAt,
    isStale,
    relativeLabel: lastUpdatedLabel,
  });
  const sourceFailureCount = sourceHealthFailureCount(sourceHealth);

  return (
    <section className={styles.tabPanel}>
      <TabHeader
        title="Auto applying"
        description="A live job feed from your saved searches, with auto-tailored applications."
        actions={
          <FeedToolbar
            refreshing={refreshing}
            onRefresh={handleManualRefresh}
            hasUpdated={!!lastUpdatedAt}
            isStale={isStale}
            freshnessText={freshnessText}
            failureCount={sourceFailureCount}
            view={view}
            onChangeView={setView}
            queueCount={queueCount}
            activeFilterCount={activeFilterCount}
            advancedOpen={advancedOpen}
            onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
            currentUser={currentUser}
            onOpenAutofillProfile={() => setAutofillDialogOpen(true)}
          />
        }
      />

      {/* Collapsible advanced filters + saved searches (ported from Job Search) */}
      <Collapse in={advancedOpen} unmountOnExit>
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 1.5, sm: 2 },
            mb: 2,
            borderRadius: 2,
            bgcolor: "background.paper",
          }}
        >
          {/* Saved searches section */}
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}
          >
            Saved searches
          </Typography>
          <SavedSearchStrip
            savedSearches={savedSearchesWithCounts}
            activeSavedSearchId={activeSavedSearchId}
            saveCurrentSearch={saveCurrentSearch}
            applySavedSearch={applySavedSearch}
            deleteSavedSearch={deleteSavedSearch}
            saveLabel="current feed search"
          />

          <FeedEmailAlerts
            currentUser={currentUser}
            setSavedSearchAutoTailor={setSavedSearchAutoTailor}
            savedSearches={savedSearches}
          />

          <Divider sx={{ my: 2 }} />

          {/* Active filter summary chips */}
          <FeedFilterSummary chips={activeFilterChips} onClearAll={clearAllFilters} />

          {/* Search section */}
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}
          >
            Search
          </Typography>
          <FeedSearchFields filters={filters} updateFilter={updateFilter} />

          <Divider sx={{ my: 2 }} />

          {/* Refine section */}
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}
          >
            Refine
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <JobFilterControls
              jobKeywords={advanced.jobKeywords}
              setJobKeywords={setJobKeywords}
              maxYearsExp={advanced.maxYearsExp}
              setMaxYearsExp={setMaxYearsExp}
              selectedCategories={advanced.selectedCategories}
              setSelectedCategories={setSelectedCategories}
              selectedCompanies={advanced.selectedCompanies}
              setSelectedCompanies={setSelectedCompanies}
              excludedCompanies={advanced.excludedCompanies}
              setExcludedCompanies={setExcludedCompanies}
              excludedTitleKeywords={advanced.excludedTitleKeywords}
              setExcludedTitleKeywords={setExcludedTitleKeywords}
              GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES}
              COMPANY_CATEGORIES={COMPANY_CATEGORIES}
            />
          </Box>
        </Paper>
      </Collapse>

      {view === "queue" ? (
        <AutoApplyQueueTab
          currentUser={currentUser}
          savedSearches={savedSearches}
          onCountChange={setQueueCount}
        />
      ) : (
        <>
      {!currentUser && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Sign in to save postings, hide ones you don&apos;t want, and add jobs
          to your Applying pipeline.
        </Alert>
      )}

      {isStale && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Feed data may be stale — last successful ingest was {lastUpdatedLabel}.
          {currentUser ? " Try refreshing." : ""}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Loading skeletons */}
      {loading && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={92} />
          ))}
        </Box>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && !error && (
        <Box
          sx={{
            textAlign: "center",
            py: 6,
            color: "text.secondary",
            fontSize: "0.95rem",
          }}
        >
          No postings match your filters yet. Try widening your filters or
          refreshing.
        </Box>
      )}

      {/* Feed list */}
      {!loading && items.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {items.map((posting) => (
            <FeedPostingCard
              key={posting.id}
              posting={posting}
              busy={!!busyIds[posting.id]}
              canTailor={canTailor}
              currentUser={currentUser}
              nowTs={nowTs}
              onTailor={handleTailorPosting}
              onAutoFill={handleAutoFill}
              onHide={handleHide}
            />
          ))}

          {nextCursor != null && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 1.5 }}>
              <Button
                variant="outlined"
                onClick={() => loadPage(activeFilters, { append: true })}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={16} /> : null}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </Box>
          )}
        </Box>
      )}
        </>
      )}

      <AutofillProfileDialog
        open={autofillDialogOpen}
        onClose={() => setAutofillDialogOpen(false)}
        profile={autofillProfile}
        onSaved={setAutofillProfile}
      />
      <Snackbar
        open={!!snackbar}
        autoHideDuration={6000}
        onClose={() => setSnackbar("")}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </section>
  );
}
