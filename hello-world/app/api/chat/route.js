import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

const SYSTEM_PROMPT = [
  "You are a concise, friendly career assistant inside the Resume Tailor app.",
  "Help the user with resume writing, job search strategy, interview prep, and using this tool.",
  "Answer briefly. Use plain language. No markdown headings unless asked.",
  "When the user has uploaded a resume or has applications, use that context to give specific, personalized advice.",
  "Reference specific companies, roles, or resume bullets from the provided context when relevant.",
].join(" ");

const MAX_RESUME_CHARS = 12000;
const MAX_APPLICATIONS = 25;
const MAX_JD_CHARS = 1500;
const MAX_TAILORED_CHARS = 2000;

function truncate(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function buildContextBlock(resumeText, applications) {
  const parts = [];

  if (typeof resumeText === "string" && resumeText.trim()) {
    parts.push(
      `--- USER'S UPLOADED RESUME ---\n${truncate(resumeText.trim(), MAX_RESUME_CHARS)}`,
    );
  }

  if (Array.isArray(applications) && applications.length > 0) {
    const limited = applications.slice(0, MAX_APPLICATIONS);
    const rendered = limited.map((app, idx) => {
      const lines = [];
      lines.push(`Application ${idx + 1}:`);
      if (app.company) lines.push(`  Company: ${app.company}`);
      if (app.role) lines.push(`  Role: ${app.role}`);
      if (app.status) lines.push(`  Status: ${app.status}`);
      if (app.appliedAt) lines.push(`  Applied: ${app.appliedAt}`);
      if (app.applicationUrl) lines.push(`  URL: ${app.applicationUrl}`);
      if (app.jobDescription) {
        lines.push(`  Job Description: ${truncate(app.jobDescription, MAX_JD_CHARS)}`);
      }
      if (app.tailoredResume) {
        lines.push(`  Tailored Resume: ${truncate(app.tailoredResume, MAX_TAILORED_CHARS)}`);
      }
      if (Array.isArray(app.stages) && app.stages.length > 0) {
        const stageStrs = app.stages.map((s) => {
          const bits = [];
          if (s.name) bits.push(s.name);
          else if (s.type) bits.push(s.type);
          if (s.scheduledAt) bits.push(`@ ${s.scheduledAt}`);
          if (s.outcome && s.outcome !== "pending") bits.push(`(${s.outcome})`);
          return bits.join(" ");
        }).filter(Boolean);
        if (stageStrs.length > 0) {
          lines.push(`  Interview Stages: ${stageStrs.join("; ")}`);
        }
      }
      return lines.join("\n");
    });
    parts.push(`--- USER'S APPLICATIONS ---\n${rendered.join("\n\n")}`);
  }

  return parts.join("\n\n");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const resumeText = typeof body?.resumeText === "string" ? body.resumeText : "";
    const applications = Array.isArray(body?.applications) ? body.applications : [];

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

    const contextBlock = buildContextBlock(resumeText, applications);
    const systemInstruction = contextBlock
      ? `${SYSTEM_PROMPT}\n\nContext about this user (do not repeat verbatim; use to personalize answers):\n${contextBlock}`
      : SYSTEM_PROMPT;

    const response = await client.models.generateContent({
      model: geminiModel,
      contents,
      config: {
        systemInstruction,
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
