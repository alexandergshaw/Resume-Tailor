"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DOCX_SCOPES, SCOPE_LABEL } from "../../lib/tailor/documentScopes";
import { buildPreviewBlob, previewBlobArgs, scopeText } from "../../lib/document/previewBlob";
import { triggerBlobDownload } from "../../lib/document/download";
import { driveDocName } from "../../lib/drive/driveNames";
import { DRIVE_UPLOAD_MAX_BYTES } from "../../lib/drive/driveSize";
import { sha256Hex, driveCopyState } from "../../lib/drive/contentHash";
import { DOCX_MIME } from "../../lib/drive/driveMime";
import {
  driveSaveBatch,
  SCOPE_OUTCOME,
  BATCH_ERROR,
} from "../../lib/drive/driveSaveBatch";
import { driveErrorMessage, downloadedSummary, driveAnnounceStart } from "../../lib/drive/driveMessages";

// Wave 5A — the client-side Drive state machine (`ARCH.md` §11, module table
// row 24). This is the hook that finally joins the three Drive components
// (`DriveActions`, `DriveResultRegion`, `DriveOverwriteDialog` — Wave 3,
// already committed) to the seven Drive routes (Wave 4, already committed).
// It mounts INSIDE `app/components/DocumentPreviewMount.js` (`AC-R2`), which
// this wave does NOT touch — a later, single-agent wave (6A) wires this
// hook's return value onto the three components' actual JSX. This file's
// job is to make that wiring trivial and hard to get wrong: every field
// below is named after the prop it feeds, and the block comment on the
// return statement says exactly which component/prop consumes it.
//
// SIX OBLIGATIONS THIS HOOK DISCHARGES (recorded so a future edit doesn't
// silently reopen one of them):
//   1. The status route already renames `google_email` -> `email`
//      (`app/api/drive/status/route.js`). `checkStatus()` below reads
//      `body.email` directly; nothing here re-derives it from a column name.
//   2. The oauth2callback route already clears the state cookie on every
//      exit path. This hook never touches cookies at all.
//   3. `leadingLine` is a structured descriptor. `driveSaveBatch(...)`
//      already returns `{kind, count|saved, total}` (WAVE3-SEAMS.md
//      BLOCKER B1 was fixed at the SOURCE, in `lib/drive/driveSaveBatch.js`,
//      not by an adapter here) and `buildDownloadResult()` below returns the
//      same descriptor shape for the download path's `{kind:"downloaded"}`
//      case. Both are passed to `DriveResultRegion` untouched.
//   4. Caption ownership: `DriveResultRegion` owns all four captions
//      (WAVE3-SEAMS.md BLOCKER B2, ruling recorded in that file's own
//      header). This hook computes `showConversionCaption` /
//      `reconnectCaption` / `hiringEmail` for that component only, and
//      never passes caption text to `DriveActions` (which no longer even
//      accepts such a prop — confirmed against the committed component).
//   5. `isStale` is computed ONCE, in `currentHashByScope` / the `isStale`
//      value below, and handed to BOTH `DriveActions.isStale` and
//      `DriveResultRegion.stale` from the same field in this hook's return
//      value — see the comment on the return statement. No second call site
//      anywhere else in this feature is allowed to derive it independently.
//   6. `announcement` is always a complete `{polite, alert}` object, never
//      undefined and never split into two props — `DriveResultRegion`
//      deliberately THROWS on anything else (see that file's header), and
//      every `setAnnouncement` call site below sets the whole object.
//
// ROUTE CONTRACTS this hook matches rather than re-derives:
//   - `POST /api/drive/save` takes `multipart/form-data` with the raw
//     `Blob` (part `file`) plus JSON `meta` — never base64. The 4 MB
//     pre-flight guard imports `DRIVE_UPLOAD_MAX_BYTES` from
//     `lib/drive/driveSize.js` rather than re-typing the number.
//   - `onConflict` is exactly `"overwrite"` or `"new"` — the two literal
//     strings the save route branches on.
//   - `GET /api/drive/documents?jobId=` returns
//     `{documents: {resume?, cover?}}`, `{fileId, contentHash, version,
//     webViewLink}` per scope — merged into `driveRefs` verbatim.
//   - Every save carries `meta.knownRef` from this hook's own in-session
//     `driveRefs`, so a durable-row miss (a lost `drive_documents` upsert,
//     or no `position_id` at all) still lets the very next save find the
//     Doc it just created instead of creating a duplicate.
//   - `GET /api/drive/status` alone can answer 200 `{connected:false,
//     configured:false}`; every other route 503s when unconfigured. This
//     hook never calls a Drive route when `configured === false` (except
//     `status` itself, which is what discovers that value in the first
//     place).
//
// CONTENT HASH (`AC-P6`). `drive_content_hash` is SHA-256 over the tuple
// `["v1", scope, text, edited, engineDocxDigest, docxPath, templateDigest]`
// — not the text alone (a version switch or a template swap can change the
// resolved bytes with the text byte-identical) and never the produced .docx
// bytes (JSZip stamps a wall-clock timestamp into every build, so hashing
// output would report "stale" against itself). `lib/drive/contentHash.js`
// deliberately supplies only the two primitives (`sha256Hex`,
// `driveCopyState`) and says explicitly that assembling the tuple is the
// CALLER's job — `computeCurrentHash` below is that assembly, built once,
// reused for both the hash this hook SENDS with a save (`meta.contentHash`)
// and the hash it compares against a stored reference for staleness, so the
// two can never drift onto two different formulas. It reuses
// `previewBlobArgs` (the exact inputs `resolveDocumentBlob` would branch on)
// rather than re-deriving `edited`/`docxPath`/the engine doc a second time.
//
// CLICK COST (`AC-K1/K2/K3/K5`). Cold start is ONE activation:
// `saveToDrive()` opens the consent popup AND remembers the save request in
// `pendingSaveArgsRef`; the popup's own success message (or, on mobile where
// `window.opener` is commonly severed, the 3s status poll — never depend on
// `postMessage` alone) resumes the save with NO second call from the
// caller. A second activation while consent is pending re-focuses the
// existing popup (`onRefocusConsent`) rather than opening another. Warm
// save is one activation for every available scope, sequentially (never a
// scope/folder/format picker). Download is one activation for every
// referenced scope. The ONLY confirmation this hook ever surfaces is the
// overwrite conflict prompt.

const NAME_KIND = { resume: "Resume", cover: "CL" };
const FILE_NAME_FIELD = { resume: "resumeFileName", cover: "coverLetterFileName" };

const BATCH_KEY = "drive:batch";
const EXPORT_KEY = "drive:export";

const POPUP_NAME = "drive-oauth";
const POPUP_FEATURES = "width=520,height=680,popup=1";
const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_TIMEOUT_MS = 120000;

const EMPTY_ANNOUNCEMENT = { polite: "", alert: "" };

// This hook's own one-time fallback for a download-side error code
// `driveMessages.js` has no copy for — the same pattern
// `lib/drive/driveSaveBatch.js`'s `UNKNOWN_ERROR_MESSAGE` uses, and for the
// same reason: `driveErrorMessage` deliberately returns `null` for anything
// it doesn't recognise rather than owning a generic catch-all itself.
const UNKNOWN_DOWNLOAD_MESSAGE = "Something went wrong downloading from Google Drive. Try again.";

function scopeLabel(scope) {
  return SCOPE_LABEL[scope] || "Document";
}

// Memoised per `File` object, module-level (AC-P6: "memoised in a WeakMap
// keyed on the File"), so re-hashing the same uploaded template across
// scopes/renders/saves in one session is free after the first hash. A new
// upload is a NEW File object, so this can never serve a stale digest for a
// swapped template.
const templateDigestCache = new WeakMap();

async function templateDigestFor(file) {
  if (!file || typeof file.arrayBuffer !== "function") return "";
  if (templateDigestCache.has(file)) return templateDigestCache.get(file);
  const buf = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  templateDigestCache.set(file, hex);
  return hex;
}

// AC-P6's tuple, assembled from exactly the inputs `resolveDocumentBlob`
// itself branches on (`previewBlobArgs` — the same pure function
// `buildPreviewBlob` calls), so this can never drift from what the save
// path actually uploads. `templateDigest` is computed ONLY when branch 5
// (the uploaded-template fallback) is the branch that would fire — the sole
// condition `!engineDocxB64 && !docxPath` — exactly like AC-P6 specifies,
// so a résumé that has real engine bytes never pays for hashing a template
// that isn't even read.
export async function computeCurrentHash(entry, scope, { resumeFile, coverLetterFile, text } = {}) {
  const args = previewBlobArgs(entry, scope, { resumeFile, coverLetterFile, text });
  if (!args) return null;
  const { text: resolvedText, edited, engineDocxB64, docxPath, uploadedTemplate } = args;
  const templateDigest =
    !engineDocxB64 && !docxPath ? await templateDigestFor(uploadedTemplate) : "";
  const engineDocxDigest = await sha256Hex(engineDocxB64 || "");
  const tuple = ["v1", scope, resolvedText, edited, engineDocxDigest, docxPath || "", templateDigest];
  return sha256Hex(JSON.stringify(tuple));
}

// Normalises a route's machine `error` code onto `driveSaveBatch`'s own
// vocabulary ("reconnect"|"storage-full"|"refused"|"transient"|"gone"|
// "unknown"). Load-bearing, not decorative: `driveSaveBatch`'s
// `connectionLost` (MAJ-13) checks `errorKind === "reconnect"` literally —
// passing the route's raw `"not_connected"` straight through as `errorKind`
// would satisfy `driveErrorMessage` (its table happens to accept both
// vocabularies) while silently making `connectionLost` never fire, which is
// exactly the kind of two-consumers-one-fact drift this feature keeps
// warning about.
export function errorKindFromRouteCode(code) {
  switch (code) {
    case "not_connected":
      return "reconnect";
    case "drive_storage_full":
      return "storage-full";
    case "drive_refused":
      return "refused";
    case "drive_transient":
      return "transient";
    case "drive_gone":
      return "gone";
    default:
      return "unknown";
  }
}

// The ten-member `status` enum `DriveActions`/`driveMessages.js`'s
// `saveControlLabel` expect, derived from the primitives this hook actually
// owns rather than duplicated ad hoc at each call site
// (WAVE3-SEAMS.md MAJOR M-5: "status" and "connected" are two
// representations of one fact that can otherwise contradict). In-flight
// states (`prompt`, `driveBusy`, `pendingConsent`) are checked FIRST and
// unconditionally so the control never flickers back to "Connect Drive &
// save" mid-operation just because `connected` hasn't been re-read yet.
export function deriveDriveStatus({
  configured,
  connected,
  pendingConsent,
  driveBusy,
  prompt,
  reconnectNeeded,
  statusCheckFailed,
}) {
  if (prompt) return "promptPending";
  if (driveBusy) return "saving";
  if (pendingConsent) return "consentPending";
  if (configured === false) return "unconfigured";
  if (statusCheckFailed) return "statusFailed";
  if (configured === null) return "checking";
  if (connected === null) return "checking";
  if (reconnectNeeded) return "tokenRejected";
  if (connected === false) return "disconnected";
  return "connected";
}

function downloadFailureRow(scope, message, errorKind) {
  return {
    scope,
    kind: "error",
    attributed: false,
    errorKind: errorKind ?? "unknown",
    segments: [{ type: "text", value: message }],
  };
}

// The download path's own tiny reducer — deliberately NOT `driveSaveBatch`,
// whose `SCOPE_OUTCOME` vocabulary (saved/no-bytes/too-large/dismissed) and
// whose `TOO_LARGE` row text (`DRIVE_BATCH_MESSAGE.tooLargeUpload`) are
// upload-specific; reusing it here would show an UPLOAD-sized-limit message
// for a DOWNLOAD-side 413. `driveErrorMessage(code, {path:"download"})`
// already carries the download-specific wording (`reconnectDownload`,
// `tooLargeExport`) for exactly this reason.
export function buildDownloadResult({ downloadedCount, failures }) {
  const rows = failures.map((f) => downloadFailureRow(f.scope, f.message, f.errorKind));
  const leadingLine = downloadedCount > 0 ? { kind: "downloaded", count: downloadedCount } : null;
  const polite = downloadedCount > 0 ? downloadedSummary(downloadedCount) : "";
  let alert = "";
  if (failures.length === 1) {
    alert = failures[0].message;
  } else if (failures.length > 1) {
    alert = `${failures.length} documents weren't downloaded.`;
  }
  return { rows, leadingLine, announcement: { polite, alert }, connectionLost: false };
}

export function useDriveDocuments({
  currentUser,
  tailoringMap,
  resumeFile,
  coverLetterFile,
  jobId,
  jobTitle,
  company,
  activeScope,
}) {
  const entry = (jobId && tailoringMap?.[jobId]) || null;

  const [configured, setConfigured] = useState(null);
  const [connected, setConnected] = useState(null);
  const [statusCheckFailed, setStatusCheckFailed] = useState(false);
  const [reconnectNeeded, setReconnectNeeded] = useState(false);
  const [pendingConsent, setPendingConsent] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("idle");
  const [driveRefs, setDriveRefs] = useState({});
  const [currentHashByScope, setCurrentHashByScope] = useState({ resume: null, cover: null });
  const [prompt, setPrompt] = useState(null);
  const [lastRows, setLastRows] = useState([]);
  const [lastLeadingLine, setLastLeadingLine] = useState(null);
  const [announcement, setAnnouncement] = useState(EMPTY_ANNOUNCEMENT);

  const isMountedRef = useRef(true);
  const inFlightRef = useRef(new Set()); // AC-S11a/AC-D10: a ref, not state.
  const popupRef = useRef(null);
  const pendingSaveArgsRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const messageListenerRef = useRef(null);
  const pendingConflictResolveRef = useRef(null);
  const conflictActivationRef = useRef(0);

  const applyBatchResult = useCallback((result) => {
    if (!isMountedRef.current) return;
    setLastRows(result.rows);
    setLastLeadingLine(result.leadingLine);
    setAnnouncement(result.announcement);
    if (result.connectionLost) {
      setConnected(false);
      setReconnectNeeded(true);
    }
  }, []);

  const checkStatus = useCallback(async ({ verify } = {}) => {
    const res = await fetch(`/api/drive/status${verify ? "?verify=1" : ""}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body) return null;
    return { configured: Boolean(body.configured), connected: Boolean(body.connected), email: body.email };
  }, []);

  // AC-C25 / DATA.md D-10: hydrated once per user, and reset on every user
  // switch — a module-scoped cache surviving sign-out would leak user A's
  // connection state and saved references to user B in this SPA.
  //
  // Every setState below runs inside the async IIFE, after `await
  // Promise.resolve()` -- never synchronously in the effect body itself.
  // That single microtask hop is what keeps this clear of
  // react-hooks/set-state-in-effect (which rejects a setState reachable
  // SYNCHRONOUSLY from an effect's own call stack, cascading into another
  // render before the browser can paint) without changing the OBSERVABLE
  // timing an app this size can tell apart from "immediate" -- the repo's
  // own precedent for this exact tradeoff is `useApplicationDocs.js`'s
  // header comment ("only ever written from a load's .then/.catch — never
  // synchronously from the effect below").
  useEffect(() => {
    let cancelled = false;
    const userId = currentUser?.id || null;

    (async () => {
      await Promise.resolve();
      if (cancelled || !isMountedRef.current) return;

      setConfigured(null);
      setConnected(null);
      setStatusCheckFailed(false);
      setReconnectNeeded(false);
      setDriveRefs({});
      setPrompt(null);
      setDriveBusy(false);
      setDownloadStatus("idle");
      setLastRows([]);
      setLastLeadingLine(null);
      setAnnouncement(EMPTY_ANNOUNCEMENT);
      pendingSaveArgsRef.current = null;
      inFlightRef.current.clear();
      if (popupRef.current && !popupRef.current.closed) {
        try {
          popupRef.current.close();
        } catch {
          // best-effort only
        }
      }
      popupRef.current = null;
      setPendingConsent(false);

      if (!userId) return;

      const status = await checkStatus({ verify: false }).catch(() => null);
      if (cancelled || !isMountedRef.current) return;
      if (!status) {
        setStatusCheckFailed(true);
        return;
      }
      setConfigured(status.configured);
      setConnected(status.configured ? status.connected : false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // AC-C23: a connect/disconnect made in another tab is reflected here
  // without a reload.
  useEffect(() => {
    const onFocus = () => {
      if (!currentUser?.id || configured === false) return;
      void (async () => {
        const status = await checkStatus({ verify: false }).catch(() => null);
        if (!isMountedRef.current || !status) return;
        // BLOCKER-1 fix: a status call that failed earlier
        // (statusCheckFailed) must be able to heal itself once a later
        // check succeeds -- otherwise deriveDriveStatus's now-reachable
        // "statusFailed" branch (checked ahead of configured/connected)
        // would stay stuck forever even after this effect has just
        // refreshed both values.
        setStatusCheckFailed(false);
        setConfigured(status.configured);
        setConnected(status.configured ? status.connected : false);
        if (status.connected) setReconnectNeeded(false);
      })();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [currentUser?.id, configured, checkStatus]);

  // Durable per-scope references for the open posting (AM-7). Independent
  // of connection liveness on purpose: a disconnected user with stored Docs
  // still needs `hasDriveReference=true` for the reconnect-to-download
  // caption (B-6) to make sense.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve(); // see the user-change effect's comment above
      if (cancelled || !isMountedRef.current) return;
      setDriveRefs({});
      setCurrentHashByScope({ resume: null, cover: null });
      if (!jobId || !currentUser?.id || configured === false) return;
      try {
        const res = await fetch(`/api/drive/documents?jobId=${encodeURIComponent(jobId)}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (cancelled || !isMountedRef.current || !body?.documents) return;
        setDriveRefs((prev) => ({ ...prev, ...body.documents }));
      } catch {
        // Best-effort hydrate only — the save/download paths still work
        // in-session off `driveRefs` alone (AC-P14).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, currentUser?.id, configured]);

  // AC-P6/AC-P7: recompute the currency hash whenever the document that
  // would be uploaded could have changed — a new/edited tailoring entry, or
  // a swapped template file.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve(); // see the user-change effect's comment above
      if (cancelled || !isMountedRef.current) return;
      if (!entry) {
        setCurrentHashByScope({ resume: null, cover: null });
        return;
      }
      // BLOCKER-2 fix: computeCurrentHash can THROW (crypto.subtle is
      // unavailable on a non-secure origin -- lib/drive/contentHash.js's
      // deliberate behaviour) rather than reject cleanly into a caller with
      // a .catch. This effect's neighbour above (:400-411) already guards
      // its fetch with try/catch for the same reason; without this one, the
      // rejection would escape the async IIFE as an unhandled promise
      // rejection on every entry/template change while crypto is missing.
      let resumeHash = null;
      let coverHash = null;
      try {
        [resumeHash, coverHash] = await Promise.all([
          computeCurrentHash(entry, "resume", { resumeFile, coverLetterFile }),
          computeCurrentHash(entry, "cover", { resumeFile, coverLetterFile }),
        ]);
      } catch {
        resumeHash = null;
        coverHash = null;
      }
      if (cancelled || !isMountedRef.current) return;
      setCurrentHashByScope({ resume: resumeHash, cover: coverHash });
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, resumeFile, coverLetterFile]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (messageListenerRef.current) {
        window.removeEventListener("message", messageListenerRef.current);
      }
      // AC-E14: a prompt pending at unmount is treated as a dismissal, never
      // a dangling promise — `performSave`'s awaited
      // `waitForConflictDecision` resumes and writes the skip row for every
      // scope that was still conflicted.
      if (pendingConflictResolveRef.current) {
        pendingConflictResolveRef.current("dismiss");
        pendingConflictResolveRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Consent popup (§7.1)
  // ---------------------------------------------------------------------

  const performSaveRef = useRef(null); // set below, after performSave is defined

  const watchConsent = useCallback(() => {
    const startedAt = Date.now();
    let settled = false;

    const finish = (outcome, reason) => {
      if (settled) return;
      settled = true;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (messageListenerRef.current) {
        window.removeEventListener("message", messageListenerRef.current);
        messageListenerRef.current = null;
      }
      popupRef.current = null;
      if (!isMountedRef.current) return;
      setPendingConsent(false);
      if (outcome === "connected") {
        setConnected(true);
        setReconnectNeeded(false);
        const pending = pendingSaveArgsRef.current;
        pendingSaveArgsRef.current = null;
        if (pending) void performSaveRef.current?.(pending); // AC-E1/AC-K1: no second click
        return;
      }
      setConnected(false);
      pendingSaveArgsRef.current = null; // AC-E3: the pending save is abandoned, no error shown
      if (reason === "consent-refused") {
        applyBatchResult(driveSaveBatch([{ batchError: BATCH_ERROR.CONSENT_REFUSED }]));
      }
      // "timeout" (AC-C14's 120s condition) and "closed-disconnected"
      // (AC-C14's third condition / AC-E3) give up silently — the control
      // simply returns to "Connect Drive & save".
    };

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "drive-oauth") return;
      if (data.ok) finish("connected");
      else finish("disconnected", data.reason);
    };
    messageListenerRef.current = onMessage;
    window.addEventListener("message", onMessage);

    const poll = async () => {
      if (settled) return;
      if (Date.now() - startedAt >= STATUS_POLL_TIMEOUT_MS) {
        finish("timeout");
        return;
      }
      const handleClosed = !popupRef.current || popupRef.current.closed;
      const status = await checkStatus({ verify: true }).catch(() => null);
      if (settled) return;
      if (status?.connected) {
        finish("connected");
        return;
      }
      if (handleClosed) {
        finish("closed-disconnected");
        return;
      }
      pollTimeoutRef.current = setTimeout(poll, STATUS_POLL_INTERVAL_MS);
    };
    pollTimeoutRef.current = setTimeout(poll, STATUS_POLL_INTERVAL_MS);
  }, [applyBatchResult, checkStatus]);

  const openConsentPopup = useCallback(() => {
    // AC-C14 "second click while pending": re-focus, never a second window.
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    let popup = null;
    try {
      popup = window.open("/api/drive/connect", POPUP_NAME, POPUP_FEATURES);
    } catch {
      popup = null;
    }
    if (!popup || popup.closed) {
      // AC-C16: detected immediately, no 120s poll started, control returns
      // to "Connect Drive & save".
      pendingSaveArgsRef.current = null;
      applyBatchResult(driveSaveBatch([{ batchError: BATCH_ERROR.POPUP_BLOCKED }]));
      return;
    }
    popupRef.current = popup;
    setPendingConsent(true);
    watchConsent();
  }, [applyBatchResult, watchConsent]);

  const onRefocusConsent = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
    }
  }, []);

  // ---------------------------------------------------------------------
  // Save (§7.2)
  // ---------------------------------------------------------------------

  const attemptOneScope = useCallback(
    async (scope, { activeScope: activeScopeArg, activeText, activeFileName }, { onConflict } = {}) => {
      const label = scopeLabel(scope);
      const text = scope === activeScopeArg ? activeText : undefined;
      const blob = await buildPreviewBlob(entry, scope, { resumeFile, coverLetterFile, text });
      if (!blob) {
        // AC-S27/AC-S28: reachable in normal use (a cover letter with no
        // recoverable bytes after a reload) — completes without throwing,
        // is never reported saved, makes no Drive call.
        return { scope, outcome: { scope, label, result: SCOPE_OUTCOME.NO_BYTES } };
      }
      if (blob.size > DRIVE_UPLOAD_MAX_BYTES) {
        // AC-S22a/AC-S26: the client-side guard, on the SAME constant the
        // server enforces — never re-typed.
        return { scope, outcome: { scope, label, result: SCOPE_OUTCOME.TOO_LARGE } };
      }

      const contentHash = await computeCurrentHash(entry, scope, { resumeFile, coverLetterFile, text });
      const override =
        scope === activeScopeArg ? activeFileName || "" : entry?.[FILE_NAME_FIELD[scope]] || "";
      const name = driveDocName({ override, jobTitle, company, kind: NAME_KIND[scope] });
      const ref = driveRefs[scope] || null;

      const meta = {
        jobId: jobId || null,
        scope,
        name,
        jobTitle: jobTitle || "",
        company: company || "",
        contentHash,
        clientVersion: ref?.version ?? null,
      };
      if (ref?.fileId) meta.knownRef = { fileId: ref.fileId, version: ref.version || undefined };
      if (onConflict) meta.onConflict = onConflict;

      const form = new FormData();
      form.append("file", blob, `${name}.docx`);
      form.append("meta", JSON.stringify(meta));

      let res;
      try {
        res = await fetch("/api/drive/save", { method: "POST", body: form, credentials: "include" });
      } catch {
        return { scope, batchAbort: BATCH_ERROR.OFFLINE };
      }
      const body = await res.json().catch(() => null);

      if (res.ok) {
        const newRef = {
          fileId: body?.fileId,
          name: body?.name,
          webViewLink: body?.webViewLink,
          version: body?.version,
          contentHash,
        };
        return {
          scope,
          ref: newRef,
          outcome: {
            scope,
            label,
            result: SCOPE_OUTCOME.SAVED,
            name: body?.name,
            webViewLink: body?.webViewLink,
            replacedDeleted: Boolean(body?.replaced),
            conflictNewDoc: onConflict === "new",
            previousWebViewLink: onConflict === "new" ? ref?.webViewLink : undefined,
            previousName: onConflict === "new" ? ref?.name : undefined,
          },
        };
      }

      if (res.status === 409 && (body?.error === "conflict_session" || body?.error === "conflict_foreign")) {
        return { scope, conflict: { name: body?.name || name, webViewLink: body?.webViewLink } };
      }
      if (body?.error === "Unauthorized") {
        return { scope, batchAbort: BATCH_ERROR.UNAUTHORIZED };
      }
      if (body?.error === "drive_unconfigured") {
        return { scope, batchAbort: BATCH_ERROR.MISCONFIGURED };
      }
      if (body?.error === "payload_too_large") {
        return { scope, outcome: { scope, label, result: SCOPE_OUTCOME.TOO_LARGE } };
      }
      return {
        scope,
        reconnect: body?.error === "not_connected",
        outcome: {
          scope,
          label,
          result: SCOPE_OUTCOME.ERROR,
          errorKind: errorKindFromRouteCode(body?.error),
        },
      };
    },
    [entry, resumeFile, coverLetterFile, jobId, jobTitle, company, driveRefs],
  );

  // ONE prompt per activation, even when both scopes conflict at once
  // (`UX.md` §5.3/§5.7) — the sequential loop below collects every conflict
  // from a full pass before ever showing the prompt, rather than pausing
  // mid-loop the first time it sees one.
  const waitForConflictDecision = useCallback((conflicted) => {
    return new Promise((resolve) => {
      const docNames = conflicted.map((c) => c.name);
      conflictActivationRef.current += 1;
      const id = `${conflicted.map((c) => c.scope).sort().join("+")}:${conflictActivationRef.current}`;
      const settle = (decision) => {
        pendingConflictResolveRef.current = null;
        setPrompt(null);
        resolve(decision);
      };
      pendingConflictResolveRef.current = settle;
      setPrompt({
        id,
        docNames,
        onSaveAsNew: () => settle("new"),
        onOverwrite: () => settle("overwrite"),
        onDismiss: () => settle("dismiss"),
      });
    });
  }, []);

  const performSave = useCallback(
    async (args) => {
      if (inFlightRef.current.has(BATCH_KEY)) return; // AC-S11a: ref-based guard
      if (!entry) return;
      const scopes = DOCX_SCOPES.filter((s) => scopeText(entry, s).trim().length > 0);
      if (scopes.length === 0) return;

      inFlightRef.current.add(BATCH_KEY);
      setDriveBusy(true);
      // WAVE3-SEAMS.md MAJ-2 ("rule 7"): a start sentence clears the alert
      // region in the same object as the polite one, so a failure -> retry
      // -> IDENTICAL failure sequence is never adjacent to itself.
      setAnnouncement(driveAnnounceStart("save"));

      try {
        const attempts = [];
        for (const scope of scopes) {
          // BLOCKER-2 fix: attemptOneScope can THROW (a corrupt/unusual
          // .docx JSZip can't parse, or crypto.subtle being unavailable on
          // a non-secure origin) rather than resolve to an outcome. Left
          // unguarded, that throw escapes the whole batch: the `finally`
          // below still clears driveBusy, but announcement/rows are never
          // updated again, so the live region is stuck announcing "Saving
          // to Google Drive…" forever. Route it through the SAME error
          // vocabulary every other per-scope failure uses instead.
          let result;
          try {
            result = await attemptOneScope(scope, args);
          } catch {
            attempts.push({
              scope,
              outcome: { scope, label: scopeLabel(scope), result: SCOPE_OUTCOME.ERROR, errorKind: "unknown" },
            });
            continue;
          }
          if (result.batchAbort) {
            applyBatchResult(driveSaveBatch([{ batchError: result.batchAbort }]));
            return;
          }
          attempts.push(result);
        }

        const conflicted = attempts.filter((a) => a.conflict);
        let finalAttempts = attempts;
        if (conflicted.length > 0) {
          const decision = await waitForConflictDecision(
            conflicted.map((c) => ({ scope: c.scope, name: c.conflict.name })),
          );
          if (decision === "dismiss") {
            finalAttempts = attempts.map((a) =>
              a.conflict
                ? { scope: a.scope, outcome: { scope: a.scope, label: scopeLabel(a.scope), result: SCOPE_OUTCOME.DISMISSED } }
                : a,
            );
          } else {
            const retried = await Promise.all(
              conflicted.map((c) => attemptOneScope(c.scope, args, { onConflict: decision })),
            );
            const bySc = Object.fromEntries(retried.map((r) => [r.scope, r]));
            finalAttempts = attempts.map((a) => (a.conflict ? bySc[a.scope] : a));
          }
        }

        const newRefs = {};
        finalAttempts.forEach((a) => {
          if (a?.ref) newRefs[a.scope] = a.ref;
        });
        if (Object.keys(newRefs).length && isMountedRef.current) {
          setDriveRefs((prev) => ({ ...prev, ...newRefs }));
        }

        const anyReconnect = finalAttempts.some((a) => a?.reconnect);
        const outcomes = finalAttempts.map((a) => a?.outcome).filter(Boolean);
        applyBatchResult(driveSaveBatch(outcomes));
        if (anyReconnect && isMountedRef.current) setReconnectNeeded(true);
      } finally {
        inFlightRef.current.delete(BATCH_KEY);
        if (isMountedRef.current) setDriveBusy(false);
      }
    },
    [entry, attemptOneScope, applyBatchResult, waitForConflictDecision],
  );
  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  // The single entry point Wave 6's `DocumentPreviewDialog.handleSaveToDrive`
  // calls AFTER `commitDraft()`/`commitFileName()` — this hook has no access
  // to the dialog's local draft state, so it cannot itself be
  // `DriveActions.onSave` (that prop is zero-argument); the dialog must wrap
  // this with the two commits, matching `ARCH.md` §4.3's orchestrator
  // exactly: `{activeScope, activeText, activeFileName}`.
  const saveToDrive = useCallback(
    async ({ activeScope: scope, activeText, activeFileName }) => {
      if (!entry) return;
      if (configured !== true) return; // the control is hidden in this state; defensive no-op
      if (connected !== true) {
        // Cold start / reconnect (AC-K1/AC-E1): remember this exact request
        // and let the consent flow resume it with no second activation.
        pendingSaveArgsRef.current = { activeScope: scope, activeText, activeFileName };
        openConsentPopup();
        return;
      }
      await performSave({ activeScope: scope, activeText, activeFileName });
    },
    [entry, configured, connected, openConsentPopup, performSave],
  );

  // ---------------------------------------------------------------------
  // Download (§7.6)
  // ---------------------------------------------------------------------

  const onDownload = useCallback(async () => {
    if (inFlightRef.current.has(EXPORT_KEY)) return; // AC-D10
    const scopes = DOCX_SCOPES.filter((s) => driveRefs[s]?.fileId);
    if (scopes.length === 0) return;

    inFlightRef.current.add(EXPORT_KEY);
    setDownloadStatus("exporting");
    setAnnouncement(driveAnnounceStart("export"));

    let downloadedCount = 0;
    const failures = [];
    let anyReconnect = false;

    for (const scope of scopes) {
      const ref = driveRefs[scope];
      try {
        const res = await fetch(`/api/drive/export?fileId=${encodeURIComponent(ref.fileId)}`, {
          credentials: "include",
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const blob = new Blob([buf], { type: DOCX_MIME });
          const displayName = ref.name || driveDocName({ override: "", jobTitle, company, kind: NAME_KIND[scope] });
          triggerBlobDownload(blob, `${displayName} (Google Docs).docx`); // AC-D5
          downloadedCount += 1;
        } else {
          const body = await res.json().catch(() => null);
          if (body?.error === "not_connected") anyReconnect = true;
          failures.push({
            scope,
            message: driveErrorMessage(body?.error, { path: "download" }) ?? UNKNOWN_DOWNLOAD_MESSAGE,
            errorKind: errorKindFromRouteCode(body?.error),
          });
        }
      } catch {
        failures.push({
          scope,
          message: driveErrorMessage("offline", { path: "download" }) ?? UNKNOWN_DOWNLOAD_MESSAGE,
          errorKind: "unknown",
        });
      }
    }

    inFlightRef.current.delete(EXPORT_KEY);
    if (!isMountedRef.current) return;
    setDownloadStatus("idle");
    applyBatchResult(buildDownloadResult({ downloadedCount, failures }));
    if (anyReconnect) {
      setConnected(false);
      setReconnectNeeded(true);
    }
  }, [driveRefs, jobTitle, company, applyBatchResult]);

  // ---------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------

  const scopeCount = DOCX_SCOPES.filter((s) => scopeText(entry, s).trim().length > 0).length;
  const hasDriveReference = DOCX_SCOPES.some((s) => Boolean(driveRefs[s]?.fileId));

  // Obligation 5: computed ONCE here, fed to both consumers below — see the
  // comment on the return statement.
  const isStale = DOCX_SCOPES.some((s) => {
    const ref = driveRefs[s];
    if (!ref) return false;
    return driveCopyState(currentHashByScope[s], ref.contentHash) === "stale";
  });

  const status = deriveDriveStatus({
    configured,
    connected,
    pendingConsent,
    driveBusy,
    prompt,
    reconnectNeeded,
    statusCheckFailed,
  });

  const showConversionCaption = hasDriveReference && connected === true;
  const reconnectCaption = hasDriveReference && connected === false;
  const hiringEmail = activeScope === "email" && scopeCount > 0 ? { scopeCount } : null;

  return {
    // ---- Spread directly onto <DriveActions ...>. `onSave` is NOT here —
    // it needs the dialog's commitDraft()/commitFileName() wrapped around
    // `saveToDrive` below (see that function's own comment). ----
    status,
    scopeCount,
    connected: connected === true,
    hasDriveReference,
    isStale, // -> DriveActions' `isStale` prop
    downloadStatus,
    onRefocusConsent,
    onDownload,

    // ---- Spread directly onto <DriveResultRegion ...>. ----
    leadingLine: lastLeadingLine,
    rows: lastRows,
    showConversionCaption,
    stale: isStale, // -> DriveResultRegion's `stale` prop — SAME value as above, one computation
    reconnectCaption,
    hiringEmail,
    prompt,
    announcement,

    // ---- For the dialog's own handleSaveToDrive wrapper. ----
    saveToDrive,
  };
}
