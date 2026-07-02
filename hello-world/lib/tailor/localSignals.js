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
  const empty = { gaps: {} };
  if (!storage) return empty;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "");
    return parsed && typeof parsed === "object"
      ? { gaps: parsed.gaps && typeof parsed.gaps === "object" ? parsed.gaps : {}, ...parsed }
      : empty;
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
