import JSZip from "jszip";
import { DOCX_MIME } from "@/lib/drive/driveMime";

const TABLES = { resume: "generated_resumes", cover: "generated_cover_letters" };
const validKind = (kind) => typeof kind === "string" && Object.hasOwn(TABLES, kind);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPLATE_PERSISTENCE_NOTICE = "The document is available now, but its original template could not be saved for later sessions.";

async function validTemplateBytes(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) return null;
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) return null;
    return bytes;
  } catch { return null; }
}

async function ownedSource(supabase, { userId, kind, versionId }) {
  if (!validKind(kind) || typeof versionId !== "string" || !UUID.test(versionId)) return { code: "invalid-source" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id || (userId && data.user.id !== userId)) return { code: "unauthorized" };
  const owner = data.user.id;
  const found = await supabase.from(TABLES[kind]).select("id,docx_path").eq("id", versionId).eq("user_id", owner).maybeSingle();
  if (found.error) return { code: "ownership-unavailable" };
  if (!found.data) return { code: "unauthorized" };
  return { path: `${owner}/templates/generated/${kind}/${versionId}.docx`, owner, row: found.data };
}

export async function saveGeneratedTemplate(supabase, params) {
  try {
    const source = await ownedSource(supabase, params);
    if (!source.path) return { ok: false, code: source.code };
    const bytes = await validTemplateBytes(params.file);
    if (!bytes) return { ok: false, code: "invalid-source" };
    const { error } = await supabase.storage.from("resumes").upload(source.path, bytes, { contentType: DOCX_MIME, upsert: false });
    return error ? { ok: false, code: "unavailable" } : { ok: true };
  } catch { return { ok: false, code: "unavailable" }; }
}

async function fetchGeneratedTemplate(supabase, params) {
  let source;
  try { source = await ownedSource(supabase, params); } catch { return { file: null, code: "ownership-unavailable" }; }
  try {
    if (!source.path) return { file: null, code: source.code };
    const { data, error } = await supabase.storage.from("resumes").download(source.path);
    if (error) return {file:null,code: String(error.statusCode || error.status) === "404" || /not found/i.test(error.message || "") ? "missing-original" : "unavailable"};
    if (!data) return { file: null, code: "missing-original" };
    const bytes = await validTemplateBytes(data);
    if (!bytes) return { file: null, code: "invalid-content" };
    return { file: new File([bytes], `${params.kind}-original.docx`, { type: DOCX_MIME }) };
  } catch { return { file: null, code: "unavailable" }; }
}

// A File is usable only with the run/version that captured it, never today's global upload.
export async function resolveGeneratedTemplate(supabase, source) {
  if (!source || !validKind(source.kind)) return null;
  if (source.versionId) {
    const result = await fetchGeneratedTemplate(supabase, source);
    if (result.file) return result.file;
    if (!["missing-original", "unavailable", "invalid-content"].includes(result.code)) return null;
  }
  if (source.versionId && !source.binding) return (await resolveOriginalSource(supabase, source)).file || null;
  const b = source.binding;
  if (!b || b.kind !== source.kind || !b.runToken || b.runToken !== source.runToken || (b.versionId || null) !== (source.versionId || null)) return null;
  return await validTemplateBytes(b.file) ? b.file : null;
}

export function templateRunPatch({ engine, resumeFile, coverLetterFile, applyResume = true, applyCover = true }) {
  const patch = {};
  for (const [kind, file, apply] of [["resume", resumeFile, applyResume], ["cover", coverLetterFile, applyCover]]) {
    if (!apply) continue;
    patch[`${kind}TemplateVersionId`] = "";
    patch[`${kind}TemplateSource`] = engine === "gemini" && file ? { file, kind, runToken: crypto.randomUUID(), versionId: null } : null;
    patch[`${kind}TemplatePersistenceError`] = "";
  }
  return patch;
}

export function sourceTemplateForEntry(entry, kind) {
  const binding = entry?.[`${kind}TemplateSource`];
  const versionId = entry?.[`${kind}TemplateVersionId`] || null;
  if (!versionId && !binding) return null;
  return { kind, versionId, binding, runToken: binding?.runToken };
}

export function templateOutcomePatch(entry, run, outcome) {
  const patch = {};
  for (const kind of ["resume", "cover"]) {
    const binding = run[`${kind}TemplateSource`];
    if (!binding || entry?.[`${kind}TemplateSource`] !== binding) continue;
    const id = outcome?.[kind === "resume" ? "resumeId" : "coverLetterId"];
    if (id) {
      patch[`${kind}TemplateVersionId`] = id;
      patch[`${kind}TemplateSource`] = { ...binding, versionId: id };
    }
    patch[`${kind}TemplatePersistenceError`] = outcome?.templatePersistence?.[kind]?.ok ? "" : TEMPLATE_PERSISTENCE_NOTICE;
  }
  return patch;
}


const ORIGINAL_PART = "customXml/resume-tailor-original.xml";
const ORIGINAL_TYPE = "application/vnd.resume-tailor.original+xml";

// This package metadata is a closed reference, never a path or authorization.
export async function rewriteOriginalMarker(bytes, versionId = null) {
  const zip = await JSZip.loadAsync(bytes);
  let types = await zip.file("[Content_Types].xml").async("string");
  const relPath = "word/_rels/document.xml.rels";
  let rels = zip.file(relPath) ? await zip.file(relPath).async("string") : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  types = types.replace(/<Override\b[^>]*PartName="\/customXml\/resume-tailor-original\.xml"[^>]*\/\s*>/g, "");
  rels = rels.replace(/<Relationship\b[^>]*Target="\.\.\/customXml\/resume-tailor-original\.xml"[^>]*\/\s*>/g, "");
  zip.remove(ORIGINAL_PART);
  if (versionId !== null) {
    if (typeof versionId !== "string" || !UUID.test(versionId)) throw new Error("Invalid original template identity.");
    zip.file(ORIGINAL_PART, '<original xmlns="urn:resume-tailor:original:1" kind="cover" version="'+versionId+'"/>');
    if (/\/\s*>\s*$/.test(types) && !types.includes("</Types>")) types=types.replace(/\/\s*>\s*$/, "></Types>");
    types=types.replace("</Types>", '<Override PartName="/'+ORIGINAL_PART+'" ContentType="'+ORIGINAL_TYPE+'"/></Types>');
    if (/\/\s*>\s*$/.test(rels) && !rels.includes("</Relationships>")) rels=rels.replace(/\/\s*>\s*$/, "></Relationships>");
    rels=rels.replace("</Relationships>", '<Relationship Id="resumeTailorOriginal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../'+ORIGINAL_PART+'"/></Relationships>');
  }
  zip.file("[Content_Types].xml",types);zip.file(relPath,rels);
  return zip.generateAsync({type:"uint8array"});
}

export async function resolveOriginalSource(supabase, source) {
  if (!source || !validKind(source.kind)) return {code:"invalid-source"};
  if (!source.versionId) {
    const file=await resolveGeneratedTemplate(supabase,source);
    return file ? {file,versionId:null,code:"pending"} : {code:"missing-original"};
  }
  let owned;
  try { owned=await ownedSource(supabase,source); } catch { return {code:"ownership-unavailable"}; }
  if (!owned.path) return {code:owned.code};
  const direct=await fetchGeneratedTemplate(supabase,source);
  if(direct.file) return {file:direct.file,versionId:source.versionId,code:"original"};
  if(!["missing-original","unavailable","invalid-content"].includes(direct.code)) return direct;
  const bound=source.binding ? await resolveGeneratedTemplate(supabase,source) : null;
  if(bound) return {file:bound,versionId:source.versionId,code:"bound"};
  if(direct.code!=="missing-original") return {code:direct.code};
  const path=owned.row.docx_path;
  if(!path) return {code:direct.code};
  if(typeof path!=="string" || !path.startsWith(owned.owner+"/generated/") || path.includes("..")) return {code:"invalid-provenance"};
  try {
    const {data,error}=await supabase.storage.from("resumes").download(path);
    if(error || !data) return {code:"unavailable"};
    const zip=await JSZip.loadAsync(await data.arrayBuffer());
    const marker=zip.file(ORIGINAL_PART);
    if(!marker) return {code:"native"};
    const text=await marker.async("string");
    const match=/^<original xmlns="urn:resume-tailor:original:1" kind="cover" version="([0-9a-f-]+)"\/>$/i.exec(text);
    if(source.kind!=="cover" || !match || !UUID.test(match[1])) return {code:"invalid-provenance"};
    const base=await fetchGeneratedTemplate(supabase,{kind:"cover",versionId:match[1]});
    return base.file ? {file:base.file,versionId:match[1],code:"original"} : {code:base.code};
  } catch { return {code:"invalid-provenance"}; }
}
