import { uploadCoverDocx } from "./coverDocxStore";
import { bytesToBase64 } from "./docxBytes";
import { promoteDefaultTemplateBlob } from "./defaultTemplateClient";
import { buildPreviewBlob } from "./previewBlob";
import { resolveGeneratedTemplate, resolveOriginalSource, rewriteOriginalMarker, saveGeneratedTemplate, sourceTemplateForEntry } from "./generatedTemplateStore";

// Capture original Gemini input, or the faithful current server document.
async function captureDefaultTemplate(entry, kind, { supabase, resumeFile, coverLetterFile, text } = {}) {
  if (kind !== "resume" && kind !== "cover") return null;
  const source = sourceTemplateForEntry(entry, kind);
  const hasServer = kind === "cover" ? entry?.coverLetterDocxB64 || entry?.coverLetterDocxPath : entry?.docxB64 || entry?.docxPath;
  if (source && !hasServer) return resolveGeneratedTemplate(supabase, source);
  if (source && hasServer) { const original = await resolveOriginalSource(supabase, source); if (original.file) return original.file; if (original.code !== "native") return null; }
  if (!hasServer && entry?.engine === "gemini") return null;
  if (!hasServer) return null;
  return buildPreviewBlob(entry, kind, { resumeFile, coverLetterFile, text });
}

export async function promotePreviewTemplate({ scope, payload, jobId, locks, getEntry, setFlags, ...options }) {
  const key = `template:${scope}`;
  if (!jobId || !["resume", "cover"].includes(scope) || locks.has(key)) return;
  locks.add(key); setFlags(jobId, { busy: true, error: "", notice: "" });
  try {
    const blob = await captureDefaultTemplate(getEntry(), scope, { ...options, text: typeof payload === "string" ? payload : payload?.text || "" });
    setFlags(jobId, await promoteDefaultTemplateBlob(blob, scope));
  } catch { setFlags(jobId, { error: "Couldn't capture this document as a template.", notice: "" }); }
  finally { locks.delete(key); setFlags(jobId, { busy: false }); }
}

export async function revisionTemplateFiles(entry, { supabase, resumeFile, coverLetterFile }) {
  const resumeSource = sourceTemplateForEntry(entry, "resume"), coverSource = sourceTemplateForEntry(entry, "cover");
  return {
    resumeFile: resumeSource ? await captureDefaultTemplate(entry, "resume", { supabase }) : resumeFile,
    coverLetterFile: coverSource ? await captureDefaultTemplate(entry, "cover", { supabase }) : coverLetterFile,
    hasCoverSource: !!coverSource,
  };
}

export async function appendRevisionSources(formData, { resumeFile, coverLetterFile }, { applyCover, focusChange, entry, contextFiles }, buildLines) {
  formData.append("templateLines", JSON.stringify(await buildLines(resumeFile)));
  contextFiles.forEach((file) => formData.append("contextFiles", file));
  formData.append("resume", resumeFile);
  if (applyCover && Array.isArray(entry.resultLines) && entry.resultLines.length > 0) formData.append("tailoredResumeLines", JSON.stringify(entry.resultLines));
  const regenCover = (applyCover || focusChange) && coverLetterFile;
  if (regenCover) {
    formData.append("coverLetterTemplateLines", JSON.stringify(await buildLines(coverLetterFile)));
    formData.append("coverLetter", coverLetterFile);
  }
  return regenCover;
}

export function templatePersistenceNotices(entry, setFlags) {
  for (const kind of ["resume", "cover"]) {
    if (entry?.[`${kind}TemplatePersistenceError`]) setFlags(kind, { error: entry[`${kind}TemplatePersistenceError`] });
  }
}

export async function rebuildCoverOriginal(entry, supabase) {
  try {
    const source = sourceTemplateForEntry(entry, "cover");
    const file = source ? await resolveGeneratedTemplate(supabase, source) : null;
    if (!file) return "";
    const blob = await buildPreviewBlob({ ...entry, coverLetterDocxB64: "", coverLetterDocxPath: "", coverTemplateSource: null, coverTemplateVersionId: "" }, "cover", { coverLetterFile: file });
    return blob ? bytesToBase64(new Uint8Array(await blob.arrayBuffer())) : "";
  } catch { return ""; }
}


export async function persistCoverFactDocument({entry,lines,candidate="",supabase,userId,spliceRefused=false}) {
  const source=sourceTemplateForEntry(entry,"cover");
  if(!source) return {ok:true,docxB64:candidate,docxPath:candidate ? await uploadCoverDocx(supabase,userId,candidate) : null};
  try {
    let original=await resolveOriginalSource(supabase,source);
    if(original.code==="native") return {ok:true,docxB64:candidate,docxPath:candidate ? await uploadCoverDocx(supabase,userId,candidate) : null};
    if(!original.file) return {ok:false,reason:"The original cover template is unavailable. Restore it before changing facts."};
    if(!original.versionId) return {ok:false,reason:"Original template is still saving; try again shortly."};
    if(original.code==="bound") {
      await saveGeneratedTemplate(supabase,{kind:"cover",versionId:original.versionId,userId,file:original.file});
      const durable=await resolveOriginalSource(supabase,{kind:"cover",versionId:original.versionId});
      if(!durable.file || durable.code!=="original" || new Uint8Array(await durable.file.arrayBuffer()).toString()!==new Uint8Array(await original.file.arrayBuffer()).toString()) return {ok:false,reason:"The original template could not be saved. Try again."};
      original=durable;
    }
    if(spliceRefused) return {ok:false,reason:"The cover document changed; refresh before changing facts."};
    let bytes;
    if(candidate) bytes=Uint8Array.from(atob(candidate),c=>c.charCodeAt(0));
    else {
      const blob=await buildPreviewBlob({...entry,coverLetterResultLines:lines,coverLetterDocxB64:"",coverLetterDocxPath:"",coverTemplateSource:null,coverTemplateVersionId:""},"cover",{coverLetterFile:original.file});
      if(!blob) return {ok:false,reason:"Couldn't rebuild this cover document."};
      bytes=new Uint8Array(await blob.arrayBuffer());
    }
    const docxB64=bytesToBase64(await rewriteOriginalMarker(bytes,original.versionId));
    const docxPath=await uploadCoverDocx(supabase,userId,docxB64);
    return docxPath ? {ok:true,docxB64,docxPath} : {ok:false,reason:"Couldn't save the cover document. Try again."};
  } catch { return {ok:false,reason:"Couldn't preserve the original cover template. Try again."}; }
}
