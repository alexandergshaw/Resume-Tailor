"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import {
  DRIVE_IN_YOUR_DRIVE,
  savedSummary,
  partialSavedSummary,
  downloadedSummary,
  DRIVE_CONVERSION_CAPTION,
  DRIVE_STALE_CAPTION,
  DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION,
  hiringEmailDriveNote,
} from "@/lib/drive/driveMessages";
import DriveOverwriteDialog from "./DriveOverwriteDialog";

/**
 * Where Drive save/download outcomes are reported (`UX.md` rev 2 §3/§6,
 * `ARCH.md` §12 Wave 3B, module table row 26). Rendered by the caller as a
 * full-width SIBLING of `DialogActions`, in the slot `ReviseStrip` already
 * occupies (`DocumentPreviewDialog.js:756-768`) — never inside the action
 * bar, and never a child of it.
 *
 * Two hard constraints from the design, both true by construction here:
 *   1. This component NEVER writes the modal's per-scope `busy`/`notice`/
 *      `error` prop maps — it doesn't receive them at all. `busyActive` /
 *      `anyBusy` gate ten controls over eleven causal paths
 *      (`ARCH.md` §11); a Drive write there would freeze the whole modal
 *      for an action on a different document.
 *   2. A partial batch keeps the successes visible and shows only the
 *      failing scope's error — this component doesn't decide that; it just
 *      renders whatever `rows` it is given, and `rows` already carries that
 *      guarantee from `lib/drive/driveSaveBatch.js`'s reducer (its own
 *      header states the same contract). This component never claims both
 *      documents saved when one did not, because it never synthesizes a
 *      leading line on its own — every leading line here is either an exact
 *      export of `driveMessages.js` or that module's own function called
 *      with a caller-supplied count. No copy is retyped.
 *
 * ANNOUNCEMENTS. `DocumentPreviewDialog.js` has ZERO live regions today
 * (`AC.md` F-11), so the two spans below are net-new. They are rendered
 * UNCONDITIONALLY on every render of this component — never toggled by
 * whether there's currently anything to show — reusing the established
 * repo idiom (`app/copilot/ManualQuestion.js:122`, comment there: "mounted
 * from the FIRST render, empty, so a screen reader only ever hears a TEXT
 * CHANGE"). That matters here specifically because `AC.md` AC-A5 requires
 * these regions to exist for the Dialog's whole open lifetime, and the
 * VISIBLE strip below them is conditionally absent on a never-saved
 * posting ("the button is the empty state", `UX.md` §6.2) — so the caller
 * MUST mount this component whenever the Drive feature is available,
 * independent of whether `rows`/`leadingLine`/`prompt` currently have
 * anything to say, or the live regions would not exist yet when the first
 * save starts.
 *
 * CAPTION OWNERSHIP RULING (WAVE3-SEAMS.md BLOCKER B2): this component and
 * `DriveActions` were both built to render all four Drive captions
 * (conversion, stale, reconnect-to-download, hiring-email) -- every user saw
 * each one twice, with a colour disagreement on the stale caption on top
 * (`DriveActions` used `var(--warning)`; this file uses `var(--text-muted)`,
 * which is what survives). Ruling: THIS component is the SOLE owner of every
 * caption; `DriveActions` owns only its two controls now. See
 * `DriveActions.js`'s own header for the full citation list (UX.md §3
 * "every caption is in the strip", AC-K4 "binds only the controls", UX.md
 * §13's layout diagram). Where AC-S19 (hiring-email note "always" rendered)
 * conflicts with UX.md §6.5 (rendered only on the email tab), this fix
 * follows UX.md for the copy/gating per its own governing instructions --
 * `hiringEmail` here stays a caller-gated nullable prop, unchanged.
 *
 * Repo trap this design already dissolves rather than works around: two
 * consecutive IDENTICAL announcement strings produce NO DOM mutation,
 * because React bails on an unchanged state update, and the user hears
 * nothing. `UX.md` §8 closes this STRUCTURALLY — every Drive action
 * announces a start sentence before its outcome, and clears both regions
 * first — so the polite region's sequence across save -> failure -> save is
 * `"" -> start -> "" -> start -> outcome`: no two consecutive values are
 * ever identical, and the coalescing bail cannot occur. That is the
 * CALLER's property to uphold (this component only renders whatever string
 * it's handed); the property is asserted directly in this file's test
 * rather than worked around with a nonce or a zero-width character — a
 * zero-width nonce was tried in this repo before and leaked U+200B into
 * copied text (`mui-a11y-traps` item 6, `AC.md` AC-A6).
 *
 * ANNOUNCEMENT SHAPE (WAVE3-SEAMS.md MAJ-2): the polite and alert strings
 * are taken as ONE `announcement={{polite, alert}}` prop, never two loose
 * strings. `driveSaveBatch(...).announcement` and `driveMessages.js`'s
 * `driveAnnounceStart(...)` already return exactly that shape, so this is
 * never an adapter -- a caller passes either return value straight through.
 * Two loose props would let a caller set one without the other and
 * reintroduce the exact defect `driveAnnounceStart` was built to make
 * structurally impossible (see that function's own header comment): a
 * caller who announces a start on the polite side and forgets to clear the
 * alert side leaves a stale alert string standing, and a failure -> retry
 * -> IDENTICAL failure sequence then produces zero mutations on the alert
 * region because React bails on the unchanged string. A missing
 * `announcement` prop, or one missing either field, is therefore a
 * programming error, not "nothing to announce yet" -- this component
 * throws rather than quietly defaulting the missing half to "", which is
 * exactly how that defect hid in the region's own tests before (a missing
 * field and an explicit clear were indistinguishable once both defaulted
 * to "").
 */

// Mobile containment (`UX.md` §10, AC-M4): capped so the strip can never
// grow without bound on a 375px phone, where `DialogActions` already takes
// its height first. `[browser]`-tagged in AC.md (jsdom has no layout
// engine, F-12) — this file's own test only asserts the sx VALUE is
// present, never anything geometric.
const CONTAINER_SX = {
  px: { xs: 1.25, sm: 2 },
  pt: 1.25,
  pb: 1,
  borderTop: "1px solid var(--border)",
  maxHeight: { xs: "30vh" },
  overflowY: { xs: "auto" },
};

const LINK_SX = {
  overflowWrap: "anywhere",
  minHeight: { xs: "44px", sm: "auto" },
  display: "inline-flex",
  alignItems: "center",
};

// Binary success/failure colour, reusing the existing notice/error idiom
// this modal already has (`DocumentPreviewDialog.js:749-753`) rather than
// inventing a third tone. A row's `kind` (from `driveSaveBatch.js`) decides
// which side of the line it's on; UX.md gives no third colour for any row.
const SUCCESS_ROW_KINDS = new Set(["saved", "saved-new-doc", "replaced-deleted"]);

function rowColor(kind) {
  return SUCCESS_ROW_KINDS.has(kind) ? "var(--success)" : "var(--danger)";
}

// Resolves the leading line's exact text via driveMessages.js's own
// exports -- never retyped here -- from a small caller-supplied descriptor.
// This is deliberately NOT a pre-formatted string prop: accepting one would
// let a caller retype "Saved 2 documents to Drive." by hand, which is
// exactly the defect class the task brief calls out ("a previous wave
// shipped a defect by re-deriving twelve of them"). Calling the real
// function here instead makes drift impossible.
function resolveLeadingLine(leadingLine) {
  if (!leadingLine) return null;
  switch (leadingLine.kind) {
    case "idle":
      return { text: DRIVE_IN_YOUR_DRIVE, color: "var(--text-muted)" };
    case "saved":
      return { text: savedSummary(leadingLine.count), color: "var(--success)" };
    case "partial":
      return {
        text: partialSavedSummary(leadingLine.saved, leadingLine.total),
        color: "var(--success)",
      };
    case "downloaded":
      return { text: downloadedSummary(leadingLine.count), color: "var(--success)" };
    default:
      return null;
  }
}

function Segments({ segments }) {
  return segments.map((segment, i) =>
    segment.type === "link" ? (
      <Box
        key={i}
        component="a"
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer"
        sx={LINK_SX}
      >
        {segment.text}
      </Box>
    ) : (
      // Index as key: text segments carry no stable identity of their own,
      // and the index is stable within one row's fixed-shape segment list.
      <span key={i}>{segment.value}</span>
    ),
  );
}

function ResultRow({ row }) {
  return (
    <Box
      // Not a styling hook -- exists so a test can locate THIS row's own
      // element (as opposed to its child link/text spans) to inspect the
      // colour `rowColor(row.kind)` actually applied, independent of the
      // row's text content. Guards WAVE3-SEAMS.md MAJOR M-2 (M18): a
      // `rowColor` that returns success for every kind must be catchable by
      // more than "the right words appeared somewhere in the strip".
      data-row-kind={row.kind}
      sx={{
        mt: 0.5,
        fontSize: "0.8rem",
        color: rowColor(row.kind),
        overflowWrap: "anywhere",
      }}
    >
      <Segments segments={row.segments} />
    </Box>
  );
}

/**
 * @param {object} props
 * @param {null | {kind:"idle"} | {kind:"saved",count:number} | {kind:"partial",saved:number,total:number} | {kind:"downloaded",count:number}} props.leadingLine
 *   One resolved leading-line descriptor, or null for "nothing to say" (a
 *   fully-failed batch, whose message lives in `rows` instead — UX.md §6.3).
 * @param {Array<{scope:string|null, kind:string, attributed:boolean, errorKind:string|null, segments:Array}>} [props.rows]
 *   Exactly `lib/drive/driveSaveBatch.js`'s `driveSaveBatch(...).rows` shape.
 * @param {boolean} [props.showConversionCaption] - AC-D7: rendered whenever
 *   the caller is rendering "Download from Drive".
 * @param {boolean} [props.stale] - AC-P7: rendered ABOVE the conversion
 *   caption when both are true.
 * @param {boolean} [props.reconnectCaption] - B-6: replaces the conversion
 *   caption when disconnected but the posting still has stored Docs.
 * @param {{scopeCount:number}|null} [props.hiringEmail] - render the
 *   hiring-email-tab-only note; caller gates this to "only while the save
 *   control is rendered" (M-10).
 * @param {{docNames:string[], id?:string|number, onSaveAsNew:Function, onOverwrite:Function, onDismiss:Function}|null} [props.prompt]
 *   Forwarded verbatim to `DriveOverwriteDialog`. Rendered INLINE in this
 *   strip, in the same slot the layout diagrams show it in (`UX.md` §13) --
 *   never a separate region. `id`, when the caller has one (e.g. an
 *   activation id), keys the dialog's remount (B3 below); otherwise this
 *   component tracks its own activation counter (see `promptKey` below), so
 *   a second conflict remounts `DriveOverwriteDialog` even when it names
 *   the exact same Doc(s) as the first.
 * @param {{polite:string, alert:string}} props.announcement - Both live
 *   region strings, bundled as one object (MAJ-2 below) -- `role="status"
 *   aria-live="polite"` reads `.polite`, `role="alert"` reads `.alert`.
 *   Required: a missing prop, or one missing either field, throws.
 */
export default function DriveResultRegion({
  leadingLine = null,
  rows = [],
  showConversionCaption = false,
  stale = false,
  reconnectCaption = false,
  hiringEmail = null,
  prompt = null,
  announcement,
}) {
  // The `useState` below is called UNCONDITIONALLY, before the
  // `announcement` validation -- deliberately, so a bad `announcement` prop
  // always throws the same clear TypeError (see below) instead of, on some
  // later render, tripping React's own "rendered fewer hooks than expected"
  // error first because a hook got skipped by an early return.
  const [promptActivation, setPromptActivation] = useState({ prompt: null, counter: 0 });

  // WAVE3-SEAMS.md MAJ-2: a missing `announcement`, or one missing either
  // field, is a programming error -- exactly the shape that let a caller
  // announce a start on one region and silently leave the other's stale
  // value standing. Loud on purpose: this must THROW, not default the
  // absent half to "", because "field missing" and "explicitly cleared"
  // have to stay distinguishable here for this component's own tests to
  // catch the regression (a silent default is how mutation A4 hid before --
  // see driveMessages.js's own header comment on `driveAnnounceStart`).
  if (
    !announcement ||
    typeof announcement !== "object" ||
    typeof announcement.polite !== "string" ||
    typeof announcement.alert !== "string"
  ) {
    throw new TypeError(
      "DriveResultRegion requires announcement={{polite, alert}} with both fields as strings -- " +
        "a missing prop or a missing field is the WAVE3-SEAMS.md MAJ-2 defect class (a caller " +
        "announces one live region without clearing the other), so it must fail loudly here " +
        "rather than silently rendering an empty string for the missing half.",
    );
  }
  const { polite: politeMessage, alert: alertMessage } = announcement;

  const resolvedLeadingLine = resolveLeadingLine(leadingLine);
  const rowList = Array.isArray(rows) ? rows : [];

  // WAVE3-SEAMS.md MAJ-1: a key derived from the conflict's own CONTENT
  // (`JSON.stringify(prompt.docNames)`) is identical for two activations
  // that happen to name the same Doc(s) -- the single most likely repeat
  // (the user leaves a prompt undecided, a retry fires, the same Doc
  // conflicts again). React then reconciles the second activation into the
  // SAME node as the first: `DriveOverwriteDialog`'s mount-time focus
  // effect never re-runs, nothing is re-announced, and the callbacks swap
  // underneath a user who may already have a keypress in flight for the
  // FIRST prompt's buttons. The fix is an identity that owes nothing to the
  // conflict's content: an activation counter that increments every time
  // `prompt` becomes a NEW, different, non-null object, regardless of what
  // it names. This is React's own sanctioned "store info from previous
  // renders" pattern (a render-phase `setState` guarded by an identity
  // comparison) -- not a ref mutated during render, which is unsafe under
  // concurrent rendering. `prompt.id` still wins when the caller supplies
  // one; the counter is only the fallback, replacing the old content-derived
  // one.
  if (prompt && promptActivation.prompt !== prompt) {
    setPromptActivation({ prompt, counter: promptActivation.counter + 1 });
  }
  const promptKey = prompt ? (prompt.id ?? `activation-${promptActivation.counter}`) : null;

  // "The strip renders only when it has something to say. On a never-saved
  // posting it is absent." (UX.md §3.) The live regions above are NOT part
  // of this decision -- they always render, per this file's header comment.
  const hasVisibleContent =
    resolvedLeadingLine !== null ||
    rowList.length > 0 ||
    showConversionCaption ||
    stale ||
    reconnectCaption ||
    hiringEmail !== null ||
    prompt !== null;

  return (
    <>
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {politeMessage}
      </Box>
      <Box component="span" role="alert" sx={visuallyHidden}>
        {alertMessage}
      </Box>
      {hasVisibleContent ? (
        <Box sx={CONTAINER_SX}>
          {resolvedLeadingLine ? (
            <Box sx={{ fontSize: "0.85rem", fontWeight: 600, color: resolvedLeadingLine.color }}>
              {resolvedLeadingLine.text}
            </Box>
          ) : null}

          {rowList.map((row, i) => (
            // `row.scope` is the key when present (two rows in one batch
            // never share a scope); the index is only a fallback for a
            // batch-error row, whose `scope` is null.
            <ResultRow key={row.scope ?? `row-${i}`} row={row} />
          ))}

          {reconnectCaption ? (
            <Box sx={{ mt: 0.75, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION}
            </Box>
          ) : (
            <>
              {stale ? (
                <Box sx={{ mt: 0.75, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {DRIVE_STALE_CAPTION}
                </Box>
              ) : null}
              {showConversionCaption ? (
                <Box sx={{ mt: 0.75, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {DRIVE_CONVERSION_CAPTION}
                </Box>
              ) : null}
            </>
          )}

          {hiringEmail ? (
            <Box sx={{ mt: 0.75, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {hiringEmailDriveNote(hiringEmail.scopeCount)}
            </Box>
          ) : null}

          {prompt ? (
            <DriveOverwriteDialog
              // WAVE3-SEAMS.md BLOCKER B3 / MAJ-1: `promptKey` (computed
              // above) is never derived from the conflict's own content, so
              // two activations that name the SAME Doc(s) still remount this
              // component -- see the long comment at `promptActivation`
              // above for why a content-derived key (the previous
              // `JSON.stringify(prompt.docNames)` fallback) is exactly the
              // trap this closes.
              key={promptKey}
              docNames={prompt.docNames}
              onSaveAsNew={prompt.onSaveAsNew}
              onOverwrite={prompt.onOverwrite}
              onDismiss={prompt.onDismiss}
            />
          ) : null}
        </Box>
      ) : null}
    </>
  );
}
