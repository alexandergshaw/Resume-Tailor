"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DescriptionIcon from "@mui/icons-material/Description";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";

import styles from "../page.module.css";
import { openPostingBeside } from "@/lib/window/openPostingBeside";

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
        <p style={{ color: "var(--text-secondary)" }}>
          Sign in to view your auto-apply queue.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.tabPanel}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: "0.95rem" }}>Auto-apply queue</Typography>
        <Chip size="small" label={items.length} color={items.length > 0 ? "primary" : "default"} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={load} disabled={loading} sx={{ textTransform: "none" }}>
          Refresh
        </Button>
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
      <Typography sx={{ color: "#546e7a", fontSize: "0.8rem", mb: 1.5 }}>
        Jobs matched from your saved searches, auto-saved with a tailored resume and cover letter.
        Work through them one at a time.
      </Typography>

      {error && <p style={{ color: "var(--error, #d32f2f)" }}>Error: {error}</p>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{ color: "#78909c", fontSize: "0.85rem", fontStyle: "italic" }}>
          Nothing queued yet. Enable auto-tailor on a saved search and wait for the next run.
        </Box>
      ) : walking && current ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
            <Typography variant="overline" color="text.secondary">{progressLabel}</Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setWalkIndex(-1)} sx={{ textTransform: "none" }}>
              Exit
            </Button>
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: "1.05rem" }}>
            {current.positions?.title || "Untitled role"}
          </Typography>
          <Typography sx={{ color: "#546e7a", mb: 0.5 }}>
            {current.positions?.company || "—"}
            {current.positions?.location ? ` · ${current.positions.location}` : ""}
          </Typography>
          {originName(current) && (
            <Chip size="small" variant="outlined" label={`From: ${originName(current)}`} sx={{ mb: 0.5 }} />
          )}
          {current.auto_apply_opened_at && (
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={`Opened ${new Date(current.auto_apply_opened_at).toLocaleString()}`}
              sx={{ mb: 0.5, ml: originName(current) ? 0.5 : 0 }}
            />
          )}
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", my: 1.5 }}>
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
            {current.positions?.url && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<OpenInNewIcon />}
                href={current.positions.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ textTransform: "none" }}
              >
                Open posting
              </Button>
            )}
          </Box>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
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
            <Button
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
          </Box>
          <Typography sx={{ color: "#90a4ae", fontSize: "0.72rem", mt: 1 }}>
            Jobs stay in the queue until you change their status in the Tracking tab.
          </Typography>
        </Paper>
      ) : (
        <Box sx={{ overflowX: "auto", border: "1px solid #cfd8dc", borderRadius: 1 }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <Box component="thead" sx={{ bgcolor: "#f5f7f8" }}>
              <Box component="tr">
                <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid #cfd8dc", fontWeight: 600 }}>Saved</Box>
                <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid #cfd8dc", fontWeight: 600 }}>From</Box>
                <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid #cfd8dc", fontWeight: 600 }}>Company</Box>
                <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid #cfd8dc", fontWeight: 600 }}>Title</Box>
                <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid #cfd8dc", fontWeight: 600 }}>Docs</Box>
                <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid #cfd8dc", fontWeight: 600 }}>Actions</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {items.map((row) => {
                const pos = row.positions || {};
                const dateLabel = row.auto_saved_at ? new Date(row.auto_saved_at).toLocaleString() : "—";
                return (
                  <Box component="tr" key={row.id} sx={{ "&:hover": { bgcolor: "#fafbfc" } }}>
                    <Box component="td" sx={{ p: 1, borderBottom: "1px solid #eceff1", whiteSpace: "nowrap" }}>{dateLabel}</Box>
                    <Box component="td" sx={{ p: 1, borderBottom: "1px solid #eceff1" }}>{originName(row) || "—"}</Box>
                    <Box component="td" sx={{ p: 1, borderBottom: "1px solid #eceff1" }}>{pos.company || "—"}</Box>
                    <Box component="td" sx={{ p: 1, borderBottom: "1px solid #eceff1" }}>{pos.title || "—"}</Box>
                    <Box component="td" sx={{ p: 1, borderBottom: "1px solid #eceff1", whiteSpace: "nowrap" }}>
                      <Button size="small" onClick={() => handleDownloadResume(row)} disabled={!resumeFor(row)} sx={{ textTransform: "none", minWidth: 0, px: 0.75 }}>Résumé</Button>
                      <Button size="small" onClick={() => handleDownloadCover(row)} disabled={!coverFor(row)} sx={{ textTransform: "none", minWidth: 0, px: 0.75 }}>Cover</Button>
                    </Box>
                    <Box component="td" sx={{ p: 1, borderBottom: "1px solid #eceff1", whiteSpace: "nowrap" }}>
                      <Button
                        size="small"
                        variant={row.auto_apply_opened_at ? "outlined" : "contained"}
                        color={row.auto_apply_opened_at ? "success" : "primary"}
                        onClick={() => handleApply(row)}
                        disabled={busyId === row.id || !pos.url}
                        sx={{ textTransform: "none", py: 0.25, px: 1, fontSize: "0.75rem" }}
                      >
                        {row.auto_apply_opened_at ? "Re-open" : "Apply"}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => handleRemove(row)}
                        disabled={busyId === row.id}
                        sx={{ textTransform: "none", py: 0.25, px: 1, fontSize: "0.75rem", minWidth: 0, ml: 0.5 }}
                      >
                        Remove
                      </Button>
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
