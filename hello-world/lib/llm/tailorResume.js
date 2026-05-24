import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

function buildTemplateLinesBlock(templateLines) {
  return templateLines
    .map((line, index) => `${index + 1}. ${line || ""}`)
    .join("\n");
}

function buildTailorPrompt({ jobPosting, resumeText, resumeFileName, templateLines }) {
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
    "",
    `Job posting:\n${jobPosting}`,
    "",
    `Resume file name: ${resumeFileName || "Not provided"}`,
    `Resume content:\n${resumeText || "Not provided"}`,
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

export async function generateTailoredResumeDraft({
  jobPosting,
  resumeText,
  resumeFileName,
  templateLines,
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