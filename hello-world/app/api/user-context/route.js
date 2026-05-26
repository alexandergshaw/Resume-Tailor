import { createClient } from "@/lib/supabase/server";
import { getCached, setCached } from "@/lib/cache/jobCache";

export const runtime = "nodejs";

const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year
const MAX_LENGTH = 20000;

function keyFor(userId) {
  return `user:${userId}:additionalContext`;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const value = await getCached(keyFor(user.id));
  return Response.json({ additionalContext: typeof value === "string" ? value : "" });
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

  const raw = body?.additionalContext;
  if (raw != null && typeof raw !== "string") {
    return Response.json({ error: "additionalContext must be a string" }, { status: 400 });
  }

  const value = (raw || "").slice(0, MAX_LENGTH);
  await setCached(keyFor(user.id), value, TTL_SECONDS);

  return Response.json({ ok: true });
}
