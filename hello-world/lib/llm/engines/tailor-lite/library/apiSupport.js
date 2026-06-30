// Shared server helpers for the library CRUD routes. Uses the AUTHED Supabase
// client so RLS enforces ownership as defense-in-depth (every row is also scoped
// by user_id in the query). Each mutation bumps tailor_profile.library_version,
// which is the cache-busting token loadLibrary keys on, and clears the in-process
// cache so the next tailor request reads fresh data.

import { createClient } from "@/lib/supabase/server";
import { seedUserLibrary } from "./seed.js";
import { invalidateLibraryInProcess } from "./loadLibrary.js";

export async function getAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, userId: user?.id || null };
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
export function badRequest(errors) {
  return Response.json({ error: "Validation failed", errors }, { status: 400 });
}

// Seed the user's library from the bundled defaults if they have none yet, so the
// editor and the first edit both have a profile row to work against.
export async function ensureSeeded(supabase, userId) {
  const { data } = await supabase
    .from("tailor_profile")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) await seedUserLibrary(userId, supabase);
}

export async function bumpVersion(supabase, userId) {
  const { data } = await supabase
    .from("tailor_profile")
    .select("library_version")
    .eq("user_id", userId)
    .maybeSingle();
  const next = ((data && data.library_version) || 1) + 1;
  await supabase
    .from("tailor_profile")
    .update({ library_version: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  invalidateLibraryInProcess(userId);
}
