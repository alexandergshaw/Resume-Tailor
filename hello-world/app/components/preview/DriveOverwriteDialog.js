"use client";

import { useId, useLayoutEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import {
  overwriteHeading,
  overwriteBody,
  saveAsNewDocLabel,
  overwriteDocLabel,
  DRIVE_OVERWRITE_DISMISS_LABEL,
} from "@/lib/drive/driveMessages";

/**
 * The foreign-edit conflict prompt (`UX.md` rev 2 §5, `AC.md` AC-S15/S16/
 * S18/S19, AC-A8) — the riskiest element in the Drive feature, because it
 * interrupts a deliberately one-click flow. Every rule below exists to keep
 * it from becoming a wizard and to make every dismissal route fail safe.
 *
 * INLINE, NOT a nested MUI `Dialog`. The repo's only confirm idiom is
 * `window.confirm` (which can't express three named actions), and a MUI
 * `Dialog` stacked on the `fullScreen` preview `Dialog` would create two
 * close affordances and two Escape owners (`UX.md` §5.3). This is a plain
 * `Box`, rendered by the caller (`DriveResultRegion`) inside the strip, in
 * the same slot the strip already occupies above `DialogActions`.
 *
 * COPY NOTE: the sentences below are verbatim from `UX.md` rev 2 §5.3, and
 * -- like every other Drive string in this feature -- they live in exactly
 * one place: `lib/drive/driveMessages.js` (`overwriteHeading`,
 * `overwriteBody`, `saveAsNewDocLabel`, `overwriteDocLabel`,
 * `DRIVE_OVERWRITE_DISMISS_LABEL`). This component only calls those
 * exports; it does not recompute or duplicate the wording.
 *
 * AC-S17 (the shared-Doc caption on "Save as a new Doc") is deliberately
 * NOT implemented here: `UX.md` never gives it verbatim copy (only a
 * paraphrase — "states that people it is shared with will keep seeing the
 * old Doc"), and no wave before this one has landed a way to know a Doc's
 * sharing state. Inventing wording for a criterion the design document
 * itself left unworded would violate "take the copy verbatim rather than
 * improvising." Flagged in the wave report rather than guessed at.
 */

// Touch targets for every action, not just some: 44px at `xs`, never
// `size="small"` (MUI small is 30px) — AC-M3. Units are explicit strings,
// never bare numbers, which `sx` reinterprets as multipliers/fractions
// (the repo's own recorded scar, `lib/copilot/answerStatus.js:69-80`).
const TOUCH_SX = { minHeight: { xs: "44px", sm: "36px" }, textTransform: "none" };

/**
 * @param {object} props
 * @param {string[]} props.docNames - the display name(s) of the conflicted
 *   Doc(s), 1 for a single-scope conflict or 2 for "both documents
 *   conflicted (one prompt, never two)" (`UX.md` §5.3/§5.7).
 * @param {() => void} props.onSaveAsNew - "Save as a new Doc[s]" — the safe,
 *   first-in-DOM-order action.
 * @param {() => void} props.onOverwrite - "Overwrite the Doc[s]" — the only
 *   destructive action in this feature.
 * @param {() => void} props.onDismiss - "Not now" AND Escape (both routes
 *   call this prop; see `handleKeyDown` below). Every caller of this prop
 *   must write NOTHING to Drive — the prompt fails safe by construction
 *   (`UX.md` §5.6).
 */
export default function DriveOverwriteDialog({ docNames, onSaveAsNew, onOverwrite, onDismiss }) {
  const containerRef = useRef(null);
  const headingId = useId();
  const bodyId = useId();
  // Focus lands on the prompt's CONTAINER — never a button — the instant it
  // mounts. "One prompt per activation" (UX.md §5.7) means this component
  // must be freshly MOUNTED for each conflict, so mount-time focus is the
  // only time this ever needs to run; it deliberately does not re-fire on
  // every render. That premise is enforced by the CALLER, not here:
  // `DriveResultRegion` renders this component with a `key` derived from the
  // conflict's own identity (WAVE3-SEAMS.md BLOCKER B3), so React tears down
  // and remounts this component — running this effect again — rather than
  // reconciling a second, different conflict into the same node. Without
  // that `key`, this effect would silently NOT re-run for conflict #2, and
  // this component's whole "freshly mounted" premise would be false; this
  // component cannot enforce that on its own; it can only rely on it.
  // Landing focus on a button here would let a keypress the user already had
  // in flight (an Enter aimed at the Save control moments earlier) land on
  // "Overwrite" instead — the exact hazard this prompt exists to prevent
  // (`UX.md` §5.4).
  //
  // UNMOUNT MID-DECISION (WAVE3-SEAMS.md, the route B3's fix left untested):
  // this prompt can disappear without the user ever choosing one of its
  // three actions -- the caller drops `prompt` via some route other than
  // this component's own buttons/Escape (a whole-modal close, for
  // instance). Nothing is written in that case (this component only ever
  // writes to Drive from its own button handlers), but without the cleanup
  // below, React removing the focused container from the DOM lets the
  // browser's own default kick in and focus falls to `<body>`, stranding a
  // keyboard user with no visible indication of where focus went. So this
  // effect also captures whatever had focus immediately before the mount-
  // time `.focus()` call above, and restores it on unmount -- but only if
  // focus is STILL inside this prompt at that point (if the user already
  // moved focus elsewhere themselves before this prompt closed, this must
  // not yank it back).
  //
  // `useLayoutEffect`, not `useEffect`, is load-bearing here: React runs a
  // layout effect's cleanup synchronously, as part of tearing down this
  // fiber, BEFORE the DOM node is actually detached (that ordering is also
  // what lets a cleanup still read a ref's `.current` at all) -- so
  // `document.activeElement` in the cleanup below is still whatever it was
  // the instant before unmount, not yet reset to `<body>` by the browser's
  // own "focused node removed" behaviour. A passive `useEffect` cleanup
  // runs later, after the node is already gone, by which point the browser
  // has already moved focus to `<body>` and this check could never fire.
  useLayoutEffect(() => {
    // Copied into a local, not read as `containerRef.current` inside the
    // cleanup below: by the time an unmount's cleanup runs, a ref set by
    // React on this same fiber may already have been cleared, even though
    // the DOM node itself hasn't been detached yet (see the ordering note
    // above) -- so the cleanup must close over the NODE, not the ref.
    const node = containerRef.current;
    const previouslyFocused = document.activeElement;
    node?.focus();
    return () => {
      if (
        node &&
        document.activeElement === node &&
        previouslyFocused &&
        previouslyFocused !== node &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // MUI's `Modal` attaches its OWN Escape handler to the modal ROOT, an
  // ANCESTOR of this prompt. Without stopPropagation, Escape here bubbles up
  // and closes the entire preview dialog instead of just this prompt
  // (`UX.md` §5.6, AC-S16). Escape is otherwise identical to "Not now": it
  // writes nothing and calls the same dismissal callback.
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onDismiss?.();
    }
  };

  const heading = overwriteHeading(docNames);
  const body = overwriteBody(docNames);
  const saveAsNewLabel = saveAsNewDocLabel(docNames);
  const overwriteLabel = overwriteDocLabel(docNames);

  return (
    <Box
      ref={containerRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={headingId}
      aria-describedby={bodyId}
      onKeyDown={handleKeyDown}
      sx={{
        mt: 1,
        p: 1.5,
        borderRadius: 1,
        bgcolor: "var(--warning-soft)",
      }}
    >
      <Box id={headingId} sx={{ color: "var(--warning)", fontWeight: 600, fontSize: "0.85rem" }}>
        {heading}
      </Box>
      {/* aria-describedby is load-bearing, not decoration: a focused
          role="group" announces its LABEL only, so without this id the one
          sentence that makes the choice comprehensible never reaches a
          screen-reader user (UX.md §5.4, M-15). */}
      <Box id={bodyId} sx={{ mt: 0.5, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
        {body}
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.25 }}>
        {/* Order matters and is part of the design, not incidental markup:
            the safe option is FIRST so Tab reaches it before either action
            that writes to Drive (UX.md §5.4). Do not reorder these three —
            this is the UX's own safe-first-in-DOM-order requirement, a
            different thing from AC-S18's prose listing (which names
            Overwrite before Save-as-new and is explicitly NOT a DOM-order
            requirement, per UX.md §12 note 6). */}
        <Button variant="outlined" onClick={onSaveAsNew} sx={TOUCH_SX}>
          {saveAsNewLabel}
        </Button>
        <Button variant="text" color="error" onClick={onOverwrite} sx={TOUCH_SX}>
          {overwriteLabel}
        </Button>
        {/* The third action, deliberately NOT one of AC-S18's original "two
            actions": with only two, both of which write to Drive, a touch
            user (no keyboard, so no Escape) would have no way to decline
            (UX.md §5.4, AC-S16). Every dismissal route -- this button,
            Escape, and (by the caller unmounting this component) Close or a
            backdrop click -- writes nothing. */}
        <Button variant="text" onClick={onDismiss} sx={{ ...TOUCH_SX, color: "var(--text-muted)" }}>
          {DRIVE_OVERWRITE_DISMISS_LABEL}
        </Button>
      </Box>
    </Box>
  );
}
