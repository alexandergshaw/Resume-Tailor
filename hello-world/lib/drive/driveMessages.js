// Every user-facing Drive string, keyed by outcome code where the design
// calls for that and as small pure builders elsewhere. Copy is taken
// VERBATIM from UX.md rev 2 (adversarially reviewed) -- nothing here is
// improvised wording. Two rules that copy follows, load-bearing enough to
// restate here (UX.md §6.6):
//
//   1. Never blame Google for the app's own decision. The upload ceiling is
//      THIS APP's multipart-transport choice, not a Drive limit (Drive
//      itself accepts files up to 5 TB) -- so the oversize message never
//      says "Drive's limit" and always offers a recovery that exists (the
//      local .docx download, unaffected by this guard).
//   2. Never assume an administrator. Most users are on personal Gmail with
//      none, and a permission refusal is usually about the app's own
//      "Resume Tailor" folder, not an org policy -- so the refused message
//      says "if" an organisation manages the account, never states it as
//      fact.

// ---------------------------------------------------------------------------
// 1. The save control's label (§6.1)
// ---------------------------------------------------------------------------

export const DRIVE_SAVE_LABEL = {
  connectAndSave: "Connect Drive & save",
  reconnectAndSave: "Reconnect Drive & save",
  waitingForGoogle: "Waiting for Google…",
  saving: "Saving…",
};

// saveControlLabel({ status, scopeCount }) -> string | null
//
// `status` one of: "unconfigured" | "checking" | "statusFailed" |
// "connected" | "disconnected" | "consentPending" | "tokenRejected" |
// "saving" | "promptPending" | "noScopes". Returns null for the states that
// render no control at all (AC-S2/AC-S25/AC-S29).
export function saveControlLabel({ status, scopeCount } = {}) {
  switch (status) {
    case "unconfigured":
    case "checking":
    case "noScopes":
      return null;
    case "statusFailed":
    case "disconnected":
      return DRIVE_SAVE_LABEL.connectAndSave;
    case "consentPending":
      return DRIVE_SAVE_LABEL.waitingForGoogle;
    case "tokenRejected":
      return DRIVE_SAVE_LABEL.reconnectAndSave;
    case "saving":
    case "promptPending":
      return DRIVE_SAVE_LABEL.saving;
    case "connected":
      return scopeCount === 1 ? "Save to Drive" : `Save ${scopeCount} to Drive`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Settings -- DriveButton (§6.7)
// ---------------------------------------------------------------------------

export const DRIVE_SETTINGS_LABEL = {
  checking: "Checking…",
  connect: "Connect Drive",
  connected: "Drive connected",
  disconnect: "Disconnect Drive",
  disconnecting: "Disconnecting…",
};

// ---------------------------------------------------------------------------
// 3. Result region -- the leading line, one slot (§6.3)
// ---------------------------------------------------------------------------

export const DRIVE_IN_YOUR_DRIVE = "In your Drive";

export function savedSummary(count) {
  return count === 1 ? "Saved 1 document to Drive." : `Saved ${count} documents to Drive.`;
}

export function partialSavedSummary(savedCount, totalCount) {
  return `Saved ${savedCount} of ${totalCount} documents to Drive.`;
}

export function downloadedSummary(count) {
  return count === 1
    ? "Downloaded 1 document from Drive."
    : `Downloaded ${count} documents from Drive.`;
}

// ---------------------------------------------------------------------------
// 4. The strip -- per-scope rows (§6.4)
// ---------------------------------------------------------------------------

// "<label> — " -- the row's leading text before the link Drive returned the
// name for (AC-S13: the visible link text is Drive's name, not computed
// here).
export function savedRowPrefix(scopeLabel) {
  return `${scopeLabel} — `;
}

// The "saved to a new Doc" row embeds two links mid-sentence (B-3). Exposed
// as the three text fragments around them so the caller can interleave real
// <a> elements; joining fragments[0] + linkA + fragments[1] + linkB +
// fragments[2] reproduces the UX.md sentence exactly.
export function savedAsNewDocFragments(scopeLabel) {
  return [
    `${scopeLabel} — saved to a new Doc: `,
    ". Your earlier Doc, with the changes made in your Drive, is still there: ",
    ".",
  ];
}

// Ends with a trailing space, not a period-and-stop: the row's caller
// (`driveSaveBatch.js`'s `buildRow`) appends the new Doc's link right after
// this text, so the space is the word-boundary before that link, not
// decorative whitespace.
export function replacedRowText(scopeLabel) {
  return `${scopeLabel} — the previous Doc was no longer in your Drive, so a new one was created. `;
}

// Parameterised on `scopeLabel` like the rest of this section (not hardcoded
// to "Cover letter") because the row's leading label is `buildRow`'s own
// scope label, not this module's business -- today NO_BYTES only ever
// happens for the cover-letter scope (the rebuild-cover-letter recovery
// sentence that follows is itself cover-letter-specific and does not
// generalise), but the label slot stays a parameter so this stays one
// definition importable as-is rather than a template callers have to
// special-case around.
export function coverNoBytesRow(scopeLabel) {
  return `${scopeLabel} — couldn't rebuild the document. Regenerate the cover letter, or upload your cover letter template (.docx), then save again.`;
}

export function dismissedRow(scopeLabel) {
  return `${scopeLabel} — not saved. The Doc in Drive has changed since the app last saved it.`;
}

export function scopeFailureRow(scopeLabel, reasonSentence) {
  return `${scopeLabel} — wasn't saved. ${reasonSentence}`;
}

// ---------------------------------------------------------------------------
// 4b. The download control's label (§6.1's sibling for the download path)
// ---------------------------------------------------------------------------
//
// WAVE3-SEAMS.md M-1: this is the THIRD time this defect class has shipped
// in this feature -- a component re-deriving strings driveMessages.js does
// not yet own, instead of this module owning them from the start.
// `DriveActions.js` used to hand-roll these three literals inline; they are
// UX.md copy just like every other Drive string (`Download older Drive
// copy` is quoted verbatim in `AC.md`/`UX.md`), so they belong here.
export const DRIVE_DOWNLOAD_LABEL = {
  download: "Download from Drive",
  downloadStale: "Download older Drive copy",
  downloading: "Downloading…",
};

// ---------------------------------------------------------------------------
// 5. Captions (§6.5)
// ---------------------------------------------------------------------------

export const DRIVE_CONVERSION_CAPTION =
  "Drive copies are converted by Google Docs and can differ in formatting from the .docx you download here.";

// "Differs from", never an ordering claim ("older", "newer", "out of date",
// "behind"). AC-P7: after a page reload the app no longer holds the user's
// hand-edits (page.js persists only a slim status summary), so the Drive
// copy can legitimately be NEWER than what's on screen -- "older" would then
// be a confident falsehood in the one flow whose entire job is telling the
// user which document to trust. "Differs from" is true in both directions
// and is the only claim the app can actually support. Do not "fix" this back
// into ordering language -- UX.md rev 2's own caption shipped that mistake
// and was overruled on this exact point.
export const DRIVE_STALE_CAPTION =
  "The Drive copy differs from the document shown here. Save to update it.";

export const DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION = "Reconnect Drive to download these as .docx.";

// hiringEmailDriveNote(scopeCount) -- parameterised on the scopes that
// actually exist so a posting with no cover letter is never told about one
// (M-10).
export function hiringEmailDriveNote(scopeCount) {
  return scopeCount === 1
    ? "Save to Drive saves your resume — the hiring email isn't a document."
    : "Save to Drive saves your resume and cover letter — the hiring email isn't a document.";
}

export const DRIVE_FOLDER_CAPTION = "Documents are saved to a “Resume Tailor” folder in your Drive.";

export const DRIVE_DISCONNECT_NOTE =
  "Disconnecting only removes this app's access — your Docs stay in Drive.";

// ---------------------------------------------------------------------------
// 6. Batch-level failures -- one row, not attributed to a scope (§6.6)
// ---------------------------------------------------------------------------

export const DRIVE_BATCH_MESSAGE = {
  consentRefused: "Drive access wasn't granted — nothing was saved.",
  popupBlocked: "Your browser blocked the Google window. Allow pop-ups for this site, then try again.",
  popupClosedNoResult: "The Google window closed before access was granted. Nothing was saved.",
  offline: "Couldn't reach Google Drive — check your connection.",
  reconnectSave: "Your Drive connection expired. Reconnect and this save will finish on its own.",
  reconnectDownload: "Your Drive connection expired. Reconnect, then download again.",
  appSignedOut: "You've been signed out. Sign in again, then save.",
  storageFull: "Your Google Drive is out of space. Free some up, then save again.",
  refused:
    "Google Drive wouldn't accept this file. If your account is managed by an organisation, its policy may block this; otherwise check that the “Resume Tailor” folder still exists in your Drive and that you can edit it.",
  tooLargeUpload: "This document is too large for the app to upload to Drive. Download it as .docx here instead.",
  tooLargeExport: "That Google Doc is too large for the app to download from Drive. Open it in Google Docs and export it there.",
  gone: "That Google Doc is no longer in your Drive. Save again to create a new one.",
  transient: "Google Drive is busy. Try saving again in a moment.",
  misconfigured: "Drive saving isn't set up on this server.",
  tokenUnreadable: "Couldn't finish connecting to Drive. Try again.",
};

// driveErrorMessage(code, { path } = {}) -> string | null
//
// Maps an outcome code to its exact UX.md string. Accepts BOTH taxonomies
// this feature produces: the route's machine `error` codes (ARCH.md §7.3 --
// "Unauthorized" · "not_connected" · "drive_unconfigured" ·
// "drive_storage_unavailable" · "payload_too_large" · "drive_storage_full" ·
// "drive_refused" · "drive_transient" · "drive_gone") and
// classifyDriveError's shorter category names (lib/drive/driveErrors.js:
// "reconnect" | "storage-full" | "refused" | "transient" | "gone" |
// "unknown"), plus the client-only codes that never reach either (never
// touch the network, so never get a machine code at all): "consent-refused"
// | "popup-blocked" | "popup-closed" | "offline" | "token-unreadable".
//
// `path` disambiguates the two codes whose wording depends on which action
// was in flight: "save" | "download". `conflict_foreign` / `conflict_session`
// are intentionally NOT handled here -- those resolve through the overwrite
// prompt (AC-S15-S18), never this batch-failure row. "unknown" has no
// generic catch-all copy in UX.md (every real case is named deliberately),
// so it returns null like any other unrecognised code.
//
// Two casings of "unauthorized" are both real inputs, not a typo to settle
// one way: `lib/experience/apiAuth.js`'s `unauthorized()` -- the repo-wide
// convention 11 routes already share -- emits the machine code
// `"Unauthorized"` (capitalised, ARCH.md §7.3), while `driveSaveBatch.js`'s
// `BATCH_ERROR.UNAUTHORIZED` is the lowercase `"unauthorized"` (its own
// client-side batch-abort vocabulary, never a route's `error` field). Both
// must resolve to the same copy, so the lowercase form is an ADDED alias,
// not a rename -- the capitalised key stays exactly as routes already emit
// it (WAVE2-SEAMS.md MAJOR-4).
const ERROR_CODE_TO_KEY = {
  Unauthorized: "appSignedOut",
  unauthorized: "appSignedOut",
  not_connected: "reconnect",
  reconnect: "reconnect",
  drive_unconfigured: "misconfigured",
  drive_storage_unavailable: "misconfigured",
  misconfigured: "misconfigured",
  payload_too_large: "tooLarge",
  "too-large": "tooLarge",
  drive_storage_full: "storageFull",
  "storage-full": "storageFull",
  drive_refused: "refused",
  refused: "refused",
  drive_transient: "transient",
  transient: "transient",
  drive_gone: "gone",
  gone: "gone",
  "consent-refused": "consentRefused",
  "popup-blocked": "popupBlocked",
  "popup-closed": "popupClosedNoResult",
  offline: "offline",
  "token-unreadable": "tokenUnreadable",
};

export function driveErrorMessage(code, { path = "save" } = {}) {
  const key = ERROR_CODE_TO_KEY[code];
  if (!key) return null;
  if (key === "reconnect") {
    return path === "download" ? DRIVE_BATCH_MESSAGE.reconnectDownload : DRIVE_BATCH_MESSAGE.reconnectSave;
  }
  if (key === "tooLarge") {
    return path === "download" ? DRIVE_BATCH_MESSAGE.tooLargeExport : DRIVE_BATCH_MESSAGE.tooLargeUpload;
  }
  return DRIVE_BATCH_MESSAGE[key];
}

// ---------------------------------------------------------------------------
// 7. Announcements (§8) -- polite/alert live-region text
// ---------------------------------------------------------------------------

export const DRIVE_ANNOUNCE = {
  connectStart: "Opening the Google permission window…",
  saveStart: "Saving to Google Drive…",
  exportStart: "Downloading from Google Drive…",
  coverNotSavedAlert: "Cover letter wasn't saved: couldn't rebuild the document.",
};

// WAVE3-SEAMS.md MAJOR (§5): UX.md §8 rule 7 -- "Every Drive action clears
// both regions before writing its first message" -- has no mechanism
// anywhere in the wave that built it. The three `*Start` strings above are
// polite-side only; a caller that sets `politeMessage` from one of them and
// forgets `alertMessage` leaves the ALERT region's stale value in place. On
// a failure -> retry -> IDENTICAL failure sequence that omission means the
// alert region's text never changes at all ("" is never written in
// between), so React bails on the unchanged string and a screen-reader user
// hears nothing on the retry -- proven with a MutationObserver: 0 alert
// mutations across the whole cycle.
//
// The fix is structural, not caller discipline: these three functions
// return `{polite, alert}` as ONE object, so clearing the region not in use
// is inseparable from announcing the one that is -- there is no call shape
// that sets one without the other. This mirrors the polite region's own
// existing protection (a start sentence before every outcome, so no two
// consecutive values are ever identical) and gives the alert region the
// same property via its own distinct value in the sequence: a failure
// message is always preceded by "" (the start clear), so even an
// IDENTICAL failure on retry is never adjacent to itself.
//
// Deliberately NOT a nonce or zero-width character -- that was tried in
// this repo before and leaked U+200B into copied text (`mui-a11y-traps`
// item 6, `AC.md` AC-A6).
export function driveAnnounceStart(kind) {
  switch (kind) {
    case "connect":
      return { polite: DRIVE_ANNOUNCE.connectStart, alert: "" };
    case "export":
      return { polite: DRIVE_ANNOUNCE.exportStart, alert: "" };
    case "save":
    default:
      return { polite: DRIVE_ANNOUNCE.saveStart, alert: "" };
  }
}

// ---------------------------------------------------------------------------
// 8. Overwrite conflict prompt (§5.3) -- DriveOverwriteDialog
// ---------------------------------------------------------------------------

// `docNames` is the display name(s) of the conflicted Doc(s) -- 1 for a
// single-scope conflict, 2 for "both documents conflicted" (one prompt,
// never two -- UX.md §5.3/§5.7). Every function below derives
// singular/plural from `docNames.length` itself, rather than taking a
// separate `plural` flag, so a caller can never drift the heading, body, and
// button labels out of sync by computing "plural" differently in two places.
function isPlural(docNames) {
  return (Array.isArray(docNames) ? docNames : []).length > 1;
}

export function overwriteHeading(docNames) {
  const names = Array.isArray(docNames) ? docNames : [];
  return isPlural(names)
    ? "Both Docs have changed in your Drive since this app last saved them."
    : `“${names[0] ?? ""}” has changed in your Drive since this app last saved it.`;
}

export function overwriteBody(docNames) {
  return isPlural(docNames)
    ? "That could be edits, or just renames, moves, or comments — the app can't tell which. Overwriting replaces whatever is in the Docs now, and this app can't undo it."
    : "That could be an edit, or just a rename, a move, or a comment — the app can't tell which. Overwriting replaces whatever is in the Doc now, and this app can't undo it.";
}

// "Save as a new Doc[s]" -- the safe, first-in-DOM-order action (UX.md §5.4).
export function saveAsNewDocLabel(docNames) {
  return isPlural(docNames) ? "Save as new Docs" : "Save as a new Doc";
}

// "Overwrite the Doc[s]" -- the only destructive action in this feature.
export function overwriteDocLabel(docNames) {
  return isPlural(docNames) ? "Overwrite the Docs" : "Overwrite the Doc";
}

// "Not now" AND Escape (both routes call the same dismissal callback --
// DriveOverwriteDialog.js). UX.md never pluralises this one; it never
// mentions a Doc count at all.
export const DRIVE_OVERWRITE_DISMISS_LABEL = "Not now";
