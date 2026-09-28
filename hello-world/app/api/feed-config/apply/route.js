// N60 second chunk, Step B -- the chat write path's apply route (AC2-C3,
// AC2-C5). Writes an ordinary saved_searches row through the shared
// savedSearch module's chat-only sanitizer, never the two permissive
// sanitizers the FeedAutomationCard enable control uses.
//
// STRUCTURAL GUARANTEE (AC2-C3): this route calls ONLY
// sanitizeChatDerivedSavedSearch, whose return value never carries
// auto_tailor_enabled. The insert argument below is `{ user_id: user.id,
// ...sanitized }` -- never `{ ...body, ...sanitized }`, which would
// reintroduce a body-supplied flag because `...sanitized` has no key to
// override it with. The acting account is always the session user, never a
// body-supplied id.
//
// This route imports nothing that reaches lib/llm (AC2-S6's positive guard):
// it derives no configuration itself, so it spends nothing.
import { createClient } from "@/lib/supabase/server";
import {
  sanitizeChatDerivedSavedSearch,
  MAX_SAVED_SEARCHES_PER_ACCOUNT,
} from "@/lib/savedSearch/savedSearchFields";

export const runtime = "nodejs";

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sanitized = sanitizeChatDerivedSavedSearch(body);
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
