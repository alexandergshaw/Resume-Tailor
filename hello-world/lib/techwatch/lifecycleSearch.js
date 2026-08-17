// ---------------------------------------------------------------------------
// Grounded lifecycle answers, for the technologies no public feed covers.
//
// This is the only part of Tech Watch that lets a model author a fact the
// user reads. Everything else on the panel is a quote from a primary feed
// (endoflife.date, an advisory, a release page); a row here is a claim, so
// the parser's real job is refusal, not extraction. A row that slips through
// without proof reads on screen exactly like an endoflife.date row, which is
// precisely the failure this file exists to prevent.
//
// No network call lives here — that is the route's job (wave 2). This file
// only builds the prompt and disbelieves the answer.
// ---------------------------------------------------------------------------

import { isGroundedHost } from "../llm/grounding.js";

// Lifecycle facts (support windows, EOL dates) move on the order of months,
// not hours — a day's cache is generous, and the key the route builds around
// this TTL is global (not per-user), so one search buys every user's answer.
export const LIFECYCLE_CACHE_TTL_SECONDS = 60 * 60 * 24;

const ALLOWED_STATES = new Set(["supported", "security-only", "unsupported"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS_PER_TECHNOLOGY = 8;

// Builds the grounded-search prompt for the technologies chunk A found no
// public feed for. Every requested label is named explicitly rather than
// left to the model to infer from context — the model must not go looking
// for technologies nobody asked about (see the "not requested" drop below).
export function buildLifecyclePrompt(technologies) {
  const list = Array.isArray(technologies) ? technologies : [];
  const labels = list.map((t) => String(t?.label ?? "")).filter(Boolean);
  const names = labels.length ? labels.join(", ") : "(none)";

  return [
    "You are researching software lifecycle / end-of-support information using",
    "Google Search. Research EXACTLY these technologies, one at a time, and no",
    `others: ${names}.`,
    "",
    "For each technology, find its current release cycle(s) and support",
    "timeline from an authoritative source (the vendor's own support policy,",
    "documentation, or release notes page).",
    "",
    "Respond with a JSON array and nothing else — no prose before or after it.",
    "Each element must be an object with exactly these keys:",
    "  technology    - the technology name, matching one of the names above",
    "  cycle         - the release series, e.g. \"5.9\"",
    "  latest        - the latest patch version within that cycle, or null",
    "  supportEndsAt - ISO date YYYY-MM-DD when active support ends, or null",
    "  eolAt         - ISO date YYYY-MM-DD when the cycle reaches end of life, or null",
    "  state         - one of: supported, security-only, unsupported",
    "  sourceUrl     - the URL of the page you actually found this on",
    "",
    "If you cannot find a properly sourced answer for a technology, omit it",
    "entirely rather than guess — do not estimate or infer a date. An",
    "unsourced claim will be discarded, so guessing only wastes your answer.",
  ].join("\n");
}

// Extracts the first top-level JSON array out of a model response that may
// be fenced in ```json, wrapped in prose, or bare. Returns null rather than
// throwing when nothing array-shaped is present.
function extractFirstJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Resolves the model's free-text `technology` against the requested list,
// case-insensitively, but returns OUR label — never the model's casing —
// so a row renders identically to how the deterministic rows spell the name.
function resolveTechnology(rawTechnology, technologies) {
  const needle = String(rawTechnology || "").trim().toLowerCase();
  if (!needle) return null;
  const list = Array.isArray(technologies) ? technologies : [];
  return list.find((t) => String(t?.label || "").trim().toLowerCase() === needle) || null;
}

function isValidDateField(value) {
  return value === null || (typeof value === "string" && ISO_DATE_RE.test(value));
}

// Turns one raw model row into either a validated row, or a dropped record
// with a reason. Never coerces — a value that is close but not exactly what
// was asked for (a state that isn't one of the three, a date that isn't
// YYYY-MM-DD) is dropped, not "fixed", because fixing it would mean the
// parser is now the one authoring the fact.
function buildRow(raw, { technologies, grounded }) {
  const match = resolveTechnology(raw?.technology, technologies);
  if (!match) {
    return { drop: { technology: raw?.technology ?? null, url: raw?.sourceUrl ?? null, reason: "technology was not requested" } };
  }

  const cycle = typeof raw.cycle === "string" ? raw.cycle.trim() : "";
  if (!cycle) {
    return { drop: { technology: match.label, url: raw?.sourceUrl ?? null, reason: "missing cycle" } };
  }

  const state = raw.state;
  if (!ALLOWED_STATES.has(state)) {
    return { drop: { technology: match.label, url: raw?.sourceUrl ?? null, reason: `unrecognized state "${state}"` } };
  }

  const supportEndsAt = raw.supportEndsAt ?? null;
  const eolAt = raw.eolAt ?? null;
  if (!isValidDateField(supportEndsAt) || !isValidDateField(eolAt)) {
    return { drop: { technology: match.label, url: raw?.sourceUrl ?? null, reason: "date was not YYYY-MM-DD" } };
  }

  const sourceUrl = typeof raw.sourceUrl === "string" ? raw.sourceUrl : "";
  if (!isGroundedHost(sourceUrl, grounded)) {
    return { drop: { technology: match.label, url: sourceUrl || null, reason: "citation was not a host the model actually grounded on" } };
  }

  let label;
  try {
    label = new URL(sourceUrl).hostname;
  } catch {
    // isGroundedHost already rejected an unparseable URL above, so this
    // branch is unreachable in practice — kept only so a future change to
    // the grounding check can't turn it into a thrown error here.
    return { drop: { technology: match.label, url: sourceUrl || null, reason: "citation URL was not parseable" } };
  }

  return {
    row: {
      technologyId: match.id,
      technology: match.label,
      cycle,
      latest: typeof raw.latest === "string" ? raw.latest : null,
      releasedAt: null, // not asked for — the prompt has no releasedAt key
      supportEndsAt,
      eolAt,
      state,
      inUse: false, // only the panel knows detectedVersions
      source: "ai",
      citation: { label, url: sourceUrl },
    },
  };
}

// -> { rows, dropped }
export function parseLifecycleAnswer(rawText, { technologies, grounded, now } = {}) {
  void now; // reserved for future staleness checks; unused today

  const text = typeof rawText === "string" ? rawText : "";
  const candidates = extractFirstJsonArray(text);
  if (!candidates) return { rows: [], dropped: [] };

  const rows = [];
  const dropped = [];
  const seen = new Set();
  const perTechnologyCount = new Map();

  for (const raw of candidates) {
    if (!raw || typeof raw !== "object") continue; // ignored, not "dropped" — never claimed to be a row

    const result = buildRow(raw, { technologies, grounded });
    if (result.drop) {
      dropped.push(result.drop);
      continue;
    }

    const row = result.row;
    const dedupeKey = `${row.technologyId}::${row.cycle}`;
    if (seen.has(dedupeKey)) continue; // keep the first
    seen.add(dedupeKey);

    const countSoFar = perTechnologyCount.get(row.technologyId) || 0;
    if (countSoFar >= MAX_ROWS_PER_TECHNOLOGY) continue; // one verbose answer can't flood the table
    perTechnologyCount.set(row.technologyId, countSoFar + 1);

    rows.push(row);
  }

  return { rows, dropped };
}
