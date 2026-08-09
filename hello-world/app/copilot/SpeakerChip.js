"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";

// AC-M1.5 requirement 2: the transcript's per-turn speaker chip, and — once
// an in-person session offers a correction — the control that fixes it.
// TranscriptView.js decides *whether* correction is offered at all: its
// tab/system rendering path never imports this file, so that mode's
// byte-identical <Chip> output can never regress through here. This
// component only decides how the chip LOOKS, and, when `onActivate` is
// supplied, how it BEHAVES.
//
// `resolved` distinguishes a real label ("You" / "Them" / "Speaker 2") from
// the explicit "Unknown speaker" placeholder — AC-M1.5 requirement 1: a
// label must never fall back to "You" just because it is not resolved yet.
//
// `onActivate` remains the Chip-vs-button gate exactly as before: falsy
// renders the plain <Chip>, a function renders the real <button>. That is
// load-bearing for CopilotClient.js's own always-visible speaker bar (a
// second caller of this component) — it deliberately passes
// `onActivate: null` for its already-resolved "You" chip specifically to
// get the non-interactive <Chip> back, see the comment at that call site.
// This pass does not touch that file, so that contract is preserved as-is.
//
// `disabled` is new and orthogonal to the Chip/button choice: it lets a
// caller keep rendering the real <button> for a row that is not currently
// actionable, instead of falling back to `onActivate: null` (which would
// swap it for a <Chip> and drop the element — see BUG-2 below). Only
// meaningful when `onActivate` is truthy; ignored otherwise.
export default function SpeakerChip({ label, resolved, isYou, onActivate, disabled }) {
  const palette = !resolved
    ? {
        // Not yet resolved: a neutral, dashed treatment that reads as
        // "pending" without leaning on color alone — the text itself
        // already says "Unknown speaker".
        color: "var(--text-secondary)",
        background: "transparent",
        border: "1px dashed var(--border)",
      }
    : isYou
    ? {
        // Same soft/neutral treatment HEAD gives "You".
        color: "var(--text-secondary)",
        background: "var(--bg-soft)",
        border: "1px solid var(--border)",
      }
    : {
        // Same accent treatment HEAD gives "Them" — reused for any other
        // resolved, non-user voice ("Them" or a numbered "Speaker N").
        color: "var(--accent-contrast)",
        background: "var(--accent)",
        border: "none",
      };

  const baseSx = {
    height: 20,
    fontSize: 11,
    fontWeight: 700,
    ...palette,
  };

  if (!onActivate) {
    return <Chip size="small" label={label} sx={baseSx} />;
  }

  // BUG-2 (adversarial review): this component used to have only two
  // states — `onActivate` falsy renders <Chip>, `onActivate` a function
  // renders <Box component="button">. A caller (TranscriptView) would null
  // out `onActivate` the instant a row resolved to "You", including the
  // very row a correction just landed on. Applying the correction therefore
  // unmounted the <button> the user was standing on and mounted a <Chip> in
  // its place at the same tree position — `document.activeElement` falls
  // back to <body>, so a keyboard-only user who tabs to "Mark Them as me"
  // and presses Enter has their focus silently reset to the top of the
  // document at the exact moment every label in the transcript changes
  // underneath them.
  //
  // Fix: element type no longer depends on whether THIS row is actionable
  // right now, only on whether the caller says it could ever be (a truthy
  // `onActivate`). TranscriptView now keeps `onActivate` a real function for
  // any row it could ever offer a correction on, and flags the momentarily
  // not-actionable ones (already "You") with `disabled` instead — so the
  // <button> this returns is the same element for the whole lifetime of
  // such a row; only its disabled-ness changes, never its type.
  //
  // `aria-disabled`, not the native `disabled` attribute: a `disabled`
  // button drops out of the tab order and stops being focusable in most
  // browsers, which reproduces the same focus-loss bug by a different
  // route the instant a click disables it. `aria-disabled` plus an inert
  // click handler keeps the node focusable and tabbable — screen readers
  // still announce it as unavailable — so both the element and the user's
  // focus position survive every correction.
  return (
    <Box
      component="button"
      type="button"
      onClick={disabled ? handleInertClick : onActivate}
      aria-disabled={disabled || undefined}
      aria-label={`Mark ${label} as me`}
      sx={{
        ...baseSx,
        display: "inline-flex",
        alignItems: "center",
        lineHeight: "20px",
        px: 1,
        py: 0,
        borderRadius: "10px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.65 : 1,
        fontFamily: "inherit",
        "&:focus-visible": {
          outline: "2px solid var(--accent)",
          outlineOffset: "2px",
        },
      }}
    >
      {label}
    </Box>
  );
}

// BUG-2: an explicit no-op rather than an omitted onClick, so a disabled
// row's button is inert by a deliberate handler rather than by accident of
// what happens to be falsy.
function handleInertClick(event) {
  event.preventDefault();
}
