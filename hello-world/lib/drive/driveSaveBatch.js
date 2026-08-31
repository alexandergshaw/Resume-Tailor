/**
 * Pure decision logic for saving a batch of documents to Drive in one
 * action (`ARCH.md` §7.2 / module table row 9): given what happened for
 * each scope the app attempted to save, decide the result rows, the
 * leading summary line, the two live-region announcements, and whether the
 * Drive connection itself should be treated as lost.
 *
 * Every user-facing string below is copied VERBATIM from `UX.md` rev 2 —
 * do not edit copy here without updating that document first.
 *
 * A partial batch must keep the successes visible and show only the
 * failing scope's error; it must never claim both succeeded when one did
 * not (`driveSaveBatch`'s central contract — see `buildSummary` and the
 * "nothing saved" branch of `driveSaveBatch` itself).
 *
 * No React, no network calls: this module only turns already-resolved
 * per-scope outcomes into plain data. Rendering (real `<a>` tags, colours,
 * live regions) happens elsewhere; `segments` below is the seam — an
 * ordered array of `{type:"text", value}` / `{type:"link", href, text}`
 * pieces a renderer concatenates, so a link's href is never smuggled
 * inside a plain string a test would have to parse.
 *
 * Every user-facing SENTENCE below is IMPORTED from `driveMessages.js` —
 * that module is the single source of record for Drive copy (its own header
 * says so explicitly); this module must never re-derive a private copy of a
 * string `driveMessages.js` already owns (WAVE2-SEAMS.md MAJOR-3). That
 * includes every per-scope row `buildRow` renders: the saved, saved-as-new-
 * doc, replaced-deleted, no-bytes and dismissed rows all come from
 * `savedRowPrefix` / `savedAsNewDocFragments` / `replacedRowText` /
 * `coverNoBytesRow` / `dismissedRow` below, not from copies re-typed here.
 * There are exactly three exceptions, none of them a duplicate of anything
 * `driveMessages.js` exports:
 *   1. `SHORT_REASON` below — this module's own terse live-region phrasing.
 *      `driveMessages.js` doesn't own a short form of any of these
 *      sentences, so there is nothing to import for it.
 *   2. `UNKNOWN_ERROR_MESSAGE` below — this module's OWN one-time fallback
 *      for an error code `driveMessages.js` has no copy for at all (see the
 *      comment at its definition). Not a duplicate: there is no canonical
 *      copy anywhere to diverge from.
 *   3. The literal `"Document"` fallback label in `scopeLabel()` below, used
 *      only when an outcome arrives with no `label` at all (a defensive
 *      default, not real UX copy `driveMessages.js` has any reason to own).
 */

import {
  DRIVE_BATCH_MESSAGE,
  driveErrorMessage,
  savedSummary,
  partialSavedSummary,
  savedRowPrefix,
  savedAsNewDocFragments,
  replacedRowText,
  coverNoBytesRow,
  dismissedRow,
} from "./driveMessages.js";

/** The five things that can happen to one attempted scope. */
export const SCOPE_OUTCOME = Object.freeze({
  SAVED: "saved",
  NO_BYTES: "no-bytes",
  TOO_LARGE: "too-large",
  DISMISSED: "dismissed",
  ERROR: "error",
});

/** A failure that happened before any scope could be attempted at all. */
export const BATCH_ERROR = Object.freeze({
  CONSENT_REFUSED: "consent-refused",
  POPUP_BLOCKED: "popup-blocked",
  POPUP_CLOSED: "popup-closed",
  OFFLINE: "offline",
  UNAUTHORIZED: "unauthorized",
  MISCONFIGURED: "misconfigured",
});

// The generic fallback for an error code driveMessages.js has no copy for.
// driveMessages.js's driveErrorMessage() deliberately returns null for
// "unknown" (and any unrecognised code) — UX.md names every real case
// individually and has no generic catch-all sentence, so there is nothing
// for this module to import here. This is this module's OWN one-time
// fallback, used everywhere a code can't be resolved, so there is exactly
// one such string rather than one invented per call site. Never surfaces
// the literal word "unknown" to a user.
const UNKNOWN_ERROR_MESSAGE = "Something went wrong saving to Google Drive. Try again.";

// Short, terse phrasing for the live "alert" region only (UX.md §8's Partial
// row: "Cover letter wasn't saved: couldn't rebuild the document." is
// deliberately SHORTER than the visible row text — rule 3, "never per-file
// progress ... or document text" in the live region). Only the no-bytes
// wording is given explicitly in the spec; the rest are this module's own
// terse renderings of driveMessages.js's sentences, kept consistent with
// them — driveMessages.js does not own a short form of any of these, so
// there is nothing to import for this table itself.
const SHORT_REASON = Object.freeze({
  [SCOPE_OUTCOME.NO_BYTES]: "couldn't rebuild the document",
  [SCOPE_OUTCOME.TOO_LARGE]: "the document is too large to upload",
  [SCOPE_OUTCOME.DISMISSED]: "the Doc in Drive has changed since the app last saved it",
  reconnect: "your Drive connection expired",
  "storage-full": "your Google Drive is out of space",
  refused: "Drive wouldn't accept the file",
  transient: "Drive is busy right now",
  gone: "the Doc is no longer in your Drive",
  unknown: "something went wrong",
});

function textSeg(value) {
  return { type: "text", value };
}

function linkSeg(href, text) {
  return { type: "link", href: href ?? "", text: text ?? href ?? "" };
}

function flattenSegments(segments) {
  return segments.map((s) => (s.type === "link" ? s.text : s.value)).join("");
}

function scopeLabel(outcome) {
  return typeof outcome.label === "string" && outcome.label.length > 0 ? outcome.label : "Document";
}

/** Builds one result row for one attempted scope's outcome. */
function buildRow(outcome) {
  const label = scopeLabel(outcome);

  switch (outcome.result) {
    case SCOPE_OUTCOME.SAVED: {
      if (outcome.conflictNewDoc) {
        const [before, between, after] = savedAsNewDocFragments(label);
        return {
          scope: outcome.scope ?? null,
          kind: "saved-new-doc",
          attributed: true,
          errorKind: null,
          segments: [
            textSeg(before),
            linkSeg(outcome.webViewLink, outcome.name || outcome.webViewLink),
            textSeg(between),
            linkSeg(outcome.previousWebViewLink, outcome.previousName || outcome.previousWebViewLink),
            textSeg(after),
          ],
        };
      }
      if (outcome.replacedDeleted) {
        return {
          scope: outcome.scope ?? null,
          kind: "replaced-deleted",
          attributed: true,
          errorKind: null,
          segments: [
            textSeg(replacedRowText(label)),
            linkSeg(outcome.webViewLink, outcome.name || outcome.webViewLink),
          ],
        };
      }
      return {
        scope: outcome.scope ?? null,
        kind: "saved",
        attributed: true,
        errorKind: null,
        segments: [textSeg(savedRowPrefix(label)), linkSeg(outcome.webViewLink, outcome.name || outcome.webViewLink)],
      };
    }

    case SCOPE_OUTCOME.NO_BYTES:
      return {
        scope: outcome.scope ?? null,
        kind: "no-bytes",
        attributed: true,
        errorKind: null,
        segments: [textSeg(coverNoBytesRow(label))],
      };

    case SCOPE_OUTCOME.DISMISSED:
      return {
        scope: outcome.scope ?? null,
        kind: "dismissed",
        attributed: true,
        errorKind: null,
        segments: [textSeg(dismissedRow(label))],
      };

    case SCOPE_OUTCOME.TOO_LARGE:
      return {
        scope: outcome.scope ?? null,
        kind: "too-large",
        attributed: false,
        errorKind: null,
        segments: [textSeg(DRIVE_BATCH_MESSAGE.tooLargeUpload)],
      };

    case SCOPE_OUTCOME.ERROR: {
      const message = driveErrorMessage(outcome.errorKind) ?? UNKNOWN_ERROR_MESSAGE;
      return {
        scope: outcome.scope ?? null,
        kind: "error",
        attributed: false,
        errorKind: outcome.errorKind ?? "unknown",
        segments: [textSeg(message)],
      };
    }

    default:
      // Defensive fallback for a malformed outcome — never throw out of a
      // pure reducer over data that ultimately comes from a network call.
      return {
        scope: outcome.scope ?? null,
        kind: "error",
        attributed: false,
        errorKind: "unknown",
        segments: [textSeg(UNKNOWN_ERROR_MESSAGE)],
      };
  }
}

/** UX.md §6.3 / AC-S20's exact leading-line rules. */
function buildSummary(total, savedCount) {
  if (total === 0) return null;
  if (savedCount === 0) return null; // "absent when nothing was saved" — the failure row carries the message
  if (savedCount === total) return savedSummary(savedCount);
  return partialSavedSummary(savedCount, total);
}

function shortReasonFor(outcome) {
  if (outcome.result === SCOPE_OUTCOME.ERROR) {
    return SHORT_REASON[outcome.errorKind] ?? SHORT_REASON.unknown;
  }
  return SHORT_REASON[outcome.result] ?? SHORT_REASON.unknown;
}

/** UX.md §8's two live regions, for the save flow only. */
function buildAnnouncement({ total, savedCount, summary, failed }) {
  if (total === 0) return { polite: "", alert: "" };

  if (savedCount === total) {
    return { polite: summary, alert: "" };
  }

  if (savedCount > 0) {
    // Partial.
    if (failed.length === 1) {
      const label = scopeLabel(failed[0]);
      return { polite: summary, alert: `${label} wasn't saved: ${shortReasonFor(failed[0])}.` };
    }
    // More than one failure alongside at least one success has no example
    // in UX.md; this keeps rule 3 ("never ... a running list") by staying a
    // single terse sentence rather than concatenating every reason.
    // EXTRAPOLATED beyond UX.md §8, which only specifies the single-failure
    // case (today's 2-scope batches can't reach this branch at all) —
    // accepted by the coordinator; revisit once a 3rd scope makes it reachable.
    return { polite: summary, alert: `${failed.length} documents weren't saved.` };
  }

  // Nothing saved: polite is cleared, alert carries the failure's own
  // message verbatim (UX.md §8, "Nothing saved" row).
  if (failed.length === 1) {
    return { polite: "", alert: flattenSegments(buildRow(failed[0]).segments) };
  }
  return { polite: "", alert: failed.map((f) => flattenSegments(buildRow(f).segments)).join(" ") };
}

/**
 * @typedef {Object} ScopeOutcome
 * @property {string} scope - e.g. "resume" | "cover" (a real DOCX_SCOPES key
 *   from `lib/tailor/documentScopes.js` — never "coverLetter"; that spelling
 *   is not a legal `drive_documents.scope` value and the CHECK constraint on
 *   that column will reject it, see WAVE2-SEAMS.md MAJOR-5)
 * @property {string} label - display label, e.g. "Resume" | "Cover letter"
 * @property {"saved"|"no-bytes"|"too-large"|"dismissed"|"error"} result
 * @property {string} [name] - saved only: the name Drive returned (AC-S13)
 * @property {string} [webViewLink] - saved only
 * @property {boolean} [conflictNewDoc] - saved only (B-3)
 * @property {string} [previousWebViewLink] - saved + conflictNewDoc only
 * @property {string} [previousName]
 * @property {boolean} [replacedDeleted] - saved only (AC-E10)
 * @property {"reconnect"|"storage-full"|"refused"|"transient"|"gone"|"unknown"} [errorKind] - error only, from classifyDriveError
 *
 * @typedef {Object} BatchAbort - a failure before any scope was attempted
 * @property {"consent-refused"|"popup-blocked"|"popup-closed"|"offline"|"unauthorized"|"misconfigured"} batchError
 */

/**
 * @param {Array<ScopeOutcome|BatchAbort>} scopeOutcomes - either one entry
 *   per scope the app attempted to save (normal case), or a single-element
 *   array holding a `BatchAbort` when nothing could be attempted at all.
 * @returns {{
 *   rows: Array<{scope: string|null, kind: string, attributed: boolean, errorKind: string|null, segments: Array}>,
 *   summary: string|null,
 *   announcement: {polite: string, alert: string},
 *   connectionLost: boolean,
 * }}
 */
export function driveSaveBatch(scopeOutcomes) {
  const outcomes = Array.isArray(scopeOutcomes) ? scopeOutcomes : [];

  const abort = outcomes.find((o) => o && typeof o.batchError === "string");
  if (abort) {
    const message = driveErrorMessage(abort.batchError) ?? UNKNOWN_ERROR_MESSAGE;
    return {
      rows: [{ scope: null, kind: "batch-error", attributed: false, errorKind: null, segments: [textSeg(message)] }],
      summary: null,
      announcement: { polite: "", alert: message },
      connectionLost: false,
    };
  }

  const total = outcomes.length;
  const saved = outcomes.filter((o) => o.result === SCOPE_OUTCOME.SAVED);
  const failed = outcomes.filter((o) => o.result !== SCOPE_OUTCOME.SAVED);
  const savedCount = saved.length;

  const rows = outcomes.map(buildRow);
  const summary = buildSummary(total, savedCount);
  const announcement = buildAnnouncement({ total, savedCount, summary, failed });
  const connectionLost = failed.some(
    (o) => o.result === SCOPE_OUTCOME.ERROR && o.errorKind === "reconnect",
  );

  return { rows, summary, announcement, connectionLost };
}
