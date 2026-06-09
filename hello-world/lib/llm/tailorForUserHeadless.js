import mammoth from "mammoth";
import {
  generateTailoredResumeDraft,
  generateTailoredCoverLetterDraft,
} from "@/lib/llm/tailorResume";

const MAX_RESUME_CHARS = 20000;

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

  const draft = await generateTailoredResumeDraft({
    jobPosting,
    jobPostingUrl: "",
    resumeText,
    resumeFileName: "resume.docx",
    templateLines,
    additionalContext,
    aggressiveness,
    contextDocuments: [],
  });

  return {
    result: draft.result,
    resultLines: draft.resultLines,
    jobTitle: draft.jobTitle || jobTitleHint || "",
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
  jobPosting,
  jobPostingUrl = "",
  companyName = "",
  jobTitle = "",
  additionalContext = "",
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

  let resumeText = "";
  if (resumeBuffer && Buffer.isBuffer(resumeBuffer)) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: resumeBuffer });
      resumeText = (value || "").slice(0, MAX_RESUME_CHARS);
    } catch {
      resumeText = "";
    }
  }

  const draft = await generateTailoredCoverLetterDraft({
    jobPosting,
    jobPostingUrl,
    companyName,
    jobTitle,
    resumeText,
    templateLines,
    additionalContext,
    contextDocuments: [],
  });

  return {
    result: draft.result,
    resultLines: draft.resultLines,
  };
}

