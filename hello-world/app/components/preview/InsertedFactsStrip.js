"use client";

import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import UndoIcon from "@mui/icons-material/Undo";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import CoverFactSmoothConfirm from "./CoverFactSmoothConfirm";

const SMOOTH_DISABLED_NOTE_ID = "inserted-facts-smooth-note";
// ChatPanel's ANSWER_AS_ME_NOTE wording for the same embedded-engine gate.
const SMOOTH_DISABLED_NOTE = "Smoothing applies to the AI engine. Switch to Gemini in the top bar.";

// N61 -- the cover letter's inserted-fact review strip: the owner's "I
// should be able to remove any of the facts with a simple click." One row
// per fact currently in the letter, each with its OWN one-click Remove
// control -- no confirm, no mode switch (AC-N61.14/.15). Removal only ever
// REDUCES what reaches an employer, so a confirmation dialog would guard the
// wrong direction, not the right one.
//
// A fact's source link is rendered only when `safeExternalHref` accepts its
// url -- a refused or grounding-redirect url renders no link at all, the
// same rule CompanyResearchDialog's own ArticleLinkButton applies (AC-N61.10).
//
// No Tooltip wrapper on the Remove control: MUI's Tooltip can steal a
// child's own accessible name, and this control's aria-label IS the
// reachability contract removal's render-and-click tests key on.
//
// N92 Wave 1 (Control A): a back and a forward move control per row, same
// no-Tooltip rule. `movability` is a `{[factId]: {forward, backward}}` map
// the caller pre-computes (via `planMoveFact`'s own `changed` flag) so a
// control at a boundary is DISABLED before the click, never a live-looking
// arrow that silently no-ops (AC-A6) -- the caller knows the letter's lines
// and every fact's slot; this component only renders what it is told.
//
// N92 Wave 3 (Control B): a "Smooth" control per row, disabled (never
// hidden -- the reason must stay visible, AC-B9/X2) when `smoothDisabled` --
// the caller passes `engine === "embedded"`. `pendingSmooth` is at most ONE
// `{factId, candidate}` at a time (CONFIRM-BEFORE-PERSIST) -- its before/
// after confirm surface renders directly under the fact row it belongs to.
//
// N94: a disabled Smooth control states WHY, the way ChatPanel's N102 "Answer
// as me" switch does for the same embedded engine -- one visible note for the
// strip (not one per row, not a hover-only title: a disabled MUI button takes
// no pointer events, so a title on it would never show) and an
// aria-describedby on each disabled Smooth control pointing at it. Never a
// Tooltip, for the no-Tooltip reason above; the control's aria-label is
// untouched.
//
// N93 (AC-B6): a post-apply "Undo" control per row, shown only once that
// fact has an applied smoothing stashed by the caller (`smoothApplied`, a
// `{[factId]: true}` map) -- never before Apply, never once the stash has
// been cleared (used, or invalidated by a later move/remove/smooth of that
// same fact). Same no-Tooltip rule: the aria-label IS the reachability
// contract these controls are keyed on.
//
// N95: `busyFactId` is the ONE fact (if any) with a move or a smooth-produce
// in flight -- its whole row is `aria-busy` and every control on it is
// disabled, independent of `movability` (which legitimately recomputes under
// optimistic MOVE). `smoothingFactId` is the narrower "specifically a smooth
// produce" case, which additionally swaps the Smooth icon for an aria-hidden
// spinner (the produce is the longest wait in the feature, with nothing to
// show optimistically -- unlike MOVE, whose shift is already on screen).
export default function InsertedFactsStrip({
  facts = [],
  onRemove,
  onMove,
  movability = {},
  onSmooth,
  smoothDisabled = false,
  pendingSmooth = null,
  onApplySmooth,
  onDiscardSmooth,
  smoothApplied = {},
  onUndoSmooth,
  busyFactId = null,
  smoothingFactId = null,
  applyPending = false,
  error = "",
}) {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length === 0) return null;
  return (
    <Box sx={{ px: { xs: 1.25, sm: 2 }, py: 1, borderBottom: "1px solid var(--border)", bgcolor: "var(--accent-soft)" }}>
      <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", mb: 0.5 }}>
        Added from research
      </Box>
      {smoothDisabled ? (
        <Box id={SMOOTH_DISABLED_NOTE_ID} sx={{ fontSize: "0.7rem", color: "var(--text-muted)", mb: 0.5 }}>
          {SMOOTH_DISABLED_NOTE}
        </Box>
      ) : null}
      {error ? (
        <Box role="alert" sx={{ fontSize: "0.8rem", color: "var(--danger)", mb: 0.5 }}>
          {error}
        </Box>
      ) : null}
      {list.map((fact) => {
        const href = safeExternalHref(fact?.url);
        const busy = busyFactId === fact.id;
        const smoothing = smoothingFactId === fact.id;
        return (
          <Box key={fact.id} aria-busy={busy ? "true" : undefined}>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mb: 0.5 }}>
              <Box sx={{ flex: 1, fontSize: "0.8rem" }}>
                {fact.title || fact.text}
                {href ? (
                  <IconButton size="small" component="a" href={href} target="_blank" rel="noopener noreferrer" aria-label="Open the source article" sx={{ p: 0.25, ml: 0.5 }}>
                    <OpenInNewIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                ) : null}
              </Box>
              <IconButton
                size="small"
                aria-label="Move this fact one sentence earlier"
                disabled={busy || !movability[fact.id]?.backward}
                onClick={() => onMove?.(fact.id, "backward")}
                sx={{ p: 0.25 }}
              >
                <ArrowBackIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Move this fact one sentence later"
                disabled={busy || !movability[fact.id]?.forward}
                onClick={() => onMove?.(fact.id, "forward")}
                sx={{ p: 0.25 }}
              >
                <ArrowForwardIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Smooth the transition into this fact"
                aria-describedby={smoothDisabled ? SMOOTH_DISABLED_NOTE_ID : undefined}
                disabled={busy || smoothDisabled}
                onClick={() => onSmooth?.(fact.id)}
                sx={{ p: 0.25 }}
              >
                {smoothing ? (
                  <CircularProgress size={16} aria-hidden="true" sx={{ color: "currentColor" }} />
                ) : (
                  <AutoFixHighIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
              {smoothApplied?.[fact.id] ? (
                <IconButton
                  size="small"
                  aria-label="Undo the smoothing"
                  disabled={busy}
                  onClick={() => onUndoSmooth?.(fact.id)}
                  sx={{ p: 0.25 }}
                >
                  <UndoIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ) : null}
              <IconButton size="small" aria-label="Remove this fact" disabled={busy} onClick={() => onRemove?.(fact.id)} sx={{ p: 0.25 }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
            {pendingSmooth && pendingSmooth.factId === fact.id ? (
              <CoverFactSmoothConfirm
                candidate={pendingSmooth.candidate}
                pending={applyPending}
                onApply={() => onApplySmooth?.(fact.id)}
                onDiscard={() => onDiscardSmooth?.(fact.id)}
              />
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
