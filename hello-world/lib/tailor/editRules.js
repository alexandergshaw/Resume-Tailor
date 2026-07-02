// Paired-edit extraction — turns a hand-edit session into candidate rewrite
// rules. Where editMining.js harvests ADDED lines (new vocabulary), this
// aligns MODIFIED lines to their originals and distills each change into a
// minimal "before → after" replacement, so recurring fixes ("team of 5" →
// "team of 8", a fact the engine keeps getting wrong, or a formatting tweak)
// can be tracked across resumes AND cover letters and eventually applied
// automatically at render time. Pure functions, no I/O.

const MIN_SIMILARITY = 0.45; // token Jaccard for pairing a modified line
const MIN_BEFORE_CHARS = 4; // a rule's match text must be distinctive
const MIN_DELETE_CHARS = 8; // deletions need more evidence than swaps
const MAX_RULE_CHARS = 160;
export const MAX_RULES_PER_REQUEST = 20;

function norm(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function tokens(line) {
  return new Set(norm(line).toLowerCase().match(/[a-z0-9]+/g) || []);
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let common = 0;
  for (const t of a) if (b.has(t)) common += 1;
  return common / (a.size + b.size - common);
}

// Align modified lines: originals that vanished vs. edited lines that appeared,
// greedily paired by highest token similarity. Unpaired lines are additions or
// deletions (handled elsewhere), not modifications.
export function pairEdits(beforeLines, afterLines) {
  const beforeSet = new Set((beforeLines || []).map((l) => norm(l).toLowerCase()));
  const afterSet = new Set((afterLines || []).map((l) => norm(l).toLowerCase()));
  const gone = (beforeLines || []).map(norm).filter((l) => l && !afterSet.has(l.toLowerCase()));
  const appeared = (afterLines || []).map(norm).filter((l) => l && !beforeSet.has(l.toLowerCase()));

  const candidates = [];
  gone.forEach((b, bi) =>
    appeared.forEach((a, ai) => candidates.push({ bi, ai, score: jaccard(tokens(b), tokens(a)) })),
  );
  candidates.sort((x, y) => y.score - x.score);

  const usedB = new Set();
  const usedA = new Set();
  const pairs = [];
  for (const { bi, ai, score } of candidates) {
    if (score < MIN_SIMILARITY) break;
    if (usedB.has(bi) || usedA.has(ai)) continue;
    usedB.add(bi);
    usedA.add(ai);
    pairs.push({ before: gone[bi], after: appeared[ai] });
  }
  return pairs;
}

// Snap a char offset in `s` LEFT to the start of the word it falls inside.
function snapToWordStart(s, i) {
  let j = i;
  while (j > 0 && /\S/.test(s[j - 1])) j -= 1;
  return j;
}

// Snap a char offset in `s` RIGHT to the end of the word it falls inside.
function snapToWordEnd(s, i) {
  let j = i;
  while (j < s.length && /\S/.test(s[j])) j += 1;
  return j;
}

// The last whole word of `s` (with its trailing joiner), used as left context.
function lastWord(s) {
  const m = s.match(/(\S+\s*)$/);
  return m ? m[1] : "";
}

// The first whole word of `s` (with its leading joiner), used as right context.
function firstWord(s) {
  const m = s.match(/^(\s*\S+)/);
  return m ? m[1] : "";
}

// Distill one modified line into a minimal replacement rule: trim the common
// prefix/suffix, snap the changed span to word boundaries, then include one
// unchanged word of context on each side so the rule never degenerates to a
// bare number or letter ("5" → "8" becomes "team of 5" → "team of 8").
// Returns { before, after } or null when no safe rule can be made.
export function minimalRule(beforeLine, afterLine) {
  const b = norm(beforeLine);
  const a = norm(afterLine);
  if (!b || b === a) return null;

  let p = 0;
  const maxP = Math.min(b.length, a.length);
  while (p < maxP && b[p] === a[p]) p += 1;
  let s = 0;
  const maxS = Math.min(b.length, a.length) - p;
  while (s < maxS && b[b.length - 1 - s] === a[a.length - 1 - s]) s += 1;

  // Snap the changed span outward to whole words in BOTH strings (the common
  // prefix/suffix are identical text, so the snap offsets stay aligned).
  let bStart = snapToWordStart(b, p);
  let bEnd = snapToWordEnd(b, b.length - s);
  const prefix = b.slice(0, bStart);
  const suffix = b.slice(bEnd);
  const aStart = bStart; // prefix is common text
  const aEnd = a.length - suffix.length;

  const leftCtx = lastWord(prefix);
  const rightCtx = firstWord(suffix);

  const before = (leftCtx + b.slice(bStart, bEnd) + rightCtx).trim();
  const after = (leftCtx + a.slice(aStart, aEnd) + rightCtx).trim();

  if (before === after) return null;
  if (before.length > MAX_RULE_CHARS || after.length > MAX_RULE_CHARS) return null;
  const isDeletion = a.slice(aStart, aEnd).trim() === "";
  if (before.length < (isDeletion ? MIN_DELETE_CHARS : MIN_BEFORE_CHARS)) return null;
  return { before, after };
}

// Full pipeline for one document's edit session: pair modified lines, distill
// each into a rule, de-duplicated (same rule from multiple lines counts once —
// recurrence across SESSIONS is what promotes a rule, not within one).
export function deriveEditRules(beforeLines, afterLines) {
  const seen = new Set();
  const rules = [];
  for (const pair of pairEdits(beforeLines, afterLines)) {
    const rule = minimalRule(pair.before, pair.after);
    if (!rule) continue;
    const key = `${rule.before.toLowerCase()}→${rule.after.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return rules;
}

// Defensive parse of client-supplied rules on the server: array of
// { before, after } strings within the same limits the deriver enforces.
export function sanitizeEditRules(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const before = norm(item?.before);
    const after = norm(item?.after);
    if (!before || before === after) continue;
    if (before.length < MIN_BEFORE_CHARS || before.length > MAX_RULE_CHARS) continue;
    if (after.length > MAX_RULE_CHARS) continue;
    const key = before.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ before, after });
    if (out.length >= MAX_RULES_PER_REQUEST) break;
  }
  return out;
}
