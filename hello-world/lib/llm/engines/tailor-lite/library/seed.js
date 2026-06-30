// Seed a user's tailor library from the bundled defaults. Idempotent: it only
// writes when the user has no taxonomy rows yet, so calling it repeatedly (the
// loader does this lazily on first read) is safe. Uses a service-role client so
// it can write before the user has touched the library.

import { createAdminClient } from "@/lib/supabase/admin";
import { defaultLibraryData } from "./defaults.js";
import { libraryToRows } from "./assemble.js";

// Returns true if seeding ran, false if the user already had a library.
export async function seedUserLibrary(userId, adminClient = null) {
  if (!userId) throw new Error("seedUserLibrary: userId is required.");
  const supabase = adminClient || createAdminClient();

  const { count, error: countError } = await supabase
    .from("tailor_taxonomy")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) throw countError;
  if (count && count > 0) return false; // already seeded

  const rows = libraryToRows(defaultLibraryData, userId);
  // Insert in dependency-free order; any insert error aborts so we never leave a
  // half-seeded library (the unique indexes also guard against double-seeding).
  const inserts = [
    supabase.from("tailor_taxonomy").insert(rows.taxonomy),
    supabase.from("tailor_focus_areas").insert(rows.focusAreas),
    supabase.from("tailor_skill_groups").insert(rows.skillGroups),
    supabase.from("tailor_content_library").insert(rows.contentLibrary),
    supabase.from("tailor_profile").upsert(rows.profile, { onConflict: "user_id" }),
  ];
  const results = await Promise.all(inserts);
  for (const { error } of results) {
    if (error) throw error;
  }
  return true;
}
