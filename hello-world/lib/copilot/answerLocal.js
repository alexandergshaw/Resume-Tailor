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
// AC-H4.19: mining over the submitted résumé/cover letter runs a wider skill
// pool than the default before filtering down to literal mentions — the
// same reasoning sampleAnswerLocal.js's draftSampleAnswerLocal uses: a
// taxonomy inference bumping a real skill out of the top few must not also
// cost that real skill its spot once the inference itself is dropped.
const WIDE_SKILL_POOL = 12;
// The STAR-label prefix a behavioral point may carry, matching the exact
// convention POINTS_SYSTEM (app/api/copilot/answer/route.js) already uses.
// Shared so both that route and sampleAnswerLocal.js's draftSampleAnswerLocal
// strip it the same way when deriving flowing prose from generated points
// (AC-H9.33). Exported for lib/copilot/answerCues.js, which must split the
// SAME label off the front of a point before shortening the sentence behind
// it — a second copy of this pattern there would be free to drift from the
// one the prompts actually emit.
export const STAR_LABEL_RE = /^(Situation|Task|Action|Result):\s*/;

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
//
// The noun list deliberately excludes "people"/"engineers"/"reports" — a
// digit next to one of those ("led a team of 6 engineers") states the SCOPE
// of a role, not an outcome of it, and project pages (which this same
// function mines via draftAnswerLocal/draftSampleAnswerLocal, see
// combineMaterial) are dense with exactly that phrasing. Presenting a team
// size as a "Result:" metric was a real, reported defect; the fix is to never
// treat that shape as an achievement figure, not to special-case any one
// caller.
export function profileMetric(profile) {
  const m = String(profile || "").match(
    /(\d+(?:\.\d+)?%|\$\s?\d[\d,.]*\s?[kmb]?\b|\b\d[\d,]*\+?\s*(?:users|customers|clients|requests|deals|hires|hours|days|x)\b)/i,
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

// The top `limit` candidate lines from `profile`, ranked exactly the way a
// single "most relevant line" search would score them — overlap with the
// question terms plus an "accomplishment" signal (a verb or metric),
// skipping headers and skills lists. Exported so a caller wanting a SECOND
// (or third) usable line — resumeAnchor.js's `description`, drawn from the
// same role's remaining bullets — can pull one without re-deriving this
// scoring a second time, which would let the two drift on what counts as a
// usable line. `relevantExperienceLine` below is this with `limit: 1`, so
// the two can never disagree about what the single best line is.
//
// Ties keep source order (stable sort, plain `>` comparisons below never
// replace on equal score) — the same determinism `relevantExperienceLine`
// got before this was factored out, where only a STRICTLY greater score
// replaced the running best.
export function rankedExperienceLines(profile, question, limit = 1) {
  const lines = String(profile || "")
    .split(/\r?\n+/)
    .map((l) => l.replace(/^[\s•\-*–—>]+/, "").trim())
    .filter(Boolean);
  const qTerms = new Set((String(question || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []));

  const scored = [];
  for (const s of lines) {
    if (s.length < 24) continue;
    if (/^(skills?|technologies|tools|education|summary|objective)\s*:/i.test(s)) continue;
    const words = s.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    let overlap = 0;
    for (const w of words) if (qTerms.has(w)) overlap += 1;
    const hasSignal = /\d/.test(s) || ACHIEVEMENT_VERBS.test(s);
    const score = overlap * 2 + (hasSignal ? 1 : 0);
    if (score > 0) scored.push({ line: s, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const out = [];
  for (const item of scored) {
    const cleaned = cleanLine(item.line);
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

// The single most relevant, concrete line from the candidate's profile for this
// question — the raw material an LLM would cite. Profiles are line-oriented
// (resume/prep bullets), so it scores each line by overlap with the question
// plus an "accomplishment" signal (a verb or metric), skipping headers and
// skills lists.
export function relevantExperienceLine(profile, question) {
  return rankedExperienceLines(profile, question, 1)[0] || "";
}

// AC-H4.15/AC-H4.18: combines every source of real material the candidate
// has on file into one string every mining helper below can run over
// uniformly — the candidate's own prep notes/profile plus, when available,
// the résumé and cover letter actually submitted for the selected
// application. Shared by draftAnswerLocal below (live mode's talking
// points, once a posting with documents is selected) and
// sampleAnswerLocal.js's draftSampleAnswerLocal (practice mode's sample
// answer), so both engines combine the same three sources the same way —
// reused here rather than re-derived in each file.
export function combineMaterial(profile, resume, coverLetter) {
  return [profile, resume, coverLetter]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A mined skill (profileSkills) can be a taxonomy inference rather than
// something the candidate actually wrote — e.g. "team" gets canonicalized to
// the product "Microsoft Teams". Surfaced as a talking point or spoken
// aloud, that reads as a claimed skill the candidate never mentioned, so a
// mined skill only counts once its own canonical name literally occurs,
// case insensitively, somewhere in the material it was mined from. Exported
// so any mining over submitted documents — here and in
// sampleAnswerLocal.js — applies the same defense instead of re-deriving it
// (the recorded "team" -> "Microsoft Teams" mining hazard).
export function literallyMentioned(term, material) {
  const t = String(term || "").trim();
  if (!t) return false;
  const escaped = escapeRegExp(t);
  const startsWithWordChar = /^\w/.test(t);
  const endsWithWordChar = /\w$/.test(t);
  const pattern = new RegExp(`${startsWithWordChar ? "\\b" : ""}${escaped}${endsWithWordChar ? "\\b" : ""}`, "i");
  return pattern.test(material);
}

// A line that reads as an application/motivation statement ("I am applying
// for...", "I'm excited about...") rather than something the candidate
// actually did. relevantExperienceLine scores purely on keyword overlap
// plus an achievement signal, so a cover letter's opening line can out-score
// a real accomplishment when the question's own wording happens to overlap
// with it. Exported so both draftAnswerLocal and draftSampleAnswerLocal test
// against the same wording instead of duplicating the pattern.
export const MOTIVATION_LINE_RE =
  /\b(i am applying|i'm applying|i am excited|i'm excited|looking forward to|excited (?:to|about)|would love to|hope to|eager to|i want to|passionate about|interested in (?:this|the|joining))\b/i;

// A line only counts as real past work when it carries its own achievement
// signal (a verb from ACHIEVEMENT_VERBS or a number) and doesn't read as
// motivation phrasing (the recorded "motivation line quoted as a concrete
// example" mining hazard).
export function isPastWorkLine(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  const hasAchievementSignal = /\d/.test(t) || ACHIEVEMENT_VERBS.test(t);
  return hasAchievementSignal && !MOTIVATION_LINE_RE.test(t);
}

// relevantExperienceLine's cleanLine helper truncates anything over 140
// characters mid-word with a trailing ellipsis — tolerable in a glanceable
// point, but a quote that visibly stops mid-word is never something a
// person would actually say aloud, so a caller building a spoken sentence
// (not a fragment) around it should treat that the same as no example
// having been found.
export function usableExperienceLine(line) {
  return line && !line.endsWith("…") ? line : "";
}

// The concrete example a caller may cite as evidence of past work — never a
// motivation statement. relevantExperienceLine only ever returns its single
// top-scoring line, so when that line reads as motivation rather than past
// work (a cover letter's "I am applying for..." opener can out-score a real
// accomplishment on keyword overlap alone), this looks again with every
// such line removed from the material. Exported so sampleAnswerLocal.js's
// behavioral/general shapes reuse the same disqualification instead of
// re-deriving it.
export function pastWorkExperienceLine(material, question) {
  const top = usableExperienceLine(relevantExperienceLine(material, question));
  if (!top || isPastWorkLine(top)) return top;
  const withoutMotivationLines = String(material || "")
    .split(/\r?\n+/)
    .filter((line) => isPastWorkLine(line.replace(/^[\s•\-*–—>]+/, "").trim()))
    .join("\n");
  return usableExperienceLine(relevantExperienceLine(withoutMotivationLines, question));
}

// Turns generated bullet points (each a complete, speakable sentence,
// possibly STAR-labeled) into flowing prose: strips a leading STAR label
// from each point, then joins with a single space. Shared by
// app/api/copilot/answer/route.js (mode "answer", both the Gemini and
// embedded paths) and sampleAnswerLocal.js's draftSampleAnswerLocal, so a
// later feature that synthesizes audio from `answer` always gets the exact
// same derivation regardless of which engine drafted the points — two
// independently generated versions of the same answer would drift; this is
// the one place that computes it (AC-H9.33).
export function deriveAnswerFromPoints(points) {
  return (Array.isArray(points) ? points : [])
    .map((p) => String(p || "").replace(STAR_LABEL_RE, "").trim())
    .filter(Boolean)
    .join(" ");
}

// Every shape function below now returns { points, pageIndices } rather than
// a bare array: `pageIndices` names which entries of `points` carry a clause
// drawn from `story` (ARCH §3.6 / §3.5's per-point pageSources), a no-op
// (empty array, `story` never consulted) whenever `story` is null — the
// unmatched-page and no-story cases collapse to the same byte-identical path
// (AC-5.2's "never speaks a page that doesn't match as though it were
// chosen"). Live mode's response DOES surface `pageSources` now (AC-6.2 —
// app/api/copilot/answer/route.js returns it from the points-mode branch, and
// this function is what that branch's embedded engine gets it from). This
// comment used to say live mode never surfaced it; the route was updated and
// the comment was not.
function behavioralPoints({ headline, metric, hint, expRef, seed, story }) {
  const situation = headline.company
    ? `a specific project at ${headline.company}${headline.title ? ` as ${headline.title}` : ""}`
    : "one specific, relevant project";
  const opener = pick(seed, ["Set the scene briefly", "Frame the context in a sentence", "Open with where and when"]);
  // AC-5.1: a matched project page's own bullet is preferred over the
  // résumé/profile expRef for the concrete "e.g." clause — the same
  // preference order sampleAnswerLocal.js's shapes use.
  const pageClause = story?.bullets?.[0] || "";
  const groundingClause = pageClause || expRef;
  // Prefer a real accomplishment as the Action example; fall back to the skills hint.
  const actionTail = groundingClause ? ` — e.g. ${groundingClause}` : hint ? ` (${hint})` : "";
  const points = [
    `Situation: ${opener} — ${situation}.`,
    "Task: State the goal you personally owned and why it mattered.",
    `Action: Walk through the concrete steps you took${actionTail}.`,
    `Result: Close with a measurable outcome${metric ? ` — e.g. ${metric}` : " (a metric or clear impact)"}.`,
  ];
  return { points, pageIndices: pageClause ? [2] : [] };
}

function technicalPoints({ question, skills, hint, expRef, seed, story }) {
  const matched = matchedSkills(question, skills);
  // AC-5.1: "a technical question draws its approach from the best-matching
  // page's own bullets" — preferred over expRef, same preference order as
  // behavioralPoints above.
  const pageClause = story?.bullets?.[0] || "";
  const groundingText = pageClause || expRef;
  const grounding = groundingText
    ? `Ground it in real work you've done — e.g. ${groundingText}.`
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
  const points = [
    open,
    "Think out loud — outline your approach before diving into details.",
    grounding,
    "Call out the trade-offs (time vs. space, simplicity vs. scale) and justify your choice.",
    "Say how you'd test it and handle edge cases / failure modes.",
  ];
  return { points, pageIndices: pageClause ? [2] : [] };
}

function generalPoints({ headline, skills, expRef, seed, story }) {
  // AC-5.1: the general shape's experience beat prefers a matched page
  // bullet over expRef too.
  const pageClause = story?.bullets?.[0] || "";
  const groundingText = pageClause || expRef;
  const anchor = groundingText
    ? `Anchor your answer in a concrete example — e.g. ${groundingText}.`
    : headline.company
      ? `Anchor your answer in a concrete example from ${headline.company}.`
      : "Anchor your answer in one concrete example, not generalities.";
  const close = pick(seed, [
    "Tie it back to why this specific role and company excite you.",
    "Close by connecting it to what this role is asking for.",
    "End on why this team, specifically, is the right fit for you.",
  ]);
  const points = [
    anchor,
    skills.length
      ? `Highlight the strengths most relevant to this role: ${skills.slice(0, 3).join(", ")}.`
      : "Highlight the 2-3 strengths most relevant to this role.",
    "Keep it to ~60-90 seconds — lead with the point, then the evidence.",
    close,
  ];
  return { points, pageIndices: pageClause ? [0] : [] };
}

// Build glanceable talking points for a live interview question, grounded in the
// candidate's profile and, once a posting with submitted documents is selected
// (AC-H4.15), the résumé and cover letter actually submitted for it.
// `interviewType` (any string, normalized here) only ever matters when the
// question's own classification is "general" — see resolveScaffoldType above.
// Returns { points: string[], type, pageSources }.
//
// With no resume/coverLetter (the caller has no applicationId, or no documents
// were found for it), this computes skills/headline/metric/expRef from
// `profile` alone via the exact same calls this function made before AC-H4 —
// byte-identical output to what it produced before submitted documents existed
// as a grounding source (AC-H4.18). Only when a document is present does
// mining run over the combined material, and then with the same defenses
// sampleAnswerLocal.js's grounding uses against its recorded mining hazards
// (AC-H4.19): a wider skill pool filtered to literally-mentioned skills only
// (never a taxonomy inference like "team" -> "Microsoft Teams"), an experience
// line disqualified from being a motivation statement posing as a concrete
// example, and a metric spoken only when it comes from that SAME experience
// line — never a bare figure paired with a story mined from elsewhere.
//
// `story` (ARCH §3.6) is lib/copilot/projectStories.js's selectBestStory
// return, selected once by the route and handed down — see
// sampleAnswerLocal.js's draftSampleAnswerLocal for the full reasoning (D7,
// AC-5.2/5.3), which this mirrors. Used only when `story.matched === true`;
// `story === null` and an unmatched story are the same byte-identical case
// below, protecting every existing caller of this function.
export function draftAnswerLocal({ question, profile = "", resume = "", coverLetter = "", interviewType, story = null } = {}) {
  const q = String(question || "").trim();
  const type = resolveScaffoldType(classifyQuestionType(q), interviewType);
  const effectiveStory = story && story.matched ? story : null;

  const hasDocs = Boolean(String(resume || "").trim()) || Boolean(String(coverLetter || "").trim());

  let skills;
  let headline;
  let metric;
  let expRef;
  if (hasDocs) {
    const material = combineMaterial(profile, resume, coverLetter);
    skills = profileSkills(material, WIDE_SKILL_POOL).filter((s) => literallyMentioned(s, material));
    headline = profileHeadline(material);
    expRef = pastWorkExperienceLine(material, q);
    metric = expRef ? profileMetric(expRef) : "";
  } else {
    skills = profileSkills(profile);
    headline = profileHeadline(profile);
    metric = profileMetric(profile);
    expRef = relevantExperienceLine(profile, q);
  }

  const hint = skillHint(q, skills);
  const seed = q || profile;

  let rawResult;
  if (type === "behavioral") rawResult = behavioralPoints({ headline, metric, hint, expRef, seed, story: effectiveStory });
  else if (type === "technical") rawResult = technicalPoints({ question: q, skills, hint, expRef, seed, story: effectiveStory });
  else rawResult = generalPoints({ headline, skills, expRef, seed, story: effectiveStory });

  const pageIndexSet = new Set(rawResult.pageIndices);
  // Same ordering rule as sampleAnswerLocal.js's draftSampleAnswerLocal:
  // `fromPage` is carried alongside each point through the blank-entry
  // filter and the MAX_POINTS cut, never recomputed against a post-filter
  // index.
  const usableEntries = rawResult.points
    .map((p, i) => ({ point: p, fromPage: pageIndexSet.has(i) }))
    .filter((entry) => typeof entry.point === "string" && entry.point.trim())
    .slice(0, MAX_POINTS);

  const points = usableEntries.map((entry) => entry.point);
  const pageSources = usableEntries.map((entry) =>
    entry.fromPage && effectiveStory && effectiveStory.pageId
      ? { id: effectiveStory.pageId, title: effectiveStory.title }
      : null,
  );

  return { points, type, pageSources };
}
