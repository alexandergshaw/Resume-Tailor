// Storage for the per-posting glossary: the row shape, the validation the write
// path applies before any statement runs, and the four queries the cron worker
// and the two routes need.
//
// ---------------------------------------------------------------------------
// THE SHARED-ROW RULE, WHICH IS A HARD RULE AND NOT A NOTE
// ---------------------------------------------------------------------------
// `position_glossaries` is keyed on `position_id`, and `public.positions` has NO
// owner column -- one posting is pointed at by many users' applications rows,
// which is the whole reason the catalogue is shared. So this table has no owner
// column either, and A ROW HERE IS READABLE BY EVERY AUTHENTICATED ACCOUNT IN
// THE PRODUCT. No byte derived from a user's own private material may ever be
// written into it: no resume text, no drafted answer, no cover letter, no note,
// no user id, no hover count.
//
// That is also why there is no INSERT/UPDATE/DELETE policy on the table and no
// WITH CHECK anywhere: a row-ownership predicate needs a column naming the
// owner, and there is none to name. The denial IS the absence of a policy, and
// every write goes through the service-role client from the two server routes.
//
// ---------------------------------------------------------------------------
// A DENORMALISED COUNTER IS NOT A CONSTRAINT
// ---------------------------------------------------------------------------
// `status: 'ready'` is constrained by the database over the terms ARRAY, not
// over `recalled_count`. A counter-only check is defeated by exactly the bug it
// names: a JS miscount writes `status:'ready'` AND `recalled_count:0` together,
// from the same array, in the same statement, and the constraint passes while
// `terms` still contains recalled entries. The validation here is the first line
// of defence and the CHECK is the last; neither replaces the other.
//
// ---------------------------------------------------------------------------
// WHY THE CURSOR LIVES IN POSTGRES AND NOT IN REDIS
// ---------------------------------------------------------------------------
// `lib/feed/ingestFeed.js` is the resumable-worker pattern this feature copies,
// with ONE deliberate deviation: its cursor lives in Redis and FAILS OPEN IN
// BOTH DIRECTIONS -- `acquireLock` returns true on any error ("never block
// ingestion on a cache hiccup") and `readCursor` returns 0 on any error. For
// feed ingestion those are correct: the worst case is scanning the same 25
// companies twice. Here a cursor that reads 0 on a cache hiccup restarts a
// generation and RE-SPENDS TEN GROUNDED CALLS. A failed instrument is invalid,
// never its zero value, and that rule applies to money.

import { createHash } from "node:crypto";
import {
  MAX_TERMS_BYTES,
  MAX_LIFETIME_MODEL_CALLS,
  MAX_ABSOLUTE_MODEL_CALLS,
  MAX_POSTINGS_PER_RUN,
  MAX_POSTING_CHARS,
  LEASE_MS,
  CIRCUIT_SAMPLE,
} from "./glossaryConstants.js";

export const GLOSSARY_TABLE = "position_glossaries";

/**
 * THE ALLOW-LIST. Not a spread: a key no column matches is this repo's signature
 * silent drop, and nothing at runtime catches it. Every write names its columns
 * from this list or throws.
 */
export const GLOSSARY_COLUMNS = Object.freeze([
  "position_id",
  "status",
  "reason",
  "engine",
  "terms",
  "explicit_count",
  "anticipated_count",
  "researched_count",
  "recalled_count",
  "rejected_count",
  "truncated_reason",
  "dropped_count",
  "max_anticipated",
  "attempts",
  "research_cursor",
  "research_total",
  "lease_until",
  "queued_at",
  "last_generation_at",
  "model_calls_fingerprint",
  "model_calls_total",
  "research_batches",
  "unsearched_batches",
  "malformed_batches",
  "stage_counts",
  "refusal_reasons",
  "usage_totals",
  "posting_fingerprint",
  "researched_at",
  "created_at",
  "updated_at",
]);

/**
 * Field-name fragments that must never appear in a column of this table. Checked
 * against GLOSSARY_COLUMNS by this module's test, which is a stronger statement
 * than a source sweep: it constrains what CAN be written rather than what the
 * file happens to mention.
 */
export const PRIVATE_FIELD_NAMES = Object.freeze([
  "user_id",
  "resume",
  "cover_letter",
  "answer",
  "note",
  "hover",
]);

// Module-private on purpose: `buildGlossaryRow` is the only thing that may
// decide whether a status is legal, and an exported list invites a second
// validator somewhere else that then drifts from the database CHECK.
const GLOSSARY_STATUSES = Object.freeze([
  "ready",
  "partial",
  "quotes-only",
  "unavailable",
  "failed",
]);

const COLUMN_SET = new Set(GLOSSARY_COLUMNS);

/**
 * Whether one stored term record is well-formed. THE DATA CANNOT REPRESENT THE
 * CONFUSING STATE, so no renderer can accidentally produce it: a `recalled` term
 * carrying a source, or a `researched` term missing one, is refused at write
 * time rather than papered over in a component.
 *
 * @returns {string|null} the failing rule, or null
 */
export function termRecordRejection(record) {
  if (!record || typeof record !== "object") return "shape";
  if (typeof record.term !== "string" || record.term.trim() === "") return "shape";
  if (typeof record.definition !== "string") return "shape";

  if (record.provenance !== "researched" && record.provenance !== "recalled") {
    // There is no "unknown" and no "pending". A term whose batch has not run yet
    // is `recalled`, because that is the honest description of what the reader
    // is looking at: a definition with no source. "Not yet researched" is a state
    // of the ROW, never of the term -- and a third value would render as neither
    // label, i.e. silently as if it were sourced.
    return "bad-provenance";
  }

  const hasSource =
    record.source_url != null || record.source_host != null || record.source_title != null;
  if (record.provenance === "recalled" && hasSource) return "recalled-with-source";
  if (record.provenance === "researched") {
    if (typeof record.source_url !== "string" || record.source_url === "") {
      return "researched-without-source";
    }
    if (typeof record.source_host !== "string" || record.source_host === "") {
      return "researched-without-source";
    }
  }

  if (record.kind === "anticipated") {
    if (!record.parent || !record.anchor_quote) return "anticipated-without-anchor";
  } else if (record.kind === "explicit") {
    if (record.parent || record.anchor_quote) return "explicit-with-anchor";
    if (typeof record.evidence !== "string" || record.evidence === "") {
      return "explicit-without-evidence";
    }
  } else {
    return "bad-kind";
  }

  return null;
}

/**
 * The byte bound, enforced in JS BEFORE the write and deliberately not as a
 * database CHECK: `pg_column_size` is not IMMUTABLE and a CHECK containing a
 * non-immutable function is a dump/restore hazard. Here it can also report which
 * terms overflowed.
 *
 * An overflow drops trailing ANTICIPATED terms, never explicit ones: the terms
 * the posting actually states are the ones a candidate is certain to be asked
 * about.
 */
export function fitTermsToByteBudget(terms, limit = MAX_TERMS_BYTES) {
  const all = Array.isArray(terms) ? [...terms] : [];
  const size = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
  if (size(all) <= limit) return { terms: all, droppedCount: 0, truncatedReason: null };

  const kept = [...all];
  let dropped = 0;
  for (let i = kept.length - 1; i >= 0 && size(kept) > limit; i -= 1) {
    if (kept[i]?.kind === "explicit") continue;
    kept.splice(i, 1);
    dropped += 1;
  }
  return { terms: kept, droppedCount: dropped, truncatedReason: dropped > 0 ? "bytes" : null };
}

/**
 * The row a write may send. Every key is checked against the column allow-list,
 * and `status` is REQUIRED -- the table declares no default for it on purpose,
 * because 'ready' carries a CHECK and a default would let an insert that omitted
 * the column produce a 'ready' row over zero terms that satisfies everything.
 */
export function buildGlossaryRow(fields) {
  const source = fields && typeof fields === "object" ? fields : {};
  if (!GLOSSARY_STATUSES.includes(source.status)) {
    throw new Error(`buildGlossaryRow: status must be one of ${GLOSSARY_STATUSES.join(", ")}`);
  }
  const row = {};
  for (const [key, value] of Object.entries(source)) {
    if (!COLUMN_SET.has(key)) {
      throw new Error(`buildGlossaryRow: ${key} is not a column of ${GLOSSARY_TABLE}`);
    }
    row[key] = value;
  }
  row.updated_at = new Date().toISOString();
  return row;
}

/**
 * The row status. Computed, never supplied.
 *
 * The `research_cursor >= research_total` clause is the one that makes 'ready'
 * mean FINISHED: a row whose worker has not finished is not ready even if every
 * term it has processed so far was sourced. The database CHECK carries the same
 * clause, so the two cannot drift.
 */
export function computeStatus({
  hasDescription = true,
  embedded = false,
  harvestFailed = false,
  termCount = 0,
  recalledCount = 0,
  researchCursor = 0,
  researchTotal = 0,
}) {
  if (!hasDescription) return "unavailable";
  if (embedded) return "quotes-only";
  if (harvestFailed || termCount === 0) return "failed";
  if (recalledCount === 0 && researchCursor >= researchTotal) return "ready";
  return "partial";
}

/**
 * SHA-256 over the same capped text the model saw. A description can only GROW
 * (the catalogue's merge rules cannot blank a value or shorten a description),
 * so a grown description can carry terms the glossary never saw -- and a
 * fingerprint mismatch is what surfaces that to the reader without spending
 * anything on it.
 */
export function postingFingerprint(position) {
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const description = String(position?.description || "").slice(0, MAX_POSTING_CHARS);
  return createHash("sha256")
    .update(`${normalize(position?.title)}\n${normalize(position?.company)}\n${normalize(description)}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// THE QUERIES
// ---------------------------------------------------------------------------

/**
 * A FAILED READ IS NOT A CACHE MISS. Returning only the row made the two
 * indistinguishable, and the consequence is a full billed generation on a row
 * that already had one, on every load until the read recovers.
 */
export async function readGlossaryForPosition(client, positionId) {
  const { data, error } = await client
    .from(GLOSSARY_TABLE)
    .select("*")
    .eq("position_id", positionId)
    .maybeSingle();
  if (error) return { row: null, error: error.message || String(error) };
  return { row: data || null, error: null };
}

/**
 * THE LEASE, and it is the ONLY concurrency control. A conditional UPDATE:
 * zero rows returned means another invocation holds it, so skip this posting
 * rather than waiting. A worker the platform kills leaves a lease that expires
 * shortly after the function was already dead.
 */
export async function acquireGlossaryLease(admin, positionId, { leaseMs = LEASE_MS, now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  const { data, error } = await admin
    .from(GLOSSARY_TABLE)
    .update({ lease_until: new Date(now + leaseMs).toISOString(), updated_at: nowIso })
    .eq("position_id", positionId)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select();
  if (error) return { row: null, error: error.message || String(error) };
  return { row: Array.isArray(data) && data.length > 0 ? data[0] : null, error: null };
}

/** Cleared in a `finally`, so a worker that finishes early releases immediately. */
export async function releaseGlossaryLease(admin, positionId) {
  const { error } = await admin
    .from(GLOSSARY_TABLE)
    .update({ lease_until: null, updated_at: new Date().toISOString() })
    .eq("position_id", positionId);
  return { error: error ? error.message || String(error) : null };
}

/**
 * THE WORK QUEUE IS A QUERY, NOT A TABLE. The row that already exists IS the
 * queue entry, which is why the harvest writing a COMPLETE row (every term with
 * a recalled definition) is a precondition for the schedule rather than an
 * independent nicety.
 *
 * `research_pending` is a STORED GENERATED column rather than the two-column
 * comparison the design reads as. PostgREST cannot compare two columns in a
 * filter, so `research_cursor < research_total` is not expressible as a query
 * predicate at all; generating it in the database is what keeps the queue read
 * indexable and stops it drifting from the pair it is derived from.
 *
 * Both call caps are IN THE QUERY, not only in the loop: a row already at either
 * cap must never be selected and leased, because the lease itself is a write.
 *
 * Oldest first, so no posting starves. And ONLY pending rows, ever -- a worker
 * that quietly re-researched finished rows would turn the monthly bill into a
 * subscription, and it is exactly the change someone would make to "keep sources
 * fresh".
 */
export async function selectWorkQueue(admin, { limit = MAX_POSTINGS_PER_RUN, now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  const { data, error } = await admin
    .from(GLOSSARY_TABLE)
    .select("*")
    .eq("research_pending", true)
    .lt("model_calls_fingerprint", MAX_LIFETIME_MODEL_CALLS)
    .lt("model_calls_total", MAX_ABSOLUTE_MODEL_CALLS)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .order("queued_at", { ascending: true })
    .limit(limit);
  if (error) return { rows: [], error: error.message || String(error) };
  return { rows: Array.isArray(data) ? data : [], error: null };
}

/**
 * THE CIRCUIT BREAKER. If the last CIRCUIT_SAMPLE rows that FINISHED all
 * produced zero sourced terms while the vendor DID return annotations, something
 * about the response shape has changed and every further generation is paying
 * full price to rediscover the same fact.
 *
 * HONEST LIMIT: it fires only after ten postings, so the worst case is roughly
 * ten postings' worth of learning. One aggregate query, no new table.
 */
async function glossaryCircuitOpen(admin, { sample = CIRCUIT_SAMPLE } = {}) {
  const { data, error } = await admin
    .from(GLOSSARY_TABLE)
    .select("researched_count, stage_counts")
    .eq("research_pending", false)
    .eq("status", "partial")
    .order("updated_at", { ascending: false })
    .limit(sample);
  // A FAILED PROBE IS NOT AN OPEN CIRCUIT. Failing closed here would stop the
  // whole feature on a transient PostgREST error.
  if (error || !Array.isArray(data) || data.length < sample) return false;
  return data.every((row) => row.researched_count === 0 && (row.stage_counts?.annotations || 0) > 0);
}

/**
 * The store PORT the worker runs against. The worker never sees Supabase, which
 * is what makes the whole schedule testable with no timer and no database, and
 * what makes both routes thin shells over it.
 */
export function createGlossaryStore(admin) {
  return {
    async selectQueue(options) {
      const { rows } = await selectWorkQueue(admin, options);
      return rows;
    },
    acquireLease: (positionId, options) => acquireGlossaryLease(admin, positionId, options),
    releaseLease: (positionId) => releaseGlossaryLease(admin, positionId),
    async writeRow(positionId, fields) {
      const row = buildGlossaryRow(fields);
      const { error } = await admin.from(GLOSSARY_TABLE).update(row).eq("position_id", positionId);
      return { error: error ? error.message || String(error) : null };
    },
    circuitOpen: (options) => glossaryCircuitOpen(admin, options),
  };
}
