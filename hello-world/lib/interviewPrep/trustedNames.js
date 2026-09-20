// N33's I/O module for the O-15 exemption's trust anchor:
// `candidate_identity` (PK = user_id, one row per account) and
// `application_trusted_names` (PK = application_id, one row per
// application). This is the ONLY module that queries either table -- the
// same single-module-per-table discipline prepStore.js already uses for the
// three interview-prep tables (that file's own header).
//
// Every exported function here runs under the `authenticated` role and RLS,
// via the caller's own client, injected as the first argument -- never
// `createAdminClient()`, matching prepStore.js's own precedent.

function errMessage(error) {
  if (!error) return null;
  return typeof error.message === "string" ? error.message : String(error);
}

function isNonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolves the O-15 exemption's full set of user-supplied names for one
 * application: the account-level candidate name (candidate_identity, one
 * row per user, PK = user_id) and the per-application interviewer names
 * (application_trusted_names, one row per application, PK = application_id).
 * Two independent PK lookups via Promise.all -- the same shape
 * `readPrepPack` already uses for its own two-table read (prepStore.js) --
 * because `candidate_identity` has no FK relationship to `applications` and
 * cannot be embedded into one nested PostgREST select.
 *
 * FAILS CLOSED on any query error: returns `{candidateName: null,
 * interviewerNames: [], error: <message>}` -- even when only ONE of the two
 * queries failed, so a broken `application_trusted_names` read never leaves
 * the account name readable on its own. The caller (`normalizePack`, via
 * `flattenTrustedNames`) cannot distinguish "no names saved" from "the
 * query broke," and the safe default for an O-15 gate is the more
 * restrictive one.
 *
 * @param {*} supabase  the caller's own client, never an admin client.
 * @param {{applicationId: string, userId: string}} args
 * @returns {Promise<{candidateName: string|null, interviewerNames: string[], error: string|null}>}
 */
export async function readTrustedNames(supabase, { applicationId, userId }) {
  const failClosed = (message) => ({ candidateName: null, interviewerNames: [], error: message });
  try {
    const [candidateResult, trustedResult] = await Promise.all([
      supabase.from("candidate_identity").select("candidate_name").eq("user_id", userId).maybeSingle(),
      supabase
        .from("application_trusted_names")
        .select("interviewer_names")
        .eq("application_id", applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (candidateResult.error) return failClosed(errMessage(candidateResult.error));
    if (trustedResult.error) return failClosed(errMessage(trustedResult.error));

    const candidateName = candidateResult.data?.candidate_name ?? null;
    const interviewerNames = Array.isArray(trustedResult.data?.interviewer_names)
      ? trustedResult.data.interviewer_names
      : [];
    return { candidateName, interviewerNames, error: null };
  } catch (err) {
    return failClosed(err?.message || "unknown error");
  }
}

/**
 * Pure. Flattens the two-table row shape into the flat array the O-15
 * exemption predicate (`isUserSuppliedName`, prepParse.js) consumes.
 * Empty/whitespace-only entries are dropped -- AC-N33.6's comparison-side
 * defense in depth; the write-side reject (`saveCandidateName`) is the
 * other half. Order: candidate name first, then interviewer names in
 * stored order -- order has no behavioral effect on the exemption (it is a
 * set membership test), stated only so a future reader does not assume it
 * does. Total -- never throws on a degenerate input.
 *
 * @param {{candidateName?: string|null, interviewerNames?: string[]}} [row]
 * @returns {string[]}
 */
export function flattenTrustedNames(row = {}) {
  const { candidateName, interviewerNames } = row || {};
  const out = [];
  if (isNonBlank(candidateName)) out.push(candidateName);
  const list = Array.isArray(interviewerNames) ? interviewerNames : [];
  for (const name of list) {
    if (isNonBlank(name)) out.push(name);
  }
  return out;
}

/**
 * Writes the ONE `candidate_identity` row for this account. Upsert on the
 * table's own primary key -- `.upsert(row, { onConflict: "user_id" })`, the
 * same idiom `lib/supabase/driveConnections.js` already uses for a
 * PK-on-user_id upsert. An empty/whitespace-only `candidateName` is stored
 * as an explicit `""` (trimmed) -- a legitimate "no name entered yet" state,
 * never coerced to a sentinel.
 *
 * @param {*} supabase
 * @param {{userId: string, candidateName: string}} args
 * @returns {Promise<{written: boolean, error: string|null}>}
 */
export async function saveCandidateName(supabase, { userId, candidateName }) {
  const value = typeof candidateName === "string" ? candidateName.trim() : "";
  try {
    const { error } = await supabase
      .from("candidate_identity")
      .upsert({ user_id: userId, candidate_name: value }, { onConflict: "user_id" });
    if (error) return { written: false, error: errMessage(error) };
    return { written: true, error: null };
  } catch (err) {
    return { written: false, error: err?.message || "unknown error" };
  }
}

/**
 * Writes the `interviewer_names` array for ONE application. Upsert on the
 * table's own primary key -- `.upsert(row, { onConflict: "application_id" })`.
 * Does no diffing itself -- `buildTrustedNamesPayload` (below) is the pure
 * diff step, matching `writePrepPackResult`'s own thin-I/O-only discipline.
 *
 * @param {*} supabase
 * @param {{applicationId: string, userId: string, interviewerNames: string[]}} args
 * @returns {Promise<{written: boolean, error: string|null}>}
 */
export async function saveInterviewerNames(supabase, { applicationId, userId, interviewerNames }) {
  const names = Array.isArray(interviewerNames) ? interviewerNames : [];
  try {
    const { error } = await supabase
      .from("application_trusted_names")
      .upsert(
        { application_id: applicationId, user_id: userId, interviewer_names: names },
        { onConflict: "application_id" },
      );
    if (error) return { written: false, error: errMessage(error) };
    return { written: true, error: null };
  } catch (err) {
    return { written: false, error: err?.message || "unknown error" };
  }
}

/** Trims to `""` on a non-string input, matching `saveCandidateName`'s own
 *  discipline -- comparisons below are made against this trimmed form. */
function trimmedOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** `split(",").map(trim).filter(Boolean)` -- the exact shape already shipped
 *  for `interview_stages.interviewer_names`
 *  (`app/hooks/useApplicationDialogs.js`), reused here for the new table. */
function parseInterviewerNamesText(text) {
  return (typeof text === "string" ? text : "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sameNameList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((name, index) => name === b[index]);
}

/**
 * Pure, no IO. Decides what actually changed before a save touches the
 * network. TWO independent diffs, because the two fields live in two
 * different tables written by two different functions above -- `changed` is
 * true iff at least one payload is non-null, so the single "Save" action
 * fires only the writes that actually changed, and issues zero writes when
 * neither did.
 *
 * Both sides of the candidate-name comparison are trimmed before comparing
 * (this module's own reading of an otherwise-unspecified point: consistent
 * with `saveCandidateName`'s own explicit trim-to-`""` discipline).
 *
 * @param {object} args
 * @param {{candidateName: string, interviewerNamesText: string}} args.form
 *   `interviewerNamesText` is the raw comma-separated field value, unsplit.
 * @param {{candidateName?: string|null, interviewerNames?: string[]}} args.stored
 * @returns {{candidateNamePayload: string|null, interviewerNamesPayload: string[]|null, changed: boolean}}
 *   A `null` payload on either field means "no write needed for this
 *   field" -- an intentional empty-string/empty-array value is NEVER
 *   represented as `null`; it is the literal `""`/`[]`.
 */
export function buildTrustedNamesPayload({ form, stored } = {}) {
  const formCandidateName = trimmedOrEmpty(form?.candidateName);
  const storedCandidateName = trimmedOrEmpty(stored?.candidateName);
  const candidateNamePayload = formCandidateName === storedCandidateName ? null : formCandidateName;

  const parsedInterviewerNames = parseInterviewerNamesText(form?.interviewerNamesText);
  const storedInterviewerNames = Array.isArray(stored?.interviewerNames) ? stored.interviewerNames : [];
  const interviewerNamesPayload = sameNameList(parsedInterviewerNames, storedInterviewerNames)
    ? null
    : parsedInterviewerNames;

  return {
    candidateNamePayload,
    interviewerNamesPayload,
    changed: candidateNamePayload !== null || interviewerNamesPayload !== null,
  };
}
