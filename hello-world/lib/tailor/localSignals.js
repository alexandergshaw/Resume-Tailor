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
  const empty = {
    gaps: {},
    steering: { avoided: {}, emphasized: {} },
    editRules: {},
    focusOverrides: {},
    buzzwordEdits: { exclude: {}, boost: {} },
    variantOverrides: {},
  };
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
      focusOverrides:
        parsed.focusOverrides && typeof parsed.focusOverrides === "object" ? parsed.focusOverrides : {},
      variantOverrides:
        parsed.variantOverrides && typeof parsed.variantOverrides === "object" ? parsed.variantOverrides : {},
      buzzwordEdits: {
        exclude:
          parsed.buzzwordEdits?.exclude && typeof parsed.buzzwordEdits.exclude === "object"
            ? parsed.buzzwordEdits.exclude
            : {},
        boost:
          parsed.buzzwordEdits?.boost && typeof parsed.buzzwordEdits.boost === "object"
            ? parsed.buzzwordEdits.boost
            : {},
      },
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

// Record a focus-area correction from the previewer's picker: what auto-
// detection said (or "" for none) vs. what the user chose. A recurring
// detected→chosen pair means the library's match terms are steering detection
// wrong — surfaced as a fix-it-in-/library hint. Counted once per call (the
// picker records once per applied correction). Returns the pair's new count.
export function recordFocusOverride({ detected, chosen }, { storage = defaultStorage(), now = Date.now() } = {}) {
  const from = String(detected || "").trim();
  const to = String(chosen || "").trim();
  if (!to || from.toLowerCase() === to.toLowerCase()) return 0;
  const signals = readSignals(storage);
  const key = `${from.toLowerCase() || "(none)"}→${to.toLowerCase()}`;
  const cur = signals.focusOverrides[key] || { detected: from, chosen: to, count: 0 };
  signals.focusOverrides[key] = { ...cur, count: cur.count + 1, lastSeen: now };
  prune(signals.focusOverrides);
  writeSignals(signals, storage);
  return signals.focusOverrides[key].count;
}

// A one-line hint when auto-detection keeps getting corrected the same way
// (threshold+ postings). `detected` is what auto-detection currently says for
// the posting at hand ("" for none) — the hint only fires for THAT situation,
// so it never nags about unrelated history.
export function focusOverrideHint(detected, { storage = defaultStorage(), threshold = 3 } = {}) {
  const from = String(detected || "").trim();
  const signals = readSignals(storage);
  const fromKey = from.toLowerCase() || "(none)";
  let best = null;
  for (const [key, rec] of Object.entries(signals.focusOverrides)) {
    if (!key.startsWith(`${fromKey}→`)) continue;
    if (rec.count >= threshold && (!best || rec.count > best.count)) best = rec;
  }
  if (!best) return "";
  return from
    ? `You've switched the focus from ${best.detected} to ${best.chosen} on ${best.count} postings — edit their match terms in /library so detection gets it right.`
    : `You've picked the ${best.chosen} focus on ${best.count} postings where nothing was detected — add match terms to it in /library so it auto-selects.`;
}

// Record a cover-letter framing correction (auto-detected variant → the one
// the user chose in the previewer's teaching/staff/industry toggle). Recurring
// pairs mean the teaching/higher-ed detectors keep misreading a class of
// posting. Returns the pair's new count.
export function recordVariantOverride({ detected, chosen }, { storage = defaultStorage(), now = Date.now() } = {}) {
  const from = String(detected || "").trim().toLowerCase();
  const to = String(chosen || "").trim().toLowerCase();
  if (!to || from === to) return 0;
  const signals = readSignals(storage);
  const key = `${from || "(none)"}→${to}`;
  const cur = signals.variantOverrides[key] || { detected: from, chosen: to, count: 0 };
  signals.variantOverrides[key] = { ...cur, count: cur.count + 1, lastSeen: now };
  prune(signals.variantOverrides);
  writeSignals(signals, storage);
  return signals.variantOverrides[key].count;
}

// A one-line hint when the SAME framing correction keeps recurring for the
// framing currently detected. Local counters only — detection itself doesn't
// change, but the user learns their postings need the toggle (or a report).
export function variantOverrideHint(detected, { storage = defaultStorage(), threshold = 3 } = {}) {
  const from = String(detected || "").trim().toLowerCase();
  if (!from) return "";
  const signals = readSignals(storage);
  let best = null;
  for (const [key, rec] of Object.entries(signals.variantOverrides)) {
    if (!key.startsWith(`${from}→`)) continue;
    if (rec.count >= threshold && (!best || rec.count > best.count)) best = rec;
  }
  if (!best) return "";
  return `You've switched the letter from ${best.detected} to ${best.chosen} framing on ${best.count} postings — detection keeps misreading these, so keep an eye on the framing toggle for similar roles.`;
}

// Record the buzzword toggles the user applied (once per posting — the caller
// de-dupes repeat applies on the same job). Terms excluded or boosted across
// DIFFERENT postings are library facts waiting to be edited in /library.
export function recordBuzzwordEdits(
  { boost = [], exclude = [] } = {},
  { storage = defaultStorage(), now = Date.now() } = {},
) {
  if (boost.length === 0 && exclude.length === 0) return readSignals(storage);
  const signals = readSignals(storage);
  const bump = (bucket, term) => {
    const name = String(term || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    const cur = bucket[key] || { term: name, count: 0 };
    bucket[key] = { ...cur, count: cur.count + 1, lastSeen: now };
  };
  for (const t of exclude) bump(signals.buzzwordEdits.exclude, t);
  for (const t of boost) bump(signals.buzzwordEdits.boost, t);
  prune(signals.buzzwordEdits.exclude);
  prune(signals.buzzwordEdits.boost);
  writeSignals(signals, storage);
  return signals;
}

// Hints for the CURRENT edit set: terms the user keeps excluding (or boosting)
// posting after posting belong in the library, not in per-posting toggles.
export function buzzwordEditHints({ boost = [], exclude = [] } = {}, { storage = defaultStorage(), threshold = 3 } = {}) {
  const signals = readSignals(storage);
  const hints = [];
  for (const t of exclude) {
    const rec = signals.buzzwordEdits.exclude[String(t).toLowerCase()];
    if (rec && rec.count >= threshold) {
      hints.push(`You've excluded ${rec.term} on ${rec.count} postings — remove or re-categorize it in /library to make that permanent.`);
      break; // one hint per apply, not a lecture
    }
  }
  if (hints.length === 0) {
    for (const t of boost) {
      const rec = signals.buzzwordEdits.boost[String(t).toLowerCase()];
      if (rec && rec.count >= threshold) {
        hints.push(`You've emphasized ${rec.term} on ${rec.count} postings — add it to a focus area's capabilities in /library so it surfaces on its own.`);
        break;
      }
    }
  }
  return hints;
}

// Per-term counts for the focus modal's checklist badges ("excluded on N
// postings"). Returns { exclude: Map<lower,count>, boost: Map<lower,count> }.
export function buzzwordEditCounts({ storage = defaultStorage() } = {}) {
  const signals = readSignals(storage);
  const toMap = (bucket) => {
    const m = new Map();
    for (const [key, rec] of Object.entries(bucket)) m.set(key, rec.count || 0);
    return m;
  };
  return { exclude: toMap(signals.buzzwordEdits.exclude), boost: toMap(signals.buzzwordEdits.boost) };
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
