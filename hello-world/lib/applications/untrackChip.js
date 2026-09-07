import { getPositionId } from "../supabase/upsertApplication.js";
import { deleteUntrackedApplication } from "../supabase/applicationStatusWriter.js";
import { STATUS_LABELS, TRACKING_TAB_HIDDEN_STATUSES } from "./statusVocabulary.js";

const APPLICATIONS_TABLE = "applications";

// ---------------------------------------------------------------------------
// THE CHIP DOCK'S "REMOVE", AND THE TWO DIFFERENT THINGS IT USED TO CONFLATE.
//
// `trackedJobs` (the dock) is client-only workspace state persisted to
// `localStorage` (app/page.js:469-478) — it is NOT the record of anything.
// `applications` IS the record. Untrack used to treat one boolean as the
// answer for both: `deleteUntrackedApplication` refuses every row that is not
// a dateless `tracking` row, and app/page.js turned that refusal into
// `if (refused) return;` — so on ANY tailored, applied or later row the user's
// click removed nothing and said nothing. That is the bug this module exists
// to end, and the split is:
//
//   the ROW      — decided ONLY by `deleteUntrackedApplication`'s WHERE
//                  clause, unchanged and un-widened. An applied row is never
//                  deleted by this path (test/repro/appliedStatusDataLoss.test.js
//                  REPRO D2/D5 is exactly that regression).
//   the CHIP     — the user's own explicit request on their own workspace.
//                  It always goes.
//
// WHY THE CHIP ALWAYS GOES, given D2/D5's warning about a refused row "losing
// its only visible trace". Two independent reasons, both checkable:
//
//   1. The chip is not a protected trace and never was. The same dock renders
//      "Clear all" (app/components/StatusBar.js), which is
//      `setTrackedJobs([])` and nothing else — no guard, no delete, every
//      chip at every status. A per-chip refusal that a neighbouring button
//      overrides in one click protects nothing; it only makes one control
//      look broken.
//   2. For every status a refusal can actually be about EXCEPT two, the row
//      stays on screen in the Tracking tab: that loader excludes exactly
//      `TRACKING_TAB_HIDDEN_STATUSES` (`auto_tailored`, `tracking`), so
//      `tailored`, `auto_queued` and all seven applied-or-later statuses are
//      listed there with their status, their date and their documents.
//
// The two exceptions — `auto_tailored`, and a `tracking` row that still
// carries a date (a legacy D1 victim) — are why this module reads the row
// back rather than shrugging: the notice for those says the record was kept
// but is NOT listed in Tracking, instead of pointing the user at a screen
// that will not show it. `presentUntrackOutcome` below is where that
// distinction is made, once.
//
// The read-back is for the MESSAGE ONLY. It is never the authority for
// whether the delete was allowed — that stays a filter on the DELETE
// statement itself (AC-3b), so this module cannot re-introduce a
// read-then-write race no matter what it does with the row it read.
// ---------------------------------------------------------------------------

/**
 * Runs the row half of a chip untrack and reports what became of the row.
 * Performs NO chip mutation — the caller drops the chip unconditionally.
 *
 * @param {*} supabase
 * @param {{userId: string, jobId: string}} args  `jobId` is the chip id, i.e.
 *   `positions.external_id`.
 * @returns {Promise<{deleted: boolean, kept: {status: string|null, appliedAt: string|null}|null, unknown: boolean}>}
 *   `deleted` — the row was a dateless `tracking` row and is gone.
 *   `kept`    — the delete was refused and this is the row that survived.
 *   `unknown` — the delete was refused and the read-back failed, so what
 *               survived cannot be described. Never guessed at.
 */
export async function untrackChipApplication(supabase, { userId, jobId } = {}) {
  const nothing = { deleted: false, kept: null, unknown: false };
  if (!supabase || !userId || !jobId) return nothing;

  const positionId = await getPositionId(supabase, jobId);
  // No position row means there is no application row keyed on one either:
  // nothing was deleted and nothing was kept, so the chip just goes.
  if (!positionId) return nothing;

  const { deleted } = await deleteUntrackedApplication(supabase, { userId, positionId });
  if (deleted) return { deleted: true, kept: null, unknown: false };

  try {
    const { data, error } = await supabase
      .from(APPLICATIONS_TABLE)
      .select("status, applied_at")
      .eq("user_id", userId)
      .eq("position_id", positionId)
      .maybeSingle();
    if (error) return { deleted: false, kept: null, unknown: true };
    if (!data) return nothing;
    return {
      deleted: false,
      kept: { status: data.status ?? null, appliedAt: data.applied_at ?? null },
      unknown: false,
    };
  } catch {
    return { deleted: false, kept: null, unknown: true };
  }
}

/**
 * True when a surviving row is NOT listed by the Tracking tab, i.e. when the
 * chip really was its last on-screen appearance. Derived from the SAME
 * frozen list both application loaders filter on (`app/page.js`'s
 * `excludeTrackingTabHiddenStatuses`, `lib/copilot/postings.js`) rather than
 * a second hand-typed copy, so a status that starts or stops being hidden
 * changes this answer automatically.
 */
export function isHiddenFromTracking(status) {
  return TRACKING_TAB_HIDDEN_STATUSES.includes(status);
}

// "Senior Engineer at Acme" / "Senior Engineer" / "Acme" / a neutral fallback.
// Never an empty string, never a bare "undefined" leaking into copy.
function describeJob(job) {
  const title = typeof job?.title === "string" ? job.title.trim() : "";
  const company = typeof job?.company === "string" ? job.company.trim() : "";
  if (title && company) return `${title} at ${company}`;
  return title || company || "That posting";
}

/**
 * Turns an `untrackChipApplication` outcome into the notice the dock should
 * show, or `null` when there is genuinely nothing to say.
 *
 * `null` for a real delete is deliberate: the row is gone, the chip is gone,
 * and the two agree — a toast confirming an action whose result is already
 * on screen is noise, and this repo's minimize-clicks rule cuts against
 * making the user dismiss one. A notice is raised ONLY when the chip and the
 * database now disagree, which is the exact case the old code hid.
 *
 * @param {{deleted: boolean, kept: object|null, unknown: boolean}|null} outcome
 * @param {{id?: string, title?: string, company?: string}|null} job
 * @returns {null | {jobId: string|null, tone: "info"|"warning", kicker: string,
 *   sentence: string, announcement: string, searchSeed: string}}
 */
export function presentUntrackOutcome(outcome, job) {
  if (!outcome || outcome.deleted) return null;
  if (!outcome.kept && !outcome.unknown) return null;

  const who = describeJob(job);
  const jobId = job?.id ?? null;
  const company = typeof job?.company === "string" ? job.company.trim() : "";

  // The KICKER differs per tone on purpose. It is the notice's
  // colour-independent severity channel alongside the glyph shape — this
  // banner deliberately adds no `font-weight` override of its own (see
  // app/page.module.css's note), so if every tone shared one kicker a
  // colour-blind reader would have only the glyph to go on.
  let tone;
  let kicker;
  let sentence;
  let searchSeed;

  if (outcome.unknown) {
    tone = "warning";
    kicker = "Removed — unconfirmed";
    sentence =
      `${who}: we could not confirm what happened to the saved application. ` +
      `Check Tracking before assuming it is gone.`;
    // The seed is still offered: "go and look" is the whole remedy here.
    searchSeed = company;
  } else if (isHiddenFromTracking(outcome.kept.status)) {
    tone = "warning";
    kicker = "Removed — record kept";
    sentence =
      `${who}: the saved record (${labelFor(outcome.kept.status)}) was kept and NOT deleted, ` +
      `but the Tracking tab does not list that status, so nothing on screen shows it now.`;
    // No seed: sending the user to a tab that filters this row out would be
    // a link to an empty result, which reads as "it is gone".
    searchSeed = "";
  } else {
    tone = "info";
    kicker = "Removed from the dock";
    sentence =
      `${who}: your saved application (${labelFor(outcome.kept.status)}) was kept and is ` +
      `still in Tracking.`;
    searchSeed = company;
  }

  return { jobId, tone, kicker, sentence, announcement: `${kicker}. ${sentence}`, searchSeed };
}

// A status with no entry in the shared label map renders as its raw value
// rather than as a blank pair of brackets — the same fallback
// `lib/duplicateApply/verdictPresentation.js` uses.
function labelFor(status) {
  if (status == null) return "unknown status";
  return STATUS_LABELS[status] || status;
}
