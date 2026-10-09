// N151a: /api/templates/library -- list / add / delete the caller's saved
// formatting templates (the library over resume_templates), and make a newly
// added template the ACTIVE one. Idiom mirrors app/api/templates/default/
// route.js: getUser() -> 401 -> the stores, with userId ALWAYS taken from the
// authenticated session, never the request body. Storage-only: it imports no
// model client, so it needs no rate-limit adoption entry.
//
// GET    ?kind=resume|cover          -> { templates: [...], selectedId } --
//   selectedId is the caller's EXPLICIT selection for the kind (the
//   template_selections pointer), or null when there is none; the switcher
//   panel reads it to show which template is active.
// GET    ?kind=&id=<id>&bytes=1      -> that OWNED template's .docx bytes (or
//   404): the regenerate-into-template picker's read path for a library
//   template that is not the active one (N151c). id + user_id + kind gated.
// PUT   json {kind, templateId}     -> { ok: true } -- makes an EXISTING
//   template the caller's selection. The template must be one the caller owns
//   (id + user_id + kind): a foreign or stale id is refused with a 404 rather
//   than stored, because a dangling pointer would resolve to no bytes and the
//   next document would render native formatting while the UI showed a pick.
// POST   multipart {file, kind, name?} -> { row, selected } -- registers the
//   uploaded .docx as a named library template AND makes it the caller's
//   selection for that kind (mark = add + activate, so one click means future
//   generations use it). Only .docx is accepted: the extension AND the ZIP
//   container magic are both checked here, because a non-docx row would later
//   be skipped silently at the doc-build override and render native output
//   with no error. kind='email' (anything outside resume/cover) is refused.
// DELETE ?id=<template id>           -> { ok: true }

import { createClient } from "@/lib/supabase/server";
import { DOCX_MIME } from "@/lib/drive/driveMime";
import {
  listTemplates,
  registerTemplate,
  deleteTemplate,
  getTemplateBytesById,
} from "@/lib/document/templateLibraryStore.js";
import { getSelection, setSelection } from "@/lib/document/templateSelectionStore.js";

export const runtime = "nodejs";

const VALID_KINDS = ["resume", "cover"];
// A .docx is a ZIP container: PK\x03\x04.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

async function requireUser(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  return user || null;
}

function hasZipMagic(bytes) {
  return ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
}

export async function GET(request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");

  // N151c: one owned template's bytes by id. Handled BEFORE the metadata
  // response (a branch after it would never be reached); userId is the
  // session's, so a foreign id resolves 404 rather than another tenant's file.
  if (params.get("bytes") === "1") {
    const id = params.get("id");
    if (!id || !VALID_KINDS.includes(kind)) return new Response(null, { status: 404 });
    const found = await getTemplateBytesById(supabase, { userId: user.id, id, kind });
    if (!found) return new Response(null, { status: 404 });
    return new Response(found.bytes, { status: 200, headers: { "Content-Type": DOCX_MIME } });
  }

  if (!VALID_KINDS.includes(kind)) {
    return Response.json({ error: `Unsupported template kind: ${kind}.` }, { status: 400 });
  }
  const templates = await listTemplates(supabase, { userId: user.id, kind });
  const selection = await getSelection(supabase, { userId: user.id, kind });
  return Response.json({ templates, selectedId: selection?.template_id ?? null });
}

export async function PUT(request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const kind = body?.kind;
  const templateId = body?.templateId;
  if (!VALID_KINDS.includes(kind)) {
    return Response.json({ error: `Unsupported template kind: ${kind}.` }, { status: 400 });
  }
  if (typeof templateId !== "string" || !templateId) {
    return Response.json({ error: "No template specified." }, { status: 400 });
  }

  // Ownership guard: the row must be the caller's own, for this kind.
  const { data: owned, error: ownedError } = await supabase
    .from("resume_templates")
    .select("id")
    .eq("id", templateId)
    .eq("user_id", user.id)
    .eq("kind", kind)
    .maybeSingle();
  if (ownedError) {
    return Response.json({ error: "Couldn't look up that template." }, { status: 500 });
  }
  if (!owned) {
    return Response.json({ error: "That template is not in your library." }, { status: 404 });
  }

  const selection = await setSelection(supabase, { userId: user.id, kind, templateId });
  if (selection.error) return Response.json({ error: selection.error }, { status: 500 });
  return Response.json({ ok: true });
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

  const fileName = typeof file.name === "string" ? file.name : "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!fileName.toLowerCase().endsWith(".docx") || !hasZipMagic(bytes)) {
    return Response.json({ error: "Templates must be .docx files." }, { status: 400 });
  }

  // The client sends the name it derived; fall back to the file's own name.
  const sentName = form.get("name");
  const name = (typeof sentName === "string" && sentName.trim()) || fileName.replace(/\.docx$/i, "").trim();
  if (!name) return Response.json({ error: "A template needs a name." }, { status: 400 });

  const registered = await registerTemplate(supabase, { userId: user.id, kind, name, bytes });
  if (registered.error) {
    return Response.json({ error: registered.error }, { status: registered.duplicate ? 409 : 500 });
  }

  // Never activate a template that wasn't created (the early return above); a
  // failed activation leaves the new template in the library, un-selected.
  const selection = await setSelection(supabase, {
    userId: user.id,
    kind,
    templateId: registered.row.id,
  });
  return Response.json({ row: registered.row, selected: !selection.error });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No template specified." }, { status: 400 });
  const result = await deleteTemplate(supabase, { userId: user.id, id });
  if (result.error) return Response.json({ error: result.error }, { status: 500 });
  return Response.json({ ok: true });
}
