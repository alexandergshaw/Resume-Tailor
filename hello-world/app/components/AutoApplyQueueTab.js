"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LinearProgress from "@mui/material/LinearProgress";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DescriptionIcon from "@mui/icons-material/Description";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import InboxIcon from "@mui/icons-material/Inbox";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import TabHeader from "./TabHeader";
import EmptyState from "./EmptyState";

import styles from "../page.module.css";
import { openPostingBeside } from "@/lib/window/openPostingBeside";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// Turn generated content (string or line array) into a downloadable text file.
function downloadText(filename, lines, fallback) {
  const text = Array.isArray(lines) && lines.length > 0 ? lines.join("\n") : fallback || "";
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeName(part, fallback) {
  const cleaned = (part || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

export default function AutoApplyQueueTab({ currentUser, savedSearches = [], onCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [walkIndex, setWalkIndex] = useState(-1); // -1 = list view

  const load = useCallback(async () => {
    if (!currentUser) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auto-apply-queue", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const next = Array.isArray(data.items) ? data.items : [];
      setItems(next);
      if (typeof onCountChange === "function") onCountChange(next.length);
    } catch (err) {
      setError(err.message || "Failed to load the auto-apply queue.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, onCountChange]);

  useEffect(() => {
    const handle = setTimeout(() => load(), 0);
    return () => clearTimeout(handle);
  }, [load]);

  const resumeFor = (row) => row?.generated_resumes || null;
  const coverFor = (row) => row?.generated_cover_letters || null;

  // Map auto_search_id -> saved search name so each queued job shows which
  // saved search produced it.
  const savedSearchNames = useMemo(() => {
    const map = new Map();
    for (const s of Array.isArray(savedSearches) ? savedSearches : []) {
      if (s && s.id) map.set(s.id, s.name || "Saved search");
    }
    return map;
  }, [savedSearches]);

  const originName = useCallback(
    (row) => (row?.auto_search_id ? savedSearchNames.get(row.auto_search_id) || "" : ""),
    [savedSearchNames],
  );

  const handleDownloadResume = useCallback((row) => {
    const pos = row?.positions || {};
    const r = resumeFor(row);
    if (!r) return;
    downloadText(
      `Resume - ${safeName(pos.company, "Company")} - ${safeName(pos.title, "Role")}.txt`,
      r.content_lines,
      r.content,
    );
  }, []);

  const handleDownloadCover = useCallback((row) => {
    const pos = row?.positions || {};
    const c = coverFor(row);
    if (!c) return;
    downloadText(
      `Cover Letter - ${safeName(pos.company, "Company")} - ${safeName(pos.title, "Role")}.txt`,
      c.content_lines,
      c.content,
    );
  }, []);

  // Record that the user opened/worked a queued posting. The row stays at
  // status "auto_queued" (it only leaves the queue when the user manually
  // changes its status elsewhere), so we just mark auto_apply_opened_at locally.
  const markOpened = useCallback(async (row) => {
    if (!row?.id) return;
    setBusyId(row.id);
    setError("");
    try {
      const res = await fetch(`/api/auto-apply-queue/${row.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || `Request failed (${res.status})`);
      }
      const openedAt = payload.openedAt || new Date().toISOString();
      setItems((prev) =>
        prev.map((it) =>
          it.id === row.id ? { ...it, auto_apply_opened_at: openedAt } : it,
        ),
      );
    } catch (err) {
      setError(err.message || "Failed to update the queue item.");
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleApply = useCallback(
    async (row) => {
      const url = row?.positions?.url;
      // Download tailored docs and open the posting, then record the open.
      handleDownloadResume(row);
      if (coverFor(row)) handleDownloadCover(row);
      if (url && typeof window !== "undefined") {
        const opened = openPostingBeside(url);
        if (!opened) window.open(url, "_blank", "noopener,noreferrer");
      }
      await markOpened(row);
    },
    [markOpened, handleDownloadResume, handleDownloadCover],
  );

  // Move to the next item in the walkthrough without changing the queue.
  const goNext = useCallback(() => setWalkIndex((i) => i + 1), []);

  // Remove a posting from the queue entirely. This hard-deletes the application
  // row, so clicking the rocket again in the Live Feed re-tailors and re-queues
  // the same posting.
  const handleRemove = useCallback(
    async (row) => {
      if (!row?.id) return;
      if (typeof window !== "undefined" && !window.confirm("Remove this posting from the queue?")) {
        return;
      }
      setBusyId(row.id);
      setError("");
      try {
        const res = await fetch(`/api/auto-apply-queue/${row.id}`, { method: "DELETE" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.error || `Request failed (${res.status})`);
        }
        setItems((prev) => {
          const next = prev.filter((it) => it.id !== row.id);
          if (typeof onCountChange === "function") onCountChange(next.length);
          return next;
        });
      } catch (err) {
        setError(err.message || "Failed to remove the queue item.");
      } finally {
        setBusyId(null);
      }
    },
    [onCountChange],
  );

  // Walkthrough: items stay in the queue, so advance by index. Exit when we run
  // past the end (or the queue empties).
  const walking = walkIndex >= 0;
  const current = walking && walkIndex < items.length ? items[walkIndex] : null;
  // The shared `positions` catalogue is writable by any signed-in account, so
  // this url is not this user's to trust. See lib/url/safeExternalHref.js.
  const currentPostingHref = safeExternalHref(current?.positions?.url);

  useEffect(() => {
    if (!walking) return undefined;
    if (items.length > 0 && walkIndex < items.length) return undefined;
    const handle = setTimeout(() => setWalkIndex(-1), 0);
    return () => clearTimeout(handle);
  }, [walking, walkIndex, items.length]);

  const progressLabel = useMemo(() => {
    if (!walking || items.length === 0) return "";
    const pos = Math.min(walkIndex, items.length - 1) + 1;
    return `${pos} of ${items.length}`;
  }, [walking, walkIndex, items.length]);

  if (!currentUser) {
    return (
      <section className={styles.tabPanel}>
        <TabHeader title="Auto-apply queue" />
        <EmptyState
          icon={<InboxIcon />}
          title="Queue requires sign-in"
          message="Sign in to view your auto-apply queue and manage tailored applications."
        />
      </section>
    );
  }

  return (
    <section className={styles.tabPanel}>
      <TabHeader
        title="Auto-apply queue"
        description="Jobs matched from your saved searches, auto-saved with a tailored resume and cover letter — work through them one at a time."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Chip
              size="small"
              label={items.length}
              color={items.length > 0 ? "primary" : "default"}
            />
            <Tooltip title="Refresh queue">
              <span>
                <IconButton
                  onClick={load}
                  disabled={loading}
                  size="small"
                  color="primary"
                >
                  {loading ? <CircularProgress size={18} /> : <RefreshIcon />}
                </IconButton>
              </span>
            </Tooltip>
            {items.length > 0 && !walking && (
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={() => setWalkIndex(0)}
                sx={{ textTransform: "none" }}
              >
                Start auto-apply
              </Button>
            )}
          </Box>
        }
      />

      {/* Error alert with retry action */}
      {error && (
        <Alert
          severity="error"
          onClose={() => setError("")}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={load}
              sx={{ textTransform: "none" }}
            >
              Retry
            </Button>
          }
          sx={{ mb: 1.5 }}
        >
          {error}
        </Alert>
      )}

      {/* Loading state: table-shaped skeletons */}
      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={64} />
          ))}
        </Box>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<InboxIcon />}
          title="Nothing queued yet"
          message="Enable auto-tailor on a saved search and wait for the next run."
        />
      ) : walking && current ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          {/* Progress bar */}
          <Box sx={{ mb: 2 }}>
            <LinearProgress
              variant="determinate"
              value={items.length > 0 ? Math.min((walkIndex / items.length) * 100, 100) : 0}
            />
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", display: "block", mt: 0.5, textAlign: "right" }}
            >
              {progressLabel}
            </Typography>
          </Box>

          {/* Title and location (clear hierarchy) */}
          <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", mb: 0.25 }}>
            {current.positions?.title || "Untitled role"}
          </Typography>
          <Typography sx={{ color: "var(--text-secondary)", fontSize: "0.95rem", mb: 1 }}>
            {current.positions?.company || "—"}
            {current.positions?.location ? ` · ${current.positions.location}` : ""}
          </Typography>

          {/* Metadata chips */}
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 1.5 }}>
            {originName(current) && (
              <Chip size="small" variant="outlined" label={`From: ${originName(current)}`} />
            )}
            {current.auto_apply_opened_at && (
              <Chip
                size="small"
                color="success"
                icon={<CheckCircleIcon />}
                label={`Opened ${new Date(current.auto_apply_opened_at).toLocaleString()}`}
              />
            )}
          </Box>

          {/* Document download buttons */}
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 1.5 }}>
            <Tooltip title="Download tailored résumé">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DescriptionIcon />}
                  onClick={() => handleDownloadResume(current)}
                  disabled={!resumeFor(current)}
                  sx={{ textTransform: "none" }}
                >
                  Résumé
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Download tailored cover letter">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DescriptionIcon />}
                  onClick={() => handleDownloadCover(current)}
                  disabled={!coverFor(current)}
                  sx={{ textTransform: "none" }}
                >
                  Cover letter
                </Button>
              </span>
            </Tooltip>
            {/* Refused -> the button is omitted entirely; the queue card
                keeps company, title and both document downloads. */}
            {currentPostingHref && (
              <Tooltip title="Open job posting in new window">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<OpenInNewIcon />}
                  href={currentPostingHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ textTransform: "none" }}
                >
                  Open posting
                </Button>
              </Tooltip>
            )}
          </Box>

          <Divider sx={{ my: 1.5 }} />

          {/* Primary and secondary actions */}
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Button
              variant="contained"
              onClick={async () => {
                await handleApply(current);
                goNext();
              }}
              disabled={busyId === current.id || !current.positions?.url}
              sx={{ textTransform: "none" }}
            >
              {busyId === current.id
                ? "Opening…"
                : current.auto_apply_opened_at
                  ? "Re-open & next"
                  : "Apply & next"}
            </Button>
            <Button
              variant="text"
              color="inherit"
              onClick={goNext}
              disabled={busyId === current.id}
              sx={{ textTransform: "none" }}
            >
              Skip
            </Button>
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Remove from queue">
              <span>
                <Button
                  size="small"
                  variant="text"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={async () => {
                    await handleRemove(current);
                  }}
                  disabled={busyId === current.id}
                  sx={{ textTransform: "none" }}
                >
                  Remove
                </Button>
              </span>
            </Tooltip>
          </Box>

          {/* Informational footnote */}
          <Typography sx={{ color: "var(--text-muted)", fontSize: "0.72rem", mt: 1 }}>
            Jobs stay in the queue until you change their status in the Tracking tab.
          </Typography>
        </Paper>
      ) : (
        /* List/table view with consistent row padding, hover state, truncation */
        <Box
          sx={{
            overflowX: "auto",
            border: "1px solid var(--border)",
            borderRadius: 1,
            bgcolor: "var(--bg-surface)",
          }}
        >
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            {/* Table header */}
            <Box component="thead" sx={{ bgcolor: "var(--bg-soft)" }}>
              <Box component="tr">
                <Box
                  component="th"
                  sx={{
                    textAlign: "left",
                    p: 1.25,
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  Saved
                </Box>
                <Box
                  component="th"
                  sx={{
                    textAlign: "left",
                    p: 1.25,
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  From
                </Box>
                <Box
                  component="th"
                  sx={{
                    textAlign: "left",
                    p: 1.25,
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  Company
                </Box>
                <Box
                  component="th"
                  sx={{
                    textAlign: "left",
                    p: 1.25,
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  Title
                </Box>
                <Box
                  component="th"
                  sx={{
                    textAlign: "left",
                    p: 1.25,
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  Docs
                </Box>
                <Box
                  component="th"
                  sx={{
                    textAlign: "left",
                    p: 1.25,
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  Actions
                </Box>
              </Box>
            </Box>

            {/* Table body */}
            <Box component="tbody">
              {items.map((row) => {
                const pos = row.positions || {};
                const dateLabel = row.auto_saved_at ? new Date(row.auto_saved_at).toLocaleString() : "—";
                return (
                  <Box
                    component="tr"
                    key={row.id}
                    sx={{
                      "&:hover": { bgcolor: "var(--bg-soft)" },
                      transition: "background-color 150ms ease",
                    }}
                  >
                    {/* Saved date */}
                    <Box
                      component="td"
                      sx={{
                        p: 1.25,
                        borderBottom: "1px solid var(--border)",
                        whiteSpace: "nowrap",
                        fontSize: "0.8rem",
                        color: "text.secondary",
                      }}
                    >
                      {dateLabel}
                    </Box>

                    {/* From (saved search) */}
                    <Box
                      component="td"
                      sx={{
                        p: 1.25,
                        borderBottom: "1px solid var(--border)",
                        maxWidth: 150,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {originName(row) || "—"}
                    </Box>

                    {/* Company */}
                    <Box
                      component="td"
                      sx={{
                        p: 1.25,
                        borderBottom: "1px solid var(--border)",
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pos.company || "—"}
                    </Box>

                    {/* Title */}
                    <Box
                      component="td"
                      sx={{
                        p: 1.25,
                        borderBottom: "1px solid var(--border)",
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pos.title || "—"}
                    </Box>

                    {/* Document actions (icon buttons) */}
                    <Box
                      component="td"
                      sx={{
                        p: 1.25,
                        borderBottom: "1px solid var(--border)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Tooltip title="Download résumé">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleDownloadResume(row)}
                            disabled={!resumeFor(row)}
                            sx={{ color: "primary.main" }}
                          >
                            <DescriptionIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Download cover letter">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleDownloadCover(row)}
                            disabled={!coverFor(row)}
                            sx={{ color: "primary.main" }}
                          >
                            <DescriptionIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>

                    {/* Primary action + remove */}
                    <Box
                      component="td"
                      sx={{
                        p: 1.25,
                        borderBottom: "1px solid var(--border)",
                        whiteSpace: "nowrap",
                        display: "flex",
                        gap: 0.5,
                        alignItems: "center",
                      }}
                    >
                      <Tooltip
                        title={
                          !pos.url
                            ? "No posting URL available"
                            : row.auto_apply_opened_at
                              ? "Re-open posting and re-download docs"
                              : "Open posting and mark applied"
                        }
                      >
                        <span>
                          <Button
                            size="small"
                            variant={row.auto_apply_opened_at ? "outlined" : "contained"}
                            color={row.auto_apply_opened_at ? "success" : "primary"}
                            startIcon={row.auto_apply_opened_at ? <CheckCircleIcon /> : null}
                            onClick={() => handleApply(row)}
                            disabled={busyId === row.id || !pos.url}
                            sx={{
                              textTransform: "none",
                              fontSize: "0.75rem",
                              py: 0.5,
                              px: 1,
                            }}
                          >
                            {busyId === row.id ? "…" : row.auto_apply_opened_at ? "Re-open" : "Apply"}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Remove from queue">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleRemove(row)}
                            disabled={busyId === row.id}
                            sx={{ color: "error.main" }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      )}
    </section>
  );
}
