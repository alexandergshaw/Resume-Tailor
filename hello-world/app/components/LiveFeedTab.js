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
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import AddTaskIcon from "@mui/icons-material/AddTask";
import styles from "../page.module.css";

const FILTERS_STORAGE_KEY = "feedFilters";
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

function buildQueryString(filters, cursor) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.location) params.set("location", filters.location);
  if (filters.remote) params.set("remote", filters.remote);
  if (filters.source) params.set("source", filters.source);
  if (filters.since) params.set("since", filters.since);
  if (filters.sort) params.set("sort", filters.sort);
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

export default function LiveFeedTab({ currentUser }) {
  const [filters, setFilters] = useState(loadFilters);
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

  // Guards against overlapping fetches and stale responses after unmount.
  const fetchSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const filtersRef = useRef(filters);
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
    filtersRef.current = filters;
  }, [filters]);

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

  const loadPage = useCallback(async (activeFilters, { append } = {}) => {
    const seq = ++fetchSeqRef.current;
    const cursor = append ? nextCursorRef.current : null;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      const qs = buildQueryString(activeFilters, append ? cursor : null);
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
      loadPage(filters, { append: false });
    }, 300);
    return () => clearTimeout(handle);
  }, [filters, loadPage]);

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

  const updateFilter = (key, value) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

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
      {/* Toolbar: status + filters + refresh */}
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1.5,
          mb: 1,
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
          <Box sx={{ fontSize: "0.8rem", color: "text.secondary" }}>
            {lastUpdatedAt
              ? `Updated ${lastUpdatedLabel}`
              : "Awaiting first ingest"}
          </Box>
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

        <TextField
          size="small"
          label="Search title or company"
          value={filters.q}
          onChange={(e) => updateFilter("q", e.target.value)}
          sx={{ minWidth: 220 }}
        />
        <TextField
          size="small"
          label="Location"
          value={filters.location}
          onChange={(e) => updateFilter("location", e.target.value)}
          sx={{ minWidth: 150 }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
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
        <FormControl size="small" sx={{ minWidth: 130 }}>
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
        <FormControl size="small" sx={{ minWidth: 140 }}>
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
                onClick={() => loadPage(filters, { append: true })}
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
