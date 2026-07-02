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
import { summarize, rankSentences } from "@/lib/text/summarize";
import { pick, pickDistinct } from "@/lib/text/phrasing";
import { critiqueResume, renderCritique } from "@/lib/resume/critique";
import { extractiveAnswer } from "./extractiveQa.js";

const SKILL_CATEGORIES = ["technology", "tool_platform", "domain", "methodology"];

function lastUserText(messages) {
  const m = [...(messages || [])]
    .reverse()
    .find((x) => x && x.role !== "assistant" && typeof x.content === "string" && x.content.trim());
  return m ? m.content.trim() : "";
}

function lastAssistantText(messages) {
  const m = [...(messages || [])]
    .reverse()
    .find((x) => x && x.role === "assistant" && typeof x.content === "string" && x.content.trim());
  return m ? m.content.trim() : "";
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
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

function analyzePosting(subject, resumeText, depth = 0) {
  // Depth pages through term tiers so "tell me more" goes deeper, not louder.
  const terms = topTerms(subject, 8 * (depth + 1)).slice(8 * depth);
  if (terms.length === 0) {
    return depth > 0
      ? "That covers every significant term I can pull from this posting — the rest is boilerplate. Ask about your fit, or for interview prep against it."
      : "I couldn't pull clear requirements out of that posting text. If you paste the responsibilities or qualifications section, I can point out the key skills to emphasize.";
  }
  const parts = [];
  parts.push(
    depth > 0
      ? `Beyond the headline skills, the posting also mentions: ${list(terms)}.`
      : `This posting leans most on: ${list(terms)}.`,
  );
  const resumeTerms = new Set(topTerms(resumeText, 40).map((t) => t.toLowerCase()));
  if (resumeText && resumeText.trim()) {
    const gaps = terms.filter((t) => !resumeTerms.has(t.toLowerCase()));
    if (gaps.length > 0) {
      parts.push(
        `Your uploaded resume doesn't clearly mention: ${list(gaps)}. If you have that experience, work those exact terms into your bullets.`,
      );
    } else if (depth === 0) {
      parts.push("Your resume already covers those terms well — make sure they appear near the top.");
    }
  }
  if (depth === 0) {
    parts.push(
      "To tailor: mirror the posting's wording where it's genuinely true for you, lead each bullet with a result or metric, and cut experience that isn't relevant to this role.",
    );
  }
  return parts.join(" ");
}

function reviewResume(resumeText, depth = 0) {
  if (!resumeText || !resumeText.trim()) {
    return "Upload your resume (the Resume box on the left) and I'll point out the strengths it's leading with and where to tighten it.";
  }
  const parts = [];
  if (depth === 0) {
    const terms = topTerms(resumeText, 8);
    if (terms.length > 0) parts.push(`Your resume reads strongest on: ${list(terms)}.`);
  }
  // Bullet-level critique of the candidate's actual experience lines — the part
  // an LLM reviewer does that generic advice can't. Depth pages through the
  // flagged bullets so a repeat ask reviews the NEXT ones.
  const critique = renderCritique(critiqueResume(resumeText), { offset: depth * 3 });
  if (critique) {
    parts.push(depth > 0 ? `Continuing down the list: ${critique}` : critique);
  } else if (depth > 0) {
    parts.push(
      "That covers every bullet I'd flag — the rest read well. Next lever: reorder so the most posting-relevant bullets sit first under each role.",
    );
  } else {
    parts.push(
      "A few quick wins: start every bullet with an action verb and a concrete outcome (numbers beat adjectives), keep it to the experience most relevant to the roles you're targeting, and mirror the exact keywords from each posting you apply to.",
    );
  }
  return parts.join(" ");
}

function summarizeApplications(applications, depth = 0) {
  const apps = Array.isArray(applications) ? applications : [];
  if (apps.length === 0) {
    return "You don't have any tracked applications yet. Once you tailor and track jobs, I can summarize your pipeline and flag upcoming interviews here.";
  }
  // Depth: the follow-up gets the per-application breakdown, not the totals again.
  if (depth > 0) {
    const lines = apps
      .slice(0, 10)
      .map((a) => `${a.company || "Unknown company"}${a.role ? ` (${a.role})` : ""} — ${a.status || "status unknown"}`);
    const more = apps.length > 10 ? ` …and ${apps.length - 10} more.` : "";
    return `Here's each one: ${lines.join("; ")}.${more}`;
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

// Templates for predicting likely interview questions from a posting's top
// terms — what an LLM does when you ask "help me prep for this role".
const TECH_QUESTION_TEMPLATES = [
  (t) => `Walk me through a project where you used ${t}.`,
  (t) => `How have you applied ${t} in production?`,
  (t) => `What trade-offs have you run into working with ${t}?`,
];

// Likely questions for a specific posting, derived from its dominant terms.
// `offset` pages into deeper terms so a follow-up asks about NEW topics.
export function likelyQuestions(subject, { limit = 3, offset = 0 } = {}) {
  const terms = topTerms(subject, offset + limit + 1).slice(offset, offset + limit);
  return terms.map((t) => pick(t, TECH_QUESTION_TEMPLATES)(t));
}

function interviewPrep(applications, subject, depth = 0) {
  const apps = Array.isArray(applications) ? applications : [];
  const upcoming = [];
  for (const a of apps) {
    for (const st of a.stages || []) {
      if (st && st.scheduledAt) upcoming.push(`${a.company || "a role"} (${st.name || st.type || "interview"})`);
    }
  }
  const parts = [];
  // When a posting is pinned, predict what they'll actually ask about.
  if (subject && subject.trim()) {
    const questions = likelyQuestions(subject, { limit: 3, offset: depth * 3 });
    if (questions.length > 0) {
      parts.push(
        depth > 0
          ? `A few more they could ask: ${questions.join(" ")}`
          : `Based on this posting, expect questions like: ${questions.join(" ")} Have one concrete story or example ready for each.`,
      );
    } else if (depth > 0) {
      parts.push(
        "That exhausts the posting's technical topics — spend the remaining prep on your three or four flexible stories and on questions to ask THEM.",
      );
    }
  }
  if (depth === 0) {
    parts.push(
      "For behavioral questions, answer in STAR order: Situation, Task, Action, Result — and end on a number or clear outcome. Prepare three or four stories you can flex across questions (a conflict, a failure, a win, a leadership moment).",
      "For technical questions, restate the problem and constraints first, think out loud, and call out trade-offs before you commit to an approach.",
    );
  } else if (parts.length === 0) {
    parts.push(
      "Beyond rehearsal: prepare two questions to ask them (one about the team's biggest problem, one about how success is measured), and have your salary range ready in case it comes up.",
    );
  }
  if (upcoming.length > 0) {
    parts.push(`You have interviews coming up for: ${upcoming.slice(0, 5).join(", ")} — rehearse a story tied to each role.`);
  }
  return parts.join(" ");
}

function coverLetterHelp(pinnedContext, depth = 0) {
  const co =
    pinnedContext && typeof pinnedContext.label === "string" && pinnedContext.label.trim()
      ? pinnedContext.label.trim()
      : "the company";
  if (depth > 0) {
    return "Second-pass polish: cut every sentence that could appear in anyone else's letter, name the team or product you'd be working on, and end by proposing the next step rather than thanking them for their time. Read it aloud once — anything you stumble on, rewrite.";
  }
  return `Keep a cover letter to three short paragraphs: why this role and ${co} specifically, one story that proves you can do the job (with a result), and a confident close. Avoid restating your resume — pick the single most relevant accomplishment and go deep on it. Reference something concrete and recent about the company so it doesn't read as a template.`;
}

function capabilities() {
  return "I'm the offline assistant (Embedded engine — no AI). I work from what's in front of you, so I can: analyze or summarize a job posting you've pinned or pasted, estimate your fit against it, review the resume you've uploaded, summarize your tracked applications and upcoming interviews, and share interview, salary, and cover-letter guidance. For open-ended back-and-forth, switch the engine to Gemini in the top bar.";
}

// "Summarize this" over whatever the user is looking at — the pinned posting /
// fetched article, else the resume — using the extractive summarizer plus the
// salient terms. A real multi-sentence summary, not a keyword dump.
function summarizeSubject(subject, resumeText, depth = 0) {
  const body = subject || resumeText || "";
  if (!body.trim()) {
    return "Pin a posting (use “Ask AI” on a job), paste some text, or upload your resume, and I'll summarize the key points.";
  }
  // Depth pages through the ranked sentences: the follow-up summary continues
  // with the NEXT most informative sentences instead of repeating the gist.
  if (depth > 0) {
    const next = rankSentences(body)
      .slice(depth * 4, depth * 4 + 4)
      .sort((a, b) => a.idx - b.idx)
      .map((r) => r.sentence);
    return next.length > 0
      ? `Going deeper: ${next.join(" ")}`
      : "That's the whole text summarized — nothing substantial left to add. Ask about your fit against it if you want the comparison.";
  }
  const gist = summarize(body, { maxSentences: 4 });
  const terms = topTerms(body, 6);
  const parts = [`Here's the gist: ${gist}`];
  if (terms.length > 0) parts.push(`Key themes: ${list(terms)}.`);
  return parts.join(" ");
}

// Keyword-based fit estimate between the pinned posting and the uploaded resume.
function fitAssessment(subject, resumeText, depth = 0) {
  // The follow-up turns the verdict into an action plan for the gaps.
  if (depth > 0 && subject && subject.trim() && resumeText && resumeText.trim()) {
    const postingTerms = topTerms(subject, 8);
    const have = new Set(topTerms(resumeText, 40).map((t) => t.toLowerCase()));
    const gaps = postingTerms.filter((t) => !have.has(t.toLowerCase()));
    if (gaps.length === 0) {
      return "Nothing more to close on keywords — your edge now is framing: put the overlapping skills in your top three bullets and quantify each one.";
    }
    return `To close the gap, work on it in this order: ${gaps
      .slice(0, 3)
      .map((g, i) => `${i + 1}) add a truthful bullet showing ${g}`)
      .join("; ")}. If you don't have that experience, name the closest adjacent thing you HAVE done — adjacency beats omission.`;
  }
  if (!subject || !subject.trim()) {
    return "Pin the posting (use “Ask AI” on a job) so I can compare it against your resume and estimate your fit.";
  }
  const postingTerms = topTerms(subject, 8);
  if (postingTerms.length === 0) {
    return "I couldn't pull clear requirements out of that posting. Paste the responsibilities/qualifications and I'll estimate your fit.";
  }
  if (!resumeText || !resumeText.trim()) {
    return `Upload your resume and I'll compare it against this posting's key skills: ${list(postingTerms)}.`;
  }
  const have = new Set(topTerms(resumeText, 40).map((t) => t.toLowerCase()));
  const matched = postingTerms.filter((t) => have.has(t.toLowerCase()));
  const gaps = postingTerms.filter((t) => !have.has(t.toLowerCase()));
  const ratio = matched.length / postingTerms.length;
  const label = ratio >= 0.6 ? "strong" : ratio >= 0.35 ? "reasonable" : "stretch";
  const parts = [
    `By keyword overlap you look like a ${label} fit: your resume covers ${matched.length > 0 ? list(matched) : "few of the listed skills"}.`,
  ];
  if (gaps.length > 0) parts.push(`It doesn't clearly show: ${list(gaps)} — add those if you have them.`);
  parts.push(
    "Keyword overlap isn't the whole story, though — seniority, domain, and how you frame your experience matter just as much.",
  );
  return parts.join(" ");
}

const SALARY_TIPS = [
  "Research the range first (levels.fyi, Glassdoor, and peers) so you can anchor on data, not a feeling.",
  "Let the employer name a number first when you can; if pushed, give a researched range with your target near the top.",
  "Negotiate total comp — base, bonus, equity, sign-on, PTO — not just salary.",
  "Get the offer in writing before you counter, and counter once, confidently, with a specific number and a short reason.",
];
function salaryGuidance(seed, depth = 0) {
  // Depth rotates through the tip bank so a follow-up gets different advice.
  const [a, b] = pickDistinct(`${seed}:${depth}`, SALARY_TIPS, 2);
  return `${depth > 0 ? "More on that:" : "A few principles:"} ${a} ${b || ""}`.trim();
}

// Shorten the previous answer on request (a common follow-up).
function condense(prevAssistant) {
  const short = summarize(prevAssistant, { maxSentences: 1 });
  return short ? `In short: ${short}` : prevAssistant;
}

const MORE_TIPS = [
  "One more thing: quantify wherever you can — numbers make claims credible.",
  "Also worth doing: tailor the top third of your resume to each posting; that's the part that actually gets read.",
  "Extra tip: for every requirement you meet, have one specific story or metric ready to back it up.",
  "And: mirror the posting's exact wording for skills you genuinely have — many first-pass filters match on literal terms.",
];
function moreTips(seed) {
  return pick(seed, MORE_TIPS);
}

const RE = {
  greeting: /^(hi|hey|hello|yo|help|what can you do|who are you)\b/i,
  shorten: /\b(shorter|too long|condense|tighten|make it (short|brief)|briefer|tl;?dr)\b/i,
  more: /\b(more|expand|elaborate|go on|tell me more|details|deeper|keep going)\b/i,
  summarize: /\b(summari[sz]e|tl;?dr|key points|main points|the gist|in short|sum up|overview of)\b/i,
  fit: /\b(good fit|am i a fit|should i apply|do i qualify|qualified|my chances|a stretch|how well do i match|match this)\b/i,
  salary: /\b(salary|compensation|comp\b|pay|negotiat|counter( ?offer)?|sign[- ]?on|equity|how much should i (ask|make)|worth)\b/i,
  resume: /\b(my resume|my cv|review (my )?resume|improve (my )?resume|resume feedback|critique)\b/i,
  applications: /\b(applications?|how many jobs|my pipeline|tracking|applied|status of|where am i|which (job|one)|prioriti[sz]e|focus on)\b/i,
  interview: /\b(interview|prepare|prep|star method|behavioral|whiteboard)\b/i,
  coverLetter: /\b(cover letter|cover-letter)\b/i,
  posting: /\b(this (job|role|posting|position|description)|requirements?|qualifications?|responsibilities|what skills|tailor|emphasi[sz]e)\b/i,
};

// Classify a message's intent by the same RE table the dispatcher uses, in the
// same precedence order. Returns an intent key or null (greetings/chatter).
export function classifyIntent(text) {
  const t = String(text || "");
  if (!t.trim()) return null;
  if (RE.summarize.test(t)) return "summarize";
  if (RE.fit.test(t)) return "fit";
  if (RE.salary.test(t)) return "salary";
  if (RE.coverLetter.test(t)) return "coverLetter";
  if (RE.resume.test(t)) return "resume";
  if (RE.applications.test(t)) return "applications";
  if (RE.interview.test(t)) return "interview";
  if (RE.posting.test(t)) return "posting";
  return null;
}

// What was this conversation about before the current message? Walks the prior
// user turns newest-first: brief "more" follow-ups add depth (each one already
// went a level deeper), and the first classifiable message names the intent.
// Falls back to intent null (with depth) when earlier turns were unclassifiable
// — the caller can still continue a subject-driven analysis.
function conversationFocus(messages) {
  const users = (messages || [])
    .filter((m) => m && m.role !== "assistant" && typeof m.content === "string" && m.content.trim())
    .map((m) => m.content.trim());
  users.pop(); // the current message
  let depth = 0;
  let sawAnyUser = false;
  for (let i = users.length - 1; i >= 0; i -= 1) {
    const t = users[i];
    sawAnyUser = true;
    if (wordCount(t) <= 5 && RE.more.test(t)) {
      depth += 1;
      continue;
    }
    const intent = classifyIntent(t);
    if (!intent) continue;
    let repeats = 0;
    for (let j = i - 1; j >= 0; j -= 1) if (classifyIntent(users[j]) === intent) repeats += 1;
    return { intent, depth: depth + repeats };
  }
  return sawAnyUser ? { intent: null, depth } : null;
}

// How many times the user already asked this same intent earlier in the
// conversation — a repeat ask should go deeper, never repeat itself.
function countPriorIntent(messages, intent) {
  const users = (messages || [])
    .filter((m) => m && m.role !== "assistant" && typeof m.content === "string" && m.content.trim())
    .map((m) => m.content.trim());
  users.pop();
  return users.filter((t) => classifyIntent(t) === intent).length;
}

// Route one intent to its handler at a given depth.
function answerIntent(intent, ctx, depth = 0) {
  const { text, subject, resumeText, applications, pinnedContext } = ctx;
  switch (intent) {
    case "summarize":
      return summarizeSubject(subject, resumeText, depth);
    case "fit":
      return fitAssessment(subject, resumeText, depth);
    case "salary":
      return salaryGuidance(text, depth);
    case "coverLetter":
      return coverLetterHelp(pinnedContext, depth);
    case "resume":
      return reviewResume(resumeText, depth);
    case "applications":
      return summarizeApplications(applications, depth);
    case "interview":
      return interviewPrep(applications, subject, depth);
    case "posting":
      if (subject) return analyzePosting(subject, resumeText, depth);
      return "Pin a posting (use “Ask AI” on a job) or paste the description, and I'll flag the key skills to emphasize and how to tailor for it.";
    default:
      return "";
  }
}

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
  const prevAssistant = lastAssistantText(messages);
  const isBriefFollowUp = wordCount(text) <= 5;
  const ctx = { text, subject, resumeText, applications, pinnedContext };

  // Conversational follow-ups that operate on the previous answer. Guarded to
  // short messages so "tell me more about the salary" still routes to salary.
  if (prevAssistant && isBriefFollowUp && RE.shorten.test(text)) return condense(prevAssistant);
  if (prevAssistant && isBriefFollowUp && RE.more.test(text)) {
    // Continue the conversation's actual topic one level deeper, instead of a
    // canned generic tip. The subject-driven analyze flow (pin → "Ask AI")
    // continues too, even though its opener classifies to no intent.
    const focus = conversationFocus(messages);
    if (focus?.intent) return answerIntent(focus.intent, ctx, focus.depth + 1);
    if (focus && subject) return answerIntent("posting", ctx, focus.depth + 1);
    return moreTips(text);
  }

  // Direct questions about the pinned posting ("is it remote?", "what does it
  // pay?") get answered FROM the posting — quoted verbatim, or an honest
  // not-found — before any of the coaching intents below can hijack them.
  if (subject) {
    const qa = extractiveAnswer(text, subject);
    if (qa?.type === "answer") return qa.text;
    if (qa?.type === "not-found") {
      const base = `The posting text doesn't mention ${qa.label}.`;
      return qa.topic === "salary" ? `${base} ${salaryGuidance(text)}` : base;
    }
  }

  // Explicit intents; a repeat of the same ask goes deeper instead of
  // repeating the previous answer verbatim.
  const intent = classifyIntent(text);
  if (intent && intent !== "posting") {
    return answerIntent(intent, ctx, countPriorIntent(messages, intent));
  }
  if (!intent && RE.greeting.test(text)) return capabilities();

  // A posting is the subject → analyze it (the common "Ask AI on this job" flow).
  if (subject && (intent === "posting" || pinnedContext || fetchedUrls.some((u) => u && !u.error))) {
    return analyzePosting(subject, resumeText, countPriorIntent(messages, "posting"));
  }
  if (intent === "posting" && !subject) {
    return answerIntent("posting", ctx, 0);
  }

  // Fallback: rather than a canned capabilities blurb, try to be useful from
  // whatever context exists — summarize the subject, or comment on the resume.
  if (subject) return summarizeSubject(subject, resumeText);
  if (resumeText && resumeText.trim()) return reviewResume(resumeText);
  return `${capabilities()} What would you like to start with?`;
}
