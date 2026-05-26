import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { extractUrls, fetchUrlContent } from "@/lib/scrape/fetchUrlContent";

const SYSTEM_PROMPT = [
  "You are a concise, friendly career assistant inside the Resume Tailor app.",
  "Help the user with resume writing, job search strategy, interview prep, and using this tool.",
  "Answer briefly. Use plain language. No markdown headings unless asked.",
  "When the user has uploaded a resume or has applications, use that context to give specific, personalized advice.",
  "Reference specific companies, roles, or resume bullets from the provided context when relevant.",
  "If the user pastes a URL in their message, the page contents are fetched server-side and provided to you under '--- FETCHED URLS ---'. Use that fetched text instead of saying you cannot open links.",
  "The '--- PINNED CONTEXT ---' block is the user's currently-selected subject (typically a job posting they just clicked 'Ask AI' on). Treat any text after a 'Description:' header inside it as the authoritative job description and answer questions about that description directly. If the pinned context references a URL, the fetched page content for that URL appears under '--- FETCHED URLS ---' and should be treated as the job description as well. Never tell the user you do not have access to the job description when a pinned context or fetched URL is present — instead answer using whatever description text is provided, and only if the description text is literally empty say something like 'the posting did not include a description; here is what I can infer from the title/company'.",
].join(" ");

const MAX_RESUME_CHARS = 12000;
const MAX_APPLICATIONS = 25;
const MAX_JD_CHARS = 1500;
const MAX_TAILORED_CHARS = 2000;
const MAX_ATTACHED_FILES = 10;
const MAX_ATTACHED_CHARS = 8000;
const MAX_FETCHED_URLS = 3;
const MAX_FETCHED_URL_CHARS = 8000;

function truncate(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function buildContextBlock(resumeText, applications, pinnedContext, attachedFiles, fetchedUrls) {
  const parts = [];

  if (pinnedContext && typeof pinnedContext.content === "string" && pinnedContext.content.trim()) {
    const label = (typeof pinnedContext.label === "string" && pinnedContext.label.trim()) || "Pinned Context";
    parts.push(
      `--- PINNED CONTEXT (user just clicked "Ask AI" on this; treat as the primary subject of the question) ---\n[${label}]\n${truncate(pinnedContext.content.trim(), MAX_RESUME_CHARS)}`,
    );
  }

  if (Array.isArray(fetchedUrls) && fetchedUrls.length > 0) {
    const rendered = fetchedUrls
      .filter((u) => u && u.url)
      .map((u) => {
        if (u.error) {
          return `[${u.url}]\n(Could not fetch: ${u.error})`;
        }
        const header = u.title ? `${u.title} — ${u.url}` : u.url;
        return `[${header}]\n${truncate(u.description || "", MAX_FETCHED_URL_CHARS)}`;
      });
    if (rendered.length > 0) {
      parts.push(
        `--- FETCHED URLS (content the user linked in their message; treat as primary reference material) ---\n${rendered.join("\n\n")}`,
      );
    }
  }

  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    const limited = attachedFiles.slice(0, MAX_ATTACHED_FILES);
    const rendered = limited
      .filter((f) => f && typeof f.content === "string" && f.content.trim())
      .map((f, idx) => {
        const name = (typeof f.name === "string" && f.name.trim()) || `file-${idx + 1}`;
        return `[${name}]\n${truncate(f.content.trim(), MAX_ATTACHED_CHARS)}`;
      });
    if (rendered.length > 0) {
      parts.push(`--- USER-ATTACHED FILES (dropped into chat as context) ---\n${rendered.join("\n\n")}`);
    }
  }

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
    const pinnedContext = body?.pinnedContext && typeof body.pinnedContext === "object" ? body.pinnedContext : null;
    const attachedFiles = Array.isArray(body?.attachedFiles) ? body.attachedFiles : [];

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

    // Auto-fetch any URLs in the most recent user message so the model can
    // reason about external content (job postings, articles, etc.).
    let fetchedUrls = [];
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m && m.role !== "assistant" && typeof m.content === "string");
    if (lastUserMessage) {
      const urls = extractUrls(lastUserMessage.content, MAX_FETCHED_URLS);
      if (urls.length > 0) {
        const results = await Promise.all(
          urls.map(async (url) => {
            const res = await fetchUrlContent(url, { maxChars: MAX_FETCHED_URL_CHARS });
            return { url, ...res };
          }),
        );
        fetchedUrls = results;
      }
    }

    // If the pinned context lacks an actual job description but carries a URL
    // (typical for Greenhouse postings whose `content` came back empty), fetch
    // that URL server-side so the model still has the posting body. Skip URLs
    // we already fetched from the user message.
    if (
      pinnedContext &&
      typeof pinnedContext.content === "string" &&
      pinnedContext.content.trim() &&
      !/(^|\n)\s*Description:\s*\n[^\s]/i.test(pinnedContext.content)
    ) {
      const alreadyFetched = new Set(fetchedUrls.map((u) => u.url));
      const remaining = Math.max(0, MAX_FETCHED_URLS - fetchedUrls.length);
      if (remaining > 0) {
        const pinnedUrls = extractUrls(pinnedContext.content, remaining).filter(
          (u) => !alreadyFetched.has(u),
        );
        if (pinnedUrls.length > 0) {
          const results = await Promise.all(
            pinnedUrls.map(async (url) => {
              const res = await fetchUrlContent(url, { maxChars: MAX_FETCHED_URL_CHARS });
              return { url, ...res };
            }),
          );
          fetchedUrls = [...fetchedUrls, ...results];
        }
      }
    }

    const contextBlock = buildContextBlock(resumeText, applications, pinnedContext, attachedFiles, fetchedUrls);
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
