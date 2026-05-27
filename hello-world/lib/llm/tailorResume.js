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
      rewriteBudget: "Rewrite at most ~20% of eligible lines, prioritizing the summary, top skills, and any project bullets clearly relevant to the posting. Leave the rest essentially identical to the source.",
      keywordPolicy: "Only insert a posting keyword when an existing line is already obviously about that topic. Never add a tool, technology, or skill that is not already implied by the source.",
      stylePolicy: "Preserve the source resume's exact wording, tone, and verb choices wherever possible.",
      summary: "Conservative — light keyword tuning only.",
    },
    2: {
      label: "Moderate",
      rewriteBudget: "Rewrite roughly 30–45% of eligible lines, focused on the summary, top skills, the 2–3 strongest experience bullets, and any project bullets relevant to the posting.",
      keywordPolicy: "Surface posting terminology in lines where the source already supports the concept. Do not introduce tools or domains that aren't already present.",
      stylePolicy: "Lean toward the original phrasing; only restructure a sentence when it clearly improves fit.",
      summary: "Targeted rewrites that respect source phrasing.",
    },
    3: {
      label: "Balanced",
      rewriteBudget: "Rewrite roughly 50–60% of eligible lines across the summary, skills, experience bullets, and project bullets.",
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
      rewriteBudget: "Rewrite every eligible line, including every project bullet. Treat the source resume as raw material rather than text to preserve.",
      keywordPolicy: "Saturate the resume with the posting's required and preferred keywords, tools, methodologies, buzzwords, and domain language. Every relevant line should reflect posting terminology. You must not fabricate employers, titles, dates, or credentials, but you should reframe real experience as aggressively as possible toward the posting.",
      stylePolicy: "Mirror the posting's voice, verbs, and structure throughout. Original phrasing is fully replaceable.",
      summary: "Maximum posting alignment.",
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
    "5) Keep each rewritten line close in length to its source line to minimize layout shifts. Exception: the headline / professional-title line directly under the candidate's name, and project name / project title lines, may each be made shorter than their source line if you judge that the shorter version aligns better with the posting — never make any of them longer than the source line.",
    "6) Do not add explanatory notes, markdown, or extra keys.",
    `7) Output JSON only in this exact shape: {\"jobTitle\": \"\", \"resultLines\": [${templateLines
      .map(() => "\"\"")
      .join(", ")}]}`,
    `8) resultLines must contain exactly ${templateLines.length} strings.`,
    "9) jobTitle must be the target role title from the posting, concise and clean (no company name, no location, no punctuation noise).",
    "10) Preserve contact identity lines (name, email, phone, LinkedIn, portfolio links) unless the line clearly is not contact info. The headline / professional-title line that typically sits directly under the candidate's name is NOT contact info — it IS in scope for rewriting, and you should rewrite it to match the target role from the posting whenever the source experience can plausibly support it.",
    "11) Do not fabricate employers, dates, degrees, certifications that are not supported by the source resume or provided context. You may update everything else as you see fit.",
    "12) Project bullets are in scope for rewriting at every aggressiveness level. Reframe each project bullet to emphasize the methodologies, tools, outcomes, and domain language most relevant to the posting, while preserving the underlying project identity (what was built and the real tech stack used). Do not invent new projects, but you may foreground different aspects of an existing project to better match the posting.",
    "13) Job titles in the work experience section may be rewritten to align with the posting, but the resulting sequence of titles must reflect upward (or at minimum non-regressing) career progression in chronological order. The most recent role must be at least as senior as every earlier role, and each subsequent role across time must be at the same level or more senior than the one before it — never less senior. Use standard seniority ordering (e.g., Intern < Junior/Associate < Mid/no-modifier < Senior < Staff/Lead < Principal < Manager/Director < VP < C-level). Do not introduce a more senior title for an earlier role than for a later role. Do not fabricate seniority the source resume cannot support (e.g., do not promote an intern role into a Senior title), and never invent management, director, or executive titles that aren't backed by the source. If aligning a title with the posting would break this progression, keep the original title instead.",
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

function buildCoverLetterTemplateLinesBlock(templateLines) {
  return templateLines
    .map((line, index) => {
      const text = line || "";
      return `${index + 1}. [chars=${text.length}] ${text}`;
    })
    .join("\n");
}

function buildCoverLetterPrompt({
  jobPosting,
  jobPostingUrl,
  companyName,
  jobTitle,
  resumeText,
  templateLines,
  additionalContext,
  contextDocuments,
}) {
  const jobPostingBlock = jobPostingUrl
    ? `Job posting URL: ${jobPostingUrl}\nFetch the full job description from this URL and use it to tailor the cover letter.`
    : `Job posting:\n${jobPosting || "Not provided."}`;
  const charBudget = templateLines.map((line) => (line || "").length);
  const totalChars = charBudget.reduce((sum, n) => sum + n, 0);

  return [
    "You are an expert cover letter writer.",
    "Rewrite the provided cover letter template so it is tailored to the target job, while strictly preserving the template's line structure, length, and rhythm.",
    "",
    "Hard constraints — these are non-negotiable:",
    `1) Output exactly ${templateLines.length} lines, in the same slot order as the template.`,
    "2) Treat blank template lines as blank in the output (used as paragraph breaks). Do not collapse or remove blank lines.",
    "3) Each output line's character count must stay within ±10% of the corresponding template line's character count. Never exceed +15%.",
    `4) Total character count must stay within ±5% of the template total (${totalChars} characters).`,
    "5) Preserve the template's salutation, paragraph structure, sign-off, and overall sentence rhythm.",
    "6) Do not introduce markdown, bullet points, headings, or extra blank lines that are not in the template.",
    "7) Do not fabricate employers, titles, degrees, certifications, dates, or achievements that are not supported by the resume or provided context.",
    "8) Replace generic placeholders (company name, role title, hiring manager) with the actual target where known; otherwise keep the template's wording.",
    `9) Output JSON only in this exact shape: {\"resultLines\": [${templateLines
      .map(() => "\"\"")
      .join(", ")}]} — no other keys, no commentary, no markdown.`,
    "",
    `Target role: ${jobTitle || "Not provided."}`,
    `Target company: ${companyName || "Not provided."}`,
    "",
    jobPostingBlock,
    "",
    `Additional context:\n${additionalContext || "None provided."}`,
    "",
    "Source resume (for factual grounding only — do not copy phrasing wholesale):",
    resumeText || "Not provided.",
    "",
    "Supporting documents:",
    buildContextDocumentsBlock(contextDocuments),
    "",
    "Cover letter template — preserve line count and character budgets:",
    buildCoverLetterTemplateLinesBlock(templateLines),
  ].join("\n");
}

function enforceCoverLetterLengths(resultLines, templateLines) {
  return resultLines.map((rawLine, idx) => {
    const template = templateLines[idx] || "";
    const targetLen = template.length;
    const line = String(rawLine || "");

    // Preserve blank slots so paragraph breaks survive.
    if (targetLen === 0) return "";

    // Cap to +15% to enforce the hard upper bound from the prompt.
    const maxLen = Math.max(targetLen + 5, Math.ceil(targetLen * 1.15));
    if (line.length <= maxLen) return line;

    // Truncate at the last word boundary before the cap to avoid mid-word cuts.
    const truncated = line.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
  });
}

export async function generateTailoredCoverLetterDraft({
  jobPosting,
  jobPostingUrl,
  companyName,
  jobTitle,
  resumeText,
  templateLines,
  additionalContext,
  contextDocuments,
}) {
  const normalizedTemplateLines = Array.isArray(templateLines)
    ? templateLines.map((line) => (typeof line === "string" ? line : ""))
    : [];

  if (normalizedTemplateLines.length === 0) {
    throw new Error("Cover letter template lines are required.");
  }

  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();
  const prompt = buildCoverLetterPrompt({
    jobPosting,
    jobPostingUrl,
    companyName,
    jobTitle,
    resumeText,
    templateLines: normalizedTemplateLines,
    additionalContext,
    contextDocuments,
  });

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: prompt,
    // urlContext tool isn't compatible with response_mime_type, so only force
    // JSON when we are not also fetching a URL.
    ...(jobPostingUrl
      ? { tools: [{ urlContext: {} }] }
      : { config: { responseMimeType: "application/json" } }),
  });

  const output = response.text?.trim() || "";
  if (!output) {
    throw new Error("Gemini returned an empty cover letter response.");
  }
  if (process.env.NODE_ENV !== "production") {
    console.log("[cover-letter] raw output:", output.slice(0, 400));
  }

  const parsed = parseStructuredResult(output, normalizedTemplateLines.length);
  const hasContent = parsed.resultLines.some((line) => line && line.trim().length > 0);
  if (!hasContent) {
    throw new Error("Cover letter response did not contain any usable lines.");
  }
  const enforced = enforceCoverLetterLengths(parsed.resultLines, normalizedTemplateLines);

  return {
    result: enforced.join("\n").trim(),
    resultLines: enforced,
  };
}