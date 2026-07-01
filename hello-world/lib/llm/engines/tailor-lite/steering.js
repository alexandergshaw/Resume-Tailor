// Deterministic steering — the embedded engine's version of the preview's
// "revise" box. An LLM reads free-text notes like "emphasize React, drop Java,
// be a bit bolder" and rewrites accordingly; this parses the same notes into
// three concrete directive kinds and applies them to the keyword rankings that
// drive slot mapping:
//   - emphasize <terms>  → boost those canonicals to the top of their category
//   - avoid <terms>      → remove those canonicals from every category
//   - bolder / tone down → nudge aggressiveness up/down one step
// Terms are canonicalized through the same taxonomy the engine tailors with, so
// "focus on k8s" boosts "Kubernetes". Unrecognized directives are reported back
// (report.meta.steering) instead of silently ignored.

import { extractKeywords } from "./keywords.js";

const EMPHASIZE_RE =
  /\b(?:emphasi[sz]e|focus(?: more)? on|highlight|feature|stress|lead with|prioriti[sz]e|play up|talk(?: more)? about|mention|include|add)\b/i;
const AVOID_RE =
  /\b(?:avoid|remove|drop|cut|exclude|omit|de-?emphasi[sz]e|downplay|no mention of|less about|without|don'?t (?:mention|include|use|emphasi[sz]e)|leave out)\b/i;
const AGG_UP_RE =
  /\b(?:more aggressive(?:ly)?|bolder|stronger|punchier|push (?:it )?harder|amp (?:it )?up|dial (?:it )?up|sell (?:it|me) harder)\b/i;
const AGG_DOWN_RE =
  /\b(?:less aggressive(?:ly)?|tone (?:it )?down|more conservative|more truthful|more honest|safer|dial (?:it )?back|stick to the facts)\b/i;

// Split a steering note into clauses so "emphasize X. remove Y" applies both.
function clauses(text) {
  return String(text || "")
    .split(/[.;\n]+|\bbut\b|\band then\b/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

// Canonicalize the terms in a clause tail through the taxonomy. Returns
// [{ canonical, category }]; terms the taxonomy doesn't know are returned in
// `unrecognized` (title-cased raw words) so the caller can report them.
function canonicalTerms(tail, taxonomy) {
  const grouped = extractKeywords(tail, taxonomy);
  const out = [];
  for (const [category, items] of Object.entries(grouped)) {
    if (category === "topic") continue; // RAKE phrases aren't slot categories
    for (const it of items) out.push({ canonical: it.canonical, category });
  }
  return out;
}

// Parse a free-text steering note into structured directives.
// Returns { emphasize, avoid, aggressivenessDelta, hasDirectives }.
export function parseSteering(text, taxonomy) {
  const emphasize = [];
  const avoid = [];
  let aggressivenessDelta = 0;

  const note = String(text || "").trim();
  if (!note) return { emphasize, avoid, aggressivenessDelta: 0, hasDirectives: false };

  if (AGG_UP_RE.test(note)) aggressivenessDelta += 1;
  if (AGG_DOWN_RE.test(note)) aggressivenessDelta -= 1;

  const seen = { emphasize: new Set(), avoid: new Set() };
  const push = (list, kind, terms) => {
    for (const t of terms) {
      const key = t.canonical.toLowerCase();
      if (seen[kind].has(key)) continue;
      seen[kind].add(key);
      list.push(t);
    }
  };

  for (const clause of clauses(note)) {
    // Check avoid first: "don't mention Java" also matches the emphasize verb
    // list via "mention", and negations must win.
    const avoidMatch = clause.match(AVOID_RE);
    const emphMatch = clause.match(EMPHASIZE_RE);
    if (avoidMatch && (!emphMatch || avoidMatch.index <= emphMatch.index)) {
      push(avoid, "avoid", canonicalTerms(clause.slice(avoidMatch.index + avoidMatch[0].length), taxonomy));
    } else if (emphMatch) {
      push(emphasize, "emphasize", canonicalTerms(clause.slice(emphMatch.index + emphMatch[0].length), taxonomy));
    }
  }

  // Anything emphasized AND avoided ("mention X ... actually drop X"): avoid wins.
  const avoided = new Set(avoid.map((t) => t.canonical.toLowerCase()));
  const finalEmphasize = emphasize.filter((t) => !avoided.has(t.canonical.toLowerCase()));

  return {
    emphasize: finalEmphasize,
    avoid,
    aggressivenessDelta,
    hasDirectives: finalEmphasize.length > 0 || avoid.length > 0 || aggressivenessDelta !== 0,
  };
}

// Score added to an emphasized canonical so it outranks everything organic.
const BOOST = 1000;

// Apply parsed directives to the grouped keyword map ({ category: [{canonical,
// score, count}] }) that mapSlots ranks by. Pure — returns a new map.
export function applySteering(keywords, steering) {
  if (!steering || (!steering.emphasize?.length && !steering.avoid?.length)) return keywords;

  const avoided = new Set((steering.avoid || []).map((t) => t.canonical.toLowerCase()));
  const out = {};
  for (const [category, items] of Object.entries(keywords || {})) {
    // Clone the items too — boosting must never mutate the caller's map.
    out[category] = items
      .filter((it) => !avoided.has(String(it.canonical).toLowerCase()))
      .map((it) => ({ ...it }));
  }

  for (const t of steering.emphasize || []) {
    const list = out[t.category] || (out[t.category] = []);
    const existing = list.find((it) => it.canonical.toLowerCase() === t.canonical.toLowerCase());
    if (existing) existing.score += BOOST;
    else list.push({ canonical: t.canonical, score: BOOST, count: 1 });
    list.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  }

  return out;
}

// Clamp an aggressiveness value after applying the steering delta. `base` may be
// undefined (the engine's own default is 3).
export function steerAggressiveness(base, steering) {
  const delta = steering?.aggressivenessDelta || 0;
  if (delta === 0) return base;
  const b = Number.isFinite(base) ? base : 3;
  return Math.min(5, Math.max(1, b + delta));
}
