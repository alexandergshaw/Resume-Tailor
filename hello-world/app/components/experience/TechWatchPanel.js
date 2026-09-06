"use client";

import { useEffect, useId, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { bucketByHour, summarize, formatHourLabel } from "@/lib/techwatch/hourBuckets.js";
import { formatRelative } from "@/lib/feed/liveFeedClient.js";
// Mocked by TechWatchPanel.test.js via `vi.mock("../../hooks/useTechWatch", ...)` -
// kept as this EXACT relative path (not the "@/" alias used for the lib
// imports above) so this import and that mock resolve to the same module id.
import { useTechWatch } from "../../hooks/useTechWatch";
import TechWatchItemCard from "./TechWatchItemCard.js";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// The Tech Watch briefing panel - AC-9. Placed in ExperienceTab AFTER
// <BulkActionsBar>, outside the `pages.length === 0` branch (that wiring is a
// LATER agent's file/gate, not this one's).
//
// `now` is an optional Date, defaulting to `new Date()`, threaded to
// bucketByHour/formatHourLabel and - as `now.getTime()`, NEVER the Date
// itself - to formatRelative, which takes epoch milliseconds and silently
// degrades to a bare locale date on a NaN diff (see useTechWatch.test.js's
// own comment on the same trap).

const EXPANDED_STORAGE_KEY = "techwatch:expanded";
// This panel owns ONLY this key. useTechWatch owns "techwatch:windowHours" -
// if both persisted the window choice, they would race for it on mount.
const ANNOUNCE_TOGGLE = String.fromCodePoint(0x200b);
const REFRESH_CAPTION_ID = "techwatch-refresh-caption";
const DISABLED_LOOK_SX = { opacity: 0.38, cursor: "default" };
const WINDOW_OPTIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

function readStoredExpanded() {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeStoredExpanded(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Not worth surfacing - the in-memory choice still holds for this visit.
  }
}

// "2022-03-29" -> "29 Mar 2022". Every date field endoflife.date's lifecycle
// rows carry is a bare YYYY-MM-DD string, never a datetime - parsed as UTC
// midnight so the calendar day itself never shifts under a viewer west of
// Greenwich.
function formatBareDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
  } catch {
    return "";
  }
}

function daysUntil(dateStr, now) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - now.getTime()) / 86400000);
}

// The words a lifecycle row is flagged with - AC-9: "in words, never colour
// alone", and a `supported` row (or one the user's own pages never named a
// version of) must render nothing here at all. Two cases:
//   - already out of support and IN USE: state the fact and since when.
//   - still supported but its own end is within 180 days and IN USE: give
//     the user time to act, which is the whole reason the support table
//     exists separately from the (window-limited) timeline above it.
function lifecycleNote(row, now) {
  if (row.inUse && row.state !== "supported") {
    const isUnsupported = row.state === "unsupported";
    const dateStr = isUnsupported ? row.eolAt : row.supportEndsAt;
    const formatted = formatBareDate(dateStr);
    const label = isUnsupported ? "no longer supported" : "out of active support";
    return formatted ? `${label} since ${formatted}` : label;
  }
  if (row.inUse && row.eolAt) {
    const days = daysUntil(row.eolAt, now);
    if (days !== null && days >= 0 && days <= 180) {
      return `support ends ${formatBareDate(row.eolAt)} (${days} day${days === 1 ? "" : "s"})`;
    }
  }
  return "";
}

export default function TechWatchPanel({ now = new Date() }) {
  const { data, loading, error, signedOut, lastLoadedAt, lifecycleGaps, windowHours, setWindowHours, reload } =
    useTechWatch();

  const headingId = useId();
  const [expanded, setExpanded] = useState(() => readStoredExpanded());
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      writeStoredExpanded(next);
      return next;
    });
  }

  // Keyed on `lastLoadedAt` ALONE, never on `data`'s identity - AC-9's trap
  // #4. Two consecutive refreshes reporting the same item count are still
  // two distinct events; React bails out of a setState whose new value is
  // Object.is-equal to the old one, so `seq` (always bumped) plus the
  // odd-seq ZWSP toggle is what makes the rendered live-region TEXT itself
  // genuinely differ between them, the same idiom ExperienceTab.js and
  // PageEditor.js already use for their own status regions.
  useEffect(() => {
    if (!lastLoadedAt) return;
    const count = (data?.items || []).length;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnnouncement((prev) => ({
      text: `Briefing updated — ${count} item${count === 1 ? "" : "s"}`,
      seq: prev.seq + 1,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLoadedAt]);

  // AC-9: signed out renders NOTHING at all, not an error the user cannot
  // act on. Every hook above still ran unconditionally (rules of hooks) -
  // this is the only place execution actually stops.
  if (signedOut) return null;

  const safeData = data || { items: [], lifecycle: [], sources: [], watchlist: { entries: [], usedDefaults: false, truncated: false } };
  const items = Array.isArray(safeData.items) ? safeData.items : [];
  const lifecycle = Array.isArray(safeData.lifecycle) ? safeData.lifecycle : [];
  const sources = Array.isArray(safeData.sources) ? safeData.sources : [];
  const watchlist = safeData.watchlist || { entries: [], usedDefaults: false, truncated: false };

  const summary = summarize(items);
  const buckets = bucketByHour(items, { now, windowHours });
  const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const failedSources = sources.filter((s) => s && s.ok === false);
  const noteSources = sources.filter((s) => s && s.ok === true && s.note);
  const allSourcesOk = sources.every((s) => s && s.ok !== false);
  const nothingReported = items.length === 0 && allSourcesOk;
  const anyWorkaround = items.some((item) => item && item.workaround);

  // The grounded top-up (AC-4): a technology chunk A could not find a public
  // feed for, filled in by a Google-Search-grounded model call the panel
  // issued itself, well after the briefing above already rendered.
  const safeLifecycleGaps = lifecycleGaps || { rows: [], loading: false, error: "" };
  const aiLifecycleRows = Array.isArray(safeLifecycleGaps.rows) ? safeLifecycleGaps.rows : [];
  const aiCoveredTechnologyIds = new Set(aiLifecycleRows.map((r) => r && r.technologyId));
  const hasGapSources = sources.some((s) => s && s.note === "no lifecycle feed");
  // A gap technology's honest "no lifecycle feed" line disappears the moment
  // an AI row actually answers it - keeping both on screen at once would
  // contradict itself in the same breath. A gap the model could not (or has
  // not yet) answered keeps chunk A's line untouched.
  const visibleNoteSources = noteSources.filter(
    (s) => !(s.note === "no lifecycle feed" && aiCoveredTechnologyIds.has(s.technologyId)),
  );
  // The Support & decommission heading now also earns its place when there
  // is nothing deterministic to show yet but an AI answer is in flight or
  // has landed - AC-4's "never an empty space that later fills in silently".
  const showSupportSection =
    lifecycle.length > 0 || aiLifecycleRows.length > 0 || (hasGapSources && safeLifecycleGaps.loading);

  return (
    <Box
      role="region"
      aria-labelledby={headingId}
      sx={{
        mt: 2,
        p: 1.5,
        border: "1px solid var(--border)",
        borderRadius: 1.5,
        backgroundColor: "var(--bg-soft)",
      }}
    >
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Typography id={headingId} component="h3" sx={{ fontWeight: 700, fontSize: 15, m: 0 }}>
          Tech watch
        </Typography>
        <Button
          onClick={toggleExpanded}
          aria-expanded={expanded}
          size="small"
          sx={{ textTransform: "none" }}
        >
          {expanded ? "Hide" : "Show"} Tech watch
        </Button>
      </Stack>

      {expanded ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            {`${summary.total} item${summary.total === 1 ? "" : "s"} — ${summary.outage} outage${summary.outage === 1 ? "" : "s"}, ${summary.vulnerability} vulnerabilit${summary.vulnerability === 1 ? "y" : "ies"}, ${summary.lifecycle} lifecycle change${summary.lifecycle === 1 ? "" : "s"}`}
            {summary.exploited > 0 ? `, ${summary.exploited} actively exploited` : ""}
            {/* Trailing period is load-bearing: without a non-word character
                after the relative-time text, it butts directly against the
                window-selector buttons in textContent with no whitespace of
                its own, and a test asserting a WORD-BOUNDARY match on
                (e.g.) "5m ago" fails because "ago" and the next button's
                leading digit ("2" of "24 hours") read as one unbroken word. */}
            {` — as of ${formatRelative(lastLoadedAt, now.getTime())}.`}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
            {WINDOW_OPTIONS.map((opt) => (
              <Button
                key={opt.hours}
                variant={windowHours === opt.hours ? "contained" : "outlined"}
                size="small"
                onClick={() => setWindowHours(opt.hours)}
                sx={{ textTransform: "none" }}
              >
                {opt.label}
              </Button>
            ))}
            <Button
              variant="outlined"
              size="small"
              aria-disabled={loading || undefined}
              aria-describedby={loading ? REFRESH_CAPTION_ID : undefined}
              onClick={() => {
                if (loading) return;
                reload();
              }}
              sx={{ textTransform: "none", ...(loading ? DISABLED_LOOK_SX : {}) }}
            >
              Refresh
            </Button>
          </Stack>
          {loading ? (
            <Typography id={REFRESH_CAPTION_ID} sx={{ fontSize: "0.72rem", color: "var(--text-muted)", mt: 0.5 }}>
              Refreshing the briefing…
            </Typography>
          ) : null}

          {error ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {error}
            </Alert>
          ) : null}

          {failedSources.length > 0 ? (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 12.5 }}>Sources we could not reach</Typography>
              {failedSources.map((s) => (
                <Typography key={s.id} sx={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {`${s.label}: could not be reached${s.error ? ` (${s.error})` : ""}.`}
                </Typography>
              ))}
            </Box>
          ) : null}

          {visibleNoteSources.length > 0 ? (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 12.5 }}>Sources with no feed to publish</Typography>
              {visibleNoteSources.map((s) => (
                <Typography key={s.id} sx={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {`${s.label}: ${s.note}`}
                </Typography>
              ))}
            </Box>
          ) : null}

          {watchlist.truncated ? (
            <Typography sx={{ fontSize: 12.5, color: "var(--text-secondary)", mt: 1 }}>
              {`Showing the top ${watchlist.entries.length} technologies detected in your pages; not all were included.`}
            </Typography>
          ) : null}

          {items.length > 0 && !anyWorkaround ? (
            <Typography sx={{ fontSize: 12.5, color: "var(--text-secondary)", mt: 1 }}>
              No source in this briefing publishes workarounds for its items.
            </Typography>
          ) : null}

          <Box sx={{ mt: 1.5 }}>
            {nothingReported ? (
              <Typography variant="body2">Nothing reported in the current window.</Typography>
            ) : (
              <Stack spacing={1.5}>
                {buckets.map((bucket) => (
                  <Box key={bucket.key}>
                    <Typography component="h4" sx={{ fontWeight: 700, fontSize: 13, m: 0, mb: 0.5 }}>
                      {formatHourLabel(bucket, { now, timeZone: viewerTimeZone })}
                    </Typography>
                    <Stack spacing={1}>
                      {bucket.items.map((item) => (
                        <TechWatchItemCard key={item.id} item={item} />
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          {showSupportSection ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography component="h4" sx={{ fontWeight: 700, fontSize: 13.5, m: 0 }}>Support &amp; decommission</Typography>
              <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                {lifecycle.map((row, i) => {
                  const note = lifecycleNote(row, now);
                  return (
                    <Box key={`${row.technologyId}-${row.cycle}-${i}`}>
                      <Typography sx={{ fontWeight: 600, fontSize: 13 }}>
                        {`${row.technology} ${row.cycle}`}
                      </Typography>
                      {note ? (
                        <Typography sx={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{note}</Typography>
                      ) : null}
                    </Box>
                  );
                })}
                {/* AI-sourced rows, after the deterministic ones (AC-4). Every
                    other row in this table is quoted from a primary feed; an
                    identical-looking date here would make the most trustworthy
                    section on screen the least, so each carries a chip AND its
                    citation - never colour alone. */}
                {aiLifecycleRows.map((row, i) => {
                  const note = lifecycleNote(row, now);
                  // The citation is AI-search output: isGroundedHost compares
                  // hostnames with no scheme test, so nothing upstream has
                  // checked this string. Refused -> the citation LINE stays
                  // (an AI-sourced row without its citation would be exactly
                  // the untraceable date AC-4 forbids) but carries no anchor.
                  const citationHref = safeExternalHref(row.citation?.url);
                  return (
                    <Box key={`ai-${row.technologyId}-${row.cycle}-${i}`}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                        <Typography sx={{ fontWeight: 600, fontSize: 13 }}>
                          {`${row.technology} ${row.cycle}`}
                        </Typography>
                        <Chip
                          label="Found by AI search"
                          size="small"
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10.5, borderColor: "var(--border)" }}
                        />
                      </Stack>
                      {note ? (
                        <Typography sx={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{note}</Typography>
                      ) : null}
                      {row.citation?.url ? (
                        <Typography sx={{ fontSize: 12.5 }}>
                          {citationHref ? (
                            <a href={citationHref} target="_blank" rel="noopener noreferrer">
                              {`${row.technology} lifecycle source — ${row.citation.label || citationHref}`}
                            </a>
                          ) : (
                            <Box component="span" sx={{ color: "var(--text-secondary)" }}>
                              {`${row.technology} lifecycle source — not linkable`}
                            </Box>
                          )}
                        </Typography>
                      ) : null}
                    </Box>
                  );
                })}
                {hasGapSources && safeLifecycleGaps.loading ? (
                  <Typography sx={{ fontSize: 12.5, color: "var(--text-secondary)", fontStyle: "italic" }}>
                    Checking for an AI-sourced lifecycle answer for the gaps above…
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Box
        component="span"
        role="status"
        aria-live="polite"
        // "1px" STRINGS, not the bare number `1` - in MUI's `sx`, a numeric
        // width/height <= 1 is a MULTIPLIER ("100%"), not a pixel value (see
        // the MUI sx numeric traps this app has been bitten by before, and
        // ExperienceTab.js's own HIDDEN_STATUS_SX, which uses the same
        // string literals for the same reason). Written as numbers this
        // becomes a 100%x100% `position: absolute` overlay covering the
        // whole panel instead of the 1px sink a visually-hidden live region
        // is meant to be.
        sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}
      >
        {announcement.text}
        {announcement.seq % 2 === 1 ? ANNOUNCE_TOGGLE : ""}
      </Box>
    </Box>
  );
}
