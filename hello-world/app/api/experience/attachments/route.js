import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { listPages } from "@/lib/supabase/experiencePages";
import { classifyAttachment } from "@/lib/experience/attachments";
import { listAttachments, createAttachment, signedAttachmentUrl } from "@/lib/supabase/experienceAttachments";

export const runtime = "nodejs";

// GET ?pageId= -> this user's attachments for that page, each carrying a
// derived `kind` and a short-lived signed `url` for image/video kinds only.
// `kind` is NOT a column of experience_attachments (see the migration) — it
// is computed here, the same way as everywhere else in this feature, via
// classifyAttachment on the row's stored mime and name, so the client and
// server can never disagree about it. AttachmentPanel.js previews image/video
// inline using both fields and leaves everything else (text/pdf/other) as a
// plain row, so there is no reason to mint a link for those.
export async function GET(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get("pageId");
  if (!pageId) return badRequest("Missing pageId.");

  const { attachments, error } = await listAttachments(supabase, userId, pageId);
  if (error) return Response.json({ error }, { status: 500 });

  const withUrls = await Promise.all(
    (attachments || []).map(async (row) => {
      const { kind } = classifyAttachment({ name: row.name, type: row.mime, size: 1 });
      if (kind !== "image" && kind !== "video") return { ...row, kind, url: null };
      const { url } = await signedAttachmentUrl(supabase, row.storage_path);
      return { ...row, kind, url: url || null };
    }),
  );

  return Response.json({ attachments: withUrls });
}

// multipart/form-data body: pageId, id (client-generated with
// crypto.randomUUID(), doubling as the row id and the storage-key token —
// see lib/experience/attachments.js's storagePathFor), file, notes?.
//
// `pageId` is checked against this caller's own pages before anything is
// uploaded — the same 404-not-403 shape app/api/experience/route.js's POST
// uses for `parent_id`, so a page id that exists but belongs to someone
// else is indistinguishable from one that does not exist at all.
export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Invalid form data.");
  }

  const pageId = form.get("pageId");
  const id = form.get("id");
  const file = form.get("file");
  const notes = form.get("notes");

  if (typeof pageId !== "string" || !pageId) return badRequest("Missing pageId.");
  if (typeof id !== "string" || !id) return badRequest("Missing id.");
  if (!file || typeof file === "string") return badRequest("Missing file.");

  const { pages, error: pagesError } = await listPages(supabase, userId);
  if (pagesError) return Response.json({ error: pagesError }, { status: 500 });
  const owns = (pages || []).some((p) => p.id === pageId);
  if (!owns) return notFound("That page could not be found.");

  const classification = classifyAttachment({ name: file.name, type: file.type, size: file.size });
  if (!classification.ok) {
    return Response.json({ error: classification.reason, kind: classification.kind }, { status: 400 });
  }

  const { attachment, error } = await createAttachment(supabase, userId, {
    id,
    pageId,
    file,
    name: file.name,
    mime: file.type || "",
    bytes: file.size,
    notes: typeof notes === "string" ? notes : "",
  });
  if (error) {
    // Never forward a database error verbatim here: an id collision on
    // insert returns Postgres's "duplicate key value violates unique
    // constraint" message, which is a cross-tenant existence oracle for
    // attachment ids (this feature's own rule is 404, never 403 - a
    // distinguishable error is the same class of leak). Log the real
    // reason server-side and answer with a generic message instead.
    console.error("experience attachment create failed:", error);
    return Response.json({ error: "Could not save this attachment." }, { status: 500 });
  }
  return Response.json({ attachment });
}
