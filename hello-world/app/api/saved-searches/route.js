import { createClient } from "@/lib/supabase/server";
import {
  sanitizeSavedSearchCreate,
  MAX_SAVED_SEARCHES_PER_ACCOUNT,
} from "@/lib/savedSearch/savedSearchFields";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ searches: data || [] });
}

export async function POST(request) {
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
  const sanitized = sanitizeSavedSearchCreate(body);
  if (!sanitized) {
    return Response.json({ error: "Missing or invalid 'name'." }, { status: 400 });
  }

  const { count } = await supabase
    .from("saved_searches")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (typeof count === "number" && count >= MAX_SAVED_SEARCHES_PER_ACCOUNT) {
    return Response.json(
      { error: `You can have at most ${MAX_SAVED_SEARCHES_PER_ACCOUNT} saved searches.` },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("saved_searches")
    .insert({ user_id: user.id, ...sanitized })
    .select("*")
    .single();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ search: data });
}
