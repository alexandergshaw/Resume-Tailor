// Skill-phrase miner — extracts the skills a posting states in prose that the
// taxonomy doesn't know. Postings phrase requirements in stock constructions
// ("Knowledge of web management principles", "Experience with content
// management systems, search engine optimization best practices, and
// analytics", "Skill in editing and proofreading"), so instead of hoping RAKE
// stumbles onto them, this targets those constructions directly: capture the
// tail after a skill introducer, split the list, tidy each candidate down to
// its noun phrase, and keep only candidates that are neither noise nor already
// known to the taxonomy (alias-aware via canonicalize). Deterministic.

import { canonicalize } from "./keywords.js";
import { isNoiseTopic } from "./topicNoise.js";

// "Knowledge of X", "Skill in X", "Experience (required) with/in X", etc.
const INTRODUCER_SRC =
  "(?:knowledge of|skill(?:s|ed)?\\s+(?:in|with)|experience(?:\\s+\\w+){0,2}\\s+(?:with|in|using)|proficien(?:t|cy)\\s+(?:with|in)|familiar(?:ity)?\\s+with|expertise\\s+(?:in|with)|background\\s+in|working knowledge of|competen(?:cy|ce|t)\\s+(?:with|in)|understanding of|ability to use|trained in|certifi(?:ed|cation)\\s+in)";
const INTRODUCER_RE = new RegExp(`\\b${INTRODUCER_SRC}\\s+([^.;:!?\\n]+)`, "gi");
// A second introducer INSIDE a captured tail ("Knowledge of X and experience
// with Y" in one sentence) — the real candidate is what follows it.
const INNER_INTRODUCER_RE = new RegExp(`\\b${INTRODUCER_SRC}\\s+(.+)$`, "i");

// List separators inside a captured tail. "such as" / "including" introduce the
// concrete examples — both sides are kept as candidates.
const LIST_SPLIT_RE = /,|\band\b|\bor\b|;|\bsuch as\b|\bincluding\b|\be\.g\.\b/gi;

// Leading words that modify rather than name the skill — articles, adjectives,
// and prepositions ("working at a fast pace" → "pace", which is generic).
const LEADING_FILLER_RE =
  /^(?:a|an|the|all|any|various|other|modern|current|relevant|related|strong|excellent|demonstrated|proven|hands.?on|advanced|basic|solid|fast|good|great|at|in|on|to|with|within|across)\s+/i;
// Leading gerunds ("creating/writing content…") — the skill is what follows.
// Behavioral gerunds (organizing, prioritizing…) reduce KSA filler like
// "organizing work" to its (generic, droppable) noun.
const GERUND_LEAD_RE =
  /^(?:creating|writing|using|managing|developing|maintaining|building|designing|editing|producing|running|leading|organizing|following|prioritizing|multitasking|working|planning|coordinating|monitoring|ensuring|providing)(?:\/\w+)*(?:\s+|$)/i;
// Trailing advice-ish filler that pads the noun phrase without naming anything
// ("search engine optimization best practices" → "search engine optimization").
const TRAILING_FILLER_RE =
  /(?:\s+(?:best practices|principles(?:\s+and\s+practices)?|practices|methods|standards|techniques|concepts|skills|abilities|is\s+(?:required|preferred|a\s+plus)|required|preferred))+\s*$/i;

// Single words too generic to suggest on their own.
const GENERIC_WORDS = new Set([
  "content", "web", "data", "systems", "system", "tools", "tool", "software", "technology",
  "technologies", "experience", "knowledge", "information", "management", "development",
  "design", "practices", "methods", "standards", "related", "field", "work", "works",
  "skills", "skill", "ability", "abilities", "university", "college", "department",
  "departmental", "campus", "staff", "students", "oral", "written", "internet", "computer",
  "computers", "office", "others", "etc", "procedures", "records", "files", "through",
  "detail", "pace", "environment",
]);

const MAX_PHRASE_WORDS = 4;
const MIN_PHRASE_CHARS = 3;
const MAX_PHRASE_CHARS = 40;

// Tidy one raw list item down to a candidate noun phrase (or "" to discard).
function cleanCandidate(raw) {
  let p = String(raw || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s\-–—·•*]+|[\s\-–—·•*.,]+$/g, "");
  // A nested introducer means the skill is what FOLLOWS it.
  const inner = p.match(INNER_INTRODUCER_RE);
  if (inner) p = inner[1].trim();

  const stripLeading = (s) => {
    let out = s;
    for (let guard = 0; guard < 4; guard += 1) {
      const before = out;
      out = out.replace(LEADING_FILLER_RE, "");
      if (out === before) break;
    }
    return out.trim();
  };

  p = stripLeading(p);
  p = p.replace(GERUND_LEAD_RE, "");
  p = p.replace(TRAILING_FILLER_RE, "").trim();
  // "content for digital media" / "management of files" — the named thing
  // follows the preposition; what precedes it is connective filler.
  for (const prep of [" for ", " of "]) {
    const idx = p.toLowerCase().indexOf(prep);
    if (idx > -1) p = p.slice(idx + prep.length).trim();
  }
  p = stripLeading(p);
  // A lone adverb ("collaboratively", "independently") names a manner, not a skill.
  if (/^\w+ly$/i.test(p)) return "";
  return p;
}

function isKnownToTaxonomy(phrase, taxonomy) {
  const p = phrase.toLowerCase();
  if (canonicalize(p, taxonomy)) return true;
  // Naive plural: "content management systems" ↔ "…system".
  if (p.endsWith("s") && canonicalize(p.slice(0, -1), taxonomy)) return true;
  return false;
}

// Mine a posting for skill phrases the taxonomy doesn't recognize.
// Returns [{ phrase, count }] — most-mentioned first, then first-seen order.
export function mineSkillPhrases(posting, taxonomy) {
  const text = String(posting || "");
  if (!text.trim()) return [];

  const counts = new Map(); // lower phrase -> { phrase (as first seen), count, order }
  let order = 0;
  INTRODUCER_RE.lastIndex = 0;
  let m;
  while ((m = INTRODUCER_RE.exec(text)) !== null) {
    for (const raw of m[1].split(LIST_SPLIT_RE)) {
      const phrase = cleanCandidate(raw);
      if (!phrase) continue;
      const words = phrase.split(/\s+/);
      if (words.length > MAX_PHRASE_WORDS) continue;
      if (phrase.length < MIN_PHRASE_CHARS || phrase.length > MAX_PHRASE_CHARS) continue;
      if (!/[a-z]/i.test(phrase)) continue;
      if (words.length === 1 && GENERIC_WORDS.has(phrase.toLowerCase())) continue;
      if (isNoiseTopic(phrase)) continue;
      if (isKnownToTaxonomy(phrase, taxonomy)) continue;
      const key = phrase.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { phrase, count: 1, order: order++ });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map(({ phrase, count }) => ({ phrase, count }));
}
