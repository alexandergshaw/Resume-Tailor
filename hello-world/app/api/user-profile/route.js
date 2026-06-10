import { createClient } from "@/lib/supabase/server";
import { getCached, setCached } from "@/lib/cache/jobCache";

export const runtime = "nodejs";

const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year
const MAX_FIELD_LENGTH = 500;

// Fields used to auto-fill application forms via the Auto Fill bookmarklet.
const ALLOWED_KEYS = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "linkedin",
  "github",
  "website",
  "location",
];

function keyFor(userId) {
  return `user:${userId}:autofillProfile`;
}

function sanitize(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const key of ALLOWED_KEYS) {
    const value = input[key];
    if (typeof value === "string") {
      const trimmed = value.slice(0, MAX_FIELD_LENGTH);
      if (trimmed) out[key] = trimmed;
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
  let profile = {};
  if (raw && typeof raw === "object") {
    profile = sanitize(raw);
  } else if (typeof raw === "string") {
    try { profile = sanitize(JSON.parse(raw)); } catch {}
  }
  return Response.json({ profile });
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

  const profile = sanitize(body?.profile);
  await setCached(keyFor(user.id), profile, TTL_SECONDS);
  return Response.json({ ok: true, profile });
}
