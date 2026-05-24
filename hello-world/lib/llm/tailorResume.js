import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

function buildTemplateLinesBlock(templateLines) {
  return templateLines
    .map((line, index) => `${index + 1}. ${line || ""}`)
    .join("\n");
}

function buildContextDocumentsBlock(contextDocuments) {
  if (!Array.isArray(contextDocuments) || contextDocuments.length === 0) {
    return "None provided.";
  }

  return contextDocuments
    .map((document, index) => {
      return [
        `Document ${index + 1}: ${document.name || "Unnamed file"}`,
        document.content || "No extractable content.",
      ].join("\n");
    })
    .join("\n\n");
}

function buildTailorPrompt({
  jobPosting,
  resumeText,
  resumeFileName,
  templateLines,
  additionalContext,
  contextDocuments,
}) {
  return [
    "You are an expert resume editor.",
    "Rewrite the resume to match the job posting as aggressively as possible while preserving the source resume layout exactly.",
    "",
    "Hard constraints:",
    "1) Keep the exact section order, heading style, capitalization, and punctuation pattern from the original resume.",
    "2) Keep line-break rhythm, indentation, and bullet style consistent with the original resume.",
    "3) Keep date/location formatting and overall positioning conventions consistent with the original resume.",
    "4) Rewrite each line slot in order without changing slot count.",
    "5) Keep each rewritten line close in length to its source line to minimize layout shifts.",
    "6) Do not add explanatory notes, markdown, or extra keys.",
    `7) Output JSON only in this exact shape: {\"jobTitle\": \"\", \"resultLines\": [${templateLines
      .map(() => "\"\"")
      .join(", ")}]}`,
    `8) resultLines must contain exactly ${templateLines.length} strings.`,
    "9) jobTitle must be the target role title from the posting, concise and clean (no company name, no location, no punctuation noise).",
    "10) Preserve contact identity lines (name, email, phone, LinkedIn, portfolio links) unless the line clearly is not contact info.",
    "",
    "Aggressive optimization goals:",
    "1) Maximize semantic overlap with the job posting using the posting's exact terminology.",
    "2) Rewrite titles, professional summary, skills, projects, and experience bullets to mirror the target role language.",
    "3) Inject missing required tools, technologies, and domain keywords from the posting into the most relevant line slots.",
    "4) Prioritize posting alignment over preserving original phrasing.",
    "5) Keep output realistic and coherent as a resume.",
    "6) Internally self-check that major required keywords from the posting appear across resultLines before final output.",
    "7) Frame every experience bullet and summary line around concrete outcomes and goals achieved — lead with measurable results, impact, or improvements delivered rather than duties performed.",
    "8) Prefer action-result constructions: what was done AND what it produced (e.g. 'Reduced latency 40% by refactoring pipeline' over 'Responsible for pipeline maintenance').",
    "",
    `Job posting:\n${jobPosting}`,
    "",
    `Additional context:\n${additionalContext || "None provided."}`,
    "",
    `Resume file name: ${resumeFileName || "Not provided"}`,
    `Resume content:\n${resumeText || "Not provided"}`,
    "",
    "Supporting documents:",
    buildContextDocumentsBlock(contextDocuments),
    "",
    "Line slots to rewrite:",
    buildTemplateLinesBlock(templateLines),
  ].join("\n");
}

function fitLinesToCount(lines, targetCount) {
  if (targetCount <= 0) {
    return [];
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return new Array(targetCount).fill("");
  }

  if (lines.length < targetCount) {
    return [...lines, ...new Array(targetCount - lines.length).fill("")];
  }

  if (lines.length > targetCount) {
    return lines.slice(0, targetCount);
  }

  return lines;
}

function parseStructuredResult(rawText, targetCount) {
  if (!rawText) {
    return {
      resultLines: new Array(targetCount).fill(""),
      jobTitle: "",
    };
  }

  const directJsonMatch = rawText.match(/\{[\s\S]*\}/);

  if (directJsonMatch) {
    try {
      const parsed = JSON.parse(directJsonMatch[0]);
      if (Array.isArray(parsed.resultLines)) {
        return {
          resultLines: fitLinesToCount(
            parsed.resultLines.map((line) => (typeof line === "string" ? line : "")),
            targetCount,
          ),
          jobTitle: typeof parsed.jobTitle === "string" ? parsed.jobTitle.trim() : "",
        };
      }
    } catch {
      // Fall through to line-based fallback parsing.
    }
  }

  return {
    resultLines: fitLinesToCount(
      rawText
        .trim()
        .split("\n")
        .map((line) => line.trimEnd()),
      targetCount,
    ),
    jobTitle: "",
  };
}

function buildCoverLetterPrompt({
  jobPosting,
  coverLetterText,
  coverLetterFileName,
  templateLines,
  resumeText,
  additionalContext,
}) {
  return [
    "You are an expert cover letter writer.",
    "Rewrite the cover letter to aggressively target the job posting while preserving the original letter's structure exactly.",
    "",
    "Hard constraints:",
    "1) Keep the exact line count — output exactly the same number of lines as the original.",
    "2) Preserve paragraph breaks, greeting, and closing line positions from the original.",
    "3) Keep each rewritten line close in length to its corresponding source line.",
    "4) Do not add markdown, explanatory notes, or extra keys.",
    `5) Output JSON only in this exact shape: {\"coverLetterLines\": [${templateLines.map(() => '""').join(", ")}]}`,
    `6) coverLetterLines must contain exactly ${templateLines.length} strings.`,
    "7) Preserve contact/header identity lines (name, date, address, salutation recipient) unless clearly not identity info.",
    "",
    "Aggressive optimization goals:",
    "1) Rewrite body paragraphs to mirror the job posting's exact terminology and required skills.",
    "2) Demonstrate enthusiasm and specific alignment with the role across every body paragraph.",
    "3) Inject required tools, technologies, and domain keywords from the posting into relevant lines.",
    "4) Make the letter sound confident, direct, and tailored — not generic.",
    "5) Internally verify that major required keywords from the posting appear in the output before finalizing.",
    "6) Ground every claim in concrete outcomes and goals achieved — cite specific results, improvements, or impact delivered rather than listing responsibilities.",
    "7) Structure body paragraphs around the pattern: situation → action → outcome, keeping the outcome as the focal point.",
    "",
    `Job posting:\n${jobPosting}`,
    "",
    `Additional context:\n${additionalContext || "None provided."}`,
    "",
    `Resume content (for background):\n${resumeText ? resumeText.slice(0, 4000) : "Not provided."}`,
    "",
    `Cover letter file name: ${coverLetterFileName || "Not provided"}`,
    `Original cover letter content:\n${coverLetterText || "Not provided"}`,
    "",
    "Line slots to rewrite:",
    buildTemplateLinesBlock(templateLines),
  ].join("\n");
}

function parseCoverLetterResult(rawText, targetCount) {
  if (!rawText) {
    return new Array(targetCount).fill("");
  }

  const directJsonMatch = rawText.match(/\{[\s\S]*\}/);

  if (directJsonMatch) {
    try {
      const parsed = JSON.parse(directJsonMatch[0]);
      if (Array.isArray(parsed.coverLetterLines)) {
        return fitLinesToCount(
          parsed.coverLetterLines.map((line) => (typeof line === "string" ? line : "")),
          targetCount,
        );
      }
    } catch {
      // Fall through to line-based fallback.
    }
  }

  return fitLinesToCount(
    rawText.trim().split("\n").map((line) => line.trimEnd()),
    targetCount,
  );
}

export async function generateTailoredCoverLetterDraft({
  jobPosting,
  coverLetterText,
  coverLetterFileName,
  templateLines,
  resumeText,
  additionalContext,
}) {
  const normalizedTemplateLines = Array.isArray(templateLines)
    ? templateLines.filter((line) => typeof line === "string")
    : [];

  if (normalizedTemplateLines.length === 0) {
    throw new Error("Cover letter template lines are required.");
  }

  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();
  const prompt = buildCoverLetterPrompt({
    jobPosting,
    coverLetterText,
    coverLetterFileName,
    templateLines: normalizedTemplateLines,
    resumeText,
    additionalContext,
  });

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: prompt,
  });

  const output = response.text?.trim() || "";

  if (!output) {
    throw new Error("Gemini returned an empty response for the cover letter.");
  }

  return {
    coverLetterLines: parseCoverLetterResult(output, normalizedTemplateLines.length),
  };
}

export async function generateTailoredResumeDraft({
  jobPosting,
  resumeText,
  resumeFileName,
  templateLines,
  additionalContext,
  contextDocuments,
}) {
  const normalizedTemplateLines = Array.isArray(templateLines)
    ? templateLines.filter((line) => typeof line === "string")
    : [];

  if (normalizedTemplateLines.length === 0) {
    throw new Error("Template lines are required to preserve resume layout fidelity.");
  }

  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();
  const prompt = buildTailorPrompt({
    jobPosting,
    resumeText,
    resumeFileName,
    templateLines: normalizedTemplateLines,
    additionalContext,
    contextDocuments,
  });

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: prompt,
  });

  const output = response.text?.trim() || "";
  const parsedResult = parseStructuredResult(output, normalizedTemplateLines.length);
  const resultLines = parsedResult.resultLines;
  const result = resultLines.join("\n").trim();

  if (!output) {
    throw new Error("Gemini returned an empty response.");
  }

  return {
    result,
    resultLines,
    jobTitle: parsedResult.jobTitle,
  };
}