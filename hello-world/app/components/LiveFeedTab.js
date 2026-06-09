"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Badge from "@mui/material/Badge";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import AddTaskIcon from "@mui/icons-material/AddTask";
import TuneIcon from "@mui/icons-material/Tune";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import FilterAltOffIcon from "@mui/icons-material/FilterAltOff";
import Collapse from "@mui/material/Collapse";
import styles from "../page.module.css";
import JobFilterControls from "./JobFilterControls";
import SavedSearchStrip from "./SavedSearchStrip";

const FILTERS_STORAGE_KEY = "feedFilters";
const ADVANCED_STORAGE_KEY = "feedAdvancedFilters";
const AUTO_REFRESH_MS = 60000; // 60s, matches the cron cadence
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // warn if data is older than 5 minutes

const DEFAULT_FILTERS = {
  q: "",
  location: "",
  remote: "",
  source: "",
  since: "",
  sort: "newest",
};

// Advanced filters ported from Job Search. Companies are stored as {slug,name}
// objects (or freeform strings) to match the shared JobFilterControls shape.
const DEFAULT_ADVANCED = {
  jobKeywords: [],
  maxYearsExp: "any",
  selectedCategories: [],
  selectedCompanies: [],
  excludedCompanies: [],
  excludedTitleKeywords: [],
};

// Human-readable labels for the quick-filter summary chips.
const REMOTE_LABELS = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};
const SINCE_LABELS = {
  1: "Last 24h",
  3: "Last 3 days",
  7: "Last 7 days",
  30: "Last 30 days",
};

function loadFilters() {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function loadAdvanced() {
  if (typeof window === "undefined") return DEFAULT_ADVANCED;
  try {
    const raw = window.localStorage.getItem(ADVANCED_STORAGE_KEY);
    if (!raw) return DEFAULT_ADVANCED;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ADVANCED, ...parsed };
  } catch {
    return DEFAULT_ADVANCED;
  }
}

// Resolve a company entry ({slug,name} | string) to its display name, which is
// what feed_postings.company stores.
function companyName(entry) {
  if (!entry) return "";
  return typeof entry === "string" ? entry : entry.name || "";
}

function buildQueryString(active, cursor) {
  const params = new URLSearchParams();
  if (active.q) params.set("q", active.q);
  if (active.location) params.set("location", active.location);
  if (active.remote) params.set("remote", active.remote);
  if (active.source) params.set("source", active.source);
  if (active.since) params.set("since", active.since);
  if (active.sort) params.set("sort", active.sort);

  const keywords = (active.jobKeywords || []).filter(Boolean);
  if (keywords.length > 0) params.set("keywords", keywords.join(","));

  if (active.maxYearsExp && active.maxYearsExp !== "any") {
    params.set("maxYears", active.maxYearsExp);
  }

  const companies = (active.selectedCompanies || []).map(companyName).filter(Boolean);
  if (companies.length > 0) params.set("companies", companies.join(","));

  const excludeCompanies = (active.excludedCompanies || []).map(companyName).filter(Boolean);
  if (excludeCompanies.length > 0) params.set("excludeCompanies", excludeCompanies.join(","));

  const excludeTitle = (active.excludedTitleKeywords || []).filter(Boolean);
  if (excludeTitle.length > 0) params.set("excludeTitleKeywords", excludeTitle.join(","));

  if (cursor != null) params.set("cursor", String(cursor));
  return params.toString();
}

function formatRelative(value, now) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const base = now || d.getTime();
  const diff = base - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function LiveFeedTab({
  currentUser,
  savedSearches = [],
  setSavedSearches,
  deleteSavedSearch,
  GREENHOUSE_COMPANIES = [],
  COMPANY_CATEGORIES = [],
}) {
  const [filters, setFilters] = useState(loadFilters);
  const [advanced, setAdvanced] = useState(loadAdvanced);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState(null);
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [sourceHealth, setSourceHealth] = useState(null);
  const [busyIds, setBusyIds] = useState({});
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

  const handleToggleSave = useCallback(
    async (posting) => {
      if (!currentUser) return;
      const next = !posting.saved;
      setBusy(posting.id, true);
      // Optimistic update.
      setItems((prev) =>
        prev.map((p) => (p.id === posting.id ? { ...p, saved: next } : p)),
      );
      const ok = await postState(posting.id, next ? "save" : "unsave");
      if (!ok) {
        setItems((prev) =>
          prev.map((p) =>
            p.id === posting.id ? { ...p, saved: !next } : p,
          ),
        );
      }
      if (mountedRef.current) setBusy(posting.id, false);
    },
    [currentUser, postState],
  );

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

  const handleAddToApplying = useCallback(
    async (posting) => {
      if (!currentUser) return;
      setBusy(posting.id, true);
      try {
        const res = await fetch("/api/feed/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postingId: posting.id }),
        });
        if (res.ok) {
          setItems((prev) =>
            prev.map((p) =>
              p.id === posting.id ? { ...p, added: true } : p,
            ),
          );
        }
      } finally {
        if (mountedRef.current) setBusy(posting.id, false);
      }
    },
    [currentUser],
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
    },
    [GREENHOUSE_COMPANIES],
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

  return (
    <section className={styles.tabPanel}>
      {/* Header band: status + filters toggle */}
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1.5,
          py: 1,
          mb: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mr: "auto" }}>
          <Tooltip title="Refresh now">
            <span>
              <IconButton
                onClick={handleManualRefresh}
                disabled={refreshing}
                size="small"
                color="primary"
              >
                {refreshing ? <CircularProgress size={18} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
          {/* Freshness indicator dot */}
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              bgcolor: !lastUpdatedAt
                ? "grey.400"
                : isStale
                  ? "warning.main"
                  : "success.main",
              boxShadow: (theme) =>
                !lastUpdatedAt
                  ? "none"
                  : `0 0 0 3px ${
                      isStale
                        ? "rgba(237, 108, 2, 0.16)"
                        : "rgba(46, 125, 50, 0.16)"
                    }`,
            }}
          />
          <Typography variant="body2" color="text.secondary">
            {lastUpdatedAt
              ? `Updated ${lastUpdatedLabel}`
              : "Awaiting first ingest"}
          </Typography>
          {sourceHealth?.greenhouse?.failures > 0 && (
            <Tooltip
              title={`${sourceHealth.greenhouse.failures} source(s) failed on the last ingest`}
            >
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`${sourceHealth.greenhouse.failures} src errors`}
              />
            </Tooltip>
          )}
        </Box>

        <Badge
          badgeContent={activeFilterCount}
          color="primary"
          overlap="rectangular"
          sx={{ "& .MuiBadge-badge": { right: 4, top: 4 } }}
        >
          <Button
            size="small"
            variant={advancedOpen || activeFilterCount > 0 ? "contained" : "outlined"}
            color={activeFilterCount > 0 ? "primary" : "inherit"}
            disableElevation
            startIcon={<TuneIcon />}
            endIcon={advancedOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            onClick={() => setAdvancedOpen((v) => !v)}
            sx={{ textTransform: "none", fontWeight: 600, px: 1.75 }}
          >
            Filters
          </Button>
        </Badge>
      </Box>

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
          {/* Active filter summary chips */}
          {activeFilterChips.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  mb: 1,
                }}
              >
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ letterSpacing: 0.6 }}
                >
                  Active filters
                </Typography>
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<FilterAltOffIcon fontSize="small" />}
                  onClick={clearAllFilters}
                  sx={{ textTransform: "none", color: "text.secondary" }}
                >
                  Clear all
                </Button>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {activeFilterChips.map((chip) => (
                  <Chip
                    key={chip.key}
                    label={chip.label}
                    size="small"
                    variant="outlined"
                    onDelete={chip.onDelete}
                    sx={{ maxWidth: 240 }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Search section */}
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}
          >
            Search
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, 1fr)",
                md: "repeat(4, 1fr)",
              },
              gap: 1.5,
            }}
          >
            <TextField
              size="small"
              fullWidth
              label="Search title or company"
              value={filters.q}
              onChange={(e) => updateFilter("q", e.target.value)}
            />
            <TextField
              size="small"
              fullWidth
              label="Location"
              value={filters.location}
              onChange={(e) => updateFilter("location", e.target.value)}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Work type</InputLabel>
              <Select
                label="Work type"
                value={filters.remote}
                onChange={(e) => updateFilter("remote", e.target.value)}
              >
                <MenuItem value="">Any</MenuItem>
                <MenuItem value="remote">Remote</MenuItem>
                <MenuItem value="hybrid">Hybrid</MenuItem>
                <MenuItem value="onsite">On-site</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Posted</InputLabel>
              <Select
                label="Posted"
                value={filters.since}
                onChange={(e) => updateFilter("since", e.target.value)}
              >
                <MenuItem value="">Any time</MenuItem>
                <MenuItem value="1">Last 24h</MenuItem>
                <MenuItem value="3">Last 3 days</MenuItem>
                <MenuItem value="7">Last 7 days</MenuItem>
                <MenuItem value="30">Last 30 days</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Sort</InputLabel>
              <Select
                label="Sort"
                value={filters.sort}
                onChange={(e) => updateFilter("sort", e.target.value)}
              >
                <MenuItem value="newest">Newest</MenuItem>
                <MenuItem value="relevance">Relevance</MenuItem>
                <MenuItem value="company">Company A–Z</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Saved searches section */}
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}
          >
            Saved searches
          </Typography>
          <SavedSearchStrip
            savedSearches={savedSearches}
            activeSavedSearchId={activeSavedSearchId}
            saveCurrentSearch={saveCurrentSearch}
            applySavedSearch={applySavedSearch}
            deleteSavedSearch={deleteSavedSearch}
            saveLabel="current feed search"
          />

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
          {items.map((posting) => {
            const busy = !!busyIds[posting.id];
            return (
              <Box
                key={posting.id}
                sx={{
                  border: "1px solid var(--border, #e0e0e0)",
                  borderRadius: 1.5,
                  p: 1.5,
                  display: "flex",
                  gap: 1.5,
                  alignItems: "flex-start",
                  bgcolor: "background.paper",
                  transition: "box-shadow 120ms ease",
                  "&:hover": { boxShadow: 2 },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 1,
                      flexWrap: "wrap",
                    }}
                  >
                    <Box
                      sx={{
                        fontWeight: 700,
                        fontSize: "0.98rem",
                        color: "text.primary",
                      }}
                    >
                      {posting.title || "Untitled role"}
                    </Box>
                    <Box sx={{ color: "text.secondary", fontSize: "0.88rem" }}>
                      {posting.company || "—"}
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      display: "flex",
                      gap: 0.75,
                      flexWrap: "wrap",
                      mt: 0.5,
                      alignItems: "center",
                    }}
                  >
                    {posting.location && (
                      <Chip size="small" label={posting.location} variant="outlined" />
                    )}
                    {posting.remote_type && posting.remote_type !== "unknown" && (
                      <Chip
                        size="small"
                        label={posting.remote_type}
                        color={posting.remote_type === "remote" ? "success" : "default"}
                        variant="outlined"
                      />
                    )}
                    <Chip size="small" label={posting.source} variant="outlined" />
                    {posting.posted_at && (
                      <Box sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                        {formatRelative(posting.posted_at, nowTs)}
                      </Box>
                    )}
                  </Box>

                  {posting.description_snippet && (
                    <Box
                      sx={{
                        mt: 0.75,
                        fontSize: "0.84rem",
                        color: "text.secondary",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {posting.description_snippet}
                    </Box>
                  )}
                </Box>

                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                  {posting.url && (
                    <Tooltip title="Open posting">
                      <IconButton
                        size="small"
                        component="a"
                        href={posting.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title={posting.saved ? "Unsave" : "Save"}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={!currentUser || busy}
                        onClick={() => handleToggleSave(posting)}
                        color={posting.saved ? "primary" : "default"}
                      >
                        {posting.saved ? (
                          <BookmarkIcon fontSize="small" />
                        ) : (
                          <BookmarkBorderIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={posting.added ? "Added to Applying" : "Add to Applying"}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={!currentUser || busy || posting.added}
                        onClick={() => handleAddToApplying(posting)}
                        color={posting.added ? "success" : "default"}
                      >
                        <AddTaskIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Hide">
                    <span>
                      <IconButton
                        size="small"
                        disabled={!currentUser || busy}
                        onClick={() => handleHide(posting)}
                      >
                        <VisibilityOffIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            );
          })}

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
    </section>
  );
}
