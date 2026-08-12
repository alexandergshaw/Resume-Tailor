import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { deleteAttachment, updateAttachmentNotes } from "@/lib/supabase/experienceAttachments";

export const runtime = "nodejs";

// Body: { notes }. The only field an already-uploaded attachment exposes as
// editable — see lib/supabase/experienceAttachments.js's
// updateAttachmentNotes. 404, not a thrown error, when the row is not this
// caller's own.
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

  const { attachment, error } = await updateAttachmentNotes(
    supabase,
    userId,
    id,
    typeof body?.notes === "string" ? body.notes : "",
  );
  if (error) return Response.json({ error }, { status: 500 });
  if (!attachment) return notFound("That attachment could not be found.");
  return Response.json({ attachment });
}

// Verifies ownership of the row BEFORE removing its storage object (see
// lib/supabase/experienceAttachments.js's deleteAttachment) — a caller who
// does not own it gets 404, never a 403 that would confirm the row exists,
// and its storage object is never even attempted.
export async function DELETE(_request, { params }) {
  const { id } = await params;
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const { deleted, error } = await deleteAttachment(supabase, userId, id);
  if (error) return Response.json({ error }, { status: 500 });
  if (!deleted) return notFound("That attachment could not be found.");
  return Response.json({ ok: true });
}
