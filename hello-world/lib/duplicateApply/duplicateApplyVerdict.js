// lib/duplicateApply/duplicateApplyVerdict.js
//
// The evaluator: "has this posting already been applied to, and has this
// company had 2+ applications in the past month?" AC-duplicate-apply-r4.md
// C-9 .. C-19; 3-plan-dupapply.md §2.3 / §3.3 / §4 (A-1 .. A-5) / §5 (S-1, S-2).
//
// Standing bias: a false alarm is the expensive failure. Every signal is
// three-valued (hit/clear/indeterminate) plus a fourth `unavailable` for "the
// check did not run at all" -- ambiguity NEVER collapses to `clear`, and a
// `clear` verdict is only ever returned when the evaluator actually examined
// rows and found none that qualify.
//
// This module imports Wave-1A's two identity-key modules and re-uses two
// already-shipped, already-tested leaf modules for status/date semantics --
// it declares no status literal (C-11) and does no date parsing of its own
// (C-12). It performs no I/O, no network call and no ambient clock/zone
// read: every notion of "now" is the caller's injected `runStartedAt` /
// `nowMs` (C-19).
import { postingKeyOfPosition, canonicalPositionKey, matchesCandidate } from "@/lib/duplicateApply/postingIdentity.js";
import { companyIdentityKey } from "@/lib/duplicateApply/companyIdentity.js";
import { isAppliedOrLater, classifyStatus } from "@/lib/applications/statusVocabulary.js";
import { parseStageInstant } from "@/lib/tracking/stages.js";

// The partition S-10d (and this plan's C-4) renders on: a "capability"
// reason means zero rows were examined at all (or could not be), so the
// surface must show nothing; every other indeterminate reason is
// "evidence-bearing" -- a real, ambiguous row exists, so the surface MAY
// raise a banner alone (verdictPresentation.js, Wave 2, owns that decision;
// this module only classifies the reason).
const CAPABILITY_REASONS = new Set(["no-posting-identity", "no-company-key", "rows-unavailable", "check-threw"]);

// S-2's total order: hit > evidence-bearing indeterminate > capability
// indeterminate > unavailable > clear. mergeVerdicts (below) and the
// candidateStrandedApplied override (§4 A-3) both fold through this same
// ranking, so "a route/flag may only ADD a warning, never remove one" is one
// piece of code, not two independently-maintained rules.
function verdictRank(v) {
  if (!v || typeof v.verdict !== "string") return 0;
  switch (v.verdict) {
    case "hit":
      return 4;
    case "indeterminate":
      return CAPABILITY_REASONS.has(v.reason) ? 2 : 3;
    case "unavailable":
      return 1;
    case "clear":
    default:
      return 0;
  }
}

function evidenceKey(entry) {
  if (entry && entry.applicationId != null) return `id:${entry.applicationId}`;
  try {
    return `json:${JSON.stringify(entry)}`;
  } catch {
    return `ref:${String(entry)}`;
  }
}

function unionEvidence(a, b) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...a, ...b]) {
    const key = evidenceKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

// The one place both mergeVerdicts (a merge ACROSS TIME, S-2) and
// candidateStrandedApplied (a merge WITH A SYNTHETIC SIGNAL, §4 A-3) share
// their "never weaken" semantics. `b` wins ties -- it is always the more
// recently produced side (the caller's `next`, or the stranded override
// being folded in), so a tie between two DIFFERENT evidence-bearing reasons
// prefers the newer information.
function mergeSignal(a, b) {
  const rankA = verdictRank(a);
  const rankB = verdictRank(b);
  const [winner, loser] = rankB >= rankA ? [b, a] : [a, b];
  const winnerEvidence = Array.isArray(winner?.evidence) ? winner.evidence : null;
  const loserEvidence = Array.isArray(loser?.evidence) ? loser.evidence : null;
  if (!winnerEvidence && !loserEvidence) return winner;
  return { ...winner, evidence: unionEvidence(winnerEvidence ?? [], loserEvidence ?? []) };
}

/**
 * mergeVerdicts(previous, next) -> a verdict object
 *
 * A MONOTONE UPGRADE, exported and used TODAY -- not a speculative
 * extension point. E3 fires Signal 1 before the tailor request and Signal 2
 * only after the response resolves; the two evaluations of one run must
 * combine without the second erasing the first (S-2). Order per signal:
 * hit > evidence-bearing indeterminate > capability indeterminate >
 * unavailable > clear. Evidence arrays are UNIONED (de-duplicated by
 * `applicationId`) rather than either side's being discarded.
 */
export function mergeVerdicts(previous, next) {
  if (previous == null) return next;
  if (next == null) return previous;
  return {
    samePosition: mergeSignal(previous.samePosition, next.samePosition),
    company: mergeSignal(previous.company, next.company),
    checkedAt: next.checkedAt ?? previous.checkedAt,
    diagnostics: next.diagnostics ?? previous.diagnostics,
  };
}

function rawEvidenceFromRow(row) {
  const positions = row && typeof row === "object" ? row.positions : null;
  const p = positions && typeof positions === "object" ? positions : null;
  return {
    applicationId: row && typeof row === "object" && "id" in row ? row.id : null,
    company: p ? (p.company ?? null) : null,
    title: p ? (p.title ?? null) : null,
    url: p ? (p.url ?? null) : null,
    status: row && typeof row === "object" ? (row.status ?? null) : null,
    appliedAt: row && typeof row === "object" ? (row.applied_at ?? null) : null,
  };
}

// --- Signal 1 -------------------------------------------------------------

function classifySamePositionRow(row, candidate, runStartedAt) {
  if (!matchesCandidate(row, candidate)) return null;

  const classification = classifyStatus(row?.status);
  if (classification === "unknown") return { kind: "unknown-status" };
  if (classification === "pre-apply") return null; // not applied yet -- no evidence either way

  const instant = parseStageInstant(row?.applied_at);
  if (instant === null) return { kind: "undated" };
  if (instant.getTime() >= runStartedAt) return { kind: "future" };
  return { kind: "hit", match: rawEvidenceFromRow(row) };
}

function outcomeToSignal(outcome, rowKey, rows) {
  if (outcome === "clear") return null;
  if (outcome === "match") {
    const row = rows.find((r) => r && typeof r === "object" && r.id === rowKey);
    if (!row) return null;
    return { verdict: "hit", match: rawEvidenceFromRow(row), route: "extra" };
  }
  if (outcome && typeof outcome === "object" && typeof outcome.reason === "string") {
    return { verdict: "indeterminate", reason: outcome.reason };
  }
  return null;
}

// S-1's phase-two seam: `extraRoutes` is an array of
// `(candidate, rows) -> Map<rowId, "match" | "clear" | { reason }>`.
// Consulted ONLY when the URL route (this module's own) is not already a
// hit, and folding is UNION-ONLY -- a route may turn clear/indeterminate
// into hit; it may never turn a hit into anything else, and it never
// touches the identity key. `extraRoutes` is `[]` in production today; the
// seam exists so a future description-identity route needs no rework here.
function applyExtraRoutes(primaryResult, candidate, rows, extraRoutes) {
  if (primaryResult.verdict === "hit") return primaryResult; // not consulted at all
  if (!Array.isArray(extraRoutes) || extraRoutes.length === 0) return primaryResult;

  let result = primaryResult;
  for (const route of extraRoutes) {
    let routeMap;
    try {
      routeMap = typeof route === "function" ? route(candidate, rows) : null;
    } catch {
      continue; // a broken extra route must not crash the core (C-19/C-25)
    }
    if (!(routeMap instanceof Map)) continue;
    for (const [rowKey, outcome] of routeMap) {
      const signal = outcomeToSignal(outcome, rowKey, rows);
      if (signal) result = mergeSignal(result, signal);
    }
    if (result.verdict === "hit") break;
  }
  return result;
}

/**
 * findPriorSamePosting({ candidate, rows, runStartedAt, extraRoutes }) -> Signal 1
 *
 * Test-only export (also used internally by evaluatePriorApplications).
 * C-14/C-9/C-9b/C-11a/C-15/C-25.
 */
export function findPriorSamePosting({ candidate, rows, runStartedAt, extraRoutes = [] }) {
  let candidateKey;
  try {
    candidateKey = postingKeyOfPosition(candidate);
  } catch {
    candidateKey = null;
  }
  if (candidateKey === null) {
    return applyExtraRoutes({ verdict: "indeterminate", reason: "no-posting-identity" }, candidate, Array.isArray(rows) ? rows : [], extraRoutes);
  }

  const safeRows = Array.isArray(rows) ? rows : [];
  let hasUndated = false;
  let hasFuture = false;
  let hasUnknownStatus = false;

  for (const row of safeRows) {
    let outcome;
    try {
      outcome = classifySamePositionRow(row, candidate, runStartedAt);
    } catch {
      continue; // C-19/C-25: an uninterpretable row is excluded, never a throw
    }
    if (!outcome) continue;
    if (outcome.kind === "hit") {
      return { verdict: "hit", match: outcome.match, route: "url" };
    }
    if (outcome.kind === "undated") hasUndated = true;
    else if (outcome.kind === "future") hasFuture = true;
    else if (outcome.kind === "unknown-status") hasUnknownStatus = true;
  }

  let result;
  if (hasUndated) result = { verdict: "indeterminate", reason: "undated-match" };
  else if (hasFuture) result = { verdict: "indeterminate", reason: "future-or-concurrent" };
  else if (hasUnknownStatus) result = { verdict: "indeterminate", reason: "unknown-status-match" };
  else result = { verdict: "clear" };

  return applyExtraRoutes(result, candidate, safeRows, extraRoutes);
}

// --- Signal 2 ---------------------------------------------------------------

/**
 * inWindow(ms, nowMs, windowDays) -> boolean. C-13: a rolling window on
 * epoch milliseconds, half-open [0, windowDays*24h). Test-only export.
 */
export function inWindow(ms, nowMs, windowDays) {
  const diff = nowMs - ms;
  return diff >= 0 && diff < windowDays * 24 * 60 * 60 * 1000;
}

function evaluateCompanySignal({ candidate, rows, runStartedAt, nowMs, windowDays }) {
  let candidateCompanyKey;
  try {
    candidateCompanyKey = companyIdentityKey(candidate?.company);
  } catch {
    candidateCompanyKey = "";
  }
  if (candidateCompanyKey === "") {
    return { verdict: "indeterminate", reason: "no-company-key" };
  }

  const safeRows = Array.isArray(rows) ? rows : [];
  const groupKeys = new Set();
  let undatableCount = 0;
  let futureCount = 0;
  const evidence = [];

  safeRows.forEach((row, index) => {
    try {
      if (!isAppliedOrLater(row?.status)) return;
      const rowCompanyKey = companyIdentityKey(row?.positions?.company);
      if (rowCompanyKey === "" || rowCompanyKey !== candidateCompanyKey) return;

      const instant = parseStageInstant(row?.applied_at);
      if (instant === null) {
        undatableCount += 1;
        evidence.push(rawEvidenceFromRow(row));
        return;
      }
      const ms = instant.getTime();
      if (ms >= runStartedAt) {
        futureCount += 1;
        evidence.push(rawEvidenceFromRow(row));
        return;
      }
      if (!inWindow(ms, nowMs, windowDays)) {
        return; // legitimately too old -- not counted, not flagged
      }
      let groupKey;
      try {
        groupKey = canonicalPositionKey(row);
      } catch {
        groupKey = null;
      }
      groupKeys.add(groupKey ?? `__row_${index}__`);
      evidence.push(rawEvidenceFromRow(row));
    } catch {
      // C-19/C-25: an uninterpretable row is excluded, never a throw
    }
  });

  const count = groupKeys.size;
  if (count >= 2) {
    return { verdict: "hit", count, undatableCount, futureCount, evidence };
  }
  if (undatableCount > 0) {
    return { verdict: "indeterminate", reason: "undated-company-rows", count, undatableCount, futureCount, evidence };
  }
  if (futureCount > 0) {
    return { verdict: "indeterminate", reason: "future-company-rows", count, undatableCount, futureCount, evidence };
  }
  return { verdict: "clear", count, undatableCount, futureCount };
}

function countRelevantRows(rows, candidateKey, candidateCompanyKey) {
  let n = 0;
  for (const row of rows) {
    try {
      if (!isAppliedOrLater(row?.status)) continue;
      let rowKey = null;
      try {
        rowKey = postingKeyOfPosition(row?.positions);
      } catch {
        rowKey = null;
      }
      let rowCompanyKey = "";
      try {
        rowCompanyKey = companyIdentityKey(row?.positions?.company);
      } catch {
        rowCompanyKey = "";
      }
      const matchesPosting = candidateKey !== null && rowKey === candidateKey;
      const matchesCompany = candidateCompanyKey !== "" && rowCompanyKey !== "" && rowCompanyKey === candidateCompanyKey;
      if (matchesPosting || matchesCompany) n += 1;
    } catch {
      continue;
    }
  }
  return n;
}

function safeCandidateKey(candidate) {
  try {
    return postingKeyOfPosition(candidate);
  } catch {
    return null;
  }
}

function safeCandidateCompanyKey(candidate) {
  try {
    return companyIdentityKey(candidate?.company);
  } catch {
    return "";
  }
}

/**
 * evaluatePriorApplications({ candidate, rows, rowsState,
 *   candidateStrandedApplied, runStartedAt, nowMs, windowDays, timeZone,
 *   extraRoutes }) -> { samePosition, company, checkedAt, diagnostics }
 *
 * The single pure entry point. See the module docblock and
 * 3-plan-dupapply.md §3.3 for the full contract.
 */
export function evaluatePriorApplications({
  candidate,
  rows,
  rowsState,
  candidateStrandedApplied = false,
  runStartedAt,
  nowMs = runStartedAt,
  windowDays = 30,
  // Accepted but not read by this module -- reserved for
  // verdictPresentation.js (Wave 2), which renders evidence dates in it.
  timeZone = "UTC",
  extraRoutes = [],
} = {}) {
  const checkedAt = nowMs;
  const candidateKey = safeCandidateKey(candidate);
  const candidateCompanyKey = safeCandidateCompanyKey(candidate);

  // A-2 -- THE highest-value fix in the chunk: a failed or in-flight load
  // must not read as `clear`. Checked before any row is read.
  if (rowsState !== "ready" || rows == null) {
    const unavailable = { verdict: "unavailable", reason: "rows-unavailable" };
    return {
      samePosition: unavailable,
      company: unavailable,
      checkedAt,
      diagnostics: {
        rowsExamined: 0,
        rowsCounted: 0,
        rowsState: rowsState ?? null,
        candidateKey,
        candidateCompanyKey,
        windowDays,
        runStartedAt,
      },
    };
  }

  const safeRows = Array.isArray(rows) ? rows : [];

  try {
    let samePosition = findPriorSamePosting({ candidate, rows: safeRows, runStartedAt, extraRoutes });

    // §4 A-3 -- a stranded prior application at the candidate's OWN posting
    // (invisible to the row-based scan, RM-10) folds in through the same
    // monotone ranking as mergeVerdicts: it can upgrade a clear/capability
    // result to indeterminate, but it can never downgrade an existing hit.
    if (candidateStrandedApplied) {
      samePosition = mergeSignal(samePosition, { verdict: "indeterminate", reason: "stranded-applied-row" });
    }

    const company = evaluateCompanySignal({ candidate, rows: safeRows, runStartedAt, nowMs, windowDays });

    return {
      samePosition,
      company,
      checkedAt,
      diagnostics: {
        rowsExamined: safeRows.length,
        rowsCounted: countRelevantRows(safeRows, candidateKey, candidateCompanyKey),
        rowsState,
        candidateKey,
        candidateCompanyKey,
        windowDays,
        runStartedAt,
      },
    };
  } catch {
    // C-19/C-25 belt-and-suspenders: evaluatePriorApplications must NEVER
    // throw. Every code path above already guards its own row access, so
    // reaching this branch indicates an input shape nobody anticipated --
    // report it the same way a failed load reports (nothing was reliably
    // examined), rather than propagate an exception a fire-and-forget
    // caller (A-1) would otherwise swallow into a silent, wrong `clear`.
    const unavailable = { verdict: "unavailable", reason: "rows-unavailable" };
    return {
      samePosition: unavailable,
      company: unavailable,
      checkedAt,
      diagnostics: {
        rowsExamined: safeRows.length,
        rowsCounted: 0,
        rowsState,
        candidateKey,
        candidateCompanyKey,
        windowDays,
        runStartedAt,
      },
    };
  }
}
