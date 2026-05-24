import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

function buildTailorPrompt({ jobPosting, resumeText, resumeFileName }) {
  return [
    "You are an expert resume editor.",
    "Rewrite the resume to match the job posting while preserving the source resume layout as closely as possible.",
    "",
    "Hard constraints:",
    "1) Keep the exact section order, heading style, capitalization, and punctuation pattern from the original resume.",
    "2) Keep line-break rhythm, indentation, and bullet style consistent with the original resume.",
    "3) Keep date/location formatting and overall positioning conventions consistent with the original resume.",
    "4) Do not add explanatory notes, JSON, markdown fences, or commentary.",
    "5) Return only the final revised resume text.",
    "",
    "Content goals:",
    "1) Tailor wording and accomplishments to the job posting keywords.",
    "2) Preserve truthful information from the original resume.",
    "3) Improve impact and relevance without inventing facts.",
    "",
    `Job posting:\n${jobPosting}`,
    "",
    `Resume file name: ${resumeFileName || "Not provided"}`,
    `Resume content:\n${resumeText || "Not provided"}`,
  ].join("\n");
}

export async function generateTailoredResumeDraft({
  jobPosting,
  resumeText,
  resumeFileName,
}) {
  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();
  const prompt = buildTailorPrompt({ jobPosting, resumeText, resumeFileName });

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: prompt,
  });

  const output = response.text?.trim();

  if (!output) {
    throw new Error("Gemini returned an empty response.");
  }

  return output;
}