import {
  PRE_APPLY_STATUSES,
  APPLIED_OR_LATER_STATUSES,
  STATUS,
  classifyStatus,
  isAppliedOrLater,
} from "../applications/statusVocabulary.js";

// ---------------------------------------------------------------------------
// THE WRITER. Every guard here is a `WHERE` on the statement it guards — no
// read is ever the authority for whether a write is allowed (AC-3b). See
// `…/3-plan-dataloss.md` PART 3 for the sequence this file implements
// (opt-C, binding). The short version:
//
//   C0 — refuse before any IO: an unknown target status, or a missing key.
//   C1 — a guarded UPDATE, fail-closed: `.in("status", PRE_APPLY_STATUSES)`.
//        NEVER a deny-list — a status added to the live CHECK tomorrow must
//        evaluate FALSE against an allow-list it is not in, not TRUE against
//        a `.not(..., "in", ...)` it also is not in.
//   C2 — zero rows from C1 is ambiguous (not-found vs. already-protected vs.
//        unknown), so it is resolved by a THREE-VALUED read-back, mirroring
//        `classifyStatus` exactly: protected → refuse; pre-apply → the row
//        arrived after C1's snapshot, retry C1 exactly once, then
//        `lost-race` if the retry also misses; unknown → refuse, no retry
//        (a retry can never match an allow-list it is excluded from).
//   C3 — no row at all: `ON CONFLICT DO NOTHING` (`ignoreDuplicates: true`)
//        so the insert is structurally incapable of demoting an existing
//        row, followed by a SEPARATE read-back (never `.select()` chained
//        onto the upsert itself — `DO NOTHING … RETURNING` returns nothing
//        on the conflict path, which would silently read as "the row I just
//        wrote" and hand back nothing at all).
//   C4 — the applied-at stamp, write-once by `WHERE applied_at IS NULL`,
//        never by a read deciding to skip it. A stamp FAILURE still returns
//        the promotion's id — the promotion already landed; only the date
//        did not, and `tailorAndQueueOne` treats a falsy id as "no
//        application row exists", which is a permanent skip of the posting.
//
// `setApplicationStatusByUser` is the other door: the one a human drives
// through the Edit dialog. It carries none of C1's allow-list — AC-3b names
// it as the ONE deliberate exemption, guarded instead by a tenant filter, a
// compare-and-set on `applied_at`, and a typed confirmation that must fire
// before any statement when the save would destroy a real date.
// ---------------------------------------------------------------------------

const APPLICATIONS_TABLE = "applications";

function refusal(reason, overrides = {}) {
  return {
    id: null,
    changed: false,
    reason,
    currentStatus: null,
    stamped: false,
    ...overrides,
  };
}

/**
 * The machine door: promote (or insert) one user+position's application row
 * to `status`, never demoting a row already at an applied-or-later status.
 *
 * @param {*} supabase
 * @param {{userId: string, positionId: string, status: string}} args
 * @returns {Promise<{id: string|null, changed: boolean, reason: string, currentStatus: string|null, stamped: boolean}>}
 */
export async function writeApplicationStatus(supabase, { userId, positionId, status }) {
  // C0 — refuse before any IO.
  if (classifyStatus(status) === "unknown") {
    return refusal("unknown-status");
  }
  if (!userId || !positionId) {
    return refusal("no-key");
  }

  // Captured once, before any IO, so C3's insert and C4's stamp — which can
  // be several awaits apart — agree on the instant "now" means.
  const nowIso = new Date().toISOString();
  const targetIsAppliedOrLater = isAppliedOrLater(status);

  async function guardedUpdate() {
    return supabase
      .from(APPLICATIONS_TABLE)
      .update({ status })
      .eq("user_id", userId)
      .eq("position_id", positionId)
      .in("status", PRE_APPLY_STATUSES) // ALLOW-LIST. NEVER .not(..., "in", ...).
      .select("id, status");
  }

  async function readBack() {
    return supabase
      .from(APPLICATIONS_TABLE)
      .select("id, status, applied_at")
      .eq("user_id", userId)
      .eq("position_id", positionId)
      .maybeSingle();
  }

  // C4 — write-once by WHERE. Skipped entirely (no statement at all) for a
  // pre-apply target, so a promotion that never reaches "applied" costs
  // exactly one round trip.
  async function stampIfNeeded(id) {
    if (!targetIsAppliedOrLater) return { stamped: false, reason: "promoted" };
    const { data, error } = await supabase
      .from(APPLICATIONS_TABLE)
      .update({ applied_at: nowIso })
      .eq("user_id", userId)
      .eq("position_id", positionId)
      .is("applied_at", null) // NEVER .eq(col, null) — `= NULL` matches nothing.
      .select("id");
    if (error) return { stamped: false, reason: "stamped-failed" };
    // A stamp matching zero rows means a date already existed — honoured
    // silently, with no read, because the WHERE already did the honouring.
    return { stamped: (data || []).length > 0, reason: "promoted" };
  }

  // C1
  const c1 = await guardedUpdate();
  if (c1.error) return refusal("error");
  if ((c1.data || []).length > 0) {
    const row = c1.data[0];
    const stamp = await stampIfNeeded(row.id);
    return {
      id: row.id,
      changed: true,
      reason: stamp.reason,
      currentStatus: row.status,
      stamped: stamp.stamped,
    };
  }

  // C2 — the disambiguating read-back. Three-valued, mirroring
  // `classifyStatus` exactly.
  const c2 = await readBack();
  if (c2.error) return refusal("error");

  if (c2.data) {
    const row = c2.data;
    const classification = classifyStatus(row.status);

    if (classification === "applied-or-later") {
      return refusal("protected", { id: row.id, currentStatus: row.status });
    }
    if (classification === "unknown") {
      // A retry can never match here — the allow-list excludes this value by
      // definition — so refusing without retrying is not an optimisation,
      // it is the only correct answer.
      return refusal("unknown-status", { id: row.id, currentStatus: row.status });
    }

    // pre-apply: the row arrived after C1's snapshot. Retry C1 exactly once.
    const retry = await guardedUpdate();
    if (retry.error) return refusal("error");
    if ((retry.data || []).length > 0) {
      const retryRow = retry.data[0];
      const stamp = await stampIfNeeded(retryRow.id);
      return {
        id: retryRow.id,
        changed: true,
        reason: stamp.reason,
        currentStatus: retryRow.status,
        stamped: stamp.stamped,
      };
    }

    // The retry also matched zero — the row moved again between C2 and the
    // retry. Re-read once more and report what is there now; do not loop.
    const finalRead = await readBack();
    if (finalRead.error) return refusal("error");
    const finalRow = finalRead.data;
    return refusal("lost-race", {
      id: finalRow ? finalRow.id : null,
      currentStatus: finalRow ? finalRow.status : null,
    });
  }

  // C3 — no row at all. An insert that cannot demote.
  const payload = {
    user_id: userId,
    position_id: positionId,
    status,
    // Named EXPLICITLY on both branches, never omitted: omitting it would be
    // the first insert in this repo's history to let `applied_at` take an
    // unreadable column default, and every downstream guard (C4's
    // `IS NULL` stamp, the queue DELETE, NULLS-FIRST ordering) assumes the
    // column was set on purpose. `ON CONFLICT DO NOTHING` means naming it
    // here can never overwrite a stored date: on conflict the statement does
    // nothing at all, and off conflict there is no prior row to overwrite.
    applied_at: targetIsAppliedOrLater ? nowIso : null,
  };
  const upsertResult = await supabase
    .from(APPLICATIONS_TABLE)
    .upsert(payload, { onConflict: "user_id,position_id", ignoreDuplicates: true }); // NO .select() here — see the header.
  if (upsertResult && upsertResult.error) return refusal("error");

  async function readBackAfterInsert() {
    return supabase
      .from(APPLICATIONS_TABLE)
      .select("id, status, applied_at")
      .eq("user_id", userId)
      .eq("position_id", positionId)
      .maybeSingle();
  }

  let settledResult = await readBackAfterInsert();
  if (settledResult.error) {
    settledResult = await readBackAfterInsert();
    if (settledResult.error) return refusal("id-unread");
  }
  if (!settledResult.data) return refusal("no-row");

  const settled = settledResult.data;
  if (settled.status === status) {
    return {
      id: settled.id,
      changed: true,
      reason: "inserted",
      currentStatus: settled.status,
      // The date was already written atomically as part of the insert
      // payload above — no separate C4 round trip is needed on this path.
      stamped: targetIsAppliedOrLater,
    };
  }
  // Someone else's write landed on this row between the upsert and this
  // read (the worst case: `ON CONFLICT DO NOTHING` silently no-opped against
  // a row this call never saw). Report what is actually there; never guess.
  return refusal("lost-race", { id: settled.id, currentStatus: settled.status });
}

// Formats the date named in `setApplicationStatusByUser`'s confirmation
// prompt. Locale-fixed (not caller-supplied — this door has no UI context to
// take one from) so the prompt is deterministic; the exact wording is not
// pinned by any test, only that the year and the day-of-month both appear.
function formatDateForConfirm(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The human door: the Edit dialog's save. Deliberately carries NONE of
 * `writeApplicationStatus`'s allow-list — AC-3b names this as the one
 * exemption, because a signed-in user editing their own row through a typed
 * confirmation is not the failure mode C1 exists to stop. Its guards are on
 * the same statement, they are just different guards: a tenant filter
 * (`user_id`), a compare-and-set on `applied_at` (the byte-for-byte value
 * the dialog was opened with), and — before any of it — an explicit
 * confirmation whenever the save would clear or overwrite a real date.
 *
 * @param {*} supabase
 * @param {object} args
 * @param {string} args.applicationId
 * @param {string} args.userId
 * @param {string} args.status
 * @param {string|null} [args.appliedAt]  omit entirely to leave the column
 *   untouched; `null` to clear it; an ISO string to set it.
 * @param {string|null} args.appliedAtStored  the CAS operand: the exact
 *   value PostgREST returned when the dialog was opened.
 * @param {(message: string) => (boolean|Promise<boolean>)} args.confirm
 *   REQUIRED. Throws synchronously (as a rejected promise, since this
 *   function is async) when absent or not a function — a wiring miss must
 *   crash, not silently no-op past the one thing standing between a user and
 *   a lost date.
 */
export async function setApplicationStatusByUser(
  supabase,
  { applicationId, userId, status, appliedAt, appliedAtStored, confirm },
) {
  if (typeof confirm !== "function") {
    throw new TypeError(
      "setApplicationStatusByUser: confirm is required and must be a function",
    );
  }

  // Fail-closed on the door a human types into, not only the machine door.
  // `EditAppDialog`'s Select is sourced from `USER_SELECTABLE_STATUSES` PLUS
  // one appended entry carrying whatever the row currently holds when that
  // value is outside the subset — so `status` here is not bounded by the
  // eight the dialog lists, and this door has no allow-list on its WHERE.
  // Refusing before IO is the only thing standing between an unknown value
  // and the row.
  if (classifyStatus(status) === "unknown") {
    return refusal("unknown-status");
  }
  if (!applicationId || !userId) {
    return refusal("no-key");
  }

  const dateSupplied = appliedAt !== undefined;
  const hadStoredDate = appliedAtStored !== null && appliedAtStored !== undefined;
  const willChangeDate = dateSupplied && appliedAt !== appliedAtStored;
  const destroysDate = willChangeDate && hadStoredDate;

  if (destroysDate) {
    const proceed = await confirm(
      `Clearing or changing the applied date will remove ${formatDateForConfirm(
        appliedAtStored,
      )} from this application. This can't be undone. Continue?`,
    );
    if (!proceed) return refusal("declined");
  }

  const payload = { status };
  if (dateSupplied) payload.applied_at = appliedAt;

  let query = supabase
    .from(APPLICATIONS_TABLE)
    .update(payload)
    .eq("id", applicationId)
    .eq("user_id", userId); // the tenant filter — this door has no other guard against another user's row.

  // The CAS operand is the byte-for-byte value the dialog was opened with.
  // `.eq(col, null)` is `= NULL` and matches nothing, so a dateless row (the
  // most common shape in the table) MUST be compared with `.is()` or every
  // save of it would refuse as "stale".
  query = hadStoredDate
    ? query.eq("applied_at", appliedAtStored)
    : query.is("applied_at", null);

  const { data, error } = await query.select("id, status");
  if (error) return refusal("error");
  if (!data || data.length === 0) {
    // Zero rows matched. Whether the cause was the tenant filter or the CAS,
    // the row moved (or was never this user's) between when the dialog
    // opened and now — "stale" either way.
    return refusal("stale");
  }

  return { id: data[0].id, changed: true, reason: "promoted", currentStatus: data[0].status, stamped: false };
}

/**
 * Loads every external id this user's applications are applied-or-later for
 * — by STATUS, or by a non-null `applied_at` regardless of status (the
 * disjunct that surfaces D1's victims: a row demoted to `tracking` that
 * still carries a real date). Issued as TWO queries unioned in JS, never
 * `.or()` — the fake this repo tests against throws on `.or()` by
 * construction, and 1b adopted the disjunct for this loader while
 * dismissing it for the writer, so a single unioned query is not merely a
 * style choice here.
 *
 * @param {*} supabase
 * @param {string} userId
 * @returns {Promise<{ids: Set<string>, byExternalId: Map<string, {status:string, appliedAt:string|null, applicationId:string}>}>}
 */
export async function loadAppliedOrLaterExternalIds(supabase, userId) {
  const byExternalId = new Map();

  function ingest(rows) {
    for (const row of rows || []) {
      const externalId = row.positions && row.positions.external_id;
      if (!externalId) continue;
      byExternalId.set(externalId, {
        status: row.status,
        appliedAt: row.applied_at,
        applicationId: row.id,
      });
    }
  }

  const byStatus = await supabase
    .from(APPLICATIONS_TABLE)
    .select("id, status, applied_at, positions(external_id)")
    .eq("user_id", userId)
    .in("status", APPLIED_OR_LATER_STATUSES);
  ingest(byStatus.data);

  const byDate = await supabase
    .from(APPLICATIONS_TABLE)
    .select("id, status, applied_at, positions(external_id)")
    .eq("user_id", userId)
    .not("applied_at", "is", null);
  ingest(byDate.data);

  return { ids: new Set(byExternalId.keys()), byExternalId };
}

/**
 * Deletes a `tracking` row with no date attached — the "remove this posting
 * from the queue" action. Deliberately NOT widened to every pre-apply
 * status: a row at `tailored` is not deletable by untrack today, and
 * widening it is a feature change, not a data-loss fix. Both refusals are
 * filters on the DELETE itself, never a prior read: a row that still
 * carries a date (a D1 victim demoted to `tracking`) is left alone so the
 * caller can keep its chip rather than optimistically dropping it.
 *
 * @param {*} supabase
 * @param {{userId: string, positionId: string}} args
 * @returns {Promise<{deleted: boolean}>}
 */
export async function deleteUntrackedApplication(supabase, { userId, positionId }) {
  const { data, error } = await supabase
    .from(APPLICATIONS_TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("position_id", positionId)
    .eq("status", STATUS.TRACKING)
    .is("applied_at", null)
    .select("id");
  if (error) return { deleted: false };
  return { deleted: (data || []).length > 0 };
}

/**
 * Deletes ONE application row by id, tenant-scoped, refusing outright at any
 * applied-or-later status. This is the general "Delete" button's statement
 * (`app/hooks/useApplicationDialogs.js`'s `handleDeleteApplication`) —
 * unlike `deleteUntrackedApplication` above (narrow: only a dateless
 * `tracking` row, for the "remove from queue" action), that button is
 * reachable on a row at ANY status, and until this function existed its
 * statement carried no tenant filter and no status guard at all:
 * `supabase.from("applications").delete().eq("id", app.id)`. Whether the
 * missing tenant filter is exploitable depends on RLS state on
 * `applications`, which is unknown and must not be assumed either way — which
 * is exactly why the filter belongs on the statement rather than left to RLS
 * alone.
 *
 * REFUSE, not "confirm harder": once a hard DELETE lands it is invisible to
 * every downstream check, so the guard here is the SAME allow-list discipline
 * as C1 above (`.in("status", PRE_APPLY_STATUSES)`, un-negated, never a
 * deny-list) rather than merely another dialog in front of the same
 * unfiltered statement — a `window.confirm` is a request, not a guarantee.
 * The two-way door already exists for a user who really does want an
 * applied-or-later row gone: `setApplicationStatusByUser` (the Edit dialog)
 * can move it back to a pre-apply status first — under its OWN explicit
 * confirmation for the date that move would destroy — after which this
 * function deletes it like any other pre-apply row.
 *
 * Zero rows from the DELETE is ambiguous (wrong tenant / wrong id / already
 * gone vs. protected vs. unknown-status), so — mirroring C2's three-valued
 * disambiguation above — a single tenant-scoped read-back resolves it. No
 * retry: unlike C1's promotion case, a delete that matched nothing has
 * nothing useful to retry against. The read-back is scoped to the SAME
 * tenant filter as the delete, so a row belonging to a different user is
 * reported identically to "no such row" — never disclosing another user's
 * status.
 *
 * @param {*} supabase
 * @param {{userId: string, applicationId: string}} args
 * @returns {Promise<{deleted: boolean, reason: string, id: string|null, currentStatus: string|null}>}
 */
export async function deleteApplicationForUser(supabase, { userId, applicationId }) {
  if (!userId || !applicationId) {
    return { deleted: false, reason: "no-key", id: null, currentStatus: null };
  }

  const { data, error } = await supabase
    .from(APPLICATIONS_TABLE)
    .delete()
    .eq("id", applicationId)
    .eq("user_id", userId) // the tenant filter this statement had none of.
    .in("status", PRE_APPLY_STATUSES) // ALLOW-LIST. NEVER .not(..., "in", ...).
    .select("id");
  if (error) return { deleted: false, reason: "error", id: null, currentStatus: null };
  if ((data || []).length > 0) {
    return { deleted: true, reason: "deleted", id: applicationId, currentStatus: null };
  }

  const { data: row, error: readErr } = await supabase
    .from(APPLICATIONS_TABLE)
    .select("id, status")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) return { deleted: false, reason: "error", id: null, currentStatus: null };
  if (!row) return { deleted: false, reason: "not-found", id: null, currentStatus: null };

  const classification = classifyStatus(row.status);
  return {
    deleted: false,
    reason: classification === "unknown" ? "unknown-status" : "protected",
    id: row.id,
    currentStatus: row.status,
  };
}
