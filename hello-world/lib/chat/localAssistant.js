// Zero-cost career assistant — the embedded engine's alternative to the Gemini
// chat. It can't hold an open-ended conversation, but it recognizes the common
// intents (analyze this posting, review my resume, my applications, interview
// prep, cover letters) and answers from the same context the LLM gets: the
// pinned posting / fetched URLs, the uploaded resume, and the tracked
// applications. It mines skills with the same extractKeywords the tailor engine
// uses, so its advice is grounded in real terms. Plain prose only (the chat UI
// forbids markdown emphasis), no network, no API key.

import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";

const SKILL_CATEGORIES = ["technology", "tool_platform", "domain", "methodology"];

function lastUserText(messages) {
  const m = [...(messages || [])]
    .reverse()
    .find((x) => x && x.role !== "assistant" && typeof x.content === "string" && x.content.trim());
  return m ? m.content.trim() : "";
}

// Top salient skills/terms from a block of text, highest-scoring first, de-duped.
export function topTerms(text, limit = 8) {
  const body = String(text || "").trim();
  if (!body) return [];
  let kw;
  try {
    kw = extractKeywords(body, defaultLibraryData.taxonomy);
  } catch {
    return [];
  }
  const items = [];
  for (const cat of SKILL_CATEGORIES) {
    for (const it of kw[cat] || []) items.push(it);
  }
  items.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it.canonical);
    if (out.length >= limit) break;
  }
  return out;
}

function list(items) {
  return items.join(", ");
}

// The subject text the user is asking about: the pinned posting, else the first
// fetched URL, else the first attached text file.
function subjectText({ pinnedContext, fetchedUrls, attachedFiles }) {
  if (pinnedContext && typeof pinnedContext.content === "string" && pinnedContext.content.trim()) {
    return pinnedContext.content.trim();
  }
  const url = (fetchedUrls || []).find((u) => u && !u.error && u.description);
  if (url) return String(url.description);
  const file = (attachedFiles || []).find((f) => f && typeof f.content === "string" && f.content.trim());
  return file ? file.content.trim() : "";
}

function analyzePosting(subject, resumeText) {
  const terms = topTerms(subject, 8);
  if (terms.length === 0) {
    return "I couldn't pull clear requirements out of that posting text. If you paste the responsibilities or qualifications section, I can point out the key skills to emphasize.";
  }
  const parts = [];
  parts.push(`This posting leans most on: ${list(terms)}.`);
  const resumeTerms = new Set(topTerms(resumeText, 40).map((t) => t.toLowerCase()));
  if (resumeText && resumeText.trim()) {
    const gaps = terms.filter((t) => !resumeTerms.has(t.toLowerCase()));
    if (gaps.length > 0) {
      parts.push(
        `Your uploaded resume doesn't clearly mention: ${list(gaps)}. If you have that experience, work those exact terms into your bullets.`,
      );
    } else {
      parts.push("Your resume already covers those terms well — make sure they appear near the top.");
    }
  }
  parts.push(
    "To tailor: mirror the posting's wording where it's genuinely true for you, lead each bullet with a result or metric, and cut experience that isn't relevant to this role.",
  );
  return parts.join(" ");
}

function reviewResume(resumeText) {
  if (!resumeText || !resumeText.trim()) {
    return "Upload your resume (the Resume box on the left) and I'll point out the strengths it's leading with and where to tighten it.";
  }
  const terms = topTerms(resumeText, 8);
  const parts = [];
  if (terms.length > 0) parts.push(`Your resume reads strongest on: ${list(terms)}.`);
  parts.push(
    "A few quick wins: start every bullet with an action verb and a concrete outcome (numbers beat adjectives), keep it to the experience most relevant to the roles you're targeting, and mirror the exact keywords from each posting you apply to. Trim anything older than ~10 years to a line or two.",
  );
  return parts.join(" ");
}

function summarizeApplications(applications) {
  const apps = Array.isArray(applications) ? applications : [];
  if (apps.length === 0) {
    return "You don't have any tracked applications yet. Once you tailor and track jobs, I can summarize your pipeline and flag upcoming interviews here.";
  }
  const byStatus = {};
  for (const a of apps) {
    const s = (a.status || "unknown").toString();
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  const statusStr = Object.entries(byStatus)
    .map(([s, c]) => `${c} ${s}`)
    .join(", ");
  const upcoming = [];
  for (const a of apps) {
    for (const st of a.stages || []) {
      if (st && st.scheduledAt) {
        upcoming.push(`${a.company || "a role"} — ${st.name || st.type || "interview"} on ${st.scheduledAt}`);
      }
    }
  }
  const parts = [`You're tracking ${apps.length} application${apps.length === 1 ? "" : "s"}: ${statusStr}.`];
  if (upcoming.length > 0) {
    parts.push(`Upcoming: ${upcoming.slice(0, 5).join("; ")}.`);
  }
  return parts.join(" ");
}

function interviewPrep(applications) {
  const apps = Array.isArray(applications) ? applications : [];
  const upcoming = [];
  for (const a of apps) {
    for (const st of a.stages || []) {
      if (st && st.scheduledAt) upcoming.push(`${a.company || "a role"} (${st.name || st.type || "interview"})`);
    }
  }
  const parts = [
    "For behavioral questions, answer in STAR order: Situation, Task, Action, Result — and end on a number or clear outcome. Prepare three or four stories you can flex across questions (a conflict, a failure, a win, a leadership moment).",
    "For technical questions, restate the problem and constraints first, think out loud, and call out trade-offs before you commit to an approach.",
  ];
  if (upcoming.length > 0) {
    parts.push(`You have interviews coming up for: ${upcoming.slice(0, 5).join(", ")} — rehearse a story tied to each role.`);
  }
  return parts.join(" ");
}

function coverLetterHelp(pinnedContext) {
  const co =
    pinnedContext && typeof pinnedContext.label === "string" && pinnedContext.label.trim()
      ? pinnedContext.label.trim()
      : "the company";
  return `Keep a cover letter to three short paragraphs: why this role and ${co} specifically, one story that proves you can do the job (with a result), and a confident close. Avoid restating your resume — pick the single most relevant accomplishment and go deep on it. Reference something concrete and recent about the company so it doesn't read as a template.`;
}

function capabilities() {
  return "I'm the offline assistant (Embedded engine — no AI). I work from what's in front of you, so I can: analyze a job posting you've pinned or pasted and flag the key skills to emphasize, review the resume you've uploaded, summarize your tracked applications and upcoming interviews, and share interview and cover-letter guidance. For open-ended back-and-forth, switch the engine to Gemini in the top bar.";
}

const RE = {
  greeting: /^(hi|hey|hello|yo|help|what can you do|who are you)\b/i,
  resume: /\b(my resume|my cv|review (my )?resume|improve (my )?resume|resume feedback|critique)\b/i,
  applications: /\b(applications?|how many jobs|my pipeline|tracking|applied|status of|where am i)\b/i,
  interview: /\b(interview|prepare|prep|star method|behavioral|whiteboard)\b/i,
  coverLetter: /\b(cover letter|cover-letter)\b/i,
  posting: /\b(this (job|role|posting|position|description)|requirements?|qualifications?|responsibilities|what skills|tailor|match|good fit|should i apply)\b/i,
};

// Produce a single assistant reply for the embedded engine. Returns a plain
// string (never empty).
export function localChatReply({
  messages,
  resumeText = "",
  applications = [],
  pinnedContext = null,
  attachedFiles = [],
  fetchedUrls = [],
} = {}) {
  const text = lastUserText(messages);
  const subject = subjectText({ pinnedContext, fetchedUrls, attachedFiles });

  // Explicit intents first, most specific to least.
  if (RE.coverLetter.test(text)) return coverLetterHelp(pinnedContext);
  if (RE.resume.test(text)) return reviewResume(resumeText);
  if (RE.applications.test(text)) return summarizeApplications(applications);
  if (RE.interview.test(text)) return interviewPrep(applications);
  if (RE.greeting.test(text)) return capabilities();

  // A posting is the subject → analyze it (the common "Ask AI on this job" flow).
  if (subject && (RE.posting.test(text) || pinnedContext || fetchedUrls.some((u) => u && !u.error))) {
    return analyzePosting(subject, resumeText);
  }
  if (RE.posting.test(text) && !subject) {
    return "Pin a posting (use “Ask AI” on a job) or paste the description, and I'll flag the key skills to emphasize and how to tailor for it.";
  }

  // Fallback: honest, and steer to what the offline assistant can actually do.
  return `${capabilities()} What would you like to start with?`;
}
