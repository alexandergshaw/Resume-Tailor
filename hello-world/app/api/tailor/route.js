import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { getEngine, resolveEngineName } from "@/lib/llm/engines";
import { getServerEnv } from "@/lib/config/env";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 20000;
const MAX_CONTEXT_CHARS = 12000;
const MAX_CONTEXT_FILES = 10;
const DEFAULT_AGGRESSIVENESS = 3;
const MIN_AGGRESSIVENESS = 1;
const MAX_AGGRESSIVENESS = 5;
const TEXT_MIME_PREFIX = "text/";
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];
const DOCX_EXTENSIONS = [".docx"];
const DOCX_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
];

function isTextLikeFile(file) {
  if (file.type && file.type.startsWith(TEXT_MIME_PREFIX)) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function isDocxFile(file) {
  const lowerName = file.name.toLowerCase();

  if (DOCX_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return true;
  }

  return file.type ? DOCX_MIME_TYPES.includes(file.type) : false;
}

async function readResumeText(file) {
  if (!file) {
    return "";
  }

  if (isTextLikeFile(file)) {
    const rawText = await file.text();
    return rawText ? rawText.slice(0, MAX_RESUME_CHARS) : "";
  }

  if (isDocxFile(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    return value ? value.slice(0, MAX_RESUME_CHARS) : "";
  }

  return "";
}

async function readContextFile(file) {
  if (isTextLikeFile(file)) {
    const rawText = await file.text();
    return rawText ? rawText.slice(0, MAX_CONTEXT_CHARS) : "";
  }

  if (isDocxFile(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    return value ? value.slice(0, MAX_CONTEXT_CHARS) : "";
  }

  return "Unsupported file type for text extraction.";
}

async function parseContextDocuments(formData) {
  const rawFiles = formData.getAll("contextFiles");
  const contextFiles = rawFiles.filter((value) => value instanceof File).slice(0, MAX_CONTEXT_FILES);

  const documents = [];

  for (const file of contextFiles) {
    const content = await readContextFile(file);
    documents.push({
      name: file.name,
      content,
    });
  }

  return documents;
}

function parseAdditionalContext(rawAdditionalContext) {
  return rawAdditionalContext ? rawAdditionalContext.toString().trim().slice(0, MAX_CONTEXT_CHARS) : "";
}

function parseAggressiveness(rawAggressiveness) {
  const parsed = Number.parseInt(rawAggressiveness?.toString() || "", 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_AGGRESSIVENESS;
  }

  return Math.min(MAX_AGGRESSIVENESS, Math.max(MIN_AGGRESSIVENESS, parsed));
}

// Parse a JSON object field (e.g. external-engine slot `values`) defensively.
function parseJsonObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseTemplateLines(rawTemplateLines) {
  if (!rawTemplateLines) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawTemplateLines);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((line) => (typeof line === "string" ? line : ""))
      .slice(0, 600);
  } catch {
    return [];
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData();

    const jobPosting = formData.get("jobPosting")?.toString().trim() || "";
    const jobPostingUrl = formData.get("jobPostingUrl")?.toString().trim() || "";
    const additionalContext = parseAdditionalContext(formData.get("additionalContext"));
    const aggressiveness = parseAggressiveness(formData.get("aggressiveness"));
    const contextDocuments = await parseContextDocuments(formData);
    const templateLines = parseTemplateLines(
      formData.get("templateLines")?.toString() || "",
    );
    const coverLetterTemplateLines = parseTemplateLines(
      formData.get("coverLetterTemplateLines")?.toString() || "",
    );
    const resumeFile = formData.get("resume");
    const coverLetterFile = formData.get("coverLetter");
    // Optional external-engine slot overrides (from the review-then-generate UI).
    const values = parseJsonObject(formData.get("values"));

    // Select the document-generation engine: per-request override falls back to
    // the server default (RESUME_ENGINE). Unknown names degrade to "gemini".
    // Read the default resiliently so the no-LLM "embedded" engine still works
    // when the Gemini key (required only by the Gemini engine) is absent.
    let defaultEngine = "gemini";
    try {
      defaultEngine = getServerEnv().resumeEngine;
    } catch {
      defaultEngine = (process.env.RESUME_ENGINE || "gemini").trim().toLowerCase();
    }
    const engineName = resolveEngineName(
      formData.get("engine")?.toString() || "",
      defaultEngine,
    );
    const engine = getEngine(engineName);

    if (!jobPosting && !jobPostingUrl) {
      return NextResponse.json(
        { error: "jobPosting or jobPostingUrl is required." },
        { status: 400 },
      );
    }

    if (!(resumeFile instanceof File)) {
      return NextResponse.json(
        { error: "A resume file is required." },
        { status: 400 },
      );
    }

    if (!isTextLikeFile(resumeFile) && !isDocxFile(resumeFile)) {
      return NextResponse.json(
        {
          error:
            "Upload a resume in .txt, .md, or .docx format.",
        },
        { status: 400 },
      );
    }

    const resumeText = await readResumeText(resumeFile);

    let scrapedJobTitle = "";
    let scrapedCompany = "";
    let scrapedDescription = "";
    let effectiveJobPosting = jobPosting;
    let effectiveJobPostingUrl = jobPostingUrl;

    if (jobPostingUrl) {
      const scraped = await fetchUrlContent(jobPostingUrl);
      if (!scraped.error) {
        scrapedJobTitle = scraped.title || "";
        scrapedCompany = scraped.company || "";
        scrapedDescription = scraped.description || "";
        // If we successfully scraped the description, prefer feeding it as
        // text to the LLM (more reliable and avoids the urlContext tool).
        if (scrapedDescription && !effectiveJobPosting) {
          effectiveJobPosting = scrapedDescription;
          effectiveJobPostingUrl = "";
        }
      }
    }

    const resumeArgs = {
      jobPosting: effectiveJobPosting,
      jobPostingUrl: effectiveJobPostingUrl,
      resumeText,
      resumeFileName: resumeFile.name,
      templateLines,
      additionalContext,
      aggressiveness,
      contextDocuments,
      values,
    };

    // Run the selected engine. If "external" is chosen but not configured, fall
    // back to Gemini and surface a warning rather than failing the request.
    let activeEngine = engine;
    let result;
    const engineWarnings = [];
    try {
      result = await activeEngine.tailorResume(resumeArgs);
    } catch (err) {
      if (engineName === "external" && err?.code === "ENGINE_NOT_CONFIGURED") {
        activeEngine = getEngine("gemini");
        result = await activeEngine.tailorResume(resumeArgs);
        result.engine = "gemini";
        engineWarnings.push("Resume Tailor API is not configured; generated with Gemini instead.");
      } else {
        throw err;
      }
    }

    // Optionally generate a tailored cover letter using the uploaded template.
    let coverLetterResultLines = [];
    let coverLetterResult = "";
    let coverLetterError = "";
    let coverLetterDocxB64 = "";
    if (!(coverLetterFile instanceof File)) {
      // No cover letter file uploaded — that's fine, just skip silently.
    } else if (coverLetterTemplateLines.length === 0) {
      coverLetterError = "Cover letter template appears empty; upload a .docx with text content.";
    } else if (!isTextLikeFile(coverLetterFile) && !isDocxFile(coverLetterFile)) {
      coverLetterError = "Cover letter must be .txt, .md, or .docx.";
    } else {
      try {
        const coverDraft = await activeEngine.tailorCoverLetter({
          jobPosting: effectiveJobPosting,
          jobPostingUrl: effectiveJobPostingUrl,
          companyName: scrapedCompany || result.companyName,
          jobTitle: result.jobTitle || scrapedJobTitle,
          resumeText,
          templateLines: coverLetterTemplateLines,
          additionalContext,
          contextDocuments,
        });
        coverLetterResultLines = coverDraft.resultLines;
        coverLetterResult = coverDraft.result;
        coverLetterDocxB64 = typeof coverDraft.docxB64 === "string" ? coverDraft.docxB64 : "";
      } catch (err) {
        console.error("Error generating tailored cover letter:", err);
        coverLetterError = `Cover letter generation failed: ${err.message || "unknown error"}`;
      }
    }

    const warnings = [...engineWarnings, ...(Array.isArray(result.warnings) ? result.warnings : [])];

    return NextResponse.json({
      ...result,
      engine: result.engine || engineName,
      docxB64: typeof result.docxB64 === "string" ? result.docxB64 : "",
      coverLetterDocxB64,
      report: result.report || null,
      warnings,
      degraded: !!result.degraded,
      jobTitle: result.jobTitle || scrapedJobTitle,
      jobDescription: scrapedDescription,
      company: scrapedCompany || result.companyName || "",
      coverLetterResult,
      coverLetterResultLines,
      coverLetterError,
    });
  } catch (error) {
    console.error("Error generating tailored resume:", error);
    return NextResponse.json(
      {
        error:
          "Unable to generate tailored resume draft. Check server logs and environment configuration.",
      },
      { status: 500 },
    );
  }
}
