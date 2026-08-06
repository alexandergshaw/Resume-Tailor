import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { nextPracticeQuestion } from "@/lib/copilot/practiceQuestions";
import { normalizeQuestion } from "@/lib/copilot/questions";
import {
  normalizeInterviewType,
  interviewType as getInterviewType,
} from "@/lib/copilot/interviewTypes";

const SYSTEM = [
  "You are an interviewer conducting a mock interview practice session with a candidate.",
  "Given the job posting details, the requested interview format, and the questions already asked this session, produce exactly ONE next interview question that fits the requested format.",
  "Never repeat a question already asked, even reworded.",
  "Keep it to a single sentence a real interviewer would say out loud.",
].join(" ");

const MAX_TITLE_CHARS = 200;
const MAX_COMPANY_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 6000;
const MAX_ASKED = 40;
const MAX_ASKED_CHARS = 300;
const VALID_TYPES = ["behavioral", "technical", "general"];

// A missing or malformed posting is not an error — it just means a generic
// session, so this returns null rather than throwing.
function sanitizePosting(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? "").trim().slice(0, MAX_TITLE_CHARS);
  const company = String(raw.company ?? "").trim().slice(0, MAX_COMPANY_CHARS);
  const description = String(raw.description ?? "").trim().slice(0, MAX_DESCRIPTION_CHARS);
  if (!title && !company && !description) return null;
  return { title, company, description };
}

function sanitizeAsked(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((q) => typeof q === "string")
    .map((q) => q.trim().slice(0, MAX_ASKED_CHARS))
    .filter(Boolean)
    // The caller appends newest-last, so the questions most likely to be
    // repeated are at the end — cap by keeping the most recent entries, not
    // the oldest ones.
    .slice(-MAX_ASKED);
}

function typeOrDefault(type) {
  return VALID_TYPES.includes(type) ? type : "general";
}

function fallbackResponse(posting, asked, interviewType) {
  const fallback = nextPracticeQuestion({ posting, asked, interviewType });
  return Response.json({
    question: fallback.question,
    type: typeOrDefault(fallback.type),
    source: "fallback",
    exhausted: !!fallback.exhausted,
  });
}

function buildPrompt(posting, asked, descriptor) {
  const parts = [
    `Interview format: ${descriptor.label}`,
    descriptor.guidance,
    "Every question you generate must fit this format.",
  ];
  if (posting?.title || posting?.company) {
    parts.push("", `Role: ${[posting.title, posting.company].filter(Boolean).join(" at ")}`);
  }
  if (posting?.description) {
    parts.push("", "Job posting description:", posting.description);
  }
  if (asked.length) {
    parts.push(
      "",
      "Questions already asked this session (never repeat these):",
      asked.map((q) => `- ${q}`).join("\n"),
    );
  }
  parts.push(
    "",
    'Return ONLY JSON of this exact shape: { "question": string, "type": "behavioral" | "technical" | "general" }',
  );
  return parts.join("\n");
}

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user } = {},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return Response.json(
        { error: "Sign in to use the interview copilot." },
        { status: 401 },
      );
    }

    const body = await request.json();
    const posting = sanitizePosting(body?.posting);
    const asked = sanitizeAsked(body?.asked);
    const interviewType = normalizeInterviewType(body?.interviewType);

    // Embedded engine: pull from the deterministic question bank — no LLM.
    if (wantsEmbedded(body?.engine)) {
      const result = nextPracticeQuestion({ posting, asked, interviewType });
      return Response.json({
        question: result.question,
        type: typeOrDefault(result.type),
        source: "embedded",
        exhausted: !!result.exhausted,
      });
    }

    // A practice session must not dead-end on a model hiccup: any failure to
    // get a fresh, unasked question from Gemini falls back to the
    // deterministic bank, and the fallback is reported rather than silent.
    try {
      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const descriptor = getInterviewType(interviewType);
      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: buildPrompt(posting, asked, descriptor) }] }],
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
      });

      const parsed = parseModelJson(response.text?.trim() || "");
      const question = typeof parsed?.question === "string" ? parsed.question.trim() : "";
      // `asked` entries were capped to MAX_ASKED_CHARS by sanitizeAsked;
      // compare like with like so a long repeated question isn't missed
      // just because the model's raw text is longer than the stored entry.
      const questionForCompare = question.slice(0, MAX_ASKED_CHARS);
      const alreadyAsked = asked.some(
        (q) => normalizeQuestion(q) === normalizeQuestion(questionForCompare),
      );

      if (!question || alreadyAsked) {
        return fallbackResponse(posting, asked, interviewType);
      }

      return Response.json({
        question,
        type: typeOrDefault(parsed?.type),
        source: "gemini",
        exhausted: false,
      });
    } catch {
      return fallbackResponse(posting, asked, interviewType);
    }
  } catch (err) {
    return Response.json(
      { error: err?.message || "Question request failed." },
      { status: 500 },
    );
  }
}
