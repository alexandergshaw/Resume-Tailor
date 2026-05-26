import { createClient } from "@/lib/supabase/server";
import { getCached, setCached } from "@/lib/cache/jobCache";

export const runtime = "nodejs";

const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const ALLOWED_KEYS = new Set(["referencesOpen", "educationOpen"]);

function keyFor(userId) {
  return `user:${userId}:uiPrefs`;
}

function sanitize(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const key of Object.keys(input)) {
    if (ALLOWED_KEYS.has(key) && typeof input[key] === "boolean") {
      out[key] = input[key];
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
