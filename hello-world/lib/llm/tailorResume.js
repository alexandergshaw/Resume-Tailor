import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

function buildTailorPrompt({ jobPosting, resumeText, resumeFileName }) {
  return [
    "You are an expert resume writer.",
    "Create a tailored resume draft based on the job posting and resume content.",
    "Respond with:",
    "1) A concise professional summary",
    "2) Key skill bullets aligned to the role",
    "3) Revised experience bullets using strong action verbs",
    "4) A short gap analysis with missing keywords",
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