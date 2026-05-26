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

function getAggressivenessConfig(aggressiveness) {
  const normalized = Math.min(5, Math.max(1, Number.parseInt(aggressiveness, 10) || 3));

  const configs = {
    1: {
      label: "Light",
      rewriteBudget: "Rewrite at most ~20% of eligible lines. Leave the rest essentially identical to the source.",
      keywordPolicy: "Only insert a posting keyword when an existing line is already obviously about that topic. Never add a tool, technology, or skill that is not already implied by the source.",
      stylePolicy: "Preserve the source resume's exact wording, tone, and verb choices wherever possible.",
      summary: "Conservative — light keyword tuning only.",
    },
    2: {
      label: "Moderate",
      rewriteBudget: "Rewrite roughly 30–45% of eligible lines, focused on the summary, top skills, and the 2–3 strongest experience bullets.",
      keywordPolicy: "Surface posting terminology in lines where the source already supports the concept. Do not introduce tools or domains that aren't already present.",
      stylePolicy: "Lean toward the original phrasing; only restructure a sentence when it clearly improves fit.",
      summary: "Targeted rewrites that respect source phrasing.",
    },
    3: {
      label: "Balanced",
      rewriteBudget: "Rewrite roughly 50–60% of eligible lines across the summary, skills, and experience bullets.",
      keywordPolicy: "Adopt the posting's exact terminology in relevant lines. You may surface adjacent skills the source supports, but do not invent tools or experiences.",
      stylePolicy: "Mix source fidelity with posting alignment. Restructure sentences when it produces a meaningfully stronger match.",
      summary: "Even balance between source fidelity and job alignment.",
    },
    4: {
      label: "Assertive",
      rewriteBudget: "Rewrite roughly 70–85% of eligible lines. Aggressively reframe the summary, skills, projects, and experience bullets around the target role.",
      keywordPolicy: "Inject every important posting keyword, tool, and domain term into a relevant line, as long as the source resume can plausibly back it up. Reframe adjacent experience to use the posting's language.",
      stylePolicy: "Heavily prefer the posting's wording, structure, and verbs over the source's. Posting alignment outranks preserving original phrasing.",
      summary: "Aggressive posting-led rewrite, source phrasing largely replaced.",
    },
    5: {
      label: "Strong",
      rewriteBudget: "Rewrite every eligible line. Treat the source resume as raw material rather than text to preserve.",
      keywordPolicy: "Saturate the resume with the posting's required and preferred keywords, tools, methodologies, and domain language. Every relevant line should reflect posting terminology. You must not fabricate employers, titles, dates, or credentials, but you should reframe real experience as aggressively as possible toward the posting.",
      stylePolicy: "Mirror the posting's voice, verbs, and structure throughout. Original phrasing is fully replaceable.",
      summary: "Maximum posting alignment short of fabrication.",
    },
  };

  return {
    level: normalized,
    ...configs[normalized],
  };
}

function buildTailorPrompt({
  jobPosting,
  jobPostingUrl,
  resumeText,
  resumeFileName,
  templateLines,
  additionalContext,
  aggressiveness,
  contextDocuments,
}) {
  const aggressivenessConfig = getAggressivenessConfig(aggressiveness);
  const jobPostingBlock = jobPostingUrl
    ? `Job posting URL: ${jobPostingUrl}\nFetch the full job description from this URL and use it to tailor the resume.`
    : `Job posting:\n${jobPosting}`;
  return [
    "You are an expert resume editor.",
    `Rewrite the resume to match the job posting with aggressiveness level ${aggressivenessConfig.level}/5 (${aggressivenessConfig.label}) while preserving the source resume layout exactly.`,
    `Aggressiveness summary: ${aggressivenessConfig.summary}`,
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
    "11) Do not fabricate employers, titles, dates, degrees, tools, certifications, or achievements that are not supported by the source resume or provided context.",
    "",
    `Aggressiveness directives for level ${aggressivenessConfig.level}/5 (${aggressivenessConfig.label}) — follow these strictly:`,
    `A) Rewrite budget: ${aggressivenessConfig.rewriteBudget}`,
    `B) Keyword policy: ${aggressivenessConfig.keywordPolicy}`,
    `C) Style policy: ${aggressivenessConfig.stylePolicy}`,
    "D) Internally self-check that your output reflects the chosen aggressiveness level before finalizing. If level is 1–2, the diff against the source resume should be small and targeted. If level is 4–5, most eligible lines should be visibly reworded around the posting.",
    "",
    jobPostingBlock,
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
      return {
        resultLines: fitLinesToCount(
          Array.isArray(parsed.resultLines)
            ? parsed.resultLines.map((line) => String(line || ""))
            : [],
          targetCount,
        ),
        jobTitle: typeof parsed.jobTitle === "string" ? parsed.jobTitle.trim() : "",
      };
    } catch {
      // Fall through to line-based parsing.
    }
  }

  const lineEntries = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colonMatch = line.match(/^\d+[:.)-]\s*(.*)$/);
      if (colonMatch) {
        return colonMatch[1];
      }

      return line;
    });

  return {
    resultLines: fitLinesToCount(lineEntries, targetCount),
    jobTitle: "",
  };
}

export async function generateTailoredResumeDraft({
  jobPosting,
  jobPostingUrl,
  resumeText,
  resumeFileName,
  templateLines,
  additionalContext,
  aggressiveness,
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
    jobPostingUrl,
    resumeText,
    resumeFileName,
    templateLines: normalizedTemplateLines,
    additionalContext,
    aggressiveness,
    contextDocuments,
  });

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: prompt,
    ...(jobPostingUrl ? { tools: [{ urlContext: {} }] } : {}),
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