"use client";

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";

// N45/N46's per-section regenerate control and version history/restore
// list. N50 (S1) extracted this out of PrepPackPanel.js -- the hierarchy
// restructure that file needed (a role="group" wrapper per section, a
// keyboard-reachable history disclosure, and the N53 queue display below)
// had no room to add without pushing that file toward its 1000-line cap.
// Rendered identically for a POPULATED section and an EMPTY one (this
// component takes no `pack` binding, matching EmptySection's own
// AC-N44.3/.8 discipline), so the section a candidate most wants to
// regenerate -- the one with nothing in it -- always carries the control.
//
// Visible text is the bare word "Regenerate"/"Restore" plus a
// visually-hidden span naming the section (and, for restore, the version
// number) -- never a bare "Regenerate" repeated four times indistinguishably,
// and never colliding with `PrepPackPanel.generate.test.js`'s own
// `/^regenerate$/i` matcher for the WHOLE-PACK control, since this
// control's own trimmed textContent is never exactly "Regenerate" alone.
//
// N50/N53 (plan.r2.md section 2.2): `activity`/`outcome` are this section's
// own slice of the module-scope action queue (lib/interviewPrep/
// prepActionQueue.js, via app/hooks/usePrepActionQueue.js), threaded down
// from AppViewDialog.js through PrepPackPanel.js's PackSections. A
// `role="status"` region is ALWAYS present -- inserted empty, before any
// text ever lands in it -- because a live region created together with its
// first text is not reliably announced; only a change inside an EXISTING
// region is (AC-N50 risk R9). While `activity` is set, nothing else in this
// section renders: no button, no disclosure (AC-N50.15(d)) -- the same "a
// blocked state replaces the control, never disables it" rule
// GenerateControl already follows, so nothing here ever looks interactive
// while silently doing nothing.
const VISUALLY_HIDDEN_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

const TERMINAL_GENERATE_STATUSES = ["ready", "partial", "failed", "unavailable"];

/** M3 (N50 fix round 1): the server's own error text, when the reply carries
 *  one -- a real JSON `{error}` reply (a 429 rate-limit refusal, the missing-
 *  API-key refusal, any other route-level error) -- so a candidate reads WHY
 *  rather than a generic "Try again" that invites the immediate retry the
 *  queue exists to prevent. Excludes a `networkError` reply on purpose: that
 *  string (`"Failed to fetch"`, a fetch-level message) is not the server's
 *  own words and would be actively misleading shown as one.
 *
 *  M-2 (N50 fix round 3): a `timedOut` reply is the ONE exception to that
 *  exclusion -- its `error` is prepActionQueue.js's own TIMEOUT_MESSAGE, not
 *  a raw fetch-layer string, so it is this repo's own words after all.
 *  Before this branch, `sectionOutcomeCopy` below fell straight to its
 *  generic "Couldn't regenerate X. Try again." for a timeout exactly as it
 *  does for a genuine failure -- asserting the attempt failed when the
 *  client had only stopped waiting, right beside a banner that says the pack
 *  IS still generating (verify.r3.md M-2). */
function serverErrorText(result) {
  if (result.timedOut) return typeof result.error === "string" && result.error.trim() ? result.error.trim() : null;
  if (result.networkError) return null;
  return typeof result.error === "string" && result.error.trim() ? result.error.trim() : null;
}

/** AC-N50.16: what a candidate reads when an action taken on THIS section did
 *  not leave the trace an ordinary refetch would already show. Returns
 *  `null` for a normal terminal generate status (the refetched pack already
 *  displays it) and for a successful restore; otherwise one sentence naming
 *  the section, the action, and -- for a restore -- the version. No
 *  positional words (AC-N50.14) and no verification claims (AC-N50.17(b)). */
function sectionOutcomeCopy(outcome, label) {
  if (!outcome || !outcome.result) return null;
  const result = outcome.result;
  const serverText = serverErrorText(result);
  // M-3 (N50 fix round 4, verify4.md): a `timedOut` result is framed as a
  // SUBJECT ("label: ..."), never a verdict ("Couldn't regenerate label:
  // ..."). This section's OWN `role="status"` line falls silent the instant
  // `activity` clears (the `message` assignment below this function, in the
  // component itself), and PrepPackPanel.js's `StatusBanner` keeps reading
  // "Regenerating {label} ..." for exactly as long as this outcome's
  // `timedOut` flag keeps naming this section (AppViewDialog.js's
  // `timedOutSectionTarget`) -- so a "Couldn't ..." verdict here would sit
  // beside a banner still claiming the action is ongoing, asserting the
  // opposite of it in the same breath (verify4.md's own measured pairing).
  // The client only stopped waiting; it never learned the attempt failed.
  if (result.timedOut) {
    const subject = outcome.kind === "restore" ? `${label} version ${outcome.revision}` : label;
    return serverText
      ? `${subject}: ${serverText}`
      : `${subject}: no reply after a couple of minutes, so this attempt was abandoned here — it may still finish. Check back, or try again.`;
  }
  if (outcome.kind === "restore") {
    if (result.status === "restored") return null;
    const version = outcome.revision;
    if (result.status === "conflict") {
      return `${label} changed while restoring version ${version}, so nothing was restored. Try again.`;
    }
    if (result.status === "refused" && result.reason === "in-flight") {
      return `Couldn't restore ${label} version ${version} — the pack is being updated. Try again when it finishes.`;
    }
    if (serverText) return `Couldn't restore ${label} version ${version}: ${serverText}`;
    return `Couldn't restore ${label} version ${version}. Try again.`;
  }
  if (TERMINAL_GENERATE_STATUSES.includes(result.status)) return null;
  if (result.status === "refused" && result.reason === "in-flight") {
    return `Couldn't regenerate ${label} — the pack is being updated. Try again when it finishes.`;
  }
  if (result.status === "disabled") {
    return `Interview prep isn't available right now, so ${label} wasn't regenerated.`;
  }
  if (serverText) return `Couldn't regenerate ${label}: ${serverText}`;
  return `Couldn't regenerate ${label}. Try again.`;
}

/** The always-present status line's own text: distinct wording for "working
 *  on it now" versus "waiting its turn" (design ledger 12's leading word),
 *  so the two never read the same. */
function activityLine(activity, label) {
  const restore = activity.kind === "restore";
  if (activity.state === "queued") {
    return restore
      ? `Queued — restoring ${label}, version ${activity.revision}, once the current update finishes.`
      : `Queued — regenerating ${label} once the current update finishes.`;
  }
  return restore ? `Restoring ${label}, version ${activity.revision}…` : `Regenerating ${label}…`;
}

export default function PrepSectionActions({
  section,
  label,
  enabled,
  activity,
  outcome,
  revisions,
  liveRevision,
  onRegenerateSection,
  onRestoreRevision,
}) {
  // Renamed from `restorable` (N50 fix round 2): N45's per-revision
  // `rev.restorable` field (below) now carries that name, and this local is
  // every EARLIER revision regardless of whether the server will let it be
  // restored -- "restorable" would collide in meaning with the field it
  // filters.
  const earlier = (Array.isArray(revisions) ? revisions : []).filter((rev) => rev.revision !== liveRevision);
  const message = activity ? null : sectionOutcomeCopy(outcome, label);
  // m2 (N50 fix round 1): focus moves to this section's status line the
  // moment its OWN activity starts (a real click on Regenerate or Restore,
  // never a mere prop change while idle) -- `wasActive` tracks the boolean
  // transition, not the activity object's own identity, so a queued->
  // in-progress change for the SAME action does not steal focus a second
  // time. `tabIndex={-1}` makes the region a valid focus target without
  // adding it to the normal tab order.
  //
  // m-c (N50 fix round 2): `wasActive` used to start `false` unconditionally,
  // so mounting (a reopened dialog, a main-tab remount) WHILE an action was
  // already in progress read as a fresh idle->active transition and stole
  // focus -- on a phone, `focus()` scrolls the target into view, so the
  // reopened dialog jumped straight to whichever section happened to be
  // working. Seeding it from the activity this component mounts WITH means
  // only a real transition after mount ever moves focus.
  const statusRef = useRef(null);
  const wasActive = useRef(!!activity);
  useEffect(() => {
    const isActive = !!activity;
    if (isActive && !wasActive.current && statusRef.current) statusRef.current.focus();
    wasActive.current = isActive;
  }, [activity]);
  return (
    <Box sx={{ mt: 0.5, mb: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box ref={statusRef} role="status" tabIndex={-1} sx={{ mt: 0, mb: 0 }}>
        {activity ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0, mb: 0, fontSize: 11.5, color: "var(--text-secondary)" }}>
            {activity.state === "in-progress" ? <CircularProgress size={12} /> : null}
            {activityLine(activity, label)}
          </Box>
        ) : null}
      </Box>
      {/* m5 (N50 fix round 1): Regenerate and the history summary share ONE
       *  wrapped row instead of two stacked full-width rows -- each still
       *  keeps the 44px touch-target floor through its own padding
       *  (TOUCH_TARGET_SX), but they no longer cost two separate 44px bands
       *  of mostly-empty phone-width chrome per section. */}
      {!activity && enabled ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0, mb: 0, ...WRAP_ROW_SX }}>
          <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onRegenerateSection?.(section)}>
            Regenerate
            <Box component="span" sx={VISUALLY_HIDDEN_SX}>{` ${label}`}</Box>
          </Button>
          {earlier.length > 0 ? (
            <Box component="details" sx={{ mt: 0, mb: 0, "&:not([open]) > :not(summary)": { display: "none" } }}>
              <Box
                component="summary"
                sx={{ ...TOUCH_TARGET_SX, mt: 0, mb: 0, fontSize: 11.5, color: "var(--text-secondary)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
              >
                {`${label} version history (${earlier.length} earlier ${earlier.length === 1 ? "version" : "versions"})`}
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.375, mt: 0.5, mb: 0 }}>
                {earlier.map((rev) => (
                  <Box key={rev.revision} sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0, mb: 0, fontSize: 11.5 }}>
                    {/* N45 hand-off (N50 fix round 2): `rev.restorable === false`
                     *  is the ONLY falsy value that hides the control -- a
                     *  missing field (every landed fixture today) counts as
                     *  restorable, per that chunk's own contract. DX section 8 /
                     *  AC-N50.19 forbid a disabled Button here, so the control is
                     *  replaced outright, never disabled. */}
                    {rev.restorable === false ? (
                      <Box component="span" sx={{ mt: 0, mb: 0, color: "var(--text-secondary)", fontStyle: "italic" }}>
                        Can&apos;t be restored
                      </Box>
                    ) : (
                      <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onRestoreRevision?.(section, rev.revision)}>
                        Restore
                        <Box component="span" sx={VISUALLY_HIDDEN_SX}>{` ${label} version ${rev.revision}`}</Box>
                      </Button>
                    )}
                    <Box component="span" sx={{ mt: 0, mb: 0, color: "var(--text-secondary)" }}>
                      {rev.restoredFrom != null ? "restored version" : "earlier version"} {rev.revision}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
        </Box>
      ) : null}
      {message ? (
        <Box role="alert" sx={{ mt: 0, mb: 0, fontSize: 12.5, color: "var(--text-secondary)" }}>
          {message}
        </Box>
      ) : null}
    </Box>
  );
}
