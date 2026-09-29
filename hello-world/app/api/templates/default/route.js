// N97: /api/templates/default -- promote/read/clear the caller's per-type
// DEFAULT TEMPLATE (design §4.2, plan Step 1). Idiom mirrors
// app/api/saved-searches/route.js: getUser() -> 401 -> the store, with
// userId ALWAYS taken from the authenticated session, never the request
// body (AC-6). Deliberately not makeCrudHandlers -- this route uploads to
// storage and validates a multipart file, neither of which that helper does.
//
// GET  ?kind=resume|cover            -> { hasDefault, updatedAt? }
// GET  ?kind=resume|cover&bytes=1    -> the stored .docx bytes (or 404) --
//   the Step-3 client resolver's read path (lib/document/defaultTemplateClient.js),
//   routed through the server so it reuses this route's auth + RLS-scoped
//   client rather than a second, separately-authorized storage call.
// POST multipart {file, kind}        -> { row, replaced } -- promotes the
//   uploaded bytes as the default for kind. kind='email' (or anything else
//   outside resume/cover) is refused with 4xx and never reaches the store --
//   the structural guarantee that no path writes an email template (AC-1).
// DELETE ?kind=resume|cover          -> { ok: true }

import { createClient } from "@/lib/supabase/server";
import { DOCX_MIME } from "@/lib/drive/driveMime";
import {
  saveDefaultTemplate,
  getDefaultTemplate,
  getDefaultTemplateBytes,
  clearDefaultTemplate,
} from "@/lib/document/defaultTemplateStore.js";

export const runtime = "nodejs";

const VALID_KINDS = ["resume", "cover"];

async function requireUser(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  return user || null;
}

export async function GET(request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");

  if (url.searchParams.get("bytes") === "1") {
    if (!VALID_KINDS.includes(kind)) return new Response(null, { status: 404 });
    const found = await getDefaultTemplateBytes(supabase, { userId: user.id, kind });
    if (!found) return new Response(null, { status: 404 });
    return new Response(found.bytes, { status: 200, headers: { "Content-Type": DOCX_MIME } });
  }

  if (!VALID_KINDS.includes(kind)) return Response.json({ hasDefault: false });
  const row = await getDefaultTemplate(supabase, { userId: user.id, kind });
  return Response.json({ hasDefault: !!row, updatedAt: row?.updated_at });
}

export async function POST(request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data." }, { status: 400 });
  }
  const file = form.get("file");
  const kind = form.get("kind");

  if (!VALID_KINDS.includes(kind)) {
    return Response.json({ error: `Unsupported template kind: ${kind}.` }, { status: 400 });
  }
  if (!file || typeof file.arrayBuffer !== "function") {
    return Response.json({ error: "No document uploaded." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await saveDefaultTemplate(supabase, { userId: user.id, kind, bytes });
  if (result.error) return Response.json({ error: result.error }, { status: 500 });
  return Response.json({ row: result.row, replaced: result.replaced });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const result = await clearDefaultTemplate(supabase, { userId: user.id, kind });
  if (result.error) return Response.json({ error: result.error }, { status: 500 });
  return Response.json({ ok: true });
}
