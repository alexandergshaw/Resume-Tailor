// N151a: /api/templates/library -- list / add / delete the caller's saved
// formatting templates (the library over resume_templates), and make a newly
// added template the ACTIVE one. Idiom mirrors app/api/templates/default/
// route.js: getUser() -> 401 -> the stores, with userId ALWAYS taken from the
// authenticated session, never the request body. Storage-only: it imports no
// model client, so it needs no rate-limit adoption entry.
//
// GET    ?kind=resume|cover          -> { templates: [...] }
// POST   multipart {file, kind, name?} -> { row, selected } -- registers the
//   uploaded .docx as a named library template AND makes it the caller's
//   selection for that kind (mark = add + activate, so one click means future
//   generations use it). Only .docx is accepted: the extension AND the ZIP
//   container magic are both checked here, because a non-docx row would later
//   be skipped silently at the doc-build override and render native output
//   with no error. kind='email' (anything outside resume/cover) is refused.
// DELETE ?id=<template id>           -> { ok: true }

import { createClient } from "@/lib/supabase/server";
import {
  listTemplates,
  registerTemplate,
  deleteTemplate,
} from "@/lib/document/templateLibraryStore.js";
import { setSelection } from "@/lib/document/templateSelectionStore.js";

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

  const kind = new URL(request.url).searchParams.get("kind");
  if (!VALID_KINDS.includes(kind)) {
    return Response.json({ error: `Unsupported template kind: ${kind}.` }, { status: 400 });
  }
  const templates = await listTemplates(supabase, { userId: user.id, kind });
  return Response.json({ templates });
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
