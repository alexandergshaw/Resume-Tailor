import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { generateTailoredResumeDraft } from "@/lib/llm/tailorResume";
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
    const resumeFile = formData.get("resume");

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

    const result = await generateTailoredResumeDraft({
      jobPosting: effectiveJobPosting,
      jobPostingUrl: effectiveJobPostingUrl,
      resumeText,
      resumeFileName: resumeFile.name,
      templateLines,
      additionalContext,
      aggressiveness,
      contextDocuments,
    });

    return NextResponse.json({
      ...result,
      jobTitle: result.jobTitle || scrapedJobTitle,
      jobDescription: scrapedDescription,
      company: scrapedCompany,
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
