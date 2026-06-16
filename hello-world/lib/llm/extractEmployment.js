import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";

// AI-backed extraction of a candidate's employment history from résumé text.
// The pure helpers (parseModelJson / sanitizeExtractedPositions) are exported
// so the structured-output handling can be unit-tested without calling Gemini.

const MAX_RESUME_CHARS = 20000;

function cleanString(value, max = 300) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanNotes(value, max = 2000) {
  let text = value;
  if (Array.isArray(text)) {
    text = text.filter((line) => typeof line === "string").join("\n");
  }
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, max);
}

// Coerce a model response into a clean array of employment entries. Accepts
// either a bare array or an object with a `positions` array; drops entries that
// have neither a company nor a title; caps the count.
export function sanitizeExtractedPositions(raw, { maxEntries = 4 } = {}) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.positions)
      ? raw.positions
      : [];

  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const company = cleanString(item.company ?? item.employer, 200);
    const title = cleanString(item.title ?? item.role ?? item.position, 200);
    if (!company && !title) continue;
    out.push({
      company,
      title,
      location: cleanString(item.location, 200),
      startDate: cleanString(item.startDate ?? item.start, 60),
      endDate: cleanString(item.endDate ?? item.end, 60),
      notes: cleanNotes(item.notes ?? item.description ?? item.responsibilities, 2000),
    });
    if (out.length >= maxEntries) break;
  }
  return out;
}

// Parse a model's text output into JSON, tolerating code fences or surrounding
// prose. Returns null when nothing parseable is found.
export function parseModelJson(text) {
  if (!text || typeof text !== "string") return null;
  let body = text.trim();
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();
  try {
    return JSON.parse(body);
  } catch {
    // ignore and try to recover a JSON block below
  }
  const block = body.match(/[[{][\s\S]*[\]}]/);
  if (block) {
    try {
      return JSON.parse(block[0]);
    } catch {
      return null;
    }
  }
  return null;
}

function buildPrompt(resumeText) {
  return [
    "You are a precise résumé parser. Extract the candidate's paid employment / work history from the RESUME below.",
    "",
    "Return ONLY a JSON object of this exact shape:",
    '{ "positions": [ { "company": string, "title": string, "location": string, "startDate": string, "endDate": string, "notes": string } ] }',
    "",
    "Rules:",
    "- Include only real jobs. Exclude education, personal projects, skills, certifications, and volunteer work unless it is clearly paid employment.",
    "- title = the job title; company = the employer name.",
    '- location = city and state/country, or "Remote"; use "" if not stated.',
    '- startDate / endDate = exactly as written in the résumé (e.g. "Jan 2020"); use "Present" for current roles; use "" if unknown.',
    '- notes = a concise summary of responsibilities / achievements for that role; join multiple bullet points with newlines; use "" if none.',
    "- List the most recent position first. Never invent information that is not in the résumé.",
    '- If there is no employment history, return { "positions": [] }.',
    "",
    "RESUME:",
    resumeText,
  ].join("\n");
}

// Call Gemini to extract employment entries from résumé text.
export async function extractEmploymentFromResumeText(resumeText, { maxEntries = 4 } = {}) {
  const text =
    typeof resumeText === "string" ? resumeText.slice(0, MAX_RESUME_CHARS).trim() : "";
  if (!text) return [];

  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: buildPrompt(text),
    config: { responseMimeType: "application/json" },
  });

  const output = response.text?.trim() || "";
  if (!output) throw new Error("Gemini returned an empty response.");

  return sanitizeExtractedPositions(parseModelJson(output), { maxEntries });
}
