"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import { saveControlLabel, DRIVE_DOWNLOAD_LABEL } from "@/lib/drive/driveMessages";

// The two Drive controls that live directly in the modal's `DialogActions`
// (AC-K4) -- "Save … to Drive" and "Download from Drive". This is a
// presentational component: all state (`status`, `connected`, the
// per-batch busy flags) is owned by `useDriveDocuments` (not built in this
// wave) and arrives as props; every callback is dispatched straight through
// with no network call and no retry logic here (ARCH.md §11).
//
// CAPTION OWNERSHIP RULING (WAVE3-SEAMS.md BLOCKER B2): this component and
// `DriveResultRegion` were both built to render all four Drive captions
// (conversion, stale, reconnect-to-download, hiring-email), so every user
// saw each one twice, with a colour disagreement on top (this file used
// `var(--warning)` for the stale caption; `DriveResultRegion` used
// `var(--text-muted)`). Ruling: `DriveResultRegion` (the strip) is the SOLE
// owner of every caption. This component owns ONLY the two controls
// (buttons) that sit in `DialogActions`. Reasons, in order:
//   1. UX.md rev 2 §3 (rendered here at the review's own line numbers,
//      160-161): "No long string is ever a sibling of the buttons. Every
//      sentence, count, caption and link is in the strip. The bar holds
//      ≤ 2 short labels." -- that is THIS component ("the bar"); it forbids
//      captions here outright.
//   2. AC-K4 says this component "binds only the controls" to
//      `DialogActions`.
//   3. UX.md §13's layout diagram draws the conversion caption INSIDE the
//      `DriveResultRegion` box, not beside the download button.
// `ARCH.md:181` assigned one caption to this component instead -- that
// reading loses to the two UX.md citations above, which is why it's not
// followed here; noted rather than silently resolved.
//
// A second, independent conflict the same review found: this component used
// to gate the hiring-email note on `activeScope === "email"` (UX.md §6.5),
// while AC-S19 requires it rendered always, not only on the email tab.
// Per this fix's own instructions, a UX.md-vs-AC.md CONFLICT resolves to
// UX.md's copy/behaviour (the source of record, through two adversarial
// reviews) -- so the gate itself was the correct call, UX.md-wise. It is
// moot here regardless: the caption no longer lives in this component at
// all, so there is no gate left to get wrong. The caller now owns deciding
// when to pass `hiringEmail` into `DriveResultRegion` (see that file).
//
// DELIBERATELY carries no `Tooltip` anywhere (UX.md §2.2): a Tooltip on a
// disabled-looking control steals its accessible name (AC-A2) and is
// unreachable on touch (AC-M8). Every caveat this component still shows is
// plain, always-visible text instead.
//
// Nothing here is ever the native `disabled` attribute (AM-14/AC-G3). A
// `disabled` <button> is blurred and dropped from the tab order by the
// browser -- exactly the mid-action focus loss this feature's owner
// rejected. In-flight states use `aria-disabled` + `aria-busy` + a click
// guard in the handler itself instead; the click guard, not the attribute,
// is what actually prevents a double activation from doing anything.
export default function DriveActions({
  // "unconfigured" | "checking" | "statusFailed" | "connected" |
  // "disconnected" | "consentPending" | "tokenRejected" | "saving" |
  // "promptPending" | "noScopes" -- the same enum `driveMessages.js`'s
  // `saveControlLabel` accepts.
  status = "unconfigured",
  // Number of available DOCX_SCOPES (0, 1 or 2) for the current posting.
  scopeCount = 0,
  // Live Drive connection, owned by `useDriveDocuments` independently of
  // `status` -- AC-D1 (amended) gates `Download from Drive` on a stored
  // reference AND a live connection, never on `status` alone.
  connected = false,
  // Whether at least one scope already has a stored (or in-session) Drive
  // file reference for this posting (AC-D1).
  hasDriveReference = false,
  // AC-P7/AC-P8: the Drive copy no longer matches what's on screen -- swaps
  // the download label (the staleness CAPTION is `DriveResultRegion`'s job
  // now, per this file's header ruling), but the control stays enabled
  // (AC-G3 forbids hiding the reason behind a disabled control).
  isStale = false,
  // "idle" | "exporting" -- AC-D8's in-flight state for the export path.
  downloadStatus = "idle",
  // () => void. Handles every non-consent-pending, non-saving activation:
  // cold start ("Connect Drive & save"), warm save, and reconnect. Exactly
  // ONE control and ONE handler across all three so AC-K1/AC-K2 stay a
  // single click -- the connect-vs-save branch is the caller's job, not
  // this component's (UX.md §1).
  onSave,
  // () => void. Fired instead of `onSave` while `status === "consentPending"`
  // -- re-focuses the open consent window rather than starting a second one
  // (B-1/AC-C14). Never a no-op: the control must stay actionable through
  // this whole state, which is why it does NOT carry `aria-disabled`
  // (UX.md §6.1's consent row lists only `aria-busy`, unlike every other
  // in-flight row, which lists both -- that omission is deliberate, not an
  // oversight).
  onRefocusConsent,
  // () => void. Downloads every referenced scope in one activation (AC-D2).
  onDownload,
}) {
  // AC-C21/AC-R8 ("render nothing at all" for `configured:false`) and
  // UX.md §6.2 ("no `Checking…` in the action bar and no skeleton" -- a
  // placeholder that becomes a button 40ms later is a layout jump, so the
  // pending status call renders identically to the unconfigured case).
  if (status === "unconfigured" || status === "checking") return null;

  // AC-S25/AC-S29: absent when no DOCX_SCOPES scope is available, exactly
  // like the unconfigured case -- regardless of what `status` claims, since
  // there is nothing to save either way. `status === "noScopes"` is
  // accepted too so a caller that already computed it doesn't have to
  // special-case `scopeCount` on top.
  const saveHidden = scopeCount === 0 || status === "noScopes";
  const saveLabel = saveHidden ? null : saveControlLabel({ status, scopeCount });

  const isConsentPending = status === "consentPending";
  // "saving" and "promptPending" share one visible label ("Saving…") and
  // one behaviour: the whole batch is in flight, waiting either on the
  // network or on the user's answer to the conflict prompt (UX.md §5.8).
  const isSaving = status === "saving" || status === "promptPending";

  const handleSaveClick = () => {
    if (isSaving) return; // §5.8: "Its click handler is a no-op."
    if (isConsentPending) {
      onRefocusConsent?.();
      return;
    }
    onSave?.();
  };

  const isExporting = downloadStatus === "exporting";
  // §5.8: exporting a Doc while a save's conflict prompt is undecided would
  // hand the user bytes whose fate isn't settled yet, so Download is
  // blocked for the same duration as a save -- but it is not ITSELF busy,
  // so it gets `aria-disabled` without `aria-busy` in that case (contrast
  // the exporting case just below, which gets both).
  const downloadBlockedBySave = isSaving && !isExporting;
  const downloadDisabled = isExporting || downloadBlockedBySave;

  const handleDownloadClick = () => {
    if (downloadDisabled) return;
    onDownload?.();
  };

  const downloadLabel = isExporting
    ? DRIVE_DOWNLOAD_LABEL.downloading
    : isStale
      ? DRIVE_DOWNLOAD_LABEL.downloadStale
      : DRIVE_DOWNLOAD_LABEL.download;

  // AC-D1 (amended): a stored/in-session reference alone renders a control
  // that would just 401 for a disconnected user -- an un-followable loop.
  // Both preconditions are required. When disconnected with a stored
  // reference, this component renders NOTHING for the download path -- no
  // button (would 401) and, per the caption ruling above, no caption either;
  // `DriveResultRegion`'s `reconnectCaption` prop is the caller's route for
  // telling the user why (B-6).
  const showDownloadControl = hasDriveReference && connected;

  const saveLabelId = "drive-save-control-label";

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", minWidth: 0 }}>
      {saveLabel ? (
        <Button
          id={saveLabelId}
          onClick={handleSaveClick}
          aria-disabled={isSaving ? "true" : undefined}
          aria-busy={isSaving || isConsentPending ? "true" : undefined}
          startIcon={isSaving || isConsentPending ? <CircularProgress size={14} /> : <CloudUploadIcon />}
          variant="outlined"
          sx={{ textTransform: "none", minHeight: { xs: "44px", sm: "36px" } }}
        >
          {saveLabel}
        </Button>
      ) : null}

      {showDownloadControl ? (
        <Button
          onClick={handleDownloadClick}
          aria-disabled={downloadDisabled ? "true" : undefined}
          aria-busy={isExporting ? "true" : undefined}
          aria-describedby={downloadBlockedBySave ? saveLabelId : undefined}
          startIcon={isExporting ? <CircularProgress size={14} /> : <CloudDownloadIcon />}
          variant="text"
          sx={{ textTransform: "none", minHeight: { xs: "44px", sm: "36px" } }}
        >
          {downloadLabel}
        </Button>
      ) : null}
    </Box>
  );
}
