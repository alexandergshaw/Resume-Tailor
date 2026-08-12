import mammoth from "mammoth";
import { getEngine, resolveEngineName } from "@/lib/llm/engines";

const MAX_RESUME_CHARS = 20000;

// DECISION, left ungrounded on purpose: app/api/tailor/route.js now feeds the
// caller's own Professional Experience project pages into the Gemini prompt
// as extra context (lib/experience/tailorContext.js's buildTailorContextBlock,
// fetched there via lib/supabase/experiencePages.js's listPages, scoped by the
// route's own authenticated `supabase` client). This headless path — used by
// the cron/auto-apply feed via lib/feed/tailorAndQueue.js's tailorAndQueueOne
// — deliberately does NOT get that same context, even though it already has
// `userId` and could in principle look pages up itself.
//
// Doing it properly means threading a Supabase client through to here: this
// module has no client of its own, and its only caller (tailorAndQueueOne in
// lib/feed/tailorAndQueue.js, which already holds a service-role `admin`
// client) would need to pass it down to `tailorResumeHeadless`/
// `tailorCoverLetterHeadless`. That caller is outside this change's editable
// scope, so wiring it here without also updating there would either require
// exceeding that scope or minting a fresh Supabase client inside this module
// with its own connection/config concerns — a pattern this codebase avoids
// (every other data-access site is handed the caller's own client). Left as a
// known, documented gap rather than done partially or out of scope.

// The cron/auto-apply path has no per-request override, so it follows the
// server default engine (RESUME_ENGINE). If "external" is selected but not
// configured, fall back to Gemini so background tailoring never stalls.
function selectedEngine() {
  return getEngine(resolveEngineName(process.env.RESUME_ENGINE));
}

async function runWithFallback(engine, method, args) {
  try {
    return await engine[method](args);
  } catch (err) {
    if (engine.name === "external" && err?.code === "ENGINE_NOT_CONFIGURED") {
      return getEngine("gemini")[method](args);
    }
    throw err;
  }
}

/**
 * Run the resume tailoring pipeline for the cron job (no FormData, no HTTP).
 * Resume bytes come straight from Supabase Storage; the job posting text
 * comes from the Greenhouse description we've already fetched.
 *
 * @param {{
 *   resumeBuffer: Buffer,
 *   jobPosting: string,
 *   jobTitleHint?: string,
 *   additionalContext?: string,
 *   aggressiveness?: number,
 * }} args
 * @returns {Promise<{ result: string, resultLines: string[], jobTitle: string }>}
 */
export async function tailorResumeHeadless({
  resumeBuffer,
  jobPosting,
  jobTitleHint = "",
  additionalContext = "",
  aggressiveness = 3,
  userId,
}) {
  if (!resumeBuffer || !Buffer.isBuffer(resumeBuffer)) {
    throw new Error("tailorResumeHeadless: resumeBuffer (Buffer) is required.");
  }
  if (!jobPosting || jobPosting.trim().length === 0) {
    throw new Error("tailorResumeHeadless: jobPosting text is required.");
  }

  const { value: rawText } = await mammoth.extractRawText({ buffer: resumeBuffer });
  const resumeText = (rawText || "").slice(0, MAX_RESUME_CHARS);
  if (!resumeText.trim()) {
    throw new Error("tailorResumeHeadless: could not extract any text from resume.");
  }

  // Template lines = each non-empty line of the source resume. This keeps the
  // generated output the same shape as the original (one paragraph per line)
  // so we can later swap it back into the .docx if the user downloads it.
  const templateLines = resumeText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 600);

  const draft = await runWithFallback(selectedEngine(), "tailorResume", {
    jobPosting,
    jobPostingUrl: "",
    resumeText,
    resumeFileName: "resume.docx",
    templateLines,
    additionalContext,
    aggressiveness,
    contextDocuments: [],
    userId,
  });

  return {
    result: draft.result,
    resultLines: draft.resultLines,
    jobTitle: draft.jobTitle || jobTitleHint || "",
    docxB64: typeof draft.docxB64 === "string" ? draft.docxB64 : "",
  };
}

/**
 * Run the cover-letter tailoring pipeline for the cron job (no FormData, no
 * HTTP). The cover-letter template bytes come from Supabase Storage
 * (`${userId}/cover-letter` in the resumes bucket); the resume text is reused
 * as supporting context. Returns null when no usable cover-letter template is
 * available so callers can skip cover letters gracefully.
 *
 * @param {{
 *   coverLetterBuffer: Buffer,
 *   resumeBuffer?: Buffer,
 *   tailoredResume?: { result: string, resultLines: string[] },
 *   jobPosting: string,
 *   jobPostingUrl?: string,
 *   companyName?: string,
 *   jobTitle?: string,
 *   additionalContext?: string,
 * }} args
 * @returns {Promise<{ result: string, resultLines: string[] }|null>}
 */
export async function tailorCoverLetterHeadless({
  coverLetterBuffer,
  resumeBuffer = null,
  tailoredResume = null,
  jobPosting,
  jobPostingUrl = "",
  companyName = "",
  jobTitle = "",
  additionalContext = "",
  userId,
}) {
  if (!coverLetterBuffer || !Buffer.isBuffer(coverLetterBuffer)) return null;
  if (!jobPosting || jobPosting.trim().length === 0) return null;

  let templateText = "";
  try {
    const { value } = await mammoth.extractRawText({ buffer: coverLetterBuffer });
    templateText = value || "";
  } catch {
    return null;
  }

  const templateLines = templateText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 200);

  if (templateLines.length === 0) return null;

  // Original-resume text is still passed as background grounding (see
  // tailorResume.js); `tailoredResume` — when the caller has it, as
  // tailorAndQueue.js does — takes over as the letter's primary content source.
  let resumeText = "";
  if (resumeBuffer && Buffer.isBuffer(resumeBuffer)) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: resumeBuffer });
      resumeText = (value || "").slice(0, MAX_RESUME_CHARS);
    } catch {
      resumeText = "";
    }
  }

  const draft = await runWithFallback(selectedEngine(), "tailorCoverLetter", {
    jobPosting,
    jobPostingUrl,
    companyName,
    jobTitle,
    resumeText,
    tailoredResume,
    templateLines,
    additionalContext,
    contextDocuments: [],
    userId,
  });

  return {
    result: draft.result,
    resultLines: draft.resultLines,
    docxB64: typeof draft.docxB64 === "string" ? draft.docxB64 : "",
  };
}

