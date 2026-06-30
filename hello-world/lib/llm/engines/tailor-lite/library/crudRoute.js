// A generic create/update/delete handler set for the four row-style library tables
// (taxonomy, focus areas, skill groups, content library). Each route.js wires a
// table + validator and re-exports POST/PATCH/DELETE. Every mutation authenticates,
// validates, writes the owner's row, then bumps the library version (cache bust).

import { getAuth, unauthorized, badRequest, ensureSeeded, bumpVersion } from "./apiSupport.js";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function makeCrudHandlers({ table, validate }) {
  return {
    async POST(request) {
      const { supabase, userId } = await getAuth();
      if (!userId) return unauthorized();
      const body = await readJson(request);
      if (!body) return badRequest(["Invalid JSON body."]);
      const v = validate(body);
      if (!v.ok) return badRequest(v.errors);
      await ensureSeeded(supabase, userId);
      const { data, error } = await supabase
        .from(table)
        .insert({ user_id: userId, sort_order: Math.floor(Date.now() / 1000), ...v.value })
        .select()
        .single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      await bumpVersion(supabase, userId);
      return Response.json({ row: data, warnings: v.warnings || [] });
    },

    async PATCH(request) {
      const { supabase, userId } = await getAuth();
      if (!userId) return unauthorized();
      const body = await readJson(request);
      if (!body) return badRequest(["Invalid JSON body."]);
      if (!body.id) return badRequest(["id is required."]);
      const v = validate(body);
      if (!v.ok) return badRequest(v.errors);
      const { data, error } = await supabase
        .from(table)
        .update({ ...v.value, updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      await bumpVersion(supabase, userId);
      return Response.json({ row: data, warnings: v.warnings || [] });
    },

    async DELETE(request) {
      const { supabase, userId } = await getAuth();
      if (!userId) return unauthorized();
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return badRequest(["id query parameter is required."]);
      const { error } = await supabase.from(table).delete().eq("id", id).eq("user_id", userId);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      await bumpVersion(supabase, userId);
      return Response.json({ ok: true });
    },
  };
}
