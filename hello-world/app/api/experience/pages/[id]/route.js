import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { updatePage, deletePage } from "@/lib/supabase/experiencePages";

export const runtime = "nodejs";

// Body: { title?, body? }. 404 when the page is not the caller's own — the
// data layer scopes the update by user_id, so a page belonging to someone
// else is indistinguishable from one that does not exist.
export async function PATCH(request, { params }) {
  const { id } = await params;
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { page, error } = await updatePage(supabase, userId, id, {
    title: body?.title,
    body: body?.body,
  });
  if (error) return Response.json({ error }, { status: 500 });
  if (!page) return notFound("That page could not be found.");
  return Response.json({ page });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const { deleted, error } = await deletePage(supabase, userId, id);
  if (error) return Response.json({ error }, { status: 500 });
  if (!deleted) return notFound("That page could not be found.");
  return Response.json({ ok: true });
}
