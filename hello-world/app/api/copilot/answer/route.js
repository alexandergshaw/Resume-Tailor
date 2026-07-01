import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { draftAnswerLocal } from "@/lib/copilot/answerLocal";

const SYSTEM = [
  "You are an interview coach helping a candidate answer questions during a LIVE interview.",
  "Given the question the interviewer just asked, produce concise talking points the candidate can glance at and speak from — NOT a script to read aloud.",
  "Return 3-5 short bullet points; each is one phrase or short sentence, specific and substantive.",
  "When a CANDIDATE BACKGROUND section is provided, ground the points in it — reference their real companies, projects, metrics, and skills rather than inventing generic ones. Never fabricate experience the background does not support; if it is thin, give strong generic points instead.",
  "For behavioral questions (\"tell me about a time...\"), prefix each point with its STAR label — \"Situation:\", \"Task:\", \"Action:\", \"Result:\".",
  "Keep every point skimmable — a person on camera must absorb it in a glance.",
].join(" ");

const MAX_CONTEXT_CHARS = 4000;
const MAX_PROFILE_CHARS = 8000;
const VALID_TYPES = ["behavioral", "technical", "general"];

function buildPrompt(question, context, profile) {
  const parts = [`The interviewer asked: "${question}"`];
  if (profile) {
    parts.push(
      "",
      "--- CANDIDATE BACKGROUND (their resume / target role / prep notes; use to personalize) ---",
      profile,
    );
  }
  if (context) {
    parts.push("", "Recent conversation (most recent last), for context:", context);
  }
  parts.push(
    "",
    'Return ONLY JSON of this exact shape: { "points": string[], "type": "behavioral" | "technical" | "general" }',
    "points: 3-5 concise talking points as described above.",
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
    const question = (body?.question ?? "").toString().trim();
    if (!question) {
      return Response.json({ error: "No question provided." }, { status: 400 });
    }
    const context = (body?.context ?? "").toString().slice(0, MAX_CONTEXT_CHARS);
    const profile = (body?.profile ?? "").toString().slice(0, MAX_PROFILE_CHARS);

    // Embedded engine: assemble grounded talking points on-device — no LLM.
    if (wantsEmbedded(body?.engine)) {
      const { points, type } = draftAnswerLocal({ question, profile });
      if (points.length === 0) {
        return Response.json({ error: "Could not generate an answer." }, { status: 502 });
      }
      return Response.json({ points, type });
    }

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: buildPrompt(question, context, profile) }] }],
      config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
    });

    const parsed = parseModelJson(response.text?.trim() || "");
    const points = Array.isArray(parsed?.points)
      ? parsed.points
          .filter((p) => typeof p === "string" && p.trim())
          .map((p) => p.trim())
          .slice(0, 6)
      : [];
    if (points.length === 0) {
      return Response.json({ error: "Could not generate an answer." }, { status: 502 });
    }
    const type = VALID_TYPES.includes(parsed?.type) ? parsed.type : "general";

    return Response.json({ points, type });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Answer request failed." },
      { status: 500 },
    );
  }
}
