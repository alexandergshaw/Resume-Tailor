import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { getEngine, resolveEngineName } from "@/lib/llm/engines";
import { combineMatches } from "@/lib/llm/engines/tailor-lite/matchReport";
import { buildLibrarySuggestions } from "@/lib/llm/engines/tailor-lite/library/suggest";
import { sanitizeEditRules } from "@/lib/tailor/editRules";
import { getServerEnv } from "@/lib/config/env";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { extractPostingMeta } from "@/lib/llm/postingMeta";
import { createClient } from "@/lib/supabase/server";

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

// Parse the previewer's buzzword toggles: { boost: string[], exclude: string[] }.
// Defensive — arrays of short strings only, capped, anything else dropped.
function parseKeywordEdits(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  const clean = (list) =>
    (Array.isArray(list) ? list : [])
      .map((s) => String(s || "").trim())
      .filter((s) => s.length > 0 && s.length <= 60)
      .slice(0, 40);
  const boost = clean(parsed?.boost);
  const exclude = clean(parsed?.exclude);
  return boost.length > 0 || exclude.length > 0 ? { boost, exclude } : null;
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
    // The signed-in user (if any) selects which tailor library the embedded engine
    // reads. No user -> the engine falls back to the bundled defaults.
    let userId;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
    } catch {
      userId = undefined;
    }

    const formData = await request.formData();

    const jobPosting = formData.get("jobPosting")?.toString().trim() || "";
    const jobPostingUrl = formData.get("jobPostingUrl")?.toString().trim() || "";
    const additionalContext = parseAdditionalContext(formData.get("additionalContext"));
    // Optional free-text steering from the preview's "revise with Gemini" box.
    const steeringInstructions = parseAdditionalContext(formData.get("steeringInstructions"));
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
    // Promoted recurring hand-edits (device-local, sent by the client) that the
    // embedded engine applies document-wide after slot filling.
    const editRules = sanitizeEditRules(formData.get("editRules")?.toString() || "");
    // User-pinned focus area (the previewer's "wrong focus" flag) — the embedded
    // engine uses this library focus area instead of auto-detecting one.
    const focusArea = formData.get("focusArea")?.toString().trim().slice(0, 120) || "";
    // Buzzword toggles from the previewer's focus modal: boost/exclude specific
    // terms for this posting.
    const keywordEdits = parseKeywordEdits(formData.get("keywordEdits"));
    // Saved persona name (a named profile-reframing identity).
    const persona = formData.get("persona")?.toString().trim().slice(0, 120) || "";
    // Cover-letter framing override (the previewer's teaching/staff/industry
    // toggle). Whitelisted; anything else means auto-detect.
    const rawVariant = formData.get("coverVariant")?.toString().trim().toLowerCase() || "";
    const coverVariant = ["teaching", "staff", "industry", "nontechnical"].includes(rawVariant) ? rawVariant : "";

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
    let scrapeError = "";
    let effectiveJobPosting = jobPosting;
    let effectiveJobPostingUrl = jobPostingUrl;

    if (jobPostingUrl) {
      const scraped = await fetchUrlContent(jobPostingUrl);
      if (scraped.error) {
        scrapeError = scraped.error;
      } else {
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

    // Only Gemini can read a URL on its own (urlContext); the offline engines
    // need the text we scraped. If a URL was given but produced nothing usable,
    // tell the user plainly instead of failing with a generic error.
    if (jobPostingUrl && !effectiveJobPosting.trim() && engineName !== "gemini") {
      return NextResponse.json(
        {
          error: `Couldn't read the job posting from that URL${scrapeError ? ` (${scrapeError})` : ""}. Paste the description text instead.`,
        },
        { status: 422 },
      );
    }

    // Deterministic last-resort title/company parsed from the posting text, used
    // to name the generated documents when neither the scrape nor the engine
    // supplied one (e.g. Gemini returned empty, or a pasted posting with no URL).
    const postingMeta = extractPostingMeta(effectiveJobPosting);

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
      steeringInstructions,
      editRules,
      focusArea,
      keywordEdits,
      persona,
      userId,
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
    let coverLetterMatch = null;
    let coverVariantUsed = null;
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
          companyName: scrapedCompany || result.companyName || postingMeta.companyName,
          jobTitle: result.jobTitle || scrapedJobTitle || postingMeta.jobTitle,
          resumeText,
          templateLines: coverLetterTemplateLines,
          additionalContext,
          contextDocuments,
          steeringInstructions,
          editRules,
          focusArea,
          keywordEdits,
          coverVariant,
          persona,
          userId,
        });
        coverLetterResultLines = coverDraft.resultLines;
        coverLetterResult = coverDraft.result;
        coverLetterDocxB64 = typeof coverDraft.docxB64 === "string" ? coverDraft.docxB64 : "";
        coverLetterMatch = coverDraft.report?.match || null;
        // Which framing was used (teaching/staff/industry) and whether the user
        // pinned it — the previewer's letter-framing control reads this.
        coverVariantUsed = coverDraft.report?.meta?.coverVariant
          ? {
              name: coverDraft.report.meta.coverVariant,
              source: coverDraft.report.meta.coverVariantSource || "auto",
              detected: coverDraft.report.meta.coverVariantDetected || coverDraft.report.meta.coverVariant,
            }
          : null;
      } catch (err) {
        console.error("Error generating tailored cover letter:", err);
        coverLetterError = `Cover letter generation failed: ${err.message || "unknown error"}`;
      }
    }

    const warnings = [...engineWarnings, ...(Array.isArray(result.warnings) ? result.warnings : [])];

    // Posting↔output match (embedded engine attaches report.match per document).
    // The weakest document drives the response-level score; below the threshold
    // the client offers a library update from the reported vocabulary gaps.
    const match = combineMatches([result.report?.match, coverLetterMatch]);
    if (match?.belowThreshold) {
      warnings.push(
        `The generated documents cover ${Math.round(match.score * 100)}% of this posting's key terms — the library may be missing this posting's vocabulary.`,
      );
    }

    // Low match on the embedded engine: automatically scrape this posting for
    // buzzwords the user's library lacks. Read-only — the client shows them and
    // commits only what the user approves (via /api/library/import). Requires a
    // signed-in user (there is no per-user library to grow otherwise).
    let librarySuggestions = null;
    if (match?.belowThreshold && engineName === "embedded" && userId) {
      try {
        const suggestions = await buildLibrarySuggestions({ posting: effectiveJobPosting, userId });
        if (suggestions.buzzwords.length > 0) librarySuggestions = suggestions;
      } catch (err) {
        console.error("Library suggestion scrape failed:", err);
      }
    }

    return NextResponse.json({
      ...result,
      engine: result.engine || engineName,
      docxB64: typeof result.docxB64 === "string" ? result.docxB64 : "",
      coverLetterDocxB64,
      report: result.report || null,
      match,
      coverVariant: coverVariantUsed,
      librarySuggestions,
      warnings,
      degraded: !!result.degraded,
      jobTitle: result.jobTitle || scrapedJobTitle || postingMeta.jobTitle,
      jobDescription: scrapedDescription,
      company: scrapedCompany || result.companyName || postingMeta.companyName || "",
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
