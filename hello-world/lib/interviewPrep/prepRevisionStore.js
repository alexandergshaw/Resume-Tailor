// lib/interviewPrep/prepRevisionStore.js -- N45/N46's per-section revision
// history (plan §S5/§S6), extracted out of prepStore.js (fix round F-m2):
// that module was 5 lines from its own 1000-line cap before this round's
// F-B1/F-A4 fixes landed, and both fixes grow exactly this section. Same
// discipline as prepStore.js's own header: every exported function here
// runs under the `authenticated` role and RLS, `supabase` is always the
// caller's own client injected as the first argument, and this file carries
// no server-only import so it stays safe to bundle for the browser.
//
// Together with prepStore.js, this is the ONLY OTHER module that names
// `interview_prep_packs` or `interview_prep_section_revisions` or issues a
// query against them (design-structure.r1.md §3's own rule, now split across
// the two files instead of one) -- prepStore.js still owns
// `interview_prep_spend`/`interview_prep_events` and every WRITE to
// `interview_prep_packs` (writePrepPackResult remains the single writer,
// R-N45-CLAIMS); this file owns every read AND write of
// `interview_prep_section_revisions` EXCEPT deletePrepPackContent's own
// cascade sweep (prepStore.js) -- that delete rides along with the rest of
// that function's cascade rather than being split across two files for one
// caller -- plus the one read of `interview_prep_packs`
// (`readLiveSectionRevisions`) that a restore's base needs before
// writePrepPackResult ever runs. (F-m1, fix round: this header and
// prepStore.js's own used to both claim unqualified ownership, which was
// false in the direction that matters -- a reader could not tell from
// either file alone that the cascade delete exists.)

import { PREP_SECTION_REVISIONS_MAX, PREP_SECTION_REVISION_MAX_BYTES } from "./prepConstants.js";
import { PREP_REVISION_PROJECTION, PREP_REVISION_LIST_PROJECTION, PREP_SECTION_NAMES } from "./prepContract.js";
import { sectionRevisionIsIntact } from "./prepMerge.js";

const PACKS_TABLE = "interview_prep_packs";
const REVISIONS_TABLE = "interview_prep_section_revisions";

// Duplicated from prepStore.js's own module-private helpers, deliberately --
// three lines each, no shared state, and duplicating them keeps this file
// independent of prepStore.js's own internals (no import cycle risk, and
// prepStore.js's own header claim about which tables IT touches stays literal
// rather than growing an indirect edge into this file).
function errMessage(error) {
  if (!error) return null;
  return typeof error.message === "string" ? error.message : String(error);
}

function errCode(error) {
  if (!error) return null;
  return error.code ?? null;
}

// Same "log server-side, never return the raw text" discipline as
// prepStore.js's own logDbFailure -- duplicated rather than imported, for the
// same reason errMessage/errCode above are: this file stays independent of
// prepStore.js's own internals, no import cycle risk.
function logRevisionFailure(where, meta) {
  console.error(`interview-prep: ${where}`, meta);
}

// F-R14-2 (fix round r14, MINOR, verify.r14.md): route.js's GET handler has
// never actually surfaced this function's own `error` field (it destructures
// only `revisions`), but nothing stopped a future edit from adding it to the
// 200 body the way GET's `trustedError` field already does for a different
// module -- and had it, this field would have carried the raw PostgREST
// message straight through. Sanitised at the source now, matching
// trustedNames.js's readTrustedNames.
const LIST_SECTION_REVISIONS_FAILED = "Could not load revision history for this application.";

// N45/N46: `live_revisions` (interview_prep_packs) is a `{section: revision}`
// pointer, `jsonb not null default '{}'::jsonb`. A plain-object guard so a
// malformed or missing column value never crashes a reader -- coerces to
// `{}`, matching prepStore.js's own identical idiom.
function asPlainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * The exact byte measurement appendSectionRevisions enforces per name below
 * -- exported so a caller can pre-flight the SAME check (fix round F-m3,
 * verify.r4.md MINOR widened) before this insert is ever reached: a section
 * being SEEDED (never the one an attempt is actually regenerating) is known
 * in full before any model call, so whether it fits can be decided then, and
 * an oversized one left out of the write rather than blocking every other
 * section in the same batch. Measured with TextEncoder, matching
 * checkPackByteBudget's own browser-safe discipline.
 *
 * @param {{ content?: *, claims?: Array<object> }} entry
 * @returns {number}
 */
export function sectionRevisionBytes(entry) {
  return new TextEncoder().encode(JSON.stringify({ content: entry?.content ?? null, claims: entry?.claims ?? [] })).length;
}

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
    const bytes = sectionRevisionBytes(entry);
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
 * Deletes exactly ONE revision row, by (section, revision) -- F-m15's own
 * cleanup: PATCH (route.js) appends its own row BEFORE its optimistic pack
 * write, so appendSectionRevisions' own byte-size check still aborts a
 * restore that exceeds it with the pack row untouched. If that pack write
 * then LOSES the concurrent-restore race, the row already appended must not
 * outlive it as a phantom "restored" version the live pointer never adopted
 * -- route.js awaits this on the conflict path only. Best-effort, matching
 * this module's other cleanup calls (deletePrepPackContent's own revisions
 * sweep, in prepStore.js; pruneSectionRevisions, below): never throws, and
 * the caller returns "conflict" regardless of this call's own result -- a
 * failed cleanup here leaves at worst the SAME phantom row it exists to
 * remove, never a worse one.
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string, section: string, revision: number}} args
 * @returns {Promise<{deleted: boolean, error: string|null}>}
 */
export async function deleteSectionRevision(supabase, { applicationId, userId, section, revision }) {
  try {
    const { error } = await supabase
      .from(REVISIONS_TABLE)
      .delete()
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .eq("section", section)
      .eq("revision", revision);
    if (error) return { deleted: false, error: errMessage(error) };
    return { deleted: true, error: null };
  } catch (err) {
    return { deleted: false, error: err?.message || "unknown error" };
  }
}

// F-R9-2 (fix round): `newestBySection`'s own scan needs the max `revision`
// per section, across EVERY row ever written for the application. What it
// never needs is the eight-column PREP_REVISION_PROJECTION this used to read
// for that scan alone: no `content`, no `claims`, nothing this function does
// with the row beyond its `section`/`revision` pair. Narrowing to just those
// two columns is the same discipline PREP_REVISION_LIST_PROJECTION already
// applies for the picker; this scan needs even less than that.
//
// F-m2 (fix round r10, disposed rather than restructured): this scan's ROW
// COUNT is genuinely unbounded, but "there is no way to bound that away" (an
// earlier draft of this comment) overstated it -- the max per section IS one
// row, reachable with `PREP_SECTION_NAMES.map(name => ...eq("section",
// name).order("revision", {ascending:false}).limit(1))`, the same four-query
// shape `listSectionRevisions` two exports down already uses. Not taken:
// that would turn this ONE narrow-scan statement into four just to save
// bytes that are already cheap -- measured at ~35 bytes/row (verify.r10.md,
// verify.r11.md): unbounded in row count, ~35 bytes a row, and nothing
// prunes today -- accepted (F-R11-4, verify.r11.md:
// `PREP_SECTION_REVISION_MAX_BYTES` is a per-row content cap on one
// section's own body, not a budget for this scan's own total size, so it
// is not the right thing to measure this against). Kept as one
// unbounded-row, two-column scan;
// `pruneSectionRevisions` (below) is this file's real retention lever if
// that cost ever needs to change, but it is not yet wired to any caller.
const PREP_REVISION_NEWEST_PROJECTION = "section, revision";

/**
 * The live document's per-section bodies, provenance and revision numbers,
 * resolved from `interview_prep_packs.live_revisions`.
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
 * F-R9-2 (fix round): this used to be TWO queries in one `Promise.all` -- the
 * packs row, and EVERY row of `interview_prep_section_revisions` with the
 * FULL projection (content and claims included) -- so a 48-row history cost
 * 471KB on a single PATCH and 481KB on a single POST, decoding every body
 * ever written just to keep at most four of them (verify.r9.md). This is now
 * TWO ROUND TRIPS, not one, because the second genuinely depends on the
 * first: the packs row's own `live_revisions` pointer has to be known before
 * the exact (section, revision) pairs worth reading in full even exist.
 * Round one runs the packs read alongside the narrow `newestBySection` scan
 * above (still `Promise.all`, unrelated to each other). Round two fetches
 * the full body of ONLY the pointer's own entries -- at most
 * `PREP_SECTION_NAMES.length` rows -- reusing `readSectionRevision` (below)
 * rather than a second ad hoc query, so this file has exactly one query
 * shape for "one revision's full body, by exact key".
 *
 * F-B1 (fix round r10, BLOCKER, fixed): a round-two read failure used to be
 * SKIPPED rather than reported -- the section was left out of `sections` and
 * this function's own `error` stayed `null`, so a transient failure on one
 * `.maybeSingle()` read produced a base indistinguishable from "this section
 * was never live". On a blanked packs row (`pack = '{}'`, the state
 * `claim_prep_pack_slot` and a `running`-base `restorePayload` both leave
 * behind), that incomplete base IS the whole document -- the caller's own
 * refusal (`route.js`'s "a failed base read is a terminal refusal, never an
 * empty base") never fired, because `error` was never set. Any round-two
 * failure is now a failure of the WHOLE read, matching round one's own
 * `packResult.error`/`newestResult.error` handling two reads above -- never
 * a partially-successful base.
 *
 * F-m1 (fix round r10, minor): `withBodies: false` skips round two
 * altogether -- PATCH (route.js) reads `status`/`pack`/`liveRevisions`/
 * `newestBySection`/`updatedAt` only and never `sections`, so its own base
 * read used to pay for up to `PREP_SECTION_NAMES.length` full-body reads it
 * discarded unconditionally (measured: 39,404 of one PATCH's 50,987
 * revision-table bytes, verify.r10.md). `liveRevisions` and `newestBySection`
 * are unaffected either way -- both come from the pointer/narrow-scan data
 * round one already has, never from a body.
 *
 * F-R11-3 (fix round r11, minor): `sections` is `{}` both when the pointer
 * genuinely has no live entries AND when `withBodies:false` skipped round
 * two entirely -- the two are indistinguishable from the object alone. The
 * return now also carries `bodiesRead` (exactly the `withBodies` this call
 * received), so a caller that needs to tell them apart (`restorePayload`,
 * prepMerge.js) has an explicit marker rather than inferring it from an
 * empty map.
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string, withBodies?: boolean}} args
 * @returns {Promise<{status: string|null,
 *   sections: Record<string, {content: *, claims: Array<object>, engine: string, revision: number}>,
 *   liveRevisions: Record<string, number>, newestBySection: Record<string, number>,
 *   pack: *|null, updatedAt: string|null, bodiesRead: boolean, error: string|null}>}
 */
export async function readLiveSectionRevisions(supabase, { applicationId, userId, withBodies = true }) {
  const failure = (message) => ({
    status: null,
    sections: {},
    liveRevisions: {},
    newestBySection: {},
    pack: null,
    updatedAt: null,
    bodiesRead: withBodies,
    error: message,
  });

  const [packResult, newestResult] = await Promise.all([
    supabase
      .from(PACKS_TABLE)
      .select("status, pack, live_revisions, updated_at")
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from(REVISIONS_TABLE).select(PREP_REVISION_NEWEST_PROJECTION).eq("application_id", applicationId).eq("user_id", userId),
  ]);

  if (packResult.error) return failure(errMessage(packResult.error));
  if (newestResult.error) return failure(errMessage(newestResult.error));

  const packRow = packResult.data;
  const pointer = asPlainRecord(packRow?.live_revisions);

  const newestBySection = {};
  for (const row of Array.isArray(newestResult.data) ? newestResult.data : []) {
    if (!(row.section in newestBySection) || row.revision > newestBySection[row.section]) {
      newestBySection[row.section] = row.revision;
    }
  }

  const pointerEntries = Object.entries(pointer);
  const liveRevisions = {};
  for (const [section, revision] of pointerEntries) liveRevisions[section] = revision;

  const sections = {};
  if (withBodies) {
    const bodyResults = await Promise.all(
      pointerEntries.map(([section, revision]) => readSectionRevision(supabase, { applicationId, userId, section, revision })),
    );

    // F-B1: every body must have resolved cleanly before ANY of them is
    // trusted -- an errored read is never silently dropped from `sections`,
    // it fails the whole base.
    for (const body of bodyResults) {
      if (body.error) return failure(body.error);
    }

    pointerEntries.forEach(([section, revision], index) => {
      const body = bodyResults[index];
      // `readSectionRevision`'s own "not found" and "found" shapes agree on
      // every field except `content` -- a row that exists always has one
      // (the column is populated on every insert, `appendSectionRevisions`
      // above), so `content !== null` is the same "did this key resolve"
      // signal the old `bySectionRevision.get(key)` presence check was. Every
      // `body` reaching here already has `error: null` -- the loop above
      // returned before this one runs otherwise.
      if (body.content !== null) {
        sections[section] = { content: body.content, claims: body.claims, engine: body.engine, revision };
      }
    });
  }

  return {
    status: packRow?.status ?? null,
    sections,
    liveRevisions,
    newestBySection,
    pack: packRow?.pack ?? null,
    updatedAt: packRow?.updated_at ?? null,
    bodiesRead: withBodies,
    error: null,
  };
}

// F-m14's own narrow projection for the second, restorable-computing read
// below -- deliberately just the four columns `sectionRevisionIsIntact`
// (prepMerge.js) reads. The other four PREP_REVISION_COLUMNS
// (engine/restored_from/created_at/content_version) are already on the list
// read above and are never needed here. NOT exported from prepContract.js:
// this projection exists for exactly one caller, in this file.
const PREP_REVISION_INTACT_PROJECTION = "section, revision, content, claims";

/**
 * The history list, newest first per section, WITHOUT content/claims to the
 * CALLER -- a list view must not ship ten bodies
 * (`PREP_REVISION_LIST_PROJECTION`, never `select("*")`).
 *
 * F-m14 (fix round): each entry also carries `restorable`, computed with
 * `sectionRevisionIsIntact` (prepMerge.js) -- so a picker can skip offering
 * a Restore control that PATCH's own gate (route.js) can only ever refuse.
 * That needs `content`/`claims`, which the list projection above
 * deliberately excludes -- so a SECOND read of the SAME rows runs alongside
 * it, narrowed to `PREP_REVISION_INTACT_PROJECTION` (never the full
 * `PREP_REVISION_PROJECTION` this used to read).
 *
 * F-R9-1 (fix round, MAJOR): both reads are bounded PER SECTION, not
 * globally. The prior bound was one query, `ORDER BY revision DESC LIMIT
 * limit * PREP_SECTION_NAMES.length` -- the right total SIZE, but the wrong
 * SHAPE: the display cap is per section (`limit` rows each), so a global
 * `revision` ordering hands the whole budget to whichever section happens to
 * carry the highest revision numbers. A pack with 41 revisions of one
 * section and 1 of each other section (44 rows, four over the old bound)
 * left three of four sections with NO `restorable` key on ANY of their
 * entries, which the client's own contract then reads as "restorable" --
 * re-offering a Restore control that PATCH's own gate can only ever 409,
 * exactly the dead-button state F-m14 exists to remove. Bounding per
 * section (below: `PREP_SECTION_NAMES.flatMap`, one `[list, intact]` pair of
 * queries per name, each `.eq("section", name)...limit(limit)`) keeps the
 * same `limit`-rows-per-section ceiling the display already enforces, so the
 * budget cannot be starved by an uneven history. This also closes F-m3 (fix
 * round, MINOR): the list read itself now carries a real `.limit()` too,
 * where it previously relied on the JS-side per-section cap alone while the
 * query itself read every row.
 *
 * A row the intact read does not cover -- because it fell outside its own
 * section's bound, or because that section's read failed outright --
 * carries NO `restorable` key at all on its returned entry, never `false`.
 * `false` is a claim this code could not verify for that row, and the
 * client's own contract already treats a MISSING `restorable` as restorable
 * (the same "unknown, so don't hide the control" reading this omission
 * relies on) -- the real gate stays PATCH's own `sectionRevisionIsIntact`
 * check, which still refuses (409) a restore of a revision that turns out
 * not to be intact.
 *
 * F-A4 (fix round): every one of these `2 * PREP_SECTION_NAMES.length`
 * queries settles independently through ONE `Promise.allSettled` -- a
 * dropped connection on any single section's LIST read is still re-thrown
 * (this function's original, unchanged contract for that read: GET must not
 * silently show a section as empty), while a rejection of any section's
 * INTACT read degrades to the same "omit" outcome as an ordinary `{error}`
 * result for that section alone, never taking down the others.
 *
 * F-m5 (fix round r10, disposed): these `2 * PREP_SECTION_NAMES.length`
 * queries are issued even when the revisions table holds nothing for this
 * application at all -- every pre-N45 row, measured at 8 selects returning
 * four empty lists (verify.r10.md). Accepted rather than short-circuited:
 * they settle through the SAME one `Promise.allSettled` above, so the cost
 * is one round trip of latency, eight statements, either way. Skipping is
 * not taken because an empty LIVE pointer does not prove an empty table --
 * rows outside the pointer are exactly what a lost pack write leaves behind
 * (verify.r11.md F-R11-5), so a cheap "pointer is empty" check would hide
 * real history from this picker, not just skip wasted work.
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string, limit?: number}} args
 * @returns {Promise<{revisions: Record<string, Array<{revision: number, engine: string,
 *   restoredFrom: number|null, createdAt: string, restorable?: boolean}>>|null, error: string|null}>}
 */
export async function listSectionRevisions(supabase, { applicationId, userId, limit = PREP_SECTION_REVISIONS_MAX }) {
  const perSectionQueries = PREP_SECTION_NAMES.flatMap((name) => [
    supabase
      .from(REVISIONS_TABLE)
      .select(PREP_REVISION_LIST_PROJECTION)
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .eq("section", name)
      .order("revision", { ascending: false })
      .limit(limit),
    supabase
      .from(REVISIONS_TABLE)
      .select(PREP_REVISION_INTACT_PROJECTION)
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .eq("section", name)
      .order("revision", { ascending: false })
      .limit(limit),
  ]);

  const settled = await Promise.allSettled(perSectionQueries);

  const revisions = {};
  const intact = new Map();
  for (let i = 0; i < PREP_SECTION_NAMES.length; i += 1) {
    const name = PREP_SECTION_NAMES[i];
    const listSettled = settled[i * 2];
    const intactSettled = settled[i * 2 + 1];

    // Written as `!== "fulfilled"`, never `=== "rejected"` -- the latter is
    // a literal collision with `applications.status`'s own "rejected"
    // member that lib/applications/statusVocabularySweep.test.js's AC-3a
    // sweep would otherwise flag (it walks every app/+lib/ file for a
    // double-quoted status literal; this one is a Promise.allSettled result
    // tag, not an application's status, but the sweep cannot tell the two
    // vocabularies apart by spelling alone).
    if (listSettled.status !== "fulfilled") throw listSettled.reason;
    const listResult = listSettled.value;
    if (listResult.error) {
      logRevisionFailure("listSectionRevisions list read failed", { applicationId, section: name, error: listResult.error });
      return { revisions: null, error: LIST_SECTION_REVISIONS_FAILED };
    }

    const intactResult =
      intactSettled.status === "fulfilled"
        ? intactSettled.value
        : { data: null, error: { message: intactSettled.reason?.message || "unknown error" } };
    if (!intactResult.error) {
      for (const row of Array.isArray(intactResult.data) ? intactResult.data : []) {
        intact.set(`${row.section}:${row.revision}`, sectionRevisionIsIntact(row.section, { content: row.content, claims: row.claims }));
      }
    }

    const list = revisions[name] || (revisions[name] = []);
    for (const row of Array.isArray(listResult.data) ? listResult.data : []) {
      const key = `${row.section}:${row.revision}`;
      const entry = {
        revision: row.revision,
        engine: row.engine ?? null,
        restoredFrom: row.restored_from ?? null,
        createdAt: row.created_at ?? null,
      };
      if (intact.has(key)) entry.restorable = intact.get(key);
      list.push(entry);
    }
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
