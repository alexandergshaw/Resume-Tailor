// Resolve the active library for a tailoring request. With no userId (tests, the
// no-auth path) it returns the bundled defaults synchronously. With a userId it
// reads that user's rows from Supabase (seeding from the defaults on first use),
// caches the assembled library in-process and in Redis keyed by library_version,
// and — on ANY error or empty result — falls back to the bundled defaults so
// tailoring never breaks (the migration not being applied yet is just a fallback).

import { createAdminClient } from "@/lib/supabase/admin";
import { getCached, setCached } from "@/lib/cache/jobCache";
import { defaultLibraryData } from "./defaults.js";
import { rowsToLibrary } from "./assemble.js";
import { seedUserLibrary } from "./seed.js";

const LIBRARY_TTL_SECONDS = 60 * 60; // 1 hour
const MAX_IN_PROCESS = 50;
const inProcess = new Map(); // `${userId}:${version}` -> full library bundle

// Stopwords are bundled-only, so the per-user library reuses the default set.
function withStopwords(assembled) {
  return { ...assembled, stopwords: defaultLibraryData.stopwords };
}

function rememberInProcess(key, value) {
  if (inProcess.size >= MAX_IN_PROCESS) inProcess.clear();
  inProcess.set(key, value);
}

export async function loadLibrary({ userId, supabase } = {}) {
  if (!userId) return defaultLibraryData;
  try {
    const client = supabase || createAdminClient();

    // The profile row carries the cache-busting version AND values/teaching subjects.
    // Its absence means the user has never been seeded.
    let { data: profileRow, error: profileError } = await client
      .from("tailor_profile")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profileRow) {
      await seedUserLibrary(userId, client);
      ({ data: profileRow } = await client
        .from("tailor_profile")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle());
    }

    const version = (profileRow && profileRow.library_version) || 1;
    const cacheKey = `${userId}:${version}`;

    const local = inProcess.get(cacheKey);
    if (local) return local;

    const redisKey = `lib:${userId}:v${version}`;
    const cached = await getCached(redisKey);
    if (cached && typeof cached === "object" && cached.taxonomy) {
      const lib = withStopwords(cached);
      rememberInProcess(cacheKey, lib);
      return lib;
    }

    const [taxonomy, focusAreas, skillGroups, contentLibrary] = await Promise.all([
      client.from("tailor_taxonomy").select("*").eq("user_id", userId),
      client.from("tailor_focus_areas").select("*").eq("user_id", userId),
      client.from("tailor_skill_groups").select("*").eq("user_id", userId),
      client.from("tailor_content_library").select("*").eq("user_id", userId),
    ]);
    for (const r of [taxonomy, focusAreas, skillGroups, contentLibrary]) {
      if (r.error) throw r.error;
    }

    // A seeded user always has taxonomy rows; an empty set means something is off,
    // so fall back rather than tailor against an empty library.
    if (!taxonomy.data || taxonomy.data.length === 0) return defaultLibraryData;

    // Persistent "template" edit rules — fetched separately and tolerantly: this
    // table shipped after the others, so a not-yet-applied migration must degrade
    // to "no persisted edits", never nuke the rest of the user's library.
    let editRuleRows = [];
    try {
      const { data, error } = await client.from("tailor_edit_rules").select("*").eq("user_id", userId);
      if (!error && Array.isArray(data)) editRuleRows = data;
    } catch {
      editRuleRows = [];
    }

    // Saved personas — fetched separately and tolerantly, like edit rules.
    let personaRows = [];
    try {
      const { data, error } = await client.from("tailor_personas").select("*").eq("user_id", userId);
      if (!error && Array.isArray(data)) personaRows = data;
    } catch {
      personaRows = [];
    }

    const assembled = rowsToLibrary({
      taxonomyRows: taxonomy.data,
      focusAreaRows: focusAreas.data || [],
      skillGroupRows: skillGroups.data || [],
      contentLibraryRows: contentLibrary.data || [],
      editRuleRows,
      personaRows,
      profileRow,
    });
    await setCached(redisKey, assembled, LIBRARY_TTL_SECONDS);
    const lib = withStopwords(assembled);
    rememberInProcess(cacheKey, lib);
    return lib;
  } catch (err) {
    console.error(`loadLibrary(${userId}) failed; using bundled defaults:`, err?.message || err);
    return defaultLibraryData;
  }
}

// Drop a user's in-process cache entries (the Redis entry is version-keyed, so a
// version bump already orphans it). Called by the write API after an edit.
export function invalidateLibraryInProcess(userId) {
  for (const key of [...inProcess.keys()]) {
    if (key.startsWith(`${userId}:`)) inProcess.delete(key);
  }
}
