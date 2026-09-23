// Pure planner for inserting an accepted company fact into a cover letter's
// paragraphs (N35). Isomorphic (no DOM, no I/O) so it can be unit-tested
// directly and, later, shared with a server-side render path.
//
// A fact lands at the paragraph its `placement` names, at the position that
// placement specifies (end, or after the first sentence) -- never a new
// line, never a lead-in phrase, so the letter reads as the candidate's own
// sentence with one more clause.

import { PLACEMENTS, DEFAULT_PLACEMENT } from "../document/coverLetterWeave.js";

// The cover letter's paragraph "slots" a fact can land in: imports the SAME
// table lib/document/coverLetterWeave.js uses for the research-weave
// feature, rather than a hand-kept local copy. A prior version of this file
// hand-copied the anchors to avoid moving
// lib/sourceScan/exportReachability.sweep.test.js's pinned TEST_REFERENCED
// count -- but the copy dropped PLACEMENTS' `position` field, so `intro` and
// `why` facts were appended at the paragraph's END while the sibling
// research-weave feature inserts them after the first sentence, an
// undisclosed divergence between two features doing the same kind of
// insertion. Importing PLACEMENTS moves the census by one; that is an
// ordinary, correct re-derivation of a count that legitimately changed, not
// a gate being worked around.

// First substantive paragraph after the greeting (line 0) -- the same
// fallback coverLetterWeave.js uses when a placement's anchor isn't found
// (a Gemini-authored or already hand-edited letter may not contain it).
// Not imported: coverLetterWeave.js does not export it.
function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}

function resolvePlacement(placementId) {
  return PLACEMENTS.find((p) => p.id === placementId) || PLACEMENTS.find((p) => p.id === DEFAULT_PLACEMENT);
}

function findTargetIndex(lines, placement) {
  if (placement?.anchor) {
    const i = lines.findIndex((l) => placement.anchor.test(String(l)));
    if (i >= 0) return i;
  }
  return introIndex(lines);
}

// Mirrors coverLetterWeave.js#insertIntoParagraph exactly, so the two
// features place text the same way at a shared placement id.
function insertFactText(line, text, position) {
  const p = String(line || "");
  if (position === "end") return `${p} ${text}`.replace(/\s{2,}/g, " ").trim();
  const m = p.match(/^(.*?[.!?])(\s+)([\s\S]*)$/);
  return (m ? `${m[1]} ${text} ${m[3]}` : `${p} ${text}`).replace(/\s{2,}/g, " ").trim();
}

// Plan every accepted fact against the cover letter's CURRENT lines. Never
// mutates `lines`: with no facts to apply the identical array reference is
// returned (§ invariant other callers rely on to skip a no-op splice).
//
// @returns {{ lines: string[], edits: {lineIndex:number, before:string, after:string}[],
//             record: {id:string, text:string}[], changed: boolean }}
function planCoverFacts(lines, { facts, record = [] } = {}) {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length === 0) {
    return { lines, edits: [], record: [...record], changed: false };
  }
  const out = lines.map((l) => String(l));
  const edits = [];
  const nextRecord = [...record];
  for (const fact of list) {
    if (!fact || typeof fact.text !== "string" || !fact.text.trim()) continue;
    const text = fact.text.trim();
    const placement = resolvePlacement(fact.placement);
    const index = findTargetIndex(out, placement);
    if (index < 0 || index >= out.length) continue;
    const before = out[index];
    // M1 (verify.r1.md): a fact whose text is already IN the target
    // paragraph is skipped, not re-appended -- otherwise a second accept of
    // the same selection (a re-click on a dialog that stays open with the
    // same rows checked) duplicates it in both the letter's text and the
    // docx splice built from these edits.
    if (before.includes(text)) continue;
    const after = insertFactText(before, text, placement?.position);
    out[index] = after;
    edits.push({ lineIndex: index, before, after });
    nextRecord.push({ id: fact.id ?? null, text });
  }
  return { lines: edits.length > 0 ? out : lines, edits, record: nextRecord, changed: edits.length > 0 };
}

// The two consumers that read `pristineCoverLines` back out (editMining.js
// and editRules.js, see below) do not agree on one normalisation, so a
// pristine line is considered "the same line" as the accept's pre-edit text
// under EITHER of theirs -- matching only one would leave the other
// consumer holding a stale line.
function normalizeForMining(line) {
  return String(line || "")
    .replace(/^[\s•\-*–—>]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function normalizeForRules(line) {
  return String(line || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function samePristineLine(pristineLine, preAcceptText) {
  return (
    normalizeForMining(pristineLine) === normalizeForMining(preAcceptText) ||
    normalizeForRules(pristineLine) === normalizeForRules(preAcceptText)
  );
}

// The `pristineCoverLines` snapshot (useDocumentPreview.js's mining
// baseline) updated by CONTENT-KEYED REPLACEMENT, never a union. An accept
// modifies a paragraph in place; a union would leave that paragraph's
// pre-accept text sitting in `pristine` forever with nothing left in the
// document to pair it against -- lib/tailor/editRules.js#pairEdits then
// pairs that leftover line with whatever the candidate types next and
// mines a spurious whole-line "rewrite" rule out of it (plan.check.r2 PB2).
// Replacing the matched line in place closes that leak: `pristine` never
// holds two near-identical copies of the same paragraph.
//
// Content-keyed, never index-keyed: `entry.coverLetterResultLines` and
// `entry.pristineCoverLines` no longer share indices once the letter has
// been hand-edited before the accept, so each edit's PRE-accept text is
// matched by content against every remaining pristine line, not by
// position. A pristine line with no match at all (the paragraph was
// reworded beyond recognition before the accept) is appended, never
// dropped -- the post-accept text must still enter pristine or the fact
// itself becomes mineable.
function replacePristineCoverLines(entry, cover) {
  if (entry?.pristineCoverLines === undefined) return undefined;
  const pristine = [...entry.pristineCoverLines];
  const consumed = new Set();
  for (const edit of cover.edits) {
    let matchAt = -1;
    for (let i = 0; i < pristine.length; i += 1) {
      if (consumed.has(i)) continue;
      if (samePristineLine(pristine[i], edit.before)) {
        matchAt = i;
        break;
      }
    }
    if (matchAt >= 0) {
      pristine[matchAt] = edit.after;
      consumed.add(matchAt);
    } else {
      pristine.push(edit.after);
    }
  }
  return pristine;
}

// M2 (verify.r1.md): a second accept used to REPLACE the stored fact set
// (the client sent only the current click's facts as `p_facts`), so the
// store -- and the next letter version's `inserted_facts` provenance --
// disagreed with what the letter actually contained. Merges `incoming` onto
// `prior`: every prior fact is kept, and an incoming fact is appended only
// when its normalised text isn't already present, using the same identity
// check `planCoverFacts`' paragraph-level dedupe (M1) uses.
export function mergeAcceptedFacts(prior, incoming) {
  const priorList = Array.isArray(prior) ? prior : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const have = new Set(priorList.map((f) => normalizeForRules(f?.text)).filter(Boolean));
  const merged = [...priorList];
  for (const fact of incomingList) {
    if (!fact || typeof fact.text !== "string" || !fact.text.trim()) continue;
    const norm = normalizeForRules(fact.text);
    if (have.has(norm)) continue;
    have.add(norm);
    merged.push(fact);
  }
  return merged;
}

// The whole accept, for one tailoring entry. Currently plans the cover
// letter only -- the hiring email is plain text assembled at generation
// time (lib/llm/engines/tailor-lite/engine.js#buildHiringEmailText) and is
// out of this round's scope.
//
// @param {object} entry  a tailoringMap[jobId] entry
// @param {{facts: object[], coverRecord?: object[], emailRecord?: object[], previousFacts?: object[]}} opts
// @returns {{ cover: ReturnType<typeof planCoverFacts>, pristineCoverLines: (string[]|undefined) }}
export function planAcceptForEntry(entry, { facts, coverRecord = [] } = {}) {
  const coverLines = Array.isArray(entry?.coverLetterResultLines) ? entry.coverLetterResultLines : [];
  const cover = planCoverFacts(coverLines, { facts, record: coverRecord });
  return { cover, pristineCoverLines: replacePristineCoverLines(entry, cover) };
}
