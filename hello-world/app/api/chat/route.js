import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { extractUrls, fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { logChatMessage } from "@/lib/supabase/logChatMessage";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { localChatReply } from "@/lib/chat/localAssistant";
import { truncate, renderApplicationsSection } from "@/lib/chat/applicationContext";

const SYSTEM_PROMPT = [
  "You are a concise, friendly career assistant inside the Resume Tailor app.",
  "Help the user with resume writing, job search strategy, interview prep, and using this tool.",
  "Answer briefly. Use plain language. No markdown headings unless asked.",
  "Never use bold or italic formatting (no **bold**, no __bold__, no *italic*, no _italic_). Write in plain prose only.",
  "When the user has uploaded a resume or has applications, use that context to give specific, personalized advice.",
  "Reference specific companies, roles, or resume bullets from the provided context when relevant.",
  "If the user pastes a URL in their message, the page contents are fetched server-side and provided to you under '--- FETCHED URLS ---'. Use that fetched text instead of saying you cannot open links.",
  "The '--- PINNED CONTEXT ---' block is the user's currently-selected subject (typically a job posting they just clicked 'Ask AI' on). Treat any text after a 'Description:' header inside it as the authoritative job description and answer questions about that description directly. If the pinned context references a URL, the fetched page content for that URL appears under '--- FETCHED URLS ---' and should be treated as the job description as well. Never tell the user you do not have access to the job description when a pinned context or fetched URL is present — instead answer using whatever description text is provided, and only if the description text is literally empty say something like 'the posting did not include a description; here is what I can infer from the title/company'.",
].join(" ");

const MAX_RESUME_CHARS = 12000;
const MAX_ATTACHED_FILES = 10;
const MAX_ATTACHED_CHARS = 8000;
const MAX_FETCHED_URLS = 3;
const MAX_FETCHED_URL_CHARS = 8000;

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

  const applicationsSection = renderApplicationsSection(applications);
  if (applicationsSection) parts.push(applicationsSection);

  return parts.join("\n\n");
}

// Resolve any URLs referenced by the latest user message (and, when the pinned
// context carries a URL but no inline description, that URL too) into scraped
// page content. Shared by both the Gemini and embedded paths so each can reason
// about linked postings/articles. Non-throwing; returns [] on nothing to fetch.
async function resolveFetchedUrls({ messages, pinnedContext }) {
  let fetchedUrls = [];
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m && m.role !== "assistant" && typeof m.content === "string");
  if (lastUserMessage) {
    const urls = extractUrls(lastUserMessage.content, MAX_FETCHED_URLS);
    if (urls.length > 0) {
      fetchedUrls = await Promise.all(
        urls.map(async (url) => {
          const res = await fetchUrlContent(url, { maxChars: MAX_FETCHED_URL_CHARS });
          return { url, ...res };
        }),
      );
    }
  }

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

  return fetchedUrls;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const resumeText = typeof body?.resumeText === "string" ? body.resumeText : "";
    const applications = Array.isArray(body?.applications) ? body.applications : [];
    const pinnedContext = body?.pinnedContext && typeof body.pinnedContext === "object" ? body.pinnedContext : null;
    const attachedFiles = Array.isArray(body?.attachedFiles) ? body.attachedFiles : [];
    const tab = typeof body?.tab === "string" ? body.tab : null;
    const section = typeof body?.section === "string" ? body.section : null;

    if (messages.length === 0) {
      return Response.json({ error: "No messages provided." }, { status: 400 });
    }

    // Best-effort: log the latest user-authored message along with the tab the
    // user was on. Awaited so the insert actually flushes before the route
    // returns (a dangling promise in a serverless handler can be killed
    // before it commits); logChatMessage is non-throwing.
    try {
      const latestUserMessage = [...messages]
        .reverse()
        .find((m) => m && m.role !== "assistant" && typeof m.content === "string" && m.content.trim());
      if (!latestUserMessage) {
        console.warn("[chat] no user-authored message found in payload; skipping log");
      } else {
        const supabase = await createSupabaseServerClient();
        const { data: { user } = {}, error: getUserErr } = await supabase.auth.getUser();
        if (getUserErr) {
          console.warn("[chat] supabase.auth.getUser error:", getUserErr.message || getUserErr);
        }
        if (!user?.id) {
          console.warn(
            "[chat] no authenticated user on server; chat_message_logs insert skipped (RLS requires auth.uid()). Sign in or check Supabase auth cookies.",
          );
        } else {
          console.log("[chat] logging message for user", user.id, "tab=", tab, "section=", section);
          await logChatMessage(supabase, {
            userId: user.id,
            message: latestUserMessage.content,
            tab,
            section,
            hasPinnedContext: !!(pinnedContext && typeof pinnedContext.content === "string" && pinnedContext.content.trim()),
            pinnedLabel: pinnedContext && typeof pinnedContext.label === "string" ? pinnedContext.label : null,
            attachedFileCount: Array.isArray(attachedFiles) ? attachedFiles.length : 0,
          });
        }
      }
    } catch (err) {
      // Never let logging break the chat endpoint.
      console.error("[chat] failed to log user message:", err);
    }

    // Resolve any linked URLs first — both paths use them as reference material.
    const fetchedUrls = await resolveFetchedUrls({ messages, pinnedContext });

    // Embedded engine: answer from the provided context with the offline
    // rule/retrieval assistant — no LLM, no API key.
    if (wantsEmbedded(body?.engine)) {
      const reply = localChatReply({
        messages,
        resumeText,
        applications,
        pinnedContext,
        attachedFiles,
        fetchedUrls,
      });
      if (!reply) {
        return Response.json({ error: "Could not generate a reply." }, { status: 502 });
      }
      return Response.json({ reply });
    }

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();

    const contents = messages
      .filter((m) => m && typeof m.content === "string" && m.content.trim())
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    // Attach images/PDFs as native multimodal parts on the most recent user
    // turn so the model can actually see them (text attachments stay in the
    // context block below).
    const inlineParts = attachedFiles
      .filter(
        (f) =>
          f &&
          typeof f.dataB64 === "string" &&
          f.dataB64 &&
          typeof f.mimeType === "string" &&
          (f.mimeType.startsWith("image/") || f.mimeType === "application/pdf"),
      )
      .slice(0, MAX_ATTACHED_FILES)
      .map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.dataB64 } }));
    if (inlineParts.length > 0) {
      for (let i = contents.length - 1; i >= 0; i -= 1) {
        if (contents[i].role === "user") {
          contents[i].parts.push(...inlineParts);
          break;
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

    const rawReply = response.text?.trim() || "";
    // Defensive: even with the system prompt forbidding bold/italic, the model
    // occasionally emits markdown emphasis. Strip it server-side so the UI
    // never renders or shows raw asterisks/underscores.
    const reply = stripEmphasisMarkdown(rawReply);

    if (!reply) {
      return Response.json({ error: "Empty response from Gemini." }, { status: 502 });
    }

    return Response.json({ reply });
  } catch (err) {
    return Response.json({ error: err?.message || "Chat request failed." }, { status: 500 });
  }
}

function stripEmphasisMarkdown(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    // ***bold italic*** / ___bold italic___
    .replace(/\*\*\*(.+?)\*\*\*/gs, "$1")
    .replace(/___(.+?)___/gs, "$1")
    // **bold** / __bold__
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    // *italic* and _italic_ — only when wrapping non-space content
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g, "$1$2");
}
