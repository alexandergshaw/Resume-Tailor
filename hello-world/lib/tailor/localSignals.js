// Local learning signals for the deterministic engine, persisted in
// localStorage (device-local counters only — the tailoring library itself is
// never touched without the user's explicit approval in the update dialog).
//
// Currently tracked:
//   gaps — how often each term shows up as a coverage gap (missing or
//   unrecognized) across DIFFERENT postings. A term that recurs isn't a
//   one-off posting quirk; it's systematically missing vocabulary, so the
//   library prompt ranks it first and badges it "seen in N postings".
//
// All functions take an injectable `storage` (localStorage-shaped) for tests
// and degrade to no-ops when storage is unavailable (SSR, privacy mode).

const STORAGE_KEY = "tailorLocalSignals";
const MAX_TRACKED_TERMS = 200;

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // privacy mode can throw on access
  }
  return null;
}

export function readSignals(storage = defaultStorage()) {
  const empty = { gaps: {}, steering: { avoided: {}, emphasized: {} }, editRules: {} };
  if (!storage) return empty;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "");
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      ...parsed,
      gaps: parsed.gaps && typeof parsed.gaps === "object" ? parsed.gaps : {},
      steering: {
        avoided: parsed.steering?.avoided && typeof parsed.steering.avoided === "object" ? parsed.steering.avoided : {},
        emphasized:
          parsed.steering?.emphasized && typeof parsed.steering.emphasized === "object" ? parsed.steering.emphasized : {},
      },
      editRules: parsed.editRules && typeof parsed.editRules === "object" ? parsed.editRules : {},
    };
  } catch {
    return empty;
  }
}

export function writeSignals(signals, storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(signals));
  } catch {
    // quota/privacy failures are non-fatal — signals are best-effort
  }
}

// Keep the store bounded: drop the least-recently-seen terms beyond the cap.
function prune(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_TRACKED_TERMS) return map;
  keys
    .sort((a, b) => (map[a].lastSeen || 0) - (map[b].lastSeen || 0))
    .slice(0, keys.length - MAX_TRACKED_TERMS)
    .forEach((k) => delete map[k]);
  return map;
}

// Record a tailor run's coverage gaps (match.missing canonicals +
// match.unrecognized terms). Each term counts at most once per call, so the
// count approximates "number of postings this term was a gap in".
export function recordMatchGaps(match, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!match) return readSignals(storage);
  const terms = [
    ...(match.missing || []).map((t) => t.canonical),
    ...(match.unrecognized || []).map((t) => t.term),
  ]
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  if (terms.length === 0) return readSignals(storage);

  const signals = readSignals(storage);
  const seenThisRun = new Set();
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seenThisRun.has(key)) continue;
    seenThisRun.add(key);
    const cur = signals.gaps[key] || { count: 0, term };
    signals.gaps[key] = { term: cur.term || term, count: cur.count + 1, lastSeen: now };
  }
  prune(signals.gaps);
  writeSignals(signals, storage);
  return signals;
}

// Record the directives an embedded revise applied (report.meta.steering:
// { emphasized: [names], avoided: [names] }). Recurring habits — steering the
// same term run after run — are library facts waiting to be made permanent.
export function recordSteering(steeringMeta, { storage = defaultStorage(), now = Date.now() } = {}) {
  const avoided = steeringMeta?.avoided || [];
  const emphasized = steeringMeta?.emphasized || [];
  if (avoided.length === 0 && emphasized.length === 0) return readSignals(storage);

  const signals = readSignals(storage);
  const bump = (bucket, term) => {
    const key = String(term || "").trim().toLowerCase();
    if (!key) return;
    const cur = bucket[key] || { count: 0, term };
    bucket[key] = { term: cur.term || term, count: cur.count + 1, lastSeen: now };
  };
  for (const t of avoided) bump(signals.steering.avoided, t);
  for (const t of emphasized) bump(signals.steering.emphasized, t);
  prune(signals.steering.avoided);
  prune(signals.steering.emphasized);
  writeSignals(signals, storage);
  return signals;
}

// A one-line hint when this revise repeated a steering habit (same term
// avoided/emphasized `threshold`+ times, counting this run). Empty when the
// user isn't repeating themselves — the hint should be rare, not nagging.
export function steeringHabitHint(steeringMeta, { storage = defaultStorage(), threshold = 3 } = {}) {
  const signals = readSignals(storage);
  for (const term of steeringMeta?.avoided || []) {
    const rec = signals.steering.avoided[String(term).toLowerCase()];
    if (rec && rec.count >= threshold) {
      return `You've removed ${rec.term} in ${rec.count} revisions — delete it from your library (/library) to make that permanent.`;
    }
  }
  for (const term of steeringMeta?.emphasized || []) {
    const rec = signals.steering.emphasized[String(term).toLowerCase()];
    if (rec && rec.count >= threshold) {
      return `You've emphasized ${rec.term} in ${rec.count} revisions — pin it in your library (/library) so every document leads with it.`;
    }
  }
  return "";
}

const EDIT_RULE_THRESHOLD = 3;
const MAX_PROMOTED_RULES = 20;

function ruleKey(rule) {
  return `${String(rule.before).toLowerCase()}→${String(rule.after).toLowerCase()}`;
}

// Record one edit session's derived rewrite rules ({before, after}[], from
// deriveEditRules) for one document kind ("resume" | "cover"). Both kinds feed
// the SAME counter per rule — a fix made across resumes and cover letters is
// the same fix. Counts once per call (= per session; the deriver de-dupes
// within a session).
//
// Self-healing: a rule that exactly REVERSES a tracked one means the user
// undid that change (most likely one we auto-applied). The reversed rule is
// deleted outright and the undo itself is NOT recorded — one undo kills the
// automation, it doesn't start a competing habit.
export function recordEditRules(rules, { doc = "resume", storage = defaultStorage(), now = Date.now() } = {}) {
  const list = (rules || []).filter((r) => r && r.before && typeof r.after === "string");
  if (list.length === 0) return readSignals(storage);

  const signals = readSignals(storage);
  for (const rule of list) {
    const reverseKey = `${String(rule.after).toLowerCase()}→${String(rule.before).toLowerCase()}`;
    if (signals.editRules[reverseKey]) {
      delete signals.editRules[reverseKey];
      continue;
    }
    const key = ruleKey(rule);
    const cur = signals.editRules[key] || { before: rule.before, after: rule.after, count: 0, docs: {} };
    signals.editRules[key] = {
      ...cur,
      count: cur.count + 1,
      lastSeen: now,
      docs: { ...cur.docs, [doc]: (cur.docs?.[doc] || 0) + 1 },
    };
  }
  prune(signals.editRules);
  writeSignals(signals, storage);
  return signals;
}

// Rules consistent enough to auto-apply at render time: seen in
// EDIT_RULE_THRESHOLD+ edit sessions. When the same `before` maps to several
// `after`s, only the strongest (count, then recency) survives — conflicting
// habits compete instead of both firing. Most-recent first, capped.
export function promotedEditRules({ storage = defaultStorage(), threshold = EDIT_RULE_THRESHOLD } = {}) {
  const signals = readSignals(storage);
  const byBefore = new Map();
  for (const rec of Object.values(signals.editRules)) {
    if (!rec || rec.count < threshold) continue;
    const key = String(rec.before).toLowerCase();
    const cur = byBefore.get(key);
    if (!cur || rec.count > cur.count || (rec.count === cur.count && (rec.lastSeen || 0) > (cur.lastSeen || 0))) {
      byBefore.set(key, rec);
    }
  }
  return [...byBefore.values()]
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, MAX_PROMOTED_RULES)
    .map((r) => ({ before: r.before, after: r.after }));
}

// Annotate suggestion buzzwords with how often each term has been a gap across
// postings (seenCount), and rank recurring ones first — a term missing from 3
// different postings matters more than a fresh one, whatever its RAKE score.
// Stable within equal counts (preserves the score ordering from the scrape).
export function annotateAndRank(buzzwords, { storage = defaultStorage() } = {}) {
  const signals = readSignals(storage);
  return (buzzwords || [])
    .map((b, idx) => ({
      ...b,
      seenCount: signals.gaps[String(b.canonical || "").toLowerCase()]?.count || 0,
      _idx: idx,
    }))
    .sort((a, b) => b.seenCount - a.seenCount || a._idx - b._idx)
    .map(({ _idx, ...b }) => b);
}
