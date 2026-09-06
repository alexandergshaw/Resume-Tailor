// ---------------------------------------------------------------------------
// The merge rule for `public.positions`.
//
// `positions` is a deliberately SHARED catalogue: no user_id column
// (supabase/migrations/20260901000000_drive.sql:28), one row per external_id,
// and two accounts collide on one row by construction — app/page.js:2371
// builds the external id as `url-${trimmedUrl}`, so any two users who tailor
// the same posting write the same row.
//
// The write used to be `.upsert(fullRow, { onConflict: "external_id" })`,
// which PostgREST renders as `ON CONFLICT DO UPDATE SET <every payload
// column> = excluded.<col>` — every column overwritten unconditionally,
// explicit nulls included. So a re-tailor by one account replaced (and
// routinely blanked) the company / url / description that another account's
// stored application points at.
//
// This module is pure: it takes the stored row and an incoming row and
// returns a PATCH — only the columns that should actually change. Returning a
// patch rather than a merged row is load-bearing: the UPDATE statement then
// names only what changed, so a column nobody reasoned about here cannot be
// clobbered by being carried along, and an empty patch means "issue no write
// at all".
//
// THE INVARIANT (checked as a property in positionMerge.test.js):
//   1. No column that is non-empty becomes empty.
//   2. `description` never gets shorter.
// i.e. no sequence of writes, in any order, leaves the row holding less than
// it held before.
// ---------------------------------------------------------------------------

/**
 * Identity-bearing columns: the ones a stored application is READ through, and
 * therefore the corruption vector. Fill-if-empty only — a later non-empty
 * value never replaces a different non-empty one.
 *
 * The evidence for the conservative choice is that the automatic writers all
 * carry LLM- or scrape-derived identities that legitimately vary run to run
 * ("Acme" / "Acme Inc." / "Acme Corporation" out of app/page.js:2438's
 * `nextCompany`), and there is no signal at write time saying which run was
 * right. Letting the last writer win means whoever tailored most recently
 * decides what everyone else's application says it is.
 *
 * The cost: an identity a source genuinely got wrong can no longer be repaired
 * through the automatic path. It is repaired instead through `mergePositionEdit`
 * below — the Edit Application dialog — where a human typed the value and the
 * API route has checked they hold an application on that row.
 */
export const POSITION_IDENTITY_FIELDS = ["title", "company", "url"];

// `source` is provenance, not data. lib/feed/tailorAndQueue.js:22-25 records
// why it must never be rewritten on an existing row: doing so silently
// reclassifies rows that were ingested under a different mapper.
const FILL_ONLY_FIELDS = ["source", ...POSITION_IDENTITY_FIELDS];

// Not identity, and genuinely refreshable: a later scrape that finds a salary
// band or a posted date should record it. Still never blanked.
const REFRESHABLE_FIELDS = [
  "location",
  "is_remote",
  "employment_type",
  "salary_min",
  "salary_max",
  "posted_at",
];

// The only columns the Edit Application dialog offers.
const EDITABLE_FIELDS = ["title", "company", "description"];

/**
 * Empty means "this write carried no answer for that column": null, undefined,
 * or a string that is whitespace-only.
 *
 * `false` and `0` are ANSWERS, not blanks — is_remote=false and salary_min=0
 * are real values, and a truthiness test here would refuse to ever record
 * them.
 */
function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function has(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

// PostgREST hands back what Postgres stored, so a value that round-tripped
// through the wire can differ in JS type from the one about to be written
// (a numeric column read back as a number, a timestamptz read back as a
// string). Compare stringified scalars, the same way test/helpers/supabaseFake
// does, so an unchanged value is never mistaken for a change.
function sameScalar(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

// Length is measured on the trimmed text so that padding alone never counts as
// "more information".
function textLength(value) {
  return typeof value === "string" ? value.trim().length : 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!isPlainObject(a) || !isPlainObject(b)) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
    }
    return false;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => has(b, k) && deepEqual(a[k], b[k]));
}

/**
 * `raw_data` is the source API's blob. Nothing reads it today, but it is the
 * only record of what a source actually returned, so it grows and never
 * shrinks: keys the incoming blob omits survive, blank incoming values never
 * overwrite a stored one, and for a key both hold as text the longer text wins
 * — the same rule `description` follows, for the same reason.
 *
 * Returns the merged object, or `undefined` when there is nothing to merge.
 */
function mergeRawData(stored, incoming) {
  const s = isPlainObject(stored) ? stored : null;
  const i = isPlainObject(incoming) ? incoming : null;
  if (!i) return s ?? undefined;
  if (!s) return i;

  const out = { ...s };
  for (const [key, value] of Object.entries(i)) {
    if (isBlank(value)) continue;
    const prev = out[key];
    if (typeof prev === "string" && typeof value === "string" && textLength(value) <= textLength(prev)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * The catalogue merge, for the AUTOMATIC writers (every tailor / track / apply
 * path). Returns the columns that should change; `{}` means "write nothing".
 *
 * @param {object|null} stored   the row currently in `positions`, or null/{} for a fresh one
 * @param {object} incoming      the row this write wants to record
 * @returns {object} a patch naming only the columns to update
 */
export function mergePositionRow(stored, incoming) {
  const patch = {};
  if (!incoming || typeof incoming !== "object") return patch;
  const current = stored && typeof stored === "object" ? stored : {};

  // Identity + provenance: fill a gap, never overwrite an answer.
  for (const field of FILL_ONLY_FIELDS) {
    if (!has(incoming, field)) continue;
    const value = incoming[field];
    if (isBlank(value)) continue;
    if (!isBlank(current[field])) continue;
    patch[field] = value;
  }

  // Refreshable scalars: a real value may be corrected, but never erased.
  for (const field of REFRESHABLE_FIELDS) {
    if (!has(incoming, field)) continue;
    const value = incoming[field];
    if (isBlank(value)) continue;
    if (sameScalar(current[field], value)) continue;
    patch[field] = value;
  }

  // `description` is the one column that must be able to GROW.
  //
  // Commit aa98b17 ("stop storing a 400-character truncation as the job
  // description") stopped new writes persisting snippetFrom's 400-character
  // cut, but rows written before it still hold that truncation, and every
  // later reader — dedup, digests, downstream tailoring — treats this column
  // as the whole posting. Fill-if-empty (the identity rule) would freeze those
  // rows truncated forever, which is precisely the state aa98b17 exists to
  // get out of. Fill-if-longer repairs them.
  //
  // It has to be a length comparison rather than "the newest full text wins"
  // because the writers carry no trustworthy is-this-complete flag by the time
  // they reach here: app/page.js:2683 still writes the truncation whenever the
  // full-text lookup AND the server's own scrape both come back empty, so the
  // truncation and the full text genuinely arrive in both orders. Comparing
  // length makes the outcome the same either way, and idempotent.
  if (has(incoming, "description")) {
    const value = incoming.description;
    if (!isBlank(value) && textLength(value) > textLength(current.description)) {
      patch.description = value;
    }
  }

  if (has(incoming, "raw_data")) {
    const merged = mergeRawData(current.raw_data, incoming.raw_data);
    if (merged !== undefined && !deepEqual(merged, current.raw_data)) {
      patch.raw_data = merged;
    }
  }

  // `external_id` is the key this row was found by, never a merged column.
  return patch;
}

/**
 * The EXPLICIT edit, for the Edit Application dialog only — a human typed the
 * value, and app/api/positions/route.js has already checked they hold an
 * application on this row (authorization today's RLS performs nowhere).
 *
 * Deliberately different from `mergePositionRow`: a typed value wins outright,
 * including a shorter description. That is the escape hatch that pays for the
 * conservative identity rule above — without it, a company a scrape got wrong
 * could never be corrected by anyone. What it keeps is never-blank: an empty
 * box leaves the stored value alone, which is what the dialog's own optimistic
 * local update has always shown on screen for company and title
 * (app/hooks/useApplicationDialogs.js reads `...trim() || a.positions.company`).
 *
 * So the strict monotonicity invariant holds unconditionally for the automatic
 * path, and holds for this path except where an authorized human deliberately
 * shortens a description on a row they hold.
 */
export function mergePositionEdit(stored, incoming) {
  const patch = {};
  if (!incoming || typeof incoming !== "object") return patch;
  const current = stored && typeof stored === "object" ? stored : {};

  for (const field of EDITABLE_FIELDS) {
    if (!has(incoming, field)) continue;
    const value = incoming[field];
    if (isBlank(value)) continue;
    if (sameScalar(current[field], value)) continue;
    patch[field] = value;
  }
  return patch;
}
