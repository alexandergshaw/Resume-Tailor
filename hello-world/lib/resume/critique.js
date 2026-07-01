// Deterministic per-bullet resume critique — the embedded chat's version of an
// LLM resume review. Instead of generic advice, it inspects the candidate's
// actual experience bullets (via the same employment parser the import flow
// uses) and flags the classic weaknesses a reviewer would: weak openers
// ("responsible for…"), no quantified outcome, and run-on bullets.

import { parseEmploymentHistory } from "./parseEmployment.js";

const WEAK_OPENERS = [
  "responsible for",
  "worked on",
  "helped with",
  "helped to",
  "duties included",
  "assisted with",
  "assisted in",
  "tasked with",
  "involved in",
  "participated in",
  "was part of",
  "in charge of",
];

const METRIC_RE = /\d|%|\$/;
const MAX_BULLET_CHARS = 220;
const MIN_BULLET_CHARS = 20;

function weakOpenerOf(line) {
  const l = line.toLowerCase();
  return WEAK_OPENERS.find((w) => l.startsWith(w)) || "";
}

// Analyze one bullet line → array of { code, advice } issues (empty = fine).
export function critiqueBullet(line) {
  const text = String(line || "").trim();
  if (!text) return [];
  const issues = [];
  const weak = weakOpenerOf(text);
  if (weak) {
    issues.push({
      code: "weak-opener",
      advice: `lead with a strong verb (Built, Led, Cut) instead of "${weak}"`,
    });
  }
  if (!METRIC_RE.test(text)) {
    issues.push({
      code: "no-metric",
      advice: "add a number — scale, percentage, dollars, or users — to make it concrete",
    });
  }
  if (text.length > MAX_BULLET_CHARS) {
    issues.push({ code: "too-long", advice: "split it — one outcome per bullet" });
  } else if (text.length < MIN_BULLET_CHARS) {
    issues.push({ code: "too-short", advice: "say what you did AND what changed because of it" });
  }
  return issues;
}

// Critique the whole resume text. Returns:
//   { bullets: [{ text, issues }], total, withMetrics, flagged }
// `bullets` lists ONLY flagged bullets (worst first: most issues, then longest).
export function critiqueResume(resumeText) {
  const positions = parseEmploymentHistory(String(resumeText || ""), { maxEntries: 10 });
  const lines = [];
  for (const p of positions) {
    for (const note of String(p.notes || "").split("\n")) {
      const t = note.trim();
      if (t) lines.push(t);
    }
  }

  let withMetrics = 0;
  const flaggedBullets = [];
  for (const text of lines) {
    if (METRIC_RE.test(text)) withMetrics += 1;
    const issues = critiqueBullet(text);
    if (issues.length > 0) flaggedBullets.push({ text, issues });
  }
  flaggedBullets.sort((a, b) => b.issues.length - a.issues.length || b.text.length - a.text.length);

  return {
    bullets: flaggedBullets,
    total: lines.length,
    withMetrics,
    flagged: flaggedBullets.length,
  };
}

// Render the critique as short plain prose for the chat (no markdown emphasis).
// Returns "" when there was nothing bullet-shaped to critique.
export function renderCritique(critique, { maxExamples = 3 } = {}) {
  const c = critique || {};
  if (!c.total) return "";
  const parts = [];
  parts.push(
    `${c.withMetrics} of your ${c.total} experience bullets ${c.withMetrics === 1 ? "has" : "have"} a number in ${c.withMetrics === 1 ? "it" : "them"} — quantified bullets are what reviewers remember.`,
  );
  for (const b of (c.bullets || []).slice(0, maxExamples)) {
    const excerpt = b.text.length > 60 ? `${b.text.slice(0, 60).trim()}…` : b.text;
    const advice = b.issues.map((i) => i.advice).join("; ");
    parts.push(`"${excerpt}" — ${advice}.`);
  }
  if (c.flagged > maxExamples) {
    parts.push(`${c.flagged - maxExamples} more bullet${c.flagged - maxExamples === 1 ? "" : "s"} could use the same treatment.`);
  }
  return parts.join(" ");
}
