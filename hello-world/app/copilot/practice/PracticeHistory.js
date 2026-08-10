"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  LIST_LIMIT,
  deletePracticeAnswer,
  listPracticeAnswers,
  signedVideoUrl,
} from "@/lib/supabase/practiceAnswers";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "../mobileSx";

function fmtDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function postingLabel(row) {
  const title = row?.posting_title || "";
  const company = row?.posting_company || "";
  if (title && company) return `${title} — ${company}`;
  return title || company || "";
}

function scoreLabel(critique) {
  const score = critique && typeof critique === "object" ? Number(critique.score) : NaN;
  return Number.isFinite(score) ? `Score: ${Math.round(score)}/100` : "";
}

// One saved answer's row: replay and delete are both scoped locally so
// fetching a signed URL, or deleting, one row never touches any other.
function HistoryRow({ row, onDeleted }) {
  // idle | loading | ready | error | none
  const [video, setVideo] = useState({ status: "idle", url: "", error: "" });
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Signed URL is minted only when Replay is actually pressed (AC-D1-5) —
  // never at list time, so opening the history never mints a URL per row.
  const onReplay = useCallback(async () => {
    if (!row.video_path) {
      setVideo({ status: "none", url: "", error: "" });
      return;
    }
    setVideo({ status: "loading", url: "", error: "" });
    const { data, error } = await signedVideoUrl(row.video_path);
    if (error || !data) {
      setVideo({ status: "error", url: "", error: error || "Could not load this recording." });
      return;
    }
    setVideo({ status: "ready", url: data, error: "" });
  }, [row.video_path]);

  // deletePracticeAnswer either fully succeeds or leaves the entry
  // untouched (BUG-1) — there is no partial-success case anymore, so `error`
  // is the whole story: only drop the row from the list once it's actually
  // confirmed gone.
  const onDelete = useCallback(async () => {
    setDeleting(true);
    setDeleteError("");
    const { error } = await deletePracticeAnswer(row.id);
    setDeleting(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    onDeleted(row.id);
  }, [row.id, onDeleted]);

  const meta = [postingLabel(row), fmtDate(row.created_at), fmtDuration(row.duration_ms)]
    .filter(Boolean)
    .join(" · ");
  const score = scoreLabel(row.critique);

  return (
    <Box sx={{ py: 1.5 }}>
      <Typography
        variant="body1"
        sx={{ fontWeight: 600, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
      >
        {row.question || "Untitled question"}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-muted)", ...BREAK_LONG_WORDS_SX }}>
        {[meta, score].filter(Boolean).join(" · ")}
      </Typography>

      <Stack direction="row" useFlexGap sx={{ mt: 1, alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
        {row.video_path ? (
          <Button
            size="small"
            variant="outlined"
            onClick={onReplay}
            disabled={video.status === "loading"}
            sx={TOUCH_TARGET_SX}
          >
            {video.status === "loading" ? "Loading…" : "Replay"}
          </Button>
        ) : (
          <Typography variant="caption" sx={{ color: "var(--text-muted)" }}>
            No recording was saved for this answer.
          </Typography>
        )}

        {!confirming ? (
          <Button
            size="small"
            color="error"
            variant="text"
            onClick={() => setConfirming(true)}
            sx={TOUCH_TARGET_SX}
          >
            Delete
          </Button>
        ) : (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { xs: "stretch", sm: "center" }, width: { xs: "100%", sm: "auto" } }}
          >
            {/* BUG-12: worded to match what's ACTUALLY being deleted — a row
                with no video is not "a recording", and claiming otherwise
                overstates what the user is about to lose. */}
            <Typography variant="caption" sx={{ color: "var(--danger)" }}>
              {row.video_path
                ? "Delete this recording? This cannot be undone."
                : "Delete this history entry — its transcript, metrics and critique? This cannot be undone."}
            </Typography>
            <Button
              size="small"
              color="error"
              variant="contained"
              onClick={onDelete}
              disabled={deleting}
              sx={{ ...TOUCH_TARGET_SX, width: { xs: "100%", sm: "auto" } }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              sx={{ ...TOUCH_TARGET_SX, width: { xs: "100%", sm: "auto" } }}
            >
              Cancel
            </Button>
          </Stack>
        )}
      </Stack>

      {video.status === "error" ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {video.error}
        </Alert>
      ) : null}
      {video.status === "none" ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          No recording is saved for this answer.
        </Alert>
      ) : null}
      {video.status === "ready" ? (
        <Box
          component="video"
          controls
          src={video.url}
          sx={{
            display: "block",
            width: "100%",
            maxHeight: { xs: "50vh", md: 320 },
            borderRadius: "8px",
            mt: 1,
          }}
        />
      ) : null}
      {deleteError ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {deleteError}
        </Alert>
      ) : null}
    </Box>
  );
}

// D1's history list: the user's saved practice answers, replayable and
// deletable. Reads through lib/supabase/practiceAnswers — see that module
// for the save/list/replay/delete contract this renders; this component
// owns only presentation and per-row interaction state.
//
// `refreshSignal` is any value that changes whenever PracticeClient saves a
// new answer in the CURRENT session — the effect below reloads whenever it
// changes (in addition to on mount), since there is no other way for this
// component to learn a new row now exists.
export default function PracticeHistory({ refreshSignal }) {
  const [rows, setRows] = useState(null); // null until the first load settles
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  // BUG-5: a monotonic generation, bumped at the start of every load AND on
  // every delete — a load's response is only applied if it's still current
  // when it lands. Without this, `setRows(data || [])` overwriting the list
  // wholesale meant a delete that completed WHILE an earlier reload was
  // still in flight got silently reverted the moment that stale reload
  // landed: the just-deleted row would reappear until the next refresh.
  const loadGenRef = useRef(0);

  // Fetches inline in the effect (mirroring PostingPicker's own load-on-mount
  // shape) rather than through a separately memoized function called from
  // inside the effect — a captured setState-calling function invoked
  // synchronously from an effect body is exactly the "cascading renders"
  // pattern this repo's lint config flags, so every setState call below
  // lives inside a `.then`/`.catch`/`.finally` callback, never directly in
  // the effect's own top-level body. `loading` therefore only ever reflects
  // the FIRST load (it starts `true` and .finally only ever turns it off) —
  // a refreshSignal-triggered reload updates the list in place without a
  // spinner, since rows already has content to show meanwhile. BUG-4: on a
  // load failure, `rows`/`truncated` are left exactly as they were — a
  // failed REFRESH must not blank out an already-rendered history, only the
  // render logic below (comparing `error` against `rows === null`) decides
  // whether that makes this a full error state or a small non-destructive
  // notice on top of the still-good list.
  useEffect(() => {
    const gen = (loadGenRef.current += 1);
    listPracticeAnswers()
      .then(({ data, error: loadError, truncated: wasTruncated }) => {
        if (loadGenRef.current !== gen) return;
        if (loadError) {
          setError(loadError);
          return;
        }
        setError("");
        setRows(data || []);
        setTruncated(!!wasTruncated);
      })
      .catch((err) => {
        if (loadGenRef.current === gen) setError(err?.message || "Could not load your practice history.");
      })
      .finally(() => {
        if (loadGenRef.current === gen) setLoading(false);
      });
    return () => {
      // Re-running (refreshSignal changed) or unmounting — either way, a
      // response for THIS run that lands after must not overwrite whatever
      // comes next (or nothing, on unmount).
      loadGenRef.current += 1;
    };
  }, [refreshSignal]);

  // Removes the row from the list the moment it's actually confirmed gone
  // (deletePracticeAnswer either fully succeeds or leaves the row alone —
  // BUG-1 — so reaching here means it's really gone) and invalidates any
  // load still in flight (BUG-5) so that stale response can't resurrect the
  // row this just removed when it eventually lands.
  const onRowDeleted = useCallback((id) => {
    loadGenRef.current += 1;
    setRows((prev) => (prev || []).filter((r) => r.id !== id));
  }, []);

  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
        mb: 2,
      }}
    >
      {/* F10: one level under the tab's h2 (TabHeader.js), same as this
          tab's other top-level panel titles. `component=` changes only the
          rendered element, never the `variant` that governs how this
          looks. */}
      <Typography variant="h6" component="h3" sx={{ fontWeight: 600, color: "var(--text-primary)", mb: 1.5 }}>
        Practice history
      </Typography>

      {/* BUG-13: the list is capped (LIST_LIMIT in practiceAnswers.js) —
          past it, older entries, and the storage objects they point at,
          become invisible and therefore undeletable from this screen with
          no other indication why. Kept visible (not dismissible) for as
          long as it's true, rather than a one-off notice that could be
          closed and forgotten. */}
      {truncated ? (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Showing your most recent {LIST_LIMIT} saved answers. Older ones are not listed here.
        </Alert>
      ) : null}

      {/* BUG-4: only a FAILED FIRST load (rows still null) replaces the
          whole panel with an error — a failed refresh (rows already
          populated from an earlier success) instead keeps showing those
          rows, with the failure surfaced as a non-destructive notice below,
          so an already-rendered history never appears to vanish. */}
      {loading && rows === null ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", py: 1 }}>
          <CircularProgress size={20} />
          <Typography sx={{ color: "var(--text-muted)" }}>Loading your practice history…</Typography>
        </Stack>
      ) : error && rows === null ? (
        <Alert severity="error">Your practice history could not be loaded. {error}</Alert>
      ) : rows && rows.length === 0 ? (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          You have no saved practice answers yet.
        </Typography>
      ) : rows ? (
        <Box>
          {error ? (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Your practice history could not be refreshed — showing the last successful load. {error}
            </Alert>
          ) : null}
          {rows.map((row, i) => (
            <Box key={row.id}>
              {i > 0 ? <Divider sx={{ borderColor: "var(--border)" }} /> : null}
              <HistoryRow row={row} onDeleted={onRowDeleted} />
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
