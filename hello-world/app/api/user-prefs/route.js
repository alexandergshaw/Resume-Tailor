import { createClient } from "@/lib/supabase/server";
import { getCached, setCached } from "@/lib/cache/jobCache";

export const runtime = "nodejs";

const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const ALLOWED_BOOLEAN_KEYS = new Set(["referencesOpen", "educationOpen"]);

// Sort preference for the applications table on the Interviewing tab.
// Persisted so the user's chosen column/direction survives reloads.
const ALLOWED_SORT_FIELDS = new Set([
  "company",
  "title",
  "status",
  "applied_at",
]);
const ALLOWED_SORT_DIRS = new Set(["asc", "desc"]);

function keyFor(userId) {
  return `user:${userId}:uiPrefs`;
}

function sanitizeSort(value) {
  if (!value || typeof value !== "object") return null;
  const dir = ALLOWED_SORT_DIRS.has(value.dir) ? value.dir : "asc";
  if (value.field === null || value.field === undefined || value.field === "") {
    return { field: null, dir };
  }
  if (typeof value.field === "string" && ALLOWED_SORT_FIELDS.has(value.field)) {
    return { field: value.field, dir };
  }
  return null;
}

function sanitizeTitleKeywords(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.length > 100) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 50) break;
  }
  return out;
}

function sanitize(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const key of Object.keys(input)) {
    if (ALLOWED_BOOLEAN_KEYS.has(key) && typeof input[key] === "boolean") {
      out[key] = input[key];
    } else if (key === "appliedSort") {
      const sort = sanitizeSort(input[key]);
      if (sort) out[key] = sort;
    } else if (key === "excludedTitleKeywords") {
      const list = sanitizeTitleKeywords(input[key]);
      if (list) out[key] = list;
    }
  }
  return out;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await getCached(keyFor(user.id));
  let prefs = {};
  if (raw && typeof raw === "object") {
    prefs = sanitize(raw);
  } else if (typeof raw === "string") {
    try { prefs = sanitize(JSON.parse(raw)); } catch {}
  }
  return Response.json({ prefs });
}

export async function PUT(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = sanitize(body?.prefs);

  // Merge with existing so partial updates don't drop other keys.
  const existingRaw = await getCached(keyFor(user.id));
  let existing = {};
  if (existingRaw && typeof existingRaw === "object") {
    existing = sanitize(existingRaw);
  } else if (typeof existingRaw === "string") {
    try { existing = sanitize(JSON.parse(existingRaw)); } catch {}
  }
  const merged = { ...existing, ...incoming };

  await setCached(keyFor(user.id), merged, TTL_SECONDS);
  return Response.json({ ok: true, prefs: merged });
}
