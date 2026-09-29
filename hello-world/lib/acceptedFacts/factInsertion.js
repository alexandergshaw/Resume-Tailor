// Pure planner for inserting an accepted company fact into a cover letter's
// paragraphs (N35). Isomorphic (no DOM, no I/O) so it can be unit-tested
// directly and, later, shared with a server-side render path.
//
// A fact lands at the paragraph its `placement` names, at the position that
// placement specifies (end, or after the first sentence) -- never a new
// line, never a lead-in phrase, so the letter reads as the candidate's own
// sentence with one more clause.

import { PLACEMENTS, DEFAULT_PLACEMENT } from "../document/coverLetterWeave.js";
import { planMoveFact } from "./factMove.js";

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

// N89 Part 1 (moved from app/hooks/useCompanyResearch.js under the plan's own
// file-size contingency, §P1-5 -- the hook's line count was on this file's
// side of the ceiling): the one place the three-way branch is decided, so
// acceptFacts and autoInsertFactsForJob cannot drift apart (AC-5). Bytes
// present -> splice (byte-faithful), unless the letter is already
// hand-edited, in which case the text-only path is used on purpose (the
// candidate's edits are never overwritten). No bytes but the uploaded
// template survives in session -> lines (Shape B, the owner's case). Neither
// -> refuse, the residual Shape C today's NO_ENGINE_BYTES_REASON already
// covers (owner ruling: dissolved by Part 2, left byte-identical here).
// @param {{hasCoverBytes:boolean, canRebuild:boolean, coverAlreadyEdited:boolean}} args
// @returns {"splice" | "lines" | "refuse"}
export function coverFactStrategy({ hasCoverBytes, canRebuild, coverAlreadyEdited }) {
  if (hasCoverBytes) return coverAlreadyEdited ? "lines" : "splice";
  if (canRebuild) return "lines";
  return "refuse";
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

// F1 (fresh-verifier finding, N61): the SAME whitespace normalisation
// insertFactText applies to the composed line, applied to one fact's OWN
// text before it is queued. Without this, a fact whose source text carries
// two-or-more consecutive whitespace characters (e.g. a copy-pasted "Acme
// opened  a Dublin  lab.") is inserted with that whitespace collapsed by
// insertFactText's own `.replace(/\s{2,}/g," ")`, but the record stored the
// RAW text -- so the recorded text never occurs in the letter at all: an
// unremovable, unhighlightable claim that reaches egress unreviewed. Every
// caller that records a fact's text (below) and every caller that composes
// it into a line (insertFactText above) must agree on this same string, or
// the record and the letter drift apart.
function normalizeFactText(text) {
  return String(text || "").trim().replace(/\s{2,}/g, " ");
}

// Plan every accepted fact against the cover letter's CURRENT lines. Never
// mutates `lines`: with no facts to apply the identical array reference is
// returned (§ invariant other callers rely on to skip a no-op splice).
//
// N56: two or more facts that resolve to the SAME paragraph are COALESCED
// into ONE edit against that paragraph's ORIGINAL text, never emitted as
// separate edits against a shared, progressively-mutated array -- that was
// the defect (the second edit's `before` was the first edit's OWN output,
// which lib/acceptedFacts/factDocx.js's stale-plan guard then, correctly,
// refused). Facts in one group are composed into a single insertion, joined
// in SCREEN ORDER by one space each and NO lead-in, so screen order survives
// (insertFactText's after-first-sentence rule matches the paragraph's
// original first sentence every time -- two separate calls would insert the
// second fact ahead of the first).
//
// F2 (fresh-verifier finding, N61): a fact's exact text is NOT always a safe
// key for removal or highlighting on its own -- the same text can occur a
// second time elsewhere in the letter (ordinary prose that happens to say
// the same thing), or be a SUBSTRING of another accepted fact on the same
// line, and a plain text search then excises or marks the wrong occurrence.
// So every fact this planner inserts is recorded LOCATED -- `{id, text,
// lineIndex, offset}` -- pointing at the exact span it actually occupies in
// the composed line, computed in insertion order with a running cursor so a
// repeated or overlapping text still resolves to ITS OWN occurrence, never
// an earlier one. `planRemoveFact` (below) and `lib/document/versionDiff.js`'s
// `markInsertedFacts` consume that locator instead of searching for the text.
//
// @returns {{ lines: string[], edits: {lineIndex:number, before:string, after:string}[],
//             record: {id:string, text:string, lineIndex:number, offset:number}[], changed: boolean }}
function planCoverFacts(lines, { facts, record = [] } = {}) {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length === 0) {
    return { lines, edits: [], record: [...record], changed: false };
  }
  const original = lines.map((l) => String(l));
  const nextRecord = [...record];
  // N81 fix-forward: `record` is scoped to the APPLICATION, never to the
  // cover-letter VERSION currently on screen -- a version switch
  // (selectDocumentVersion) swaps `coverLetterResultLines` without touching
  // the accepted-facts log, so a fact's id can outlive the paragraph it was
  // inserted into. `priorText` is the whole letter as one string, checked
  // ALONGSIDE the id below: an id match is provenance, not proof the text is
  // still there to duplicate.
  const priorText = original.join("\n");
  // N81: the SHARED SEAM guard. `record` is the caller's prior-accepted
  // provenance (both acceptFacts and autoInsertFactsForJob pass their own
  // `coverRecord` here); a fact whose id is already present there AND whose
  // RECORDED text is still present in these lines was already inserted and
  // must not be inserted a second time just because it now resolves to a
  // DIFFERENT paragraph. Id scoped -- never a blanket "skip on re-accept" --
  // and null-safe, so a fact with no id (never assigned by any current
  // caller) falls through to the existing text-keyed dedupe below instead of
  // being treated as "seen".
  //
  // N81 closing round (Bug 1, fresh-verifier NOT-SHIP on 5e96be2): the
  // presence half of this guard must consult the RECORDED fact's own text --
  // `recordTextById.get(fact.id)` -- never the INCOMING `fact.text` a caller
  // can freely re-edit before re-accepting. Comparing the incoming text let a
  // candidate edit a suggestion down to a short fragment that coincidentally
  // occurs elsewhere in the letter; that fragment was never inserted, but the
  // guard suppressed it as "already present" because ITS text (not the
  // recorded fact's) matched. Keying off the recorded text instead preserves
  // version-switch healing (a regenerated letter lacking the recorded text ->
  // allow) while killing the false positive (the edited incoming text plays
  // no part in the presence check).
  const recordIds = new Set(record.filter((r) => r?.id != null).map((r) => r.id));
  const recordTextById = new Map(record.filter((r) => r?.id != null).map((r) => [r.id, normalizeFactText(r.text)]));

  // Group every surviving fact by the line index it targets (resolved
  // against the ORIGINAL, untouched lines), preserving the order `facts`
  // arrives in -- both within a group and across groups.
  const order = [];
  const groups = new Map();
  for (const fact of list) {
    if (!fact || typeof fact.text !== "string" || !fact.text.trim()) continue;
    const text = normalizeFactText(fact.text);
    if (!text) continue;
    const recordedText = fact.id != null ? recordTextById.get(fact.id) : undefined;
    if (fact.id != null && recordIds.has(fact.id) && recordedText && priorText.includes(recordedText)) continue;
    const placement = resolvePlacement(fact.placement);
    const index = findTargetIndex(original, placement);
    if (index < 0 || index >= original.length) continue;

    let group = groups.get(index);
    if (!group) {
      group = { position: placement?.position, items: [], seen: new Set() };
      groups.set(index, group);
      order.push(index);
    }
    // M1 (verify.r1.md): skip a fact whose text is already in the
    // paragraph's ORIGINAL text, or already queued earlier in this same
    // group -- a re-click, or two cards carrying the same fact, must not
    // duplicate it in the letter's text or in the docx splice built from
    // these edits.
    if (original[index].includes(text) || group.seen.has(text)) continue;
    group.seen.add(text);
    group.items.push({ id: fact.id ?? null, text });
  }

  const out = [...original];
  const edits = [];
  for (const index of order) {
    const group = groups.get(index);
    if (group.items.length === 0) continue;
    const before = original[index];
    const after = insertFactText(before, group.items.map((it) => it.text).join(" "), group.position);
    out[index] = after;
    edits.push({ lineIndex: index, before, after });

    // Locate each item in SCREEN ORDER with an advancing cursor: this is
    // what keeps a repeated string, or a fact that is a substring of the
    // NEXT item, resolving to its own occurrence rather than one already
    // claimed by an earlier item in this same group (F2(b)).
    let cursor = 0;
    for (const item of group.items) {
      const at = after.indexOf(item.text, cursor);
      const offset = at >= 0 ? at : after.indexOf(item.text);
      nextRecord.push({ id: item.id, text: item.text, lineIndex: index, offset });
      if (offset >= 0) cursor = offset + item.text.length;
    }
  }

  return { lines: edits.length > 0 ? out : lines, edits, record: nextRecord, changed: edits.length > 0 };
}

// Inverse of insertFactText / planCoverFacts (N61): excise one accepted
// fact's clause from the cover letter's lines, leaving the paragraph as
// readable as it was before the fact was inserted -- no doubled space, no
// orphaned connective. LOCATED, not text-keyed (F2): `locator` is a record
// entry from `planCoverFacts`' `record` -- `{text, lineIndex, offset}` -- so
// this excises the fact's OWN occurrence even when its text is duplicated
// elsewhere in the letter or is a substring of another accepted fact on the
// same line. A stale locator (the text no longer sits at that exact
// location -- e.g. a second remove of an already-removed fact) is a no-op
// that returns the SAME `lines` reference, never a guess at a different
// occurrence.
//
// @param {string[]} lines  the entry's coverLetterResultLines (post-insert)
// @param {{text:string, lineIndex:number, offset:number}} locator  a
//   `planCoverFacts` record entry (extra fields such as `id` are ignored)
// @returns {{ lines: string[], edit: {lineIndex:number, before:string, after:string}|null, changed: boolean }}
//   `edit` is the reverse rewrite for applyCoverDocxEdits (before=current
//   line, after=line without the clause); null when nothing changed.
export function planRemoveFact(lines, locator) {
  const arr = Array.isArray(lines) ? lines : [];
  const lineIndex = locator?.lineIndex;
  const offset = locator?.offset;
  const text = locator?.text;
  if (typeof lineIndex !== "number" || typeof offset !== "number" || typeof text !== "string" || !text) {
    return { lines: arr, edit: null, changed: false };
  }
  const before = String(arr[lineIndex] ?? "");
  if (before.slice(offset, offset + text.length) !== text) {
    return { lines: arr, edit: null, changed: false }; // stale locator -- idempotent no-op
  }
  const head = before.slice(0, offset);
  const tail = before.slice(offset + text.length);
  // Drop exactly ONE adjoining space -- the one insertFactText itself added
  // -- preferring the space right before the clause (the common case: `end`
  // placement, or a non-first item in a coalesced group) and falling back to
  // the one right after when there is none before (the clause opened the
  // paragraph). Dropping both would eat a space that belonged to the
  // SURROUNDING text, not to this insertion.
  const spliced = head.endsWith(" ") ? head.slice(0, -1) + tail : tail.startsWith(" ") ? head + tail.slice(1) : head + tail;
  const after = spliced.replace(/\s{2,}/g, " ").trim();
  if (after === before) {
    return { lines: arr, edit: null, changed: false };
  }
  const out = [...arr];
  out[lineIndex] = after;
  return { lines: out, edit: { lineIndex, before, after }, changed: true };
}

// N61 (live defect, chunk N61): every researched article defaults to the
// "intro" placement, so two or three accepted facts routinely COALESCE onto
// one paragraph (planCoverFacts above groups same-line facts into a single
// edit). Removing one of several same-line facts left every LATER survivor's
// stored `offset` stale against the now-shorter line: `planRemoveFact`
// (survivor) then found the survivor's text was not where the record said
// and refused `{changed:false}` (permanently unremovable), and
// `markInsertedFacts` matched nothing either (permanently unhighlighted) --
// an unremovable, unhighlightable claim reaching the employer-bound letter.
//
// `facts` is expected in screen order (the order `planCoverFacts` located
// them in), so relocating each survivor's text against the NEW line with a
// per-line cursor -- mirroring `planCoverFacts`' own locate loop -- finds
// each survivor's OWN occurrence rather than a sibling's, satisfying the
// invariant removal must never break: every surviving record locates its own
// text in the resulting line, regardless of removal order.
//
// Moved out of app/hooks/useCompanyResearch.js (N92 Wave 1 file-size
// contingency, mirroring N89 Part 1's own move of `coverFactStrategy`/
// `filterEligibleArticles` into this same file) so that hook's new
// `moveInsertedFact` addition has room under its line ceiling; `removeInsertedFact`
// there now imports this instead of defining it locally -- behaviour
// byte-identical, only the module moved.
//
// @param {string[]} lines  the entry's coverLetterResultLines AFTER a removal
// @param {object[]} facts  the surviving located records, in screen order
// @returns {object[]} the same records, each with a re-located `offset`
export function relocateSurvivors(lines, facts) {
  const arr = Array.isArray(lines) ? lines : [];
  const cursorByLine = new Map();
  return (Array.isArray(facts) ? facts : []).map((f) => {
    if (typeof f?.lineIndex !== "number" || typeof f?.text !== "string" || !f.text) return f;
    const line = String(arr[f.lineIndex] ?? "");
    const from = cursorByLine.get(f.lineIndex) || 0;
    let at = line.indexOf(f.text, from);
    if (at < 0) at = line.indexOf(f.text);
    if (at >= 0) cursorByLine.set(f.lineIndex, at + f.text.length);
    return at >= 0 ? { ...f, offset: at } : f;
  });
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

// N92 Wave 2 (Control C, design section 4.3 / AC-C1/AC-C2/AC-C9): after
// planCoverFacts locates each newly-inserted fact, nudge EACH ONE exactly one
// sentence slot forward via planMoveFact -- the SAME primitive Control A
// (Wave 1) uses, so the two controls cannot diverge (AC-C2). Applied per
// fact (AC-C9), never as a group/paragraph-level shift; "newly-inserted"
// means the tail of `cover.record` beyond the caller's `coverRecord` --
// planCoverFacts only ever APPENDS to that array, never rewrites an earlier
// entry, so the tail is exactly this call's own inserts.
//
// RIGHTMOST-FIRST (AC-C9 coalescing). Two facts N56-coalesces onto one
// paragraph read, to the segmenter, as adjacent sentence units with nothing
// between them -- moving the LEFTMOST one first would swap it past its own
// trailing sibling (planMoveFact's forward move is "swap with the next
// sentence unit", and a freshly-inserted sibling fact IS that unit),
// reversing N56's screen order. Processing in decreasing (lineIndex, offset)
// order relocates each trailing fact out of the way first, so a coalesced
// pair shifts forward TOGETHER, in their original relative order.
//
// AC-C4/AC-X3 fix-forward (fresh-verifier Sev-1, N92.verify.w2.r1.md Bug 1):
// `cover.edits` must reach the nudged position too, not only `lines`/`record`
// -- it is the EXACT input the byte-splice path feeds to
// lib/acceptedFacts/factDocx.js#applyCoverDocxEdits, which checks every
// edit's `before` against the entry's single, static pre-insert
// `coverLetterResultLines` snapshot and refuses the WHOLE splice
// ("stale-plan") the instant one edit's `before` is not that true original --
// so at most ONE edit may exist per touched line, and it must describe the
// line's ORIGINAL text all the way through to its FINAL, post-nudge text; a
// second edit against an intermediate (post-insert or post-earlier-nudge)
// snapshot of the same line is exactly what that guard rejects. `beforeByLine`
// captures each touched line's true original exactly once: seeded from
// planCoverFacts' own edits (already original-vs-post-insert), then extended
// the FIRST time the nudge loop reaches a line planCoverFacts never touched --
// at that moment nothing else has changed the line yet, so the move's own
// `before` (computed against the untouched `arr` planMoveFact was handed) IS
// the true original. Every later touch of that same line only updates
// `lines`, never the recorded `before`, so the final edit rewritten from
// `beforeByLine` always spans original -> final in one hop.
function applyForwardNudge(cover, coverRecord) {
  if (!cover.changed) return cover;
  const baseLen = Array.isArray(coverRecord) ? coverRecord.length : 0;
  const newlyLocated = cover.record
    .slice(baseLen)
    .filter((r) => typeof r?.lineIndex === "number" && typeof r?.offset === "number");
  if (newlyLocated.length === 0) return cover;

  const order = [...newlyLocated].sort((a, b) => b.lineIndex - a.lineIndex || b.offset - a.offset);
  const beforeByLine = new Map(cover.edits.map((e) => [e.lineIndex, e.before]));
  let lines = cover.lines;
  let records = cover.record;
  let nudgedCount = 0;
  for (const rec of order) {
    const moved = planMoveFact({ lines, records, id: rec.id, direction: "forward" });
    if (moved.changed) {
      for (const edit of moved.edits) {
        if (!beforeByLine.has(edit.lineIndex)) beforeByLine.set(edit.lineIndex, edit.before);
      }
      lines = moved.lines;
      records = moved.records;
      nudgedCount += 1;
    }
  }
  if (nudgedCount === 0) return { ...cover, lines, record: records, nudgedCount };

  const edits = [...beforeByLine.entries()]
    .map(([lineIndex, before]) => ({ lineIndex, before, after: String(lines[lineIndex] ?? "") }))
    .filter((e) => e.after !== e.before)
    .sort((a, b) => a.lineIndex - b.lineIndex);

  return { ...cover, lines, record: records, edits, nudgedCount };
}

// The whole accept, for one tailoring entry. Currently plans the cover
// letter only -- the hiring email is plain text assembled at generation
// time (lib/llm/engines/tailor-lite/engine.js#buildHiringEmailText) and is
// out of this round's scope.
//
// `forwardNudge` (N92 Wave 2, additive, default false): when true, composes
// Control C's forward nudge on top of the placement this call already
// resolves -- place FIRST, then nudge (AC-C1). `acceptFacts` (the manual
// path) never passes it, so a hand-set placement is never nudged (AC-C8);
// only `autoInsertFactsForJob` does.
//
// @param {object} entry  a tailoringMap[jobId] entry
// @param {{facts: object[], coverRecord?: object[], emailRecord?: object[], previousFacts?: object[], forwardNudge?: boolean}} opts
// @returns {{ cover: ReturnType<typeof planCoverFacts>, pristineCoverLines: (string[]|undefined) }}
export function planAcceptForEntry(entry, { facts, coverRecord = [], forwardNudge = false } = {}) {
  const coverLines = Array.isArray(entry?.coverLetterResultLines) ? entry.coverLetterResultLines : [];
  let cover = planCoverFacts(coverLines, { facts, record: coverRecord });
  if (forwardNudge) cover = applyForwardNudge(cover, coverRecord);
  return { cover, pristineCoverLines: replacePristineCoverLines(entry, cover) };
}

// N90 (moved from app/hooks/useCompanyResearch.js under the same file-size
// contingency as coverFactStrategy above): tallies WHY each candidate
// article was excluded from auto-insert eligibility, preserving the exact
// same per-article short-circuit order (no-url -> no-suggestion -> removed)
// so the reported reason for each drop is the same reason the filter itself
// used, never a re-derived, possibly-different one. `droppedRemovedAlsoAccepted`
// is the direct exposure of the accept-never-clears anomaly: an article
// excluded as "removed" while the same key already sits in `priorFacts` is
// only possible if an earlier accept failed to clear the removed log.
// @param {object[]} articles
// @param {{urlKey:(url:string)=>(string|null), removedSet:Set<string>, priorFacts:object[]}} args
// @returns {{eligible:object[], droppedNoUrl:number, droppedNoSuggestion:number, droppedRemoved:number, droppedRemovedAlsoAccepted:number}}
export function filterEligibleArticles(articles, { urlKey, removedSet, priorFacts }) {
  const dropped = { droppedNoUrl: 0, droppedNoSuggestion: 0, droppedRemoved: 0, droppedRemovedAlsoAccepted: 0 };
  const eligible = (Array.isArray(articles) ? articles : []).filter((a) => {
    if (!a || urlKey(a.url) === null) {
      dropped.droppedNoUrl += 1;
      return false;
    }
    if (!String(a.suggestion || "").trim()) {
      dropped.droppedNoSuggestion += 1;
      return false;
    }
    if (removedSet.has(a.url) || removedSet.has(a.id)) {
      dropped.droppedRemoved += 1;
      if ((priorFacts || []).some((f) => f?.id === a.id || (a.url && f?.url === a.url))) dropped.droppedRemovedAlsoAccepted += 1;
      return false;
    }
    return true;
  });
  return { eligible, ...dropped };
}
