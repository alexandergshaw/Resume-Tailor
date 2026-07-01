import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

const SYSTEM = [
  "You classify the interviewer's latest utterance during a LIVE job interview.",
  "Decide whether it is a question or an explicit request that the CANDIDATE should answer out loud.",
  "NOT questions: greetings, acknowledgements (\"great\", \"makes sense\", \"got it\"), the interviewer describing the company/role/logistics, and the interviewer answering the candidate's own question.",
  "If it IS a question/request, extract the core ask as a single clean, self-contained sentence (fix transcription artifacts, drop filler).",
  "Classify type as behavioral, technical, or general.",
].join(" ");

const MAX_UTTERANCE_CHARS = 1200;
const MAX_CONTEXT_CHARS = 2000;
const VALID_TYPES = ["behavioral", "technical", "general"];

function buildPrompt(utterance, context) {
  const parts = [];
  if (context) {
    parts.push("Recent conversation (most recent last):", context, "");
  }
  parts.push(
    `Latest interviewer utterance: "${utterance}"`,
    "",
    'Return ONLY JSON of this exact shape: { "isQuestion": boolean, "question": string, "type": "behavioral" | "technical" | "general" }',
    'If isQuestion is false, set "question" to "" and "type" to "general".',
  );
  return parts.join("\n");
}

export async function POST(request) {
  try {
    const { geminiModel } = getServerEnv();

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
    const utterance = (body?.utterance ?? "").toString().trim().slice(0, MAX_UTTERANCE_CHARS);
    if (!utterance) {
      return Response.json({ error: "No utterance provided." }, { status: 400 });
    }
    const context = (body?.context ?? "").toString().slice(0, MAX_CONTEXT_CHARS);

    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: buildPrompt(utterance, context) }] }],
      config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
    });

    const parsed = parseModelJson(response.text?.trim() || "") || {};
    const isQuestion = parsed.isQuestion === true;
    const question =
      isQuestion && typeof parsed.question === "string" && parsed.question.trim()
        ? parsed.question.trim()
        : "";
    const type = VALID_TYPES.includes(parsed.type) ? parsed.type : "general";

    return Response.json({ isQuestion: isQuestion && !!question, question, type });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Detection request failed." },
      { status: 500 },
    );
  }
}
