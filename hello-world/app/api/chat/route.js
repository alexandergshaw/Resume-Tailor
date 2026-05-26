import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

const SYSTEM_PROMPT = [
  "You are a concise, friendly career assistant inside the Resume Tailor app.",
  "Help the user with resume writing, job search strategy, interview prep, and using this tool.",
  "Answer briefly. Use plain language. No markdown headings unless asked.",
].join(" ");

export async function POST(request) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    if (messages.length === 0) {
      return Response.json({ error: "No messages provided." }, { status: 400 });
    }

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();

    const contents = messages
      .filter((m) => m && typeof m.content === "string" && m.content.trim())
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const response = await client.models.generateContent({
      model: geminiModel,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
    });

    const reply = response.text?.trim() || "";

    if (!reply) {
      return Response.json({ error: "Empty response from Gemini." }, { status: 502 });
    }

    return Response.json({ reply });
  } catch (err) {
    return Response.json({ error: err?.message || "Chat request failed." }, { status: 500 });
  }
}
