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
import { listPages } from "@/lib/supabase/experiencePages";
import { buildTailorContextBlock } from "@/lib/experience/tailorContext";

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

// Selects which résumé lines/text ground the cover letter: the client's
// stored (possibly hand-edited) tailored résumé lines when present, else the
// résumé just tailored in this same request. Tolerates missing/malformed
// inputs so it can be unit-tested in isolation.
export function pickTailoredResume(clientLines, resumeResult) {
  const lines = Array.isArray(clientLines) ? clientLines : [];
  if (lines.length > 0) {
    return { result: lines.join("\n").trim(), resultLines: lines };
  }
  const resume = resumeResult && typeof resumeResult === "object" ? resumeResult : {};
  return {
    result: typeof resume.result === "string" ? resume.result : "",
    resultLines: Array.isArray(resume.resultLines) ? resume.resultLines : [],
  };
}

// How many dropped project-page names get spelled out in the warning below
// before the rest are folded into "and N more" — an owner who dropped five
// pages should see all five, but one who dropped fifty needs a warning they
// can actually read, not a sentence that sprawls across the screen. Mirrors
// the cap-then-summarize pattern lib/chat/localAssistant.js's
// summarizeApplications already uses for the same reason.
const MAX_NAMED_DROPPED_PAGES = 10;

// The one thing app/api/tailor/route.test.js's truncation test and every
// caller of this response actually need answered: "which ones?". See
// lib/experience/tailorContext.js's header for why the names live here, in
// the response warning, rather than inside the prompt block's own notice.
function formatDroppedProjectPagesWarning(droppedPages) {
  const names = Array.isArray(droppedPages) ? droppedPages : [];
  const shown = names.slice(0, MAX_NAMED_DROPPED_PAGES).map((name) => `“${name}”`);
  const remaining = names.length - shown.length;
  const list = remaining > 0 ? `${shown.join(", ")}, and ${remaining} more` : shown.join(", ");
  return `Some of your project pages were too large to fit in the AI's context budget and were left out: ${list}.`;
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
    // reads. No user -> the engine falls back to the bundled defaults. `supabase`
    // is kept in this outer scope (not just inside the try) because it is also
    // reused below to fetch this same user's own Professional Experience project
    // pages for the tailor-context block.
    let userId;
    let supabase;
    try {
      supabase = await createClient();
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

    // Feed the caller's own "Professional Experience" project pages into the
    // Gemini prompt as extra context (title + whole body prose — never the
    // deterministic engine's mined fragments; see
    // lib/experience/tailorContext.js's header comment for why). Pages are
    // ALWAYS fetched server-side, scoped to this session's own userId via the
    // one function this codebase uses to query the pages table
    // (lib/supabase/experiencePages.js's listPages) — never read from the
    // request body. Skipped entirely for a signed-out caller or on any fetch
    // error, so the prompt those callers get is unaffected by this feature.
    let projectPagesBlock = "";
    let projectPagesTruncated = false;
    let projectPagesDropped = [];
    if (userId && supabase) {
      try {
        const { pages } = await listPages(supabase, userId);
        const built = buildTailorContextBlock(Array.isArray(pages) ? pages : []);
        projectPagesBlock = built.block;
        projectPagesTruncated = built.truncated;
        projectPagesDropped = built.droppedPages;
      } catch {
        projectPagesBlock = "";
        projectPagesTruncated = false;
        projectPagesDropped = [];
      }
    }
    // Appended as one more contextDocuments entry rather than a new prompt
    // block of its own — tailorResume.js's buildTailorPrompt already
    // documents (hard constraint 11) that a claim may be grounded in "the
    // source resume or provided context", which already covers this, so
    // nothing in tailorResume.js needs to change. Only appended when there is
    // something to add, so a caller with no eligible pages (including every
    // signed-out caller) gets a byte-identical contextDocuments array, and
    // therefore a byte-identical prompt, to one that never called this.
    const contextDocumentsWithProjectPages = projectPagesBlock
      ? [
          ...contextDocuments,
          { name: "Your project pages (Professional Experience)", content: projectPagesBlock },
        ]
      : contextDocuments;

    const templateLines = parseTemplateLines(
      formData.get("templateLines")?.toString() || "",
    );
    const coverLetterTemplateLines = parseTemplateLines(
      formData.get("coverLetterTemplateLines")?.toString() || "",
    );
    // Cover-only revises (the preview modal's cover scope) send the ALREADY-
    // tailored résumé lines it has stored client-side — which may include the
    // user's hand edits — so the cover letter is grounded in what's actually
    // being kept, not a fresh (edit-unaware) resume rewrite from this request.
    const tailoredResumeLines = parseTemplateLines(
      formData.get("tailoredResumeLines")?.toString() || "",
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
      // Includes the project-pages entry appended above, when there was one.
      contextDocuments: contextDocumentsWithProjectPages,
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
    // The cover letter's own degradation warnings (an unparsed steering note,
    // a missing focus area, an out-of-taxonomy buzzword, an applied recurring
    // edit — see lib/llm/engines/tailor-lite/engine.js's tailorCoverLetter,
    // and externalEngine.js's tailorCoverLetter for the "external" engine).
    // Previously computed by the engine and then silently discarded here —
    // never read off coverDraft, so a cover-letter-specific degradation never
    // reached a client even after 7d0f1c2 wired up `result.warnings`. See the
    // aggregation/attribution/dedup logic below (`warnings`).
    let coverLetterWarnings = [];
    // The cover letter's content source: the client's stored (possibly hand-
    // edited) tailored résumé lines when it sent them, otherwise the résumé
    // just tailored above in this same request. Either way this is the
    // TAILORED résumé, never the raw upload — see buildCoverLetterPrompt.
    const tailoredResume = pickTailoredResume(tailoredResumeLines, result);
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
          tailoredResume,
          templateLines: coverLetterTemplateLines,
          additionalContext,
          // DECISION: contextDocuments here is the SAME array passed to
          // tailorResume above, so the cover letter is deliberately also
          // grounded in the caller's project pages — desirable, since the
          // letter draws its substance from the same tailored résumé this
          // context helps produce. tailorHiringEmail below does NOT receive
          // contextDocuments at all (that asymmetry already existed before
          // this change; see the comment at that call site).
          contextDocuments: contextDocumentsWithProjectPages,
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
        coverLetterWarnings = Array.isArray(coverDraft.warnings) ? coverDraft.warnings : [];
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

    // Optionally generate a short hiring-team email, grounded in the same
    // tailored résumé as the cover letter (pickTailoredResume above). This is
    // a soft failure like the cover letter: an error here never fails the
    // request or blocks the résumé/cover letter from returning. Some engines
    // (external) have no way to produce one and resolve to null rather than
    // throwing — see lib/llm/engines/index.js. NOTE: the email is session
    // state only for now (no generated_emails table / persistence — that is
    // deliberately out of scope for this pass, not an oversight).
    // NOTE: unlike tailorResume/tailorCoverLetter above, this call does not
    // (and, per the pre-existing shape of this function, never did) pass
    // contextDocuments at all — the hiring email is grounded only in the
    // tailored résumé. That asymmetry predates the project-pages context
    // added in this change and is left as-is here rather than widened.
    let emailSubject = "";
    let emailResultLines = [];
    let emailError = "";
    // The hiring email's own degradation warnings, if the engine ever supplies
    // them (none does today — see the aggregation comment below — but the
    // field is read defensively so a future producer needs no route change).
    let emailWarnings = [];
    if (typeof activeEngine.tailorHiringEmail === "function") {
      try {
        const emailDraft = await activeEngine.tailorHiringEmail({
          jobPosting: effectiveJobPosting,
          jobPostingUrl: effectiveJobPostingUrl,
          companyName: scrapedCompany || result.companyName || postingMeta.companyName,
          jobTitle: result.jobTitle || scrapedJobTitle || postingMeta.jobTitle,
          resumeText,
          tailoredResume,
          additionalContext,
          persona,
          userId,
        });
        if (emailDraft) {
          emailSubject = typeof emailDraft.subject === "string" ? emailDraft.subject : "";
          emailResultLines = Array.isArray(emailDraft.bodyLines) ? emailDraft.bodyLines : [];
          emailWarnings = Array.isArray(emailDraft.warnings) ? emailDraft.warnings : [];
        }
      } catch (err) {
        console.error("Error generating hiring-team email:", err);
        emailError = `Hiring-team email generation failed: ${err.message || "unknown error"}`;
      }
    }

    // Résumé warnings stay exactly as before (engine-fallback notices, then the
    // résumé result's own warnings) — unprefixed, in this same order — so a
    // client showing them today (they all just `.filter(Boolean).join(" ")`
    // the array into one string; see useDocumentPreview.js/useManualTailor.js/
    // page.js) sees byte-identical text for a résumé-only run.
    const resumeWarnings = [...engineWarnings, ...(Array.isArray(result.warnings) ? result.warnings : [])];
    // Cover-letter / hiring-email warnings are folded in too (the actual gap
    // this fixes), each attributed with a plain "<Document>: " prefix rather
    // than a structured field — every current reader treats `warnings` as an
    // array of display-ready strings and joins them, so a prefix is the only
    // attribution scheme that reaches the user without a client change (and
    // client hooks are off-limits for this fix).
    //
    // Dedup rule: steeringInstructions, focusArea, and keywordEdits are all
    // threaded UNCHANGED into both the tailorResume and tailorCoverLetter
    // calls above, so a warning from one of those shared inputs (an unparsed
    // revision note, a focus area missing from the library, a boosted/excluded
    // term outside the taxonomy) is byte-identical across both documents when
    // it fires at all — the same underlying cause restated, not two distinct
    // problems. Such a warning is kept exactly once, in whichever unprefixed
    // form already appeared (the résumé's, by construction below) — the text
    // is already, equally true of both documents, so restating it with a
    // second prefix would tell the user nothing new. A warning that is NOT a
    // byte-for-byte duplicate (e.g. editRuleOutputs' "applied recurring
    // edit(s)" text, which reports the edits actually found in that
    // document's own text and so can legitimately differ between the two) is
    // deliberately kept separate, once per document, each attributed.
    const seenWarnings = new Set(resumeWarnings);
    const coverLetterAttributed = [];
    for (const raw of coverLetterWarnings) {
      if (!raw || seenWarnings.has(raw)) continue;
      seenWarnings.add(raw);
      coverLetterAttributed.push(`Cover letter: ${raw}`);
    }
    const emailAttributed = [];
    for (const raw of emailWarnings) {
      if (!raw || seenWarnings.has(raw)) continue;
      seenWarnings.add(raw);
      emailAttributed.push(`Hiring email: ${raw}`);
    }
    const warnings = [...resumeWarnings, ...coverLetterAttributed, ...emailAttributed];
    // Real budget, not a silent slice: buildTailorContextBlock already says so
    // inside the prompt content itself (what the model sees); this is the
    // same fact surfaced to the caller (what the response's warning needs) —
    // and, unlike the in-block notice, named: a warning that something was
    // left out without saying what gives the owner no way to act on it.
    if (projectPagesTruncated) {
      warnings.push(formatDroppedProjectPagesWarning(projectPagesDropped));
    }

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
      emailSubject,
      emailResultLines,
      emailError,
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
