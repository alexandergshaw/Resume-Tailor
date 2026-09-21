// The ONLY module that names any of the three interview-prep tables or
// issues a query against them (design-structure.r1.md §3). Every exported
// function here runs under the `authenticated` role and RLS -- this module
// never imports or calls `createAdminClient()`, matching the contract's own
// S-1/S-3 precedent (no service-role path for anything candidate-facing).
// `supabase` is always the caller's own client, injected as the first
// argument, exactly like every other Supabase-backed store in this repo.
//
// FIRST OBLIGATION OF THIS SEAT, per rulings.md R-IP3-61: the RPC this file
// calls is the CORRECTED, 3-parameter `claim_prep_pack_slot` signature --
// `(p_application_id, p_lease_token, p_lease_until)`, no `p_user_id`.
// Identity comes from `auth.uid()` server-side (design-structure.r1.md §4.1);
// a 4th `p_user_id` argument would be the stale, superseded, tenant-isolation
// hole R-IP3-53 removed.
//
// Reads (`readPrepPack`/`listPrepPacks`/`listPrepEvents`) are written to be
// called directly from client code via the browser Supabase client
// (design-structure.r1.md §10) -- this file carries no server-only import,
// so nothing here breaks when bundled for the browser. Writes
// (`claimPrepPack`/`writePrepPackResult`/`deletePrepPackContent`/
// `recordModelCallIssued`/`recordPrepEvent`) are driven by
// `app/api/interview-prep/route.js`.
//
// O-15's write/read choke point (`normalizePack`, `./prepParse.js`) is
// applied on BOTH sides here: `readPrepPack` normalizes before returning a
// pack to any caller, and `writePrepPackResult` normalizes before a
// generated pack is ever stored -- the same function, so there is exactly
// one place this rule can be bypassed, never two independently-maintained
// copies (prepParse.js's own header, design-structure.r1.md §9).
//
// SCOPE, STATED HONESTLY:
// - `claimPrepPack`'s `attempts` field (documented in
//   1-0-contract.r8.md's Functions table as part of every return) is `null`
//   on every path here. `1-0-contract.r3.md` §8 once described sourcing it
//   from a post-increment read of `interview_prep_spend` on a successful
//   claim -- but `prepStore.test.js`'s own landed, adversarially-checked
//   K2-FROM test asserts a successful `claimPrepPack` call issues ZERO
//   `.from()` calls at all, which a follow-up read would violate.
//   design-structure.r1.md §4.2 (the newer, authoritative round) only ever
//   describes a follow-up read for disambiguating a REFUSED claim, never for
//   populating `attempts` on a successful one -- this file follows that
//   narrower, test-confirmed reading rather than r3's older prose.
// - `recordModelCallIssued` increments `interview_prep_spend.model_calls`
//   through `record_prep_model_call`, a SECURITY DEFINER RPC added
//   alongside `claim_prep_pack_slot` in this migration -- an atomic
//   `insert ... on conflict (application_id) do update set model_calls =
//   model_calls + 1`, the same expression pattern the claim path already
//   uses for `attempts`. This replaces a prior read-then-write (a
//   `.select()` followed by `.update({ model_calls: current + 1 })`) that
//   let two concurrent calls both read the same starting value and both
//   write N+1, losing one against the cap -- closed, not merely narrowed:
//   `authenticated`'s own table grant on `interview_prep_spend` no longer
//   reaches `model_calls` at all (see that table's grant in the migration
//   file), so this RPC is now the only path that can ever write it.
// - `writePrepPackResult`'s CHECK-safe fallback write (design-structure.r1.md
//   §8.4, fired when the ordinary write raises `23514`) is a SEPARATE call
//   into this same function with a safe payload -- orchestrating that retry
//   is `lib/interviewPrep/finishAttempt.js`'s job (called from
//   `app/api/interview-prep/route.js`), not this file's; this function only
//   ever issues the one `UPDATE` it is asked for.

import { normalizePack } from "./prepParse.js";
import { PREP_LEASE_MS, PREP_PACK_MAX_BYTES, PREP_SECTION_REVISIONS_MAX, PREP_SECTION_REVISION_MAX_BYTES } from "./prepConstants.js";
import {
  PREP_LIST_PROJECTION,
  PREP_SPEND_PROJECTION,
  PREP_REVISION_PROJECTION,
  PREP_REVISION_LIST_PROJECTION,
} from "./prepContract.js";
import { claimOwnershipViolations } from "./prepClaims.js";

const PACKS_TABLE = "interview_prep_packs";
const SPEND_TABLE = "interview_prep_spend";
const EVENTS_TABLE = "interview_prep_events";
const REVISIONS_TABLE = "interview_prep_section_revisions";

// readPrepPack's own single-row projection -- deliberately narrower than
// PREP_LIST_PROJECTION, and never `select("*")` (design-structure.r1.md
// §5.1). N45/N46: widened to include `live_revisions` -- the pointer a
// restore needs to know whether history exists at all for this row (plan
// risk R5: a docstring-only widening leaves `liveRevisions` `{}` forever,
// silently).
const PACK_DETAIL_PROJECTION = "status, pack, live_revisions";

function errMessage(error) {
  if (!error) return null;
  return typeof error.message === "string" ? error.message : String(error);
}

// N45/N46: `live_revisions` (interview_prep_packs) is a `{section: revision}`
// pointer, `jsonb not null default '{}'::jsonb`. A plain-object guard so a
// malformed or missing column value never crashes a reader -- coerces to
// `{}`, matching every other defensive "unreadable becomes empty" idiom in
// this module.
function asPlainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// The driver's own SQLSTATE for a CHECK constraint violation (3b.r1.md item
// 3, confirmed at primary source: supabase-js passes `error.code` through
// clean and unmodified, unlike `error.message`, whose wording is Postgres's
// to change). This is the ONLY thing isCheckViolation below ever compares
// against -- never a substring of `error.message` (see N9: a message-text
// matcher breaks on any Postgres wording change; a SQLSTATE does not).
// Module-local, not exported: every consumer either lives in this file or
// receives a value already tagged with it (writePrepPackResult's `code`
// field) and compares against isCheckViolation, never the literal itself
// (lib/sourceScan/exportReachability.sweep.test.js's TR-1 count: an export
// whose only importer is a test is exactly the shape that rule flags).
const PG_CHECK_VIOLATION = "23514";

function errCode(error) {
  if (!error) return null;
  // Verbatim, never coerced or defaulted -- an absent `code` becomes `null`
  // (matching errMessage's own null-when-absent convention above), not
  // `undefined` and never PG_CHECK_VIOLATION.
  return error.code ?? null;
}

/**
 * True only when a writePrepPackResult() result's own `code` field is
 * exactly PG_CHECK_VIOLATION. Deliberately has NO message-text fallback --
 * reintroducing one is the exact defect N9 exists to remove. The one
 * caller, lib/interviewPrep/finishAttempt.js's finishAttempt(), passes this
 * function the whole write result (never `write.error` alone), since `code`
 * -- not `error` -- is what this predicate reads.
 *
 * @param {{ code?: string|null }} result
 */
export function isCheckViolation(result) {
  return result?.code === PG_CHECK_VIOLATION;
}

// N41 (owner decision, 2026-09-20): both interview-prep spend caps are
// removed, so this always returns false now -- the "attempts-exhausted"
// state is permanently unreachable (N41(c)'s own text). Still shared by
// readPrepPack and listPrepPacks, and still exported in shape via both
// call sites' `attemptsExhausted` field, so nothing downstream (the GET
// route, PrepPackPanel's prop list) needs to change to accommodate the
// removal -- only this function's body does. `spendRow` is accepted,
// unused beyond the shape of the call, so a future re-introduction of a cap
// has exactly one function to change back.
function isAttemptsExhausted(_spendRow) {
  return false;
}

// A `lease_token`/`interview_prep_packs.application_id`-style column is a
// real `uuid`, so a fallback must still emit a genuine RFC 4122 v4 value --
// the same defensive shape `lib/supabase/practiceAnswers.js`'s `genId`
// already ships for the identical concern on a different table.
function genLeaseToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * The IP4-facing single-pack read (design-structure.r1.md §5.1/§5.2). Derives
 * `attemptsExhausted` from (pack row presence, spend-ledger row state), never
 * from the pack row alone -- O-17 made "pack absent, ledger present" an
 * ordinary, reachable state.
 *
 * N33: `storedNames` (default `[]`) is threaded straight through to
 * `normalizePack`, below -- resolved by THIS FUNCTION'S OWN CALLER (never
 * internally), via `trustedNames.js`'s `readTrustedNames`/
 * `flattenTrustedNames`, so this module's own table-touch surface (K2-FROM,
 * prepStore.test.js) stays exactly the three prep tables it always was;
 * `candidate_identity`/`application_trusted_names` are queried only by
 * trustedNames.js and by whichever server-only caller resolves them.
 *
 * @param {*} supabase
 * @param {{ applicationId: string, userId: string }} args
 * @param {string[]} [storedNames]
 */
export async function readPrepPack(supabase, { applicationId, userId }, storedNames = []) {
  const [packResult, spendResult] = await Promise.all([
    supabase
      .from(PACKS_TABLE)
      .select(PACK_DETAIL_PROJECTION)
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from(SPEND_TABLE)
      .select(PREP_SPEND_PROJECTION)
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (packResult.error) {
    return { pack: null, status: null, liveRevisions: {}, attemptsExhausted: false, error: errMessage(packResult.error) };
  }
  if (spendResult.error) {
    return { pack: null, status: null, liveRevisions: {}, attemptsExhausted: false, error: errMessage(spendResult.error) };
  }

  const packRow = packResult.data;
  const attemptsExhausted = isAttemptsExhausted(spendResult.data);

  if (!packRow) {
    return { pack: null, status: null, liveRevisions: {}, attemptsExhausted, error: null };
  }

  return {
    pack: normalizePack(packRow.pack ?? null, storedNames),
    status: packRow.status ?? null,
    liveRevisions: asPlainRecord(packRow.live_revisions),
    attemptsExhausted,
    error: null,
  };
}

function buildListItem(packRow, spendRow) {
  return {
    status: packRow?.status ?? null,
    reason: packRow?.reason ?? null,
    engine: packRow?.engine ?? null,
    researchedAt: packRow?.researched_at ?? null,
    resumeId: packRow?.resume_id ?? null,
    coverLetterId: packRow?.cover_letter_id ?? null,
    postingFingerprint: packRow?.posting_fingerprint ?? null,
    digestResearchedAt: packRow?.digest_researched_at ?? null,
    attemptsExhausted: isAttemptsExhausted(spendRow ?? null),
  };
}

/**
 * The tracking-list read (design-structure.r1.md §5.3). Two named-column
 * queries, merged by the UNION of both result sets' `application_id` values
 * -- never the pack-table result alone, so an id present only in the ledger
 * still surfaces (content fields `null`, `attemptsExhausted` from the same
 * shared formula).
 *
 * @param {*} supabase
 * @param {{ applicationIds: string[], userId: string }} args
 */
export async function listPrepPacks(supabase, { applicationIds, userId }) {
  const ids = Array.isArray(applicationIds) ? applicationIds : [];

  const [packResult, spendResult] = await Promise.all([
    supabase.from(PACKS_TABLE).select(PREP_LIST_PROJECTION).eq("user_id", userId).in("application_id", ids),
    supabase.from(SPEND_TABLE).select(PREP_SPEND_PROJECTION).eq("user_id", userId).in("application_id", ids),
  ]);

  if (packResult.error) return { packs: null, error: errMessage(packResult.error) };
  if (spendResult.error) return { packs: null, error: errMessage(spendResult.error) };

  const packRows = Array.isArray(packResult.data) ? packResult.data : [];
  const spendRows = Array.isArray(spendResult.data) ? spendResult.data : [];
  const spendById = new Map(spendRows.map((row) => [row.application_id, row]));

  const packs = {};
  for (const row of packRows) {
    packs[row.application_id] = buildListItem(row, spendById.get(row.application_id));
  }
  for (const row of spendRows) {
    if (packs[row.application_id]) continue;
    packs[row.application_id] = buildListItem(null, row);
  }

  return { packs, error: null };
}

/**
 * Claims a run slot via the corrected, 3-parameter `claim_prep_pack_slot` RPC
 * -- never a `p_user_id` argument (R-IP3-53/R-IP3-61).
 *
 * N41 (owner decision, 2026-09-20): both spend caps are removed from the RPC
 * itself (supabase/migrations/20260922000000_interview_prep_remove_spend_caps.sql),
 * so a refused claim (`data !== true`, no RPC-level error) can now only mean
 * one thing -- the packs upsert's own `ON CONFLICT ... WHERE (status <>
 * 'running' OR lease_until < now())` matched zero rows, i.e. another
 * invocation genuinely holds a live (or just-expired) lease on this row.
 * There is nothing left to disambiguate: the follow-up read of the pack
 * row's own `lease_until` this function used to perform existed ONLY to
 * tell that state apart from "the RPC's cap check refused it" -- a state
 * N41's own text requires become PERMANENTLY UNREACHABLE. That read is
 * removed along with the branch it fed; every non-error refusal reports
 * `reason: "in-flight"` directly off the RPC's own boolean result.
 *
 * @param {*} supabase
 * @param {{ applicationId: string, userId: string }} args
 */
export async function claimPrepPack(supabase, { applicationId, userId }) {
  const leaseToken = genLeaseToken();
  const leaseUntil = new Date(Date.now() + PREP_LEASE_MS).toISOString();

  const { data, error } = await supabase.rpc("claim_prep_pack_slot", {
    p_application_id: applicationId,
    p_lease_token: leaseToken,
    p_lease_until: leaseUntil,
  });

  if (error) {
    return { claimed: false, leaseToken: null, attempts: null, reason: "error", error: errMessage(error) };
  }

  if (data === true) {
    return { claimed: true, leaseToken, attempts: null, reason: "claimed", error: null };
  }

  return { claimed: false, leaseToken: null, attempts: null, reason: "in-flight", error: null };
}

/**
 * The `pack` document's byte bound (PREP_PACK_MAX_BYTES, ./prepConstants.js),
 * enforced here in JS and deliberately not as a database CHECK --
 * `pg_column_size` is not IMMUTABLE, and a CHECK containing a non-immutable
 * function is a dump/restore hazard. See this table's own migration (the
 * "NOT ADDED, deliberately" note beside `interview_prep_packs_claims_is_array`
 * in supabase/migrations/20260914000000_interview_prep.sql) and
 * `lib/copilot/glossaryStore.js`'s identical, earlier precedent on
 * `position_glossaries.terms`.
 *
 * Reports the byte count and how far over the limit the pack was, rather
 * than a bare boolean -- matching glossaryStore's own practice of reporting
 * what overflowed instead of only refusing. Measured with `TextEncoder`,
 * never `Buffer`: this module's own header states it carries no
 * server-only import so it stays safe to bundle for the browser, and
 * `TextEncoder` (already used by test/helpers/supabaseMock.js's `fakeBlob`)
 * is the one UTF-8-byte-length primitive available in both environments.
 *
 * The `message` this returns is a TRUE statement about what happened, never
 * "violates check constraint interview_prep_packs_pack_size_check" --
 * that constraint does not exist (see the "NOT ADDED, deliberately" note
 * above); this bound is enforced here, in JS, not by the database, and
 * saying otherwise sends an operator hunting a CHECK that is in no
 * migration. `writePrepPackResult` below tags this refusal's `code` field
 * with `PG_CHECK_VIOLATION` as a DELIBERATE STAND-IN -- a JS-side refusal
 * before any statement runs carries no real driver error and so has no real
 * SQLSTATE of its own -- purely so its existing CHECK-safe fallback retry
 * (design-structure.r1.md §8.4, `lib/interviewPrep/finishAttempt.js`'s
 * `finishAttempt`) keeps treating this refusal the same way it treats an
 * actual `23514` from the database. That stand-in is a fact about the
 * `code` field, never about this function's own `message` text.
 *
 * @param {*} pack
 * @param {number} limit
 * @returns {{ ok: boolean, bytes: number, message: string|null }}
 */
export function checkPackByteBudget(pack, limit = PREP_PACK_MAX_BYTES) {
  const bytes = new TextEncoder().encode(JSON.stringify(pack ?? null)).length;
  if (bytes <= limit) return { ok: true, bytes, message: null };
  return {
    ok: false,
    bytes,
    message: `pack is ${bytes} bytes, ${bytes - limit} over the ${limit}-byte limit`,
  };
}

/**
 * The terminal write (design-structure.r1.md §8.4). Always a plain `UPDATE`,
 * never an upsert (DS-10) -- an upsert on this table could resurrect a
 * deleted pack's content on a stale in-flight write. `reason` is forced to
 * `null` whenever `status` is `'ready'`/`'partial'`, regardless of what the
 * caller passes (§8.5's writer-discipline fix); for `'failed'`/`'unavailable'`
 * the caller's `reason` is used as-is and must already be a CHECK-permitted
 * value -- this function does not pre-validate it, so a bad value fails
 * loudly at the database rather than storing un-mapped text.
 *
 * N33: `storedNames` (default `[]`) is threaded straight through to
 * `normalizePack`, below -- resolved by THIS FUNCTION'S OWN CALLER (never
 * internally, and never read off `pack` itself), the same discipline
 * `readPrepPack`'s own header states. Keeping the resolution out of this
 * function is what keeps its own table-touch surface (K2-FROM,
 * prepStore.test.js) unchanged at exactly the three prep tables.
 *
 * N45/N46: `liveRevisions` carries NO default, joining `pack`/
 * `postingFingerprint` under the N14 omission rule above -- an un-supplied
 * value leaves `live_revisions` untouched rather than nulling it (a `jsonb
 * not null` column). This function does NOT enforce that `pack` and
 * `liveRevisions` are supplied together ("both-or-neither"): doing so would
 * turn every one of `finishAttempt.test.js`'s three landed `pack`-only
 * payloads red for a rule that test never opted into, which is a defect in
 * the caller's payload, not in this write -- see route.js's own failure call
 * sites (plan §S7b) for where `...restore` supplies both together instead.
 *
 * `expectedUpdatedAt`, when supplied, replaces the ordinary lease-token
 * predicate with an OPTIMISTIC one: `.eq("updated_at", expectedUpdatedAt)`
 * plus a `status <> 'running'` guard, and no `lease_token` filter at all.
 * This is the restore path's own write (PATCH /api/interview-prep) -- it
 * never claims a lease, so gating on one would refuse every restore. Kept as
 * exactly one more caller of this SAME function (never a second `.update(`
 * site on this table) so R-N45-CLAIMS' single-writer premise still holds.
 *
 * THE INV-CLAIM-1 GATE (AC-CLAIM.6-8): `claimOwnershipViolations` runs on
 * `normalizedPack` -- the pack this call is ABOUT to write -- before the
 * `.update(` below. A cross-owner or malformed-ownership pack is refused
 * with `written: false` before any statement runs.
 *
 * @param {*} supabase
 */
export async function writePrepPackResult(
  supabase,
  {
    applicationId,
    userId,
    leaseToken,
    status,
    reason = null,
    error = null,
    engine = null,
    pack,
    resumeId = null,
    coverLetterId = null,
    postingFingerprint,
    digestResearchedAt = null,
    researchedAt = null,
    truncatedReason = null,
    storedNames = [],
    liveRevisions,
    expectedUpdatedAt,
  },
) {
  const clearedReason = status === "ready" || status === "partial" ? null : reason;
  const normalizedPack = pack != null ? normalizePack(pack, storedNames) : pack;

  if (normalizedPack != null) {
    const violations = claimOwnershipViolations(normalizedPack);
    if (violations.length > 0) {
      return {
        written: false,
        reason: "error",
        error: `pack has ${violations.length} claim ownership violation(s): ${violations.map((v) => v.kind).join(", ")}`,
        code: null,
      };
    }
  }

  // The byte bound this table's own CHECK used to enforce -- see
  // checkPackByteBudget's header for why `code: PG_CHECK_VIOLATION` is used
  // here even though this refusal is JS-side and carries no driver error.
  if (normalizedPack != null) {
    const budget = checkPackByteBudget(normalizedPack);
    if (!budget.ok) return { written: false, reason: "error", error: budget.message, code: PG_CHECK_VIOLATION };
  }

  // `pack` and `posting_fingerprint` are the two columns on this table
  // declared `not null` with their own DEFAULT (supabase/migrations/
  // 20260914000000_interview_prep.sql:155,159) -- a DEFAULT never applies to
  // an explicit `SET col = NULL`, so forwarding either argument
  // unconditionally once it had defaulted to `null` put NULL into a NOT NULL
  // column and raised SQLSTATE 23502 (backlog N14). `pack`/`postingFingerprint`
  // above therefore carry NO default value: an un-supplied argument stays
  // `undefined` here and its key is left out of the SET list entirely below,
  // so the column keeps whatever it already held rather than being nulled --
  // finishAttempt.js's own CHECK-safe fallback retry is exactly this caller,
  // supplying neither. An argument explicitly passed as `null` is NOT the
  // same as an un-supplied one and is still sent through as `null` (a bad
  // value fails loudly at the database, matching this function's own
  // documented `reason`-validation discipline above, rather than being
  // silently swallowed into an omission).
  //
  // Every other column in this SET list stays unconditional on purpose --
  // they are genuinely nullable, and several callers rely on an un-supplied
  // argument writing NULL: `reason`'s own `clearedReason` force-null for
  // `ready`/`partial` (§8.5) above, and `lease_until`/`lease_token`'s
  // hardcoded `null` releasing the lease on every terminal write. Dropping
  // every null-or-undefined key here (rather than only the two NOT NULL
  // columns' un-supplied case) would release no lease and is the wrong fix.
  const updateSet = {
    status,
    reason: clearedReason,
    error,
    engine,
    resume_id: resumeId,
    cover_letter_id: coverLetterId,
    digest_researched_at: digestResearchedAt,
    researched_at: researchedAt,
    truncated_reason: truncatedReason,
    lease_until: null,
    lease_token: null,
    updated_at: new Date().toISOString(),
  };
  if (pack !== undefined) updateSet.pack = normalizedPack;
  if (postingFingerprint !== undefined) updateSet.posting_fingerprint = postingFingerprint;
  if (liveRevisions !== undefined) updateSet.live_revisions = liveRevisions;

  let query = supabase.from(PACKS_TABLE).update(updateSet).eq("application_id", applicationId).eq("user_id", userId);
  query =
    expectedUpdatedAt !== undefined
      ? query.eq("updated_at", expectedUpdatedAt).neq("status", "running")
      : query.eq("lease_token", leaseToken);

  const { data, error: dbError } = await query.select();

  if (dbError) return { written: false, reason: "error", error: errMessage(dbError), code: errCode(dbError) };

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return { written: false, reason: "stale-token", error: null, code: null };

  return { written: true, reason: null, error: null, code: null };
}

/**
 * O-16/O-17: a real row DELETE, never a tombstone UPDATE. Carries the
 * predicate design-structure.r1.md §8.3 specifies
 * (`status <> 'running' OR lease_until < now()`) so a genuinely in-flight
 * run cannot be deleted out from under itself. A zero-row result is
 * disambiguated by a follow-up read, the same idiom `claimPrepPack` already
 * uses: the row still existing means the predicate refused the delete
 * ("in-flight"); the row genuinely absent means it was already gone
 * ("not-found").
 *
 * @param {*} supabase
 * @param {{ applicationId: string, userId: string }} args
 */
export async function deletePrepPackContent(supabase, { applicationId, userId }) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from(PACKS_TABLE)
    .delete()
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .or(`status.neq.running,lease_until.lt.${nowIso}`)
    .select();

  if (error) return { deleted: false, reason: "error", error: errMessage(error) };

  const deletedRows = Array.isArray(data) ? data : [];
  if (deletedRows.length > 0) {
    // O-16/AC-O16.1: the revisions table FKs to `applications`, not to this
    // packs row, so nothing cascades a pack delete into it automatically.
    // Best-effort, same discipline as pruneSectionRevisions -- a candidate's
    // own delete of their content must not fail because this cleanup did.
    await supabase.from(REVISIONS_TABLE).delete().eq("application_id", applicationId).eq("user_id", userId);
    return { deleted: true, reason: "deleted", error: null };
  }

  const followUp = await supabase
    .from(PACKS_TABLE)
    .select("application_id")
    .eq("application_id", applicationId)
    .eq("user_id", userId);

  if (followUp.error) return { deleted: false, reason: "error", error: errMessage(followUp.error) };

  const stillExists = Array.isArray(followUp.data) ? followUp.data.length > 0 : Boolean(followUp.data);
  return { deleted: false, reason: stillExists ? "in-flight" : "not-found", error: null };
}

// ---------------------------------------------------------------------------
// N45/N46: per-section revision history (plan §S5/§S6).
// ---------------------------------------------------------------------------

/**
 * Appends one immutable revision per named section, in ONE insert. `revision`
 * comes from the caller's own prior read (`readLiveSectionRevisions`'s
 * `newestBySection`), never a re-read here -- the PK
 * `(application_id, section, revision)` is what makes a lost race
 * impossible: the loser's insert raises 23505 and is reported as reason
 * "conflict", never silently retried, never thrown.
 *
 * Does NOT make anything live -- that is `writePrepPackResult`'s own
 * `live_revisions` column, written by the caller as a separate step. Refuses,
 * before any statement runs, any section whose `JSON.stringify({content,
 * claims})` exceeds `PREP_SECTION_REVISION_MAX_BYTES`, measured with
 * `TextEncoder` (never `Buffer` -- this module stays browser-safe), the same
 * discipline `checkPackByteBudget` already uses.
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string,
 *          sections: Record<string, {content: *, claims: Array<object>, engine: string,
 *                                    revision: number, restoredFrom?: number|null,
 *                                    contentVersion?: number}>}} args
 * @returns {Promise<{revisions: Record<string, number>|null,
 *                    reason: null|"conflict"|"too-large"|"error", error: string|null}>}
 */
export async function appendSectionRevisions(supabase, { applicationId, userId, sections }) {
  const names = Object.keys(sections || {});

  for (const name of names) {
    const entry = sections[name] || {};
    const bytes = new TextEncoder().encode(JSON.stringify({ content: entry.content ?? null, claims: entry.claims ?? [] })).length;
    if (bytes > PREP_SECTION_REVISION_MAX_BYTES) {
      return {
        revisions: null,
        reason: "too-large",
        error: `section "${name}" is ${bytes} bytes, ${bytes - PREP_SECTION_REVISION_MAX_BYTES} over the ${PREP_SECTION_REVISION_MAX_BYTES}-byte limit`,
      };
    }
  }

  const rows = names.map((name) => {
    const entry = sections[name];
    return {
      application_id: applicationId,
      user_id: userId,
      section: name,
      revision: entry.revision,
      content: entry.content,
      claims: Array.isArray(entry.claims) ? entry.claims : [],
      engine: entry.engine,
      content_version: entry.contentVersion ?? 1,
      restored_from: entry.restoredFrom ?? null,
    };
  });

  const { data, error } = await supabase.from(REVISIONS_TABLE).insert(rows).select("section, revision");

  if (error) {
    if (errCode(error) === "23505") return { revisions: null, reason: "conflict", error: null };
    return { revisions: null, reason: "error", error: errMessage(error) };
  }

  const revisions = {};
  for (const row of Array.isArray(data) ? data : []) revisions[row.section] = row.revision;
  return { revisions, reason: null, error: null };
}

/**
 * The live document's per-section bodies, provenance and revision numbers,
 * resolved from `interview_prep_packs.live_revisions`. TWO queries issued
 * together with `Promise.all` (matching `readPrepPack`'s own shape), so ONE
 * wall-clock round trip.
 *
 * G1 (plan §2.5): the return carries `status`, and THIS FUNCTION'S OWN
 * CALLER must invoke it BEFORE `claimPrepPack`. Without `status`,
 * `restorePayload` cannot tell "this row has no content" from "this row's
 * content was blanked by an attempt that is still running", and the
 * difference is the whole fix.
 *
 * Returns `sections: {}` and `liveRevisions: {}` for a row whose pointer is
 * empty -- every pre-N45 row. That empty result is the caller's signal to
 * use the stored `pack` as the merge base instead, WHICH IS ONLY VALID IF
 * THIS READ HAPPENED BEFORE `claim_prep_pack_slot` ran.
 *
 * `newestBySection` is the max revision per section INCLUDING non-live ones.
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string}} args
 * @returns {Promise<{status: string|null,
 *   sections: Record<string, {content: *, claims: Array<object>, engine: string, revision: number}>,
 *   liveRevisions: Record<string, number>, newestBySection: Record<string, number>,
 *   pack: *|null, updatedAt: string|null, error: string|null}>}
 */
export async function readLiveSectionRevisions(supabase, { applicationId, userId }) {
  const failure = (message) => ({
    status: null,
    sections: {},
    liveRevisions: {},
    newestBySection: {},
    pack: null,
    updatedAt: null,
    error: message,
  });

  const [packResult, revisionsResult] = await Promise.all([
    supabase
      .from(PACKS_TABLE)
      .select("status, pack, live_revisions, updated_at")
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from(REVISIONS_TABLE).select(PREP_REVISION_PROJECTION).eq("application_id", applicationId).eq("user_id", userId),
  ]);

  if (packResult.error) return failure(errMessage(packResult.error));
  if (revisionsResult.error) return failure(errMessage(revisionsResult.error));

  const packRow = packResult.data;
  const pointer = asPlainRecord(packRow?.live_revisions);
  const rows = Array.isArray(revisionsResult.data) ? revisionsResult.data : [];

  const newestBySection = {};
  const bySectionRevision = new Map();
  for (const row of rows) {
    bySectionRevision.set(`${row.section}:${row.revision}`, row);
    if (!(row.section in newestBySection) || row.revision > newestBySection[row.section]) {
      newestBySection[row.section] = row.revision;
    }
  }

  const liveRevisions = {};
  const sections = {};
  for (const [section, revision] of Object.entries(pointer)) {
    liveRevisions[section] = revision;
    const row = bySectionRevision.get(`${section}:${revision}`);
    if (row) {
      sections[section] = {
        content: row.content,
        claims: Array.isArray(row.claims) ? row.claims : [],
        engine: row.engine ?? null,
        revision: row.revision,
      };
    }
  }

  return {
    status: packRow?.status ?? null,
    sections,
    liveRevisions,
    newestBySection,
    pack: packRow?.pack ?? null,
    updatedAt: packRow?.updated_at ?? null,
    error: null,
  };
}

/**
 * The history list, newest first per section, WITHOUT content/claims -- a
 * list view must not ship ten bodies (`PREP_REVISION_LIST_PROJECTION`, never
 * `select("*")`).
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string, limit?: number}} args
 * @returns {Promise<{revisions: Record<string, Array<{revision: number, engine: string,
 *   restoredFrom: number|null, createdAt: string}>>|null, error: string|null}>}
 */
export async function listSectionRevisions(supabase, { applicationId, userId, limit = PREP_SECTION_REVISIONS_MAX }) {
  const { data, error } = await supabase
    .from(REVISIONS_TABLE)
    .select(PREP_REVISION_LIST_PROJECTION)
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .order("revision", { ascending: false });

  if (error) return { revisions: null, error: errMessage(error) };

  const revisions = {};
  for (const row of Array.isArray(data) ? data : []) {
    const list = revisions[row.section] || (revisions[row.section] = []);
    if (list.length >= limit) continue;
    list.push({
      revision: row.revision,
      engine: row.engine ?? null,
      restoredFrom: row.restored_from ?? null,
      createdAt: row.created_at ?? null,
    });
  }
  return { revisions, error: null };
}

/**
 * One revision's full body, by exact (section, revision) -- the restore
 * path's read.
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string, section: string, revision: number}} args
 * @returns {Promise<{content: *|null, claims: Array<object>, engine: string|null,
 *   restoredFrom: number|null, contentVersion: number|null, error: string|null}>}
 */
export async function readSectionRevision(supabase, { applicationId, userId, section, revision }) {
  const notFound = { content: null, claims: [], engine: null, restoredFrom: null, contentVersion: null, error: null };

  const { data, error } = await supabase
    .from(REVISIONS_TABLE)
    .select(PREP_REVISION_PROJECTION)
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .eq("section", section)
    .eq("revision", revision)
    .maybeSingle();

  if (error) return { ...notFound, error: errMessage(error) };
  if (!data) return notFound;

  return {
    content: data.content ?? null,
    claims: Array.isArray(data.claims) ? data.claims : [],
    engine: data.engine ?? null,
    restoredFrom: data.restored_from ?? null,
    contentVersion: data.content_version ?? null,
    error: null,
  };
}

/**
 * Retention. Deletes revisions of one section with `revision <= newest -
 * keep`, NEVER the one named by `liveRevision`. Best-effort: never throws,
 * returns its own failure, and the caller logs it rather than failing the
 * request -- so the honest bound is `keep` plus however many prunes have
 * failed, not a hard `keep`.
 *
 * Expressed with `.lte()`/`.neq()` rather than `.or()` -- this store's own
 * test harness (`test/helpers/supabaseFake.js`) throws loudly on `.or()` by
 * design, and the two-filter form is exactly equivalent for this predicate
 * (`revision <= threshold AND revision <> liveRevision`, never applying the
 * `<>` filter at all when there is no live revision to protect).
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string, section: string, newest: number,
 *          liveRevision: number|null, keep?: number}} args
 * @returns {Promise<{deleted: number, error: string|null}>}
 */
export async function pruneSectionRevisions(
  supabase,
  { applicationId, userId, section, newest, liveRevision = null, keep = PREP_SECTION_REVISIONS_MAX },
) {
  const threshold = newest - keep;
  if (!Number.isFinite(threshold) || threshold < 1) return { deleted: 0, error: null };

  try {
    let query = supabase
      .from(REVISIONS_TABLE)
      .delete()
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .eq("section", section)
      .lte("revision", threshold);
    if (liveRevision !== null && liveRevision !== undefined) query = query.neq("revision", liveRevision);

    const { data, error } = await query.select();
    if (error) return { deleted: 0, error: errMessage(error) };
    return { deleted: Array.isArray(data) ? data.length : 0, error: null };
  } catch (err) {
    return { deleted: 0, error: err?.message || "unknown error" };
  }
}

/**
 * Increments `interview_prep_spend.model_calls` by exactly one, via the
 * `record_prep_model_call` SECURITY DEFINER RPC (supabase/migrations/
 * 20260914000000_interview_prep.sql) -- an atomic
 * `insert ... on conflict (application_id) do update set model_calls =
 * interview_prep_spend.model_calls + 1`, never a read-then-write. Called
 * once, immediately before each provider call the route issues -- before
 * the call, never after, so a call that times out or errors is still
 * counted (design-operate.r1.md §6). Never throws; the route MUST await
 * this and abort the paid call on `recorded: false` (OP-9).
 *
 * `userId` is accepted for call-site symmetry with this module's other
 * writers but is not read here -- identity and the application-ownership
 * check both happen server-side inside the RPC, from `auth.uid()`, never
 * from a client-suppliable id (same discipline as `claimPrepPack`'s own RPC
 * call above).
 *
 * @param {*} supabase
 * @param {{ applicationId: string, userId?: string }} args
 */
export async function recordModelCallIssued(supabase, { applicationId }) {
  try {
    const { data, error } = await supabase.rpc("record_prep_model_call", {
      p_application_id: applicationId,
    });

    if (error) return { recorded: false, error: errMessage(error) };
    if (data !== true) return { recorded: false, error: null };
    return { recorded: true, error: null };
  } catch (err) {
    return { recorded: false, error: err?.message || "unknown error" };
  }
}

/**
 * Appends one row to the durable disclosure log. Never throws -- a write
 * failure is reported, not raised, matching `recordModelCallIssued`'s own
 * convention. FK targets `applications`, not the packs table (Table 3), so
 * this row survives a candidate's own pack delete.
 *
 * @param {*} supabase
 */
export async function recordPrepEvent(
  supabase,
  { applicationId, userId, eventType, triggerClass = null, engine = null, outcome, reason = null },
) {
  try {
    const { error } = await supabase.from(EVENTS_TABLE).insert({
      application_id: applicationId,
      user_id: userId,
      event_type: eventType,
      trigger_class: triggerClass,
      engine,
      outcome,
      reason,
    });
    if (error) return { recorded: false, error: errMessage(error) };
    return { recorded: true, error: null };
  } catch (err) {
    return { recorded: false, error: err?.message || "unknown error" };
  }
}

/**
 * The candidate-facing download source (`PrepPackPanel`'s "Download prep
 * log", design-structure.r1.md §10) -- reads the durable events log,
 * ordered oldest-first.
 *
 * @param {*} supabase
 * @param {{ applicationId: string, userId: string }} args
 */
export async function listPrepEvents(supabase, { applicationId, userId }) {
  const { data, error } = await supabase
    .from(EVENTS_TABLE)
    .select("id, application_id, event_type, trigger_class, engine, outcome, reason, at")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .order("id", { ascending: true });

  if (error) return { events: null, error: errMessage(error) };
  return { events: Array.isArray(data) ? data : [], error: null };
}
