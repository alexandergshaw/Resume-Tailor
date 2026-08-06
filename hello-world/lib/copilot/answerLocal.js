// Zero-cost interview talking points — the embedded copilot's answer generator.
// The LLM path returns 3-5 glanceable bullet points grounded in the candidate's
// background (STAR-prefixed for behavioral questions). This reproduces that
// contract deterministically: it classifies the question, mines the candidate's
// real skills (extractKeywords) and companies/metrics from the profile, and
// assembles a STAR scaffold or a technical/general checklist that references
// them. No network, no API key.

import { classifyQuestionType } from "./questionType.js";
import { normalizeInterviewType } from "./interviewTypes.js";
import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { parseEmploymentHistory } from "@/lib/resume/parseEmployment";
import { pick } from "@/lib/text/phrasing";

const SKILL_CATEGORIES = ["technology", "tool_platform", "domain"];
const MAX_POINTS = 5;

// Interview-type values that push a question the classifier itself called
// "general" toward a technical or a STAR scaffold instead (AC-G2-D-6). Only
// fires when the question earns no classification of its own — a question
// that already classifies as behavioral/technical keeps that classification
// regardless of the interview type. Shared by draftAnswerLocal below and
// sampleAnswerLocal.js's draftSampleAnswerLocal, so the two engines pick the
// same scaffold for the same (question, interviewType) pair.
const TECHNICAL_SCAFFOLD_INTERVIEW_TYPES = new Set(["system-design", "technical", "case-study"]);
const STAR_SCAFFOLD_INTERVIEW_TYPES = new Set(["behavioral", "leadership"]);

export function resolveScaffoldType(questionType, interviewTypeValue) {
  if (questionType !== "general") return questionType;
  const value = normalizeInterviewType(interviewTypeValue);
  if (TECHNICAL_SCAFFOLD_INTERVIEW_TYPES.has(value)) return "technical";
  if (STAR_SCAFFOLD_INTERVIEW_TYPES.has(value)) return "behavioral";
  return questionType;
}

// The candidate's most salient real skills, highest-scoring first, de-duped.
export function profileSkills(profile, limit = 6) {
  const text = String(profile || "").trim();
  if (!text) return [];
  let kw;
  try {
    kw = extractKeywords(text, defaultLibraryData.taxonomy);
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

// The candidate's most recent role (company + title) parsed from the profile,
// used to anchor a STAR "Situation" in something real. Empty when unknown.
export function profileHeadline(profile) {
  const positions = parseEmploymentHistory(String(profile || ""), { maxEntries: 1 });
  const p = positions[0];
  return p ? { company: p.company || "", title: p.title || "" } : { company: "", title: "" };
}

// A quantified achievement to gesture at ("40%", "$2M", "10k users"). Empty when
// the profile has no obvious metric.
export function profileMetric(profile) {
  const m = String(profile || "").match(
    /(\d+(?:\.\d+)?%|\$\s?\d[\d,.]*\s?[kmb]?\b|\b\d[\d,]*\+?\s*(?:users|customers|clients|requests|deals|hires|people|engineers|reports|hours|days|x)\b)/i,
  );
  return m ? m[0].trim() : "";
}

// Skills from the candidate's profile that the question itself mentions — the
// most relevant ones to name out loud. Falls back to nothing when there's no
// overlap (the caller then uses the top profile skills instead).
export function matchedSkills(question, skills) {
  const q = String(question || "").toLowerCase();
  return (skills || []).filter((s) => q.includes(String(s).toLowerCase()));
}

function skillHint(question, skills) {
  const matched = matchedSkills(question, skills);
  const chosen = (matched.length ? matched : skills).slice(0, 3);
  return chosen.join(", ");
}

// Tidy a profile line into a short reference phrase to weave into a talking
// point: strip bullets, trailing punctuation, clamp, and lowercase the leading
// word so it reads mid-sentence ("…e.g. built and scaled a platform").
function cleanLine(sentence) {
  let t = String(sentence || "").replace(/^[\s•\-*–—>]+/, "").trim();
  t = t.replace(/[.;,\s]+$/, "");
  if (t.length > 140) t = `${t.slice(0, 140).trim()}…`;
  if (/^[A-Z][a-z]/.test(t)) t = t.charAt(0).toLowerCase() + t.slice(1);
  return t;
}

// Exported so sampleAnswerLocal.js can reuse the same verb vocabulary to
// detect a verb-initial resume bullet and speak it in first person instead
// of as a subject-less fragment. Other callers (this file, practiceQuestions.js)
// keep using it exactly as before.
export const ACHIEVEMENT_VERBS =
  /\b(built|led|designed|shipped|launched|scaled|drove|improved|reduced|created|owned|delivered|managed|architected|automated|migrated|grew|cut|increased|implemented|developed|optimi[sz]ed|mentored)\b/i;

// The single most relevant, concrete line from the candidate's profile for this
// question — the raw material an LLM would cite. Profiles are line-oriented
// (resume/prep bullets), so it scores each line by overlap with the question
// plus an "accomplishment" signal (a verb or metric), skipping headers and
// skills lists.
export function relevantExperienceLine(profile, question) {
  const lines = String(profile || "")
    .split(/\r?\n+/)
    .map((l) => l.replace(/^[\s•\-*–—>]+/, "").trim())
    .filter(Boolean);
  const qTerms = new Set((String(question || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []));

  let best = "";
  let bestScore = 0;
  for (const s of lines) {
    if (s.length < 24) continue;
    if (/^(skills?|technologies|tools|education|summary|objective)\s*:/i.test(s)) continue;
    const words = s.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    let overlap = 0;
    for (const w of words) if (qTerms.has(w)) overlap += 1;
    const hasSignal = /\d/.test(s) || ACHIEVEMENT_VERBS.test(s);
    const score = overlap * 2 + (hasSignal ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore > 0 ? cleanLine(best) : "";
}

function behavioralPoints({ headline, metric, hint, expRef, seed }) {
  const situation = headline.company
    ? `a specific project at ${headline.company}${headline.title ? ` as ${headline.title}` : ""}`
    : "one specific, relevant project";
  const opener = pick(seed, ["Set the scene briefly", "Frame the context in a sentence", "Open with where and when"]);
  // Prefer a real accomplishment as the Action example; fall back to the skills hint.
  const actionTail = expRef ? ` — e.g. ${expRef}` : hint ? ` (${hint})` : "";
  return [
    `Situation: ${opener} — ${situation}.`,
    "Task: State the goal you personally owned and why it mattered.",
    `Action: Walk through the concrete steps you took${actionTail}.`,
    `Result: Close with a measurable outcome${metric ? ` — e.g. ${metric}` : " (a metric or clear impact)"}.`,
  ];
}

function technicalPoints({ question, skills, hint, expRef, seed }) {
  const matched = matchedSkills(question, skills);
  const grounding = expRef
    ? `Ground it in real work you've done — e.g. ${expRef}.`
    : matched.length
      ? `Ground it in your hands-on experience with ${matched.slice(0, 3).join(", ")}.`
      : hint
        ? `Draw on your ${hint} background for a concrete reference point.`
        : "Anchor it in a real system you've built, not theory.";
  const open = pick(seed, [
    "Clarify the requirements and constraints before you answer.",
    "Restate the problem and pin down the constraints first.",
    "Ask a clarifying question, then state your assumptions.",
  ]);
  return [
    open,
    "Think out loud — outline your approach before diving into details.",
    grounding,
    "Call out the trade-offs (time vs. space, simplicity vs. scale) and justify your choice.",
    "Say how you'd test it and handle edge cases / failure modes.",
  ];
}

function generalPoints({ headline, skills, expRef, seed }) {
  const anchor = expRef
    ? `Anchor your answer in a concrete example — e.g. ${expRef}.`
    : headline.company
      ? `Anchor your answer in a concrete example from ${headline.company}.`
      : "Anchor your answer in one concrete example, not generalities.";
  const close = pick(seed, [
    "Tie it back to why this specific role and company excite you.",
    "Close by connecting it to what this role is asking for.",
    "End on why this team, specifically, is the right fit for you.",
  ]);
  return [
    anchor,
    skills.length
      ? `Highlight the strengths most relevant to this role: ${skills.slice(0, 3).join(", ")}.`
      : "Highlight the 2-3 strengths most relevant to this role.",
    "Keep it to ~60-90 seconds — lead with the point, then the evidence.",
    close,
  ];
}

// Build glanceable talking points for a live interview question, grounded in the
// candidate's profile. `interviewType` (any string, normalized here) only ever
// matters when the question's own classification is "general" — see
// resolveScaffoldType above. Returns { points: string[], type }.
export function draftAnswerLocal({ question, profile = "", interviewType } = {}) {
  const q = String(question || "").trim();
  const type = resolveScaffoldType(classifyQuestionType(q), interviewType);
  const skills = profileSkills(profile);
  const headline = profileHeadline(profile);
  const metric = profileMetric(profile);
  const hint = skillHint(q, skills);
  const expRef = relevantExperienceLine(profile, q);
  const seed = q || profile;

  let points;
  if (type === "behavioral") points = behavioralPoints({ headline, metric, hint, expRef, seed });
  else if (type === "technical") points = technicalPoints({ question: q, skills, hint, expRef, seed });
  else points = generalPoints({ headline, skills, expRef, seed });

  return {
    points: points.filter((p) => typeof p === "string" && p.trim()).slice(0, MAX_POINTS),
    type,
  };
}
