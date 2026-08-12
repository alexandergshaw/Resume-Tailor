"use client";

import { useEffect, useRef } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityIcon from "@mui/icons-material/Visibility";
import StatusPill from "./StatusPill";
import {
  postingLabel,
  buildPostingsPin,
  submittableEntries,
  failedEntries,
} from "../../lib/tailor/postingQueue";
import { enqueueTargets } from "../../lib/tailor/rollingQueue";

import styles from "../page.module.css";

// One instance of this caption exists per render of this tab (B3) -- it
// explains why "Review & edit fields" refuses to run, not any one posting --
// so a plain constant id is fine; nothing here needs to be per-posting.
const REVIEW_CAPTION_ID = "job-description-review-caption";

// Chunk 11: explains why the Tailor button is disabled once every posting is
// already queued, in flight, or finished -- as opposed to `busy` alone,
// which used to be the button's ENTIRE disabled reason and gave no hint that
// pressing it again would do nothing.
const NOTHING_NEW_CAPTION_ID = "job-description-nothing-new-caption";

// A posting's own row is locked (its box and its remove control) exactly
// while ITS OWN worker owns it -- queued or actively running -- never for
// the whole tab just because a run is happening somewhere in it (chunk 11,
// AC-4: per-entry locking, not global). `busy` still locks every row when
// the thing running is NOT this tab's own queue (`running` false) -- a
// StatusBar chip's Regenerate, which this tab has no per-row visibility
// into.
function rowLocked(entry, running, busy) {
  return entry.status === "pending" || entry.status === "processing" || (busy && !running);
}

// The one `role="status" aria-live="polite"` region AC-10 requires: what to
// say while a run is in flight, and what to say once it ends. Rendered even
// when there's nothing to announce yet -- a live region only announces
// content that changes AFTER it exists in the DOM, so it has to be present
// from the start.
//
// A4/A6: `running` (this tab's own queue) and `busy` (any manual generation
// in flight, including one started from a StatusBar chip's "Regenerate") are
// separate props on purpose -- only `running` has real `completed`/`total`
// counters behind it, so borrowing them for a busy-but-not-running state
// would report a stale or unrelated count. And the "what just happened"
// summary reads `lastRun`, never `entries` -- entries changes the instant
// the user edits or removes a finished posting, which is exactly the old
// bug (a live region interrupting mid-typing to report a shrinking box
// count instead of what the run actually produced).
function progressAnnouncement({ running, busy, completed, total, lastRun }) {
  if (running) return `Tailoring ${completed} of ${total}…`;
  if (busy) return "Generating…";
  if (!lastRun) return "";
  const { done, failed } = lastRun;
  return failed > 0 ? `${done} tailored, ${failed} failed` : `${done} tailored`;
}

// Manual Applying › Job Description: several posting boxes, each with its
// own status/error/"Preview documents" button, submitted together but
// tracked independently -- the same shape as the Screenshots tab
// (app/components/ScreenshotTab.js + app/hooks/useScreenshots.js). Purely
// presentational: state, persistence, and the tailoring pipeline all live in
// app/hooks/useManualPostings.js + app/hooks/useManualTailor.js.
export default function JobDescriptionTab({
  entries,
  running,
  busy,
  completed,
  total,
  lastRun,
  error,
  onAddPosting,
  onRemovePosting,
  onChangePosting,
  onSubmit,
  onRetryFailed,
  onPreviewEntry,
  askAiAbout,
  tailorEngine,
  onReviewFields,
}) {
  const pin = buildPostingsPin(entries);
  const reviewCandidates = submittableEntries(entries);
  const canReviewOne = reviewCandidates.length === 1;
  const failedCount = failedEntries(entries).length;
  // B3: blocked for two different reasons (ambiguous selection, or a run in
  // flight), but neither one gets a real `disabled` attribute -- see the
  // button below.
  const reviewBlocked = !canReviewOne || busy;

  // Chunk 11 / A6: the Tailor button stays enabled DURING this tab's own run
  // whenever there is something new `enqueueTargets` would actually submit
  // -- pressing it again while running is how a second (or third) posting
  // gets added to the run. It is disabled, with a stated reason, once there
  // is nothing left to submit; it also stays disabled for as long as
  // something OTHER than this tab's own queue is busy (`busy` without
  // `running` -- a StatusBar chip's Regenerate), which has nothing to do
  // with whether this tab has new work.
  const hasNewWork = enqueueTargets(entries).length > 0;
  const submitBlockedElsewhere = busy && !running;
  const submitDisabled = !hasNewWork || submitBlockedElsewhere;
  // The caption only applies to the "nothing left to submit" reason, and
  // only once something has actually been attempted -- a pristine, never-run
  // blank box is not "nothing new", it just hasn't been typed into yet, and
  // the existing blank-box guardrail (shown on click) already covers that.
  const nothingNewToSubmit =
    !running && !hasNewWork && !submitBlockedElsewhere && entries.some((e) => e.status !== "idle");

  // B4: focus is dropped to <body> when a posting is removed, because the
  // element that had it (that posting's own remove button) is removed along
  // with it. `fieldRefs` collects every posting field's DOM node so the
  // neighbour that should inherit focus can be found by id after the fact;
  // `pendingFocusRef` records which target that is, decided at click time --
  // before the removal -- since afterwards the removed posting's index and
  // neighbours no longer exist to compute from.
  const fieldRefs = useRef({});
  const addButtonRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const prevIdsRef = useRef(entries.map((e) => e.id));

  useEffect(() => {
    const currentIds = entries.map((e) => e.id);
    const removed = prevIdsRef.current.some((id) => !currentIds.includes(id));
    if (removed && pendingFocusRef.current) {
      const target = pendingFocusRef.current;
      pendingFocusRef.current = null;
      if (target.type === "field" && fieldRefs.current[target.id]) {
        fieldRefs.current[target.id].focus();
      } else if (addButtonRef.current) {
        addButtonRef.current.focus();
      }
    }
    prevIdsRef.current = currentIds;
  }, [entries]);

  function handleRemove(id, index) {
    // The previous posting if there is one, otherwise the next one -- the
    // last remaining posting can never be removed (lib/tailor/postingQueue.js
    // removeEntry), so a neighbour always exists once removal is actually
    // allowed. The "no neighbour" branch (focus the Add control) is a
    // defensive fallback for that invariant, not a reachable case today.
    const neighbourId = index > 0 ? entries[index - 1].id : (entries[index + 1]?.id ?? null);
    pendingFocusRef.current = neighbourId ? { type: "field", id: neighbourId } : { type: "add" };
    onRemovePosting(id);
  }

  return (
    <section className={styles.tabPanel}>
      <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
        Paste one or more full job descriptions to generate a tailored resume and cover letter for each.
      </Typography>

      <form
        className={styles.form}
        onSubmit={onSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        {/* B5: a real list, not ten anonymous boxes in an unnamed section --
            so assistive tech can navigate it as one group and announce
            position ("3 of 10"). */}
        <Box
          component="ul"
          sx={{ display: "flex", flexDirection: "column", gap: 1.5, listStyle: "none", m: 0, p: 0 }}
        >
          {entries.map((entry, index) => {
            // B2: the pill, the error and the warning were loose text with
            // no association to the field they describe. Each gets an id
            // here (only when it will actually render something), and the
            // field's aria-describedby points at whichever exist.
            const statusId = `job-posting-${entry.id}-status`;
            const errorId = `job-posting-${entry.id}-error`;
            const warningId = `job-posting-${entry.id}-warning`;
            const describedByIds = [
              entry.status !== "idle" ? statusId : null,
              entry.status === "error" && entry.error ? errorId : null,
              entry.status === "done" && entry.warning ? warningId : null,
            ].filter(Boolean);

            return (
              <Box
                component="li"
                key={entry.id}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.75,
                  p: { xs: 1, sm: 1.25 },
                  border: "1px solid var(--border)",
                  borderRadius: 1,
                  listStyle: "none",
                }}
              >
                {/* C2: stacked at xs (remove control right-aligned above the
                    field) so the textarea gets the full card width instead
                    of losing ~48px to a 40px button plus its gap on a
                    320px-wide phone -- side by side again from sm up, same
                    as before this fix. */}
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    alignItems: { xs: "stretch", sm: "flex-start" },
                    gap: { xs: 0.75, sm: 1 },
                  }}
                >
                  <TextField
                    id={`job-posting-${entry.id}`}
                    label={postingLabel(index)}
                    multiline
                    rows={8}
                    fullWidth
                    placeholder="Paste the full job posting here..."
                    value={entry.text}
                    // Chunk 11 / A6: per-ROW, not the blanket `busy` flag --
                    // this box is locked only while its OWN worker owns it
                    // (queued or processing), or while something other than
                    // this tab's own queue is busy elsewhere. Every other
                    // row stays editable while the run continues; that is
                    // the whole point of being able to keep pasting.
                    // Without the per-row lock, typing into a QUEUED/
                    // processing box would reset that entry to idle while
                    // its in-flight worker for the OLD text is still
                    // running; that worker's patch then lands "done", a
                    // job id and a title on top of the NEW text.
                    disabled={rowLocked(entry, running, busy)}
                    error={entry.status === "error"}
                    // A plain `aria-describedby` prop on TextField lands on
                    // the root FormControl, not the actual <textarea> a
                    // screen reader is focused on -- slotProps.htmlInput is
                    // MUI's documented way to reach the native element.
                    slotProps={{
                      htmlInput: {
                        "aria-describedby": describedByIds.length ? describedByIds.join(" ") : undefined,
                      },
                    }}
                    onChange={(e) => onChangePosting(entry.id, e.target.value)}
                    inputRef={(el) => {
                      fieldRefs.current[entry.id] = el;
                    }}
                  />
                  {entries.length > 1 ? (
                    <Tooltip title="Remove">
                      <Box
                        component="span"
                        sx={{
                          alignSelf: { xs: "flex-end", sm: "flex-start" },
                          // Moves the remove control before the field in
                          // visual (not DOM) order at xs only -- keeping DOM
                          // order (tab order, and what a screen reader
                          // encounters) the field first, remove second, at
                          // every width.
                          order: { xs: -1, sm: 0 },
                        }}
                      >
                        <IconButton
                          aria-label={`Remove job posting ${index + 1}`}
                          onClick={() => handleRemove(entry.id, index)}
                          // Chunk 11 / A4: per-row, same as the field above --
                          // removing a posting that is not this run's
                          // concern must stay possible while the run
                          // continues.
                          disabled={rowLocked(entry, running, busy)}
                          sx={{ flexShrink: 0, mt: { sm: 0.5 } }}
                        >
                          <CloseIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Box>
                    </Tooltip>
                  ) : null}
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <StatusPill id={statusId} status={entry.status} />
                  {entry.status === "done" && (entry.jobTitle || entry.company) ? (
                    // C3: matches the error/warning lines below -- a long
                    // unbroken title or company must not blow out the card.
                    <Typography sx={{ fontSize: "0.85rem", fontWeight: 600, overflowWrap: "anywhere" }}>
                      {[entry.jobTitle, entry.company].filter(Boolean).join(" · ")}
                    </Typography>
                  ) : null}
                </Box>

                {entry.status === "error" && entry.error ? (
                  <Box id={errorId} sx={{ fontSize: "0.8rem", color: "var(--danger)", overflowWrap: "anywhere" }}>
                    {entry.error}
                  </Box>
                ) : null}
                {entry.status === "done" && entry.warning ? (
                  <Box id={warningId} sx={{ fontSize: "0.8rem", color: "var(--warning)", overflowWrap: "anywhere" }}>
                    {entry.warning}
                  </Box>
                ) : null}
                {entry.status === "done" ? (
                  <Button
                    size="small"
                    startIcon={<VisibilityIcon sx={{ fontSize: 16 }} />}
                    onClick={() => onPreviewEntry(entry)}
                    // B1: every finished card's button had the same visible
                    // text and no aria-label, so a screen-reader user
                    // listing controls heard "Preview documents" once per
                    // finished posting with nothing to tell them apart.
                    // Visible text is unchanged.
                    aria-label={`Preview documents for job posting ${index + 1}`}
                    sx={{ alignSelf: "flex-start", px: 1 }}
                  >
                    Preview documents
                  </Button>
                ) : null}
              </Box>
            );
          })}
        </Box>

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {/* Chunk 11: deliberately no `busy`/`running` guard here. A brand
              new box is EMPTY -- no text, no status -- so it cannot conflict
              with any worker, in this tab's own run or one started
              elsewhere. Blocking it used to be necessary only because the
              old batch runner could not grow once started; a rolling queue
              has no such limit, and "submit one, press Tailor, then submit
              another while the first is being tailored" requires being able
              to create that second box WHILE the first is still going. */}
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={onAddPosting}
            ref={addButtonRef}
          >
            Add another posting
          </Button>
        </Box>

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Button
            type="submit"
            variant="contained"
            disabled={submitDisabled}
            aria-describedby={nothingNewToSubmit ? NOTHING_NEW_CAPTION_ID : undefined}
          >
            {busy ? (running ? `Tailoring ${completed} of ${total}…` : "Generating…") : "Generate"}
          </Button>
          {failedCount > 0 ? (
            <Button variant="outlined" onClick={onRetryFailed} disabled={busy}>
              Retry failed ({failedCount})
            </Button>
          ) : null}
          <Button variant="outlined" disabled={!pin} onClick={() => askAiAbout(pin)}>
            Ask AI
          </Button>
          {tailorEngine === "external" ? (
            // B3: this used to render a real `disabled`, which pulls the
            // control out of the tab order at exactly the moment the
            // explanation below appears -- so the only users who could not
            // reach the reason were the ones who could not see it either.
            // aria-disabled keeps it focusable and refuses the action itself
            // via the handler, instead of the DOM attribute.
            <Button
              variant="outlined"
              aria-disabled={reviewBlocked || undefined}
              aria-describedby={!canReviewOne ? REVIEW_CAPTION_ID : undefined}
              onClick={() => {
                if (reviewBlocked) return;
                onReviewFields(reviewCandidates[0]?.text ?? "");
              }}
              // Visually indistinguishable from a real `disabled` button
              // (MUI's own disabled styling) without actually being one.
              sx={reviewBlocked ? { opacity: 0.38, cursor: "default" } : undefined}
            >
              Review &amp; edit fields
            </Button>
          ) : null}
        </Box>
        {/* C1: pulled out of the button row entirely -- as a flex-basis:auto
            item there, this ~95-character sentence forced the column
            wrapping it to size to its widest child, and the button
            stretched to match: ~500px wide the moment the tab has more than
            one box, snapping to ~170px the instant exactly one is left
            non-blank. On its own line below the row, it can wrap freely
            without moving anything else. */}
        {tailorEngine === "external" && !canReviewOne ? (
          <Typography id={REVIEW_CAPTION_ID} sx={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
            Review &amp; edit fields works one posting at a time — leave exactly one box filled in
            to use it.
          </Typography>
        ) : null}
        {/* Chunk 11 / A6: the Tailor button's own disabled state has no
            visible explanation on its own -- this is the stated reason for
            exactly the "nothing left to submit" case (every posting is
            already queued, running, or finished), not for the ordinary
            blank-box guardrail, which already speaks up on click. */}
        {nothingNewToSubmit ? (
          <Typography id={NOTHING_NEW_CAPTION_ID} sx={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
            Nothing new to submit — edit a posting to run it again.
          </Typography>
        ) : null}

        <Box role="status" aria-live="polite" sx={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          {progressAnnouncement({ running, busy, completed, total, lastRun })}
        </Box>
      </form>

      {error ? <Alert severity="error">{error}</Alert> : null}
    </section>
  );
}
