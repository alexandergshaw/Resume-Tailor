// N92 Wave 3 (Control B) -- LLM-smooth the transition into/around an
// inserted company fact, CONFIRM-BEFORE-PERSIST (owner ruling D7).
//
// THIS IS THE SMOOTHING SEAM'S OWN MODULE (AC-B8a, design section 3.1). The
// unattended paths -- app/hooks/useCompanyResearch.js (auto-insert, Control
// A, Control C), lib/acceptedFacts/factInsertion.js (the auto-insert
// planner), and the tailor cron -- must NEVER import this file, so a
// smoothing engine call can only ever fire from an explicit user click. Only
// the confirm UI and the route import it.
//
// TWO LAYERS OF FAITHFULNESS (AC-B3, owner ruling D7):
//   1. AUTOMATED (this module's own guards): scope -- a rewrite may change
//      only the sentence before the fact, the fact sentence, and the
//      sentence after it (checkScope) -- and added tokens -- no new number,
//      date, currency amount, or proper name may appear that was not already
//      in the in-scope material (checkAddedTokens). Both run BEFORE the user
//      ever sees anything; a candidate that fails either is REJECTED,
//      discarded, never shown.
//   2. THE USER'S CONFIRM GATE. Negation and inflation that reuse existing
//      tokens ("helped" -> "led", dropping a "not") are NOT auto-catchable
//      and are NOT claimed to be here. Nothing reaches the letter, the
//      store, or a download until the user explicitly approves the shown
//      before/after (confirmSmoothTransition) -- produce
//      (requestSmoothTransition) NEVER writes anything.
//
// recordDecision("fact-smooth", ...) calls live ONLY in this file, so the
// ledger's one-entry-per-module binding
// (lib/activityLog/activityChannels.js's DECISION_LEDGER,
// decisionCoverage.sweep.test.js) stays satisfied by this module alone.

import { sentenceBounds } from "../acceptedFacts/factMove";
import { recordDecision } from "../activityLog/appActivityLog";

export const SMOOTH_ENDPOINT = "/api/cover-fact-smooth";

// The gap offsets in `line` a move slot could land on, EXCLUDING any
// boundary strictly inside the fact's own span -- the same "atomic fact"
// rule lib/acceptedFacts/factMove.js's planMoveFact uses (AC-A11's
// counterpart here: a multi-sentence fact's internal punctuation is never a
// scope edge). Reimplemented locally (factMove.js keeps this private) so
// this module stays a sibling, not a patch, of that one.
function lineGapsExcludingSpan(line, offset, textLen) {
  const boundaries = sentenceBounds(line).filter((g) => g <= offset || g >= offset + textLen);
  return [0, ...boundaries, line.length];
}

// scopeSentences({ lines, records, id }) -> the editable region for a
// smoothing: the sentence before the fact (same paragraph only), the fact
// sentence, and the sentence after it (same paragraph only) -- AC-B1/B2.
// Refuses (ok:false) a stale locator rather than guessing a span, mirroring
// planMoveFact's own AC-A8 rule.
export function scopeSentences({ lines, records, id } = {}) {
  const arr = Array.isArray(lines) ? lines : [];
  const list = Array.isArray(records) ? records : [];
  const record = list.find((r) => r?.id === id);
  if (!record) return { ok: false, reason: "not-found" };
  const { lineIndex, offset, text } = record;
  if (typeof lineIndex !== "number" || typeof offset !== "number" || typeof text !== "string" || !text) {
    return { ok: false, reason: "stale-locator" };
  }
  const line = String(arr[lineIndex] ?? "");
  if (line.slice(offset, offset + text.length) !== text) {
    return { ok: false, reason: "stale-locator" };
  }

  const gaps = lineGapsExcludingSpan(line, offset, text.length);
  let slotIndex = gaps.indexOf(offset);
  if (slotIndex < 0) slotIndex = gaps.reduce((best, g, i) => (g <= offset ? i : best), 0);
  const start = slotIndex > 0 ? gaps[slotIndex - 1] : offset;

  const factEnd = offset + text.length;
  let endGapIndex = gaps.indexOf(factEnd);
  if (endGapIndex < 0) endGapIndex = gaps.reduce((best, g, i) => (g >= factEnd && best < 0 ? i : best), -1);
  const end = endGapIndex >= 0 && endGapIndex + 1 < gaps.length ? gaps[endGapIndex + 1] : factEnd;

  const beforeText = line.slice(start, offset).trim();
  const afterText = line.slice(factEnd, end).trim();
  const inScopeText = [beforeText, text, afterText].filter(Boolean).join(" ");

  return { ok: true, span: { lineIndex, start, end }, factText: text, beforeText, afterText, inScopeText };
}

// checkScope(originalLines, candidateLines, span) -> true iff candidateLines
// differs from originalLines ONLY inside span.lineIndex, and even there only
// within [start,end) -- the prefix before `start` and the suffix after `end`
// on that same line are byte-preserved. Every other line must be identical.
export function checkScope(originalLines, candidateLines, span) {
  const origArr = Array.isArray(originalLines) ? originalLines : [];
  const candArr = Array.isArray(candidateLines) ? candidateLines : [];
  if (!span || typeof span.lineIndex !== "number") return { ok: false, reason: "invalid-span" };
  if (origArr.length !== candArr.length) return { ok: false, reason: "line-count-changed" };
  for (let i = 0; i < origArr.length; i += 1) {
    if (i === span.lineIndex) continue;
    if (String(origArr[i] ?? "") !== String(candArr[i] ?? "")) return { ok: false, reason: "out-of-scope-line" };
  }
  const origLine = String(origArr[span.lineIndex] ?? "");
  const candLine = String(candArr[span.lineIndex] ?? "");
  const prefix = origLine.slice(0, span.start);
  const suffix = origLine.slice(span.end);
  if (!candLine.startsWith(prefix)) return { ok: false, reason: "prefix-changed" };
  if (!candLine.endsWith(suffix)) return { ok: false, reason: "suffix-changed" };
  return { ok: true, reason: "" };
}

const NUMERIC_TOKEN_RE = /\$?\d[\d,]*(?:\.\d+)?[A-Za-z]{0,2}\b/g;
const NAME_TOKEN_RE = /\b[A-Z][A-Za-z]+\b/g;

// True when the character at `index` in `text` opens a new sentence (index 0,
// or the nearest non-whitespace character before it is one of . ! ?).
function isSentenceInitial(text, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  if (i < 0) return true;
  return /[.!?]/.test(text[i]);
}

// checkAddedTokens(inScopeText, candidateText) -> rejects a candidate that
// introduces a number/date/currency amount or a (non-sentence-initial)
// proper name absent from the source material (AC-B3a). DELIBERATELY BLIND
// to negation/inflation that reuse existing tokens (AC-B3b) -- that is the
// user confirm gate's job, not this one's; see smoothTransition.guards.test.js's
// pinned "does NOT catch a negation" control.
export function checkAddedTokens(inScopeText, candidateText) {
  const source = String(inScopeText || "");
  const candidate = String(candidateText || "");

  const numericRe = new RegExp(NUMERIC_TOKEN_RE.source, "g");
  let match = numericRe.exec(candidate);
  while (match) {
    const token = match[0];
    if (!source.includes(token)) {
      return { ok: false, reason: `introduces a number/date/amount not in the source ("${token}")`, code: "added-token" };
    }
    match = numericRe.exec(candidate);
  }

  const nameRe = new RegExp(NAME_TOKEN_RE.source, "g");
  match = nameRe.exec(candidate);
  while (match) {
    const word = match[0];
    if (word.length >= 2 && !isSentenceInitial(candidate, match.index) && !source.includes(word)) {
      return { ok: false, reason: `introduces a name not in the source ("${word}")`, code: "added-token" };
    }
    match = nameRe.exec(candidate);
  }

  return { ok: true, reason: "", code: "" };
}

// Reconstructs the candidate paragraph/record/edit from the route's
// {before, fact, after} triple and the original span -- never re-derives the
// span, never re-asks the engine: this IS the text that gets shown, and (on
// confirm) the text that gets applied (AC-B12).
function buildProposal({ lines, records, id, smoothed, span }) {
  const origLine = String(lines[span.lineIndex] ?? "");
  const prefix = origLine.slice(0, span.start);
  const suffix = origLine.slice(span.end);
  const beforeText = typeof smoothed.before === "string" ? smoothed.before.trim() : "";
  const factText = typeof smoothed.fact === "string" ? smoothed.fact.trim() : "";
  const afterText = typeof smoothed.after === "string" ? smoothed.after.trim() : "";
  const middle = [beforeText, factText, afterText].filter(Boolean).join(" ");
  const newLine = `${prefix}${middle}${suffix}`;

  const newLines = lines.slice();
  newLines[span.lineIndex] = newLine;

  const factOffset = prefix.length + (beforeText ? beforeText.length + 1 : 0);
  const newRecords = records.map((r) => (r.id === id ? { ...r, text: factText, lineIndex: span.lineIndex, offset: factOffset } : r));

  const edits = [{ lineIndex: span.lineIndex, before: origLine, after: newLine }];
  return { newLines, newRecords, edits, middle };
}

async function readSmoothResponse(res) {
  if (!res || res.ok === false) return null;
  const json = await res.json();
  return json?.smoothed && typeof json.smoothed === "object" ? json.smoothed : null;
}

// requestSmoothTransition({ engine, lines, records, id, fetchImpl }) -- PRODUCES
// a candidate. NEVER PERSISTS ANYTHING (AC-B10): no store write, no
// coverLetterResultLines mutation, whatever the outcome. `fetchImpl` defaults
// to the ambient `fetch` (so a real click in the app hits the real route);
// tests inject a stub.
//
//   proposed  -> { status:"proposed", span, preview:{originalText,smoothedText},
//                  before:{lines,records}, after:{lines,records,edits} }
//   rejected  -> { status:"rejected", reason }   -- scope/added-token/stale-locator
//   failed    -> { status:"failed" }             -- engine/network/parse failure
//   unavailable_embedded -> { status:"unavailable_embedded" }  -- NO fetch fired
export async function requestSmoothTransition({ engine, lines, records, id, fetchImpl } = {}) {
  if (String(engine || "").trim().toLowerCase() === "embedded") {
    recordDecision("fact-smooth", "skipped", { reason: "embedded", code: "embedded" });
    return { status: "unavailable_embedded" };
  }

  const scoped = scopeSentences({ lines, records, id });
  if (!scoped.ok) {
    recordDecision("fact-smooth", "refused", { reason: scoped.reason, code: "stale-locator" });
    return { status: "rejected", reason: scoped.reason };
  }

  let smoothed;
  try {
    const doFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
    const res = await doFetch(SMOOTH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine,
        before: scoped.beforeText,
        factSentence: scoped.factText,
        after: scoped.afterText,
        factText: scoped.factText,
      }),
    });
    smoothed = await readSmoothResponse(res);
    if (!smoothed) throw new Error("smooth request failed");
  } catch {
    recordDecision("fact-smooth", "failed", { reason: "provider_error", code: "provider_error" });
    return { status: "failed" };
  }

  if (smoothed.status === "unavailable_embedded") {
    recordDecision("fact-smooth", "skipped", { reason: "embedded", code: "embedded" });
    return { status: "unavailable_embedded" };
  }
  if (smoothed.status === "rejected") {
    const code = smoothed.reason === "added-token" ? "added-token" : "scope";
    recordDecision("fact-smooth", "refused", { reason: smoothed.reason || "rejected", code });
    return { status: "rejected", reason: smoothed.reason || "rejected" };
  }
  if (smoothed.status !== "ok") {
    recordDecision("fact-smooth", "failed", { reason: "provider_error", code: "provider_error" });
    return { status: "failed" };
  }

  const proposal = buildProposal({ lines, records, id, smoothed, span: scoped.span });
  const scopeCheck = checkScope(lines, proposal.newLines, scoped.span);
  if (!scopeCheck.ok) {
    recordDecision("fact-smooth", "refused", { reason: "scope", code: "scope" });
    return { status: "rejected", reason: "scope" };
  }
  const tokenCheck = checkAddedTokens(scoped.inScopeText, proposal.middle);
  if (!tokenCheck.ok) {
    recordDecision("fact-smooth", "refused", { reason: "added-token", code: "added-token" });
    return { status: "rejected", reason: "added-token" };
  }

  return {
    status: "proposed",
    span: scoped.span,
    preview: {
      originalText: String(lines[scoped.span.lineIndex] ?? "").slice(scoped.span.start, scoped.span.end),
      smoothedText: proposal.middle,
    },
    before: { lines, records },
    after: { lines: proposal.newLines, records: proposal.newRecords, edits: proposal.edits },
  };
}

// persistLanded(persist, payload) -- did the caller's store write land? Shared
// by confirm and undo so the two can never disagree on what "landed" means. A
// missing `persist` is a landed write (nothing to refuse it); a resolved
// `{ ok:false }` is a refused one; a throw is an unexpected I/O failure. Never
// rethrows -- both callers turn a false into a recorded "failed" outcome.
async function persistLanded(persist, payload) {
  if (typeof persist !== "function") return true;
  try {
    const result = await persist(payload);
    return !(result && result.ok === false);
  } catch {
    return false;
  }
}

// confirmSmoothTransition(candidate, { persist }) -- THE ONLY write path
// (AC-B10/B12): applies EXACTLY `candidate.after` (the same object shown to
// the user, never regenerated) via the caller's `persist`, then records
// "acted". A no-op (never calls persist) on anything but a genuinely
// "proposed" candidate -- an already-rejected/failed/declined one cannot be
// confirmed into a write.
//
// N94: "acted" is recorded ONLY when the write actually landed. `persist` is
// the caller's store write; it signals a refused save the way
// app/hooks/useCompanyResearch.js's applySmoothedFact does, by RESOLVING
// `{ ok:false, reason }` (a bare resolve, or `{ ok:true }`, is a landed write),
// and an unexpected I/O error by THROWING. Either is recorded as the existing
// "failed" outcome with the "save-failed" code the sibling fact-position entry
// already uses for a failed save, returned as `{ ok:false }`, and never
// rethrown -- the activity log must not claim a success the letter does not
// carry, and the caller learns of the failure from the return value.
export async function confirmSmoothTransition(candidate, { persist } = {}) {
  if (!candidate || candidate.status !== "proposed") return { ok: false };
  const landed = await persistLanded(persist, candidate.after);
  if (!landed) {
    recordDecision("fact-smooth", "failed", { reason: "save-failed", code: "save-failed" });
    return { ok: false };
  }
  recordDecision("fact-smooth", "acted", { reason: "smoothed", code: "smoothed" });
  return { ok: true };
}

// declineSmoothTransition(candidate) -- the user refused a VALID proposal
// (distinct from an automated rejection, AC-B5). Never persists; logs a
// negative outcome distinguished by code "declined" (AC-B11).
export async function declineSmoothTransition(candidate) {
  if (!candidate || candidate.status !== "proposed") return { ok: true };
  recordDecision("fact-smooth", "refused", { reason: "declined", code: "declined" });
  return { ok: true };
}

// undoSmoothTransition(applied, { persist }) -- POST-APPLY UNDO (AC-B6). Only
// a genuinely applied ("proposed"->confirmed) candidate can be undone: hands
// `persist` EXACTLY the pre-smoothing snapshot the candidate already carries
// -- `applied.before.lines`/`applied.before.records`, the SAME references
// confirmSmoothTransition was given, never a re-derived copy -- plus `edits`
// built from `applied.after.edits` with `before`/`after` SWAPPED. The swap is
// what lets the byte-splice path (applyCoverDocxEdits, via the same
// commitFactMove/commitSmoothedFact I/O Apply already uses -- no new byte
// path) re-splice the STORED docx back to the original text: at undo time the
// stored bytes carry the SMOOTHED paragraph, so the edit's own `before` must
// be that smoothed text (candidate.after.edits[].after) for the staleness
// guard to accept it, and its `after` the original (candidate.after.edits[].before).
// A null / non-"proposed" candidate (nothing was ever applied, or it was only
// rejected/failed/declined) is a no-op: no persist call, `{ ok:false }`.
//
// N122: like confirm (N94), "acted"/"undo" is recorded ONLY when the restore
// actually landed. A `persist` that resolves `{ ok:false, reason }` or throws is
// recorded as the existing "failed" outcome with the "save-failed" code,
// returned as `{ ok:false }`, and never rethrown -- the letter is still smoothed,
// so the activity log must not claim it was undone.
export async function undoSmoothTransition(applied, { persist } = {}) {
  if (!applied || applied.status !== "proposed") return { ok: false };
  const edits = (Array.isArray(applied.after?.edits) ? applied.after.edits : []).map((edit) => ({
    lineIndex: edit.lineIndex,
    before: edit.after,
    after: edit.before,
  }));
  const restore = { lines: applied.before.lines, records: applied.before.records, edits };
  const landed = await persistLanded(persist, restore);
  if (!landed) {
    recordDecision("fact-smooth", "failed", { reason: "save-failed", code: "save-failed" });
    return { ok: false };
  }
  recordDecision("fact-smooth", "acted", { reason: "undo", code: "undo" });
  return { ok: true };
}
