import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { listPages, createPage } from "@/lib/supabase/experiencePages";

export const runtime = "nodejs";

export async function GET() {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const { pages, error } = await listPages(supabase, userId);
  if (error) return Response.json({ error }, { status: 500 });
  return Response.json({ pages: pages || [] });
}

// Body: { title?, parent_id? }. `user_id` is never read from the body — the
// owner always comes from the session. A `parent_id` this caller does not
// own answers 404 (not 403), so the response never confirms the row exists
// to someone who cannot see it.
export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const title = typeof body?.title === "string" ? body.title : "";
  const parentId = body?.parent_id ?? null;

  if (parentId !== null) {
    const { pages, error } = await listPages(supabase, userId);
    if (error) return Response.json({ error }, { status: 500 });
    const owns = (pages || []).some((p) => p.id === parentId);
    if (!owns) return notFound("That parent page could not be found.");
  }

  const { page, error } = await createPage(supabase, userId, { title, parentId });
  if (error) return Response.json({ error }, { status: 500 });
  return Response.json({ page });
}
