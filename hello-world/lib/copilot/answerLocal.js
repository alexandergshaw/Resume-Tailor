// Zero-cost interview talking points — the embedded copilot's answer generator.
// The LLM path returns 3-5 glanceable bullet points grounded in the candidate's
// background (STAR-prefixed for behavioral questions). This reproduces that
// contract deterministically: it classifies the question, mines the candidate's
// real skills (extractKeywords) and companies/metrics from the profile, and
// assembles a STAR scaffold or a technical/general checklist that references
// them. No network, no API key.

import { classifyQuestionType } from "./questionType.js";
import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { parseEmploymentHistory } from "@/lib/resume/parseEmployment";

const SKILL_CATEGORIES = ["technology", "tool_platform", "domain"];
const MAX_POINTS = 5;

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
  const pick = (matched.length ? matched : skills).slice(0, 3);
  return pick.join(", ");
}

function behavioralPoints({ headline, metric, hint }) {
  const situation = headline.company
    ? `a specific project at ${headline.company}${headline.title ? ` as ${headline.title}` : ""}`
    : "one specific, relevant project";
  return [
    `Situation: Set the scene briefly — ${situation}.`,
    "Task: State the goal you personally owned and why it mattered.",
    `Action: Walk through the concrete steps you took${hint ? ` (${hint})` : ""}.`,
    `Result: Close with a measurable outcome${metric ? ` — e.g. ${metric}` : " (a metric or clear impact)"}.`,
  ];
}

function technicalPoints({ question, skills, hint }) {
  const matched = matchedSkills(question, skills);
  const grounding = matched.length
    ? `Ground it in your hands-on experience with ${matched.slice(0, 3).join(", ")}.`
    : hint
      ? `Draw on your ${hint} background for a concrete reference point.`
      : "Anchor it in a real system you've built, not theory.";
  return [
    "Clarify the requirements and constraints before you answer.",
    "Think out loud — outline your approach before diving into details.",
    grounding,
    "Call out the trade-offs (time vs. space, simplicity vs. scale) and justify your choice.",
    "Say how you'd test it and handle edge cases / failure modes.",
  ];
}

function generalPoints({ headline, skills }) {
  return [
    headline.company
      ? `Anchor your answer in a concrete example from ${headline.company}.`
      : "Anchor your answer in one concrete example, not generalities.",
    skills.length
      ? `Highlight the strengths most relevant to this role: ${skills.slice(0, 3).join(", ")}.`
      : "Highlight the 2-3 strengths most relevant to this role.",
    "Keep it to ~60-90 seconds — lead with the point, then the evidence.",
    "Tie it back to why this specific role and company excite you.",
  ];
}

// Build glanceable talking points for a live interview question, grounded in the
// candidate's profile. Returns { points: string[], type }.
export function draftAnswerLocal({ question, profile = "" } = {}) {
  const q = String(question || "").trim();
  const type = classifyQuestionType(q);
  const skills = profileSkills(profile);
  const headline = profileHeadline(profile);
  const metric = profileMetric(profile);
  const hint = skillHint(q, skills);

  let points;
  if (type === "behavioral") points = behavioralPoints({ headline, metric, hint });
  else if (type === "technical") points = technicalPoints({ question: q, skills, hint });
  else points = generalPoints({ headline, skills });

  return {
    points: points.filter((p) => typeof p === "string" && p.trim()).slice(0, MAX_POINTS),
    type,
  };
}
