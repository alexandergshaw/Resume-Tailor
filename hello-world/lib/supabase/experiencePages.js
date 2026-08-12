// Data access for the "Professional Experience" knowledge base
// (public.experience_pages — see
// supabase/migrations/20260812000000_experience_pages.sql). The API routes
// under app/api/experience/ never build a Supabase query of their own; every
// read/write goes through one of the five functions below.
//
// Every function takes the caller's own authenticated `supabase` client and
// `userId` (never resolves its own session — the routes already did that via
// lib/experience/apiAuth.js's getAuth) and scopes every query by `user_id`
// explicitly, in addition to RLS: defense in depth, not a replacement for it.
// Nothing here throws — every function returns a result object, mirroring
// lib/supabase/practiceAnswers.js, so a failed call is data the caller can
// branch on rather than an exception that could tear down a route.

const TABLE = "experience_pages";

export async function listPages(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("position", { ascending: true });
    if (error) return { pages: null, error: error.message || "Could not load pages." };
    return { pages: data || [], error: null };
  } catch (err) {
    return { pages: null, error: err?.message || "Could not load pages." };
  }
}

// Appends the new page as the last sibling under `parentId` (null = top
// level). The caller (the POST route) has already checked that `parentId`,
// when given, is a page this user owns — this function trusts that and just
// counts the current non-archived siblings to find the next position.
export async function createPage(supabase, userId, { title, parentId } = {}) {
  try {
    let siblingQuery = supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null);
    siblingQuery =
      parentId === null || parentId === undefined
        ? siblingQuery.is("parent_id", null)
        : siblingQuery.eq("parent_id", parentId);
    const { count, error: countError } = await siblingQuery;
    if (countError) return { page: null, error: countError.message || "Could not create page." };

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_id: userId,
        parent_id: parentId ?? null,
        title: title || "",
        body: "",
        position: count || 0,
      })
      .select()
      .single();
    if (error) return { page: null, error: error.message || "Could not create page." };
    return { page: data, error: null };
  } catch (err) {
    return { page: null, error: err?.message || "Could not create page." };
  }
}

// `page: null` (with `error: null`) means the row was not found among this
// user's own pages — the PATCH route reads that as a 404, not a thrown error.
export async function updatePage(supabase, userId, id, { title, body } = {}) {
  try {
    const patch = { updated_at: new Date().toISOString() };
    if (typeof title === "string") patch.title = title;
    if (typeof body === "string") patch.body = body;

    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle();
    if (error) return { page: null, error: error.message || "Could not update page." };
    return { page: data || null, error: null };
  } catch (err) {
    return { page: null, error: err?.message || "Could not update page." };
  }
}

// Applies the `{ id, parent_id, position }` updates lib/experience/tree.js's
// moveNode produced. A move is several row updates rather than one
// statement — see the non-unique index comment in the migration — so this
// runs them one at a time, each still scoped by user_id, and collects
// whichever rows actually belonged to this user.
export async function applyMoves(supabase, userId, updates) {
  try {
    const list = Array.isArray(updates) ? updates : [];
    const pages = [];
    const nowIso = new Date().toISOString();
    for (const u of list) {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ parent_id: u.parent_id, position: u.position, updated_at: nowIso })
        .eq("id", u.id)
        .eq("user_id", userId)
        .select()
        .maybeSingle();
      if (error) return { pages: null, error: error.message || "Could not move pages." };
      if (data) pages.push(data);
    }
    return { pages, error: null };
  } catch (err) {
    return { pages: null, error: err?.message || "Could not move pages." };
  }
}

// `deleted` is the number of rows the delete statement itself matched (0 or
// 1 — the row's descendants disappear too, but only via the migration's `on
// delete cascade`, not because this statement targeted them). The DELETE
// route reads `deleted === 0` as a 404.
export async function deletePage(supabase, userId, id) {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) return { deleted: 0, error: error.message || "Could not delete page." };
    return { deleted: (data || []).length, error: null };
  } catch (err) {
    return { deleted: 0, error: err?.message || "Could not delete page." };
  }
}
