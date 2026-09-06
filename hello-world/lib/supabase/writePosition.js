import { mergePositionRow, mergePositionEdit } from "./positionMerge";

// ---------------------------------------------------------------------------
// The ONLY module that writes to `public.positions`.
//
// SERVER ONLY. Reached from app/api/positions/route.js (the browser's single
// path), from lib/feed/tailorAndQueue.js (cron / auto-apply, service-role),
// and from lib/supabase/upsertPosition.js's server branch via a DYNAMIC import
// so it never lands in a client bundle. Every one of those callers holds a
// privileged client, so nothing here may take an identity from a request body
// — the route authenticates before it calls in.
//
// Why read-then-merge instead of `.upsert(row, { onConflict })`: PostgREST
// renders an upsert as `ON CONFLICT DO UPDATE SET <every payload column> =
// excluded.<col>`, so the payload's columns are overwritten unconditionally,
// explicit nulls included. There is no way to express "merge" in that
// statement, and a filter chained onto `.upsert()` reaches the wire but not
// the statement, so it guards nothing. The merge therefore has to happen in
// application code, between a SELECT and a targeted UPDATE.
//
// The read-then-write is not atomic. That is deliberate and safe here: the
// merge is monotone (see positionMerge.js), so two interleaved writers can
// only ever both move the row forward — the worst case is that one of them
// re-reads stale state and issues a patch that is already applied, which is a
// no-op. The one race that needs handling is two writers both finding no row
// and both inserting; the loser gets 23505 and re-reads instead of failing.
// ---------------------------------------------------------------------------

const POSITION_COLUMNS =
  "id, external_id, source, title, company, location, is_remote, employment_type, description, url, salary_min, salary_max, posted_at, raw_data";

function isUniqueViolation(error) {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(error.message || "");
}

/**
 * Merge a position row into the shared catalogue, keyed on `external_id`.
 * Never destroys stored information — see positionMerge.js for the rule.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client privileged client
 * @param {object} row a positions-shaped row (must carry `external_id`)
 * @returns {Promise<{ id: string|null, error: object|null }>}
 */
export async function writePositionMerged(client, row) {
  const externalId = row?.external_id === null || row?.external_id === undefined
    ? ""
    : String(row.external_id).trim();

  if (!externalId) {
    return { id: null, error: { message: "writePositionMerged: external_id is required." } };
  }

  const load = () =>
    client.from("positions").select(POSITION_COLUMNS).eq("external_id", externalId).maybeSingle();

  const { data: found, error: selectError } = await load();
  if (selectError) return { id: null, error: selectError };

  let stored = found;

  if (!stored) {
    const { data: inserted, error: insertError } = await client
      .from("positions")
      .insert({ ...row, external_id: externalId })
      .select("id")
      .single();

    if (!insertError) return { id: inserted?.id ?? null, error: null };
    if (!isUniqueViolation(insertError)) return { id: null, error: insertError };

    // Lost the insert race: the row exists now. Re-read and merge into it
    // rather than failing a tailor run for a posting that is present.
    const retry = await load();
    if (retry.error) return { id: null, error: retry.error };
    if (!retry.data) return { id: null, error: insertError };
    stored = retry.data;
  }

  // No id means no way to target the UPDATE. Bail rather than issue
  // `.eq("id", null)`, which PostgREST sends as `= NULL` — it matches nothing,
  // returns no error, and would look like a successful write.
  if (!stored.id) return { id: null, error: null };

  const patch = mergePositionRow(stored, row);
  if (Object.keys(patch).length === 0) return { id: stored.id, error: null };

  const { error: updateError } = await client.from("positions").update(patch).eq("id", stored.id);
  if (updateError) return { id: null, error: updateError };

  return { id: stored.id ?? null, error: null };
}

/**
 * Apply the Edit Application dialog's typed values to one position row.
 *
 * AUTHORIZATION IS THE CALLER'S JOB and is not optional: this runs under a
 * client that bypasses RLS, and `positions` has no owner column to check
 * against anyway. app/api/positions/route.js verifies the signed-in user
 * holds an application on `positionId` before calling in.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client privileged client
 * @param {string} positionId
 * @param {{title?: string, company?: string, description?: string}} fields
 * @returns {Promise<{ error: object|null }>}
 */
export async function editPositionFields(client, positionId, fields) {
  if (!positionId) return { error: { message: "editPositionFields: positionId is required." } };

  const { data: stored, error: selectError } = await client
    .from("positions")
    .select("id, title, company, description")
    .eq("id", positionId)
    .maybeSingle();

  if (selectError) return { error: selectError };
  if (!stored) return { error: { message: "Position not found." } };

  // mergePositionEdit keeps only title/company/description, so nothing else a
  // caller passes can reach the statement.
  const patch = mergePositionEdit(stored, fields || {});
  if (Object.keys(patch).length === 0) return { error: null };

  const { error: updateError } = await client.from("positions").update(patch).eq("id", positionId);
  return { error: updateError ?? null };
}
