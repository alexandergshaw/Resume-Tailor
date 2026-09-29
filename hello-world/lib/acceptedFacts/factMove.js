// N92 Wave 1 (Control A) -- the shared move primitive: relocate one accepted
// company fact forward or backward by exactly one sentence in the cover
// letter (design N92.design-structure.r1.md section 1, plan W1-S1). Pure,
// isomorphic (no DOM, no I/O), sibling to lib/acceptedFacts/factInsertion.js.
// Both Control A (the manual move handler in useCompanyResearch.js) and
// Control C (Wave 2's insert-time forward nudge) import THIS module, so the
// two controls cannot diverge (AC-A1/AC-C2).
//
// SPAN-LOCAL, NOT LINE-GLOBAL (AC-A4 / N92C-5). `planRemoveFact` and
// `insertFactText` (factInsertion.js:252,:66-71) both finish with
// `.replace(/\s{2,}/g," ").trim()` on the WHOLE line -- fine for their own
// job, fatal for a reversible move, because it would eat any pre-existing
// double space elsewhere in the paragraph. This module's excise/insert
// helpers below touch ONLY the fact's own span plus exactly one
// insertion-owned adjoining space, so a paragraph's own quirks (a candidate's
// stray double space) survive a forward-then-backward round trip untouched.
// `planMoveFact` therefore does NOT import or reuse `planRemoveFact`.

// The sentence-boundary DEFINITION reused from lib/text/summarize.js:36
// (`splitSentences`'s own regex, copied verbatim -- including its curly
// left-quote -- so both features agree on what a boundary is). Not imported:
// `splitSentences` collapses whitespace up front and returns trimmed
// segments, not offsets into the raw text, which is unusable for a
// byte-faithful move (design section 1.2 / D1). `sentenceBounds` below
// re-implements only the OFFSET-LOCATING half, non-destructively.
const BOUNDARY_PATTERN = /(?<=[.!?])\s+(?=[A-Z0-9"'“(])/;

// AC-A10: the boundary pattern alone mis-splits "U.S. Army" (period + space +
// capital reads as a real boundary). This closed denylist names the token
// immediately before the punctuation that must NOT count as a sentence end.
// Covers every class the AC names (honorifics, U.S./U.K., e.g./i.e.,
// corporate suffixes) plus the ordinary common ones. A residual class this
// denylist cannot resolve -- a company name ending "Inc." at the genuine end
// of a sentence, immediately followed by a new capitalized sentence -- is an
// OWNER-ACCEPTED limitation (design section 1.2): the denylist would (rarely)
// suppress that real boundary rather than risk the far more common phantom
// split. Not exercised by any fixture; named here so it is never silent.
const ABBREVIATIONS = new Set([
  "Dr.",
  "Mr.",
  "Ms.",
  "Mrs.",
  "Prof.",
  "Sr.",
  "Jr.",
  "St.",
  "U.S.",
  "U.K.",
  "e.g.",
  "i.e.",
  "Ph.D.",
  "Inc.",
  "Corp.",
  "Ltd.",
  "Co.",
  "vs.",
  "etc.",
]);

// The token (including any internal periods, e.g. "U.S.") that ends at
// `punctIndex` -- the [.!?] character a candidate boundary's lookbehind
// matched. Scans backward to the previous whitespace run or the start of the
// string.
function precedingToken(text, punctIndex) {
  let start = punctIndex;
  while (start >= 0 && !/\s/.test(text[start])) start -= 1;
  return text.slice(start + 1, punctIndex + 1);
}

// Returns the char offsets in the RAW, uncollapsed `text` where each
// sentence AFTER THE FIRST begins (AC-A10, design section 1.2). Never trims
// or collapses whitespace -- a move needs to splice the ORIGINAL string, not
// a normalized copy. A fresh RegExp instance per call (built from
// BOUNDARY_PATTERN's own `.source`) avoids any shared, mutable `lastIndex`
// state across calls.
export function sentenceBounds(text) {
  const raw = String(text || "");
  const re = new RegExp(BOUNDARY_PATTERN.source, "g");
  const bounds = [];
  let match = re.exec(raw);
  while (match) {
    const punctIndex = match.index - 1;
    const token = precedingToken(raw, punctIndex);
    if (!ABBREVIATIONS.has(token)) {
      bounds.push(match.index + match[0].length);
    }
    match = re.exec(raw);
  }
  return bounds;
}

// The movable "slots" in `text`: the very start, the start of every sentence
// after the first (sentenceBounds), and the very end. A fact can be spliced
// into any of these -- never mid-sentence.
function gapsOf(text) {
  return [0, ...sentenceBounds(text), text.length];
}

// Excise the fact's own span (offset..offset+textLen) from `line`, dropping
// exactly ONE insertion-owned adjoining space -- preferring the one right
// before the clause, falling back to the one right after -- mirroring
// `planRemoveFact`'s own rule (factInsertion.js:243-251) but stopping before
// its line-global normalize (AC-A4). Also returns `gapOffset`: the position,
// in the RESULTING carrier text and in the SAME coordinate frame
// `sentenceBounds`/`gapsOf` use (the start of whatever content follows the
// gap), that the excised fact used to occupy -- so the caller can find which
// slot the fact is currently in without re-deriving it from `sentenceBounds`
// alone (a value that would not exist if the fact's own text created the
// only nearby boundary).
function exciseSpanLocal(line, offset, textLen) {
  const head = line.slice(0, offset);
  const tail = line.slice(offset + textLen);
  const carrier = head.endsWith(" ") ? head.slice(0, -1) + tail : tail.startsWith(" ") ? head + tail.slice(1) : head + tail;
  const tailContent = tail.startsWith(" ") ? tail.slice(1) : tail;
  const gapOffset = carrier.length - tailContent.length;
  return { carrier, gapOffset };
}

// Insert `text` into `carrier` at `gapOffset` (a value from `gapsOf`),
// adding exactly one owned space on each side that needs one -- the exact
// inverse of exciseSpanLocal. Returns the exact offset `text` now occupies
// (computed directly, never re-derived via `indexOf`, so a fact whose text
// recurs elsewhere on the same line is never mislocated).
function insertSpanLocal(carrier, gapOffset, text) {
  const head = carrier.slice(0, gapOffset);
  const tail = carrier.slice(gapOffset);
  if (head.length === 0 && tail.length === 0) return { line: text, offset: 0 };
  if (head.length === 0) return { line: `${text} ${tail}`, offset: 0 };
  if (tail.length === 0) return { line: `${head} ${text}`, offset: head.length + 1 };
  return { line: `${head}${text} ${tail}`, offset: head.length };
}

// AC-A3/D2/P2: the cover letter's paragraph array carries no explicit
// "closing" marker, so the body/closing boundary is a heuristic, computed
// fresh for every call (both callers -- Control A and Wave 2's Control C --
// omit `bounds` so they always get the SAME policy, never a divergent one).
// `minLine` excludes the greeting (line 0). `maxLine` excludes a trailing
// closing block: either a bare salutation line ("Sincerely,", "Regards", ...)
// or a short, punctuation-light signature line immediately following one. A
// letter with no recognizable closing moves within its whole tail.
const CLOSING_SALUTATION = /^\s*(sincerely|regards|best regards|kind regards|warm regards|best|yours (truly|sincerely)|respectfully|thank you)\b/i;

function isShortSignatureLine(line) {
  const t = String(line ?? "").trim();
  if (!t || t.length > 40) return false;
  const punctCount = (t.match(/[^\w\s]/g) || []).length;
  return punctCount <= 1;
}

function bodyBounds(lines) {
  const minLine = lines.length > 1 ? 1 : 0;
  const last = lines.length - 1;
  if (last >= minLine && isShortSignatureLine(lines[last]) && last - 1 >= minLine && CLOSING_SALUTATION.test(String(lines[last - 1] ?? ""))) {
    return { minLine, maxLine: last - 2 };
  }
  if (last >= minLine && CLOSING_SALUTATION.test(String(lines[last] ?? ""))) {
    return { minLine, maxLine: last - 1 };
  }
  return { minLine, maxLine: last };
}

// The shared move primitive (design section 1.1). Never mutates `lines` or
// `records`; a no-op returns the SAME references (AC-A1) with a machine
// `reason` ("not-found" | "stale-locator" | "boundary"). A real move returns
// a NEW `lines` array, the FULL updated `records` (every surviving record
// still locating its own text -- AC-A5/A7), and `edits` for
// `applyCoverDocxEdits` (one entry when the move stays within a paragraph,
// two when it crosses into the next/previous body paragraph -- AC-A3).
//
// @param {{lines:string[], records:object[], id:string, direction:"forward"|"backward", bounds?:{minLine:number,maxLine:number}}} args
// @returns {{lines:string[], records:object[], edits:{lineIndex:number,before:string,after:string}[], changed:boolean, reason:string}}
export function planMoveFact({ lines, records, id, direction, bounds } = {}) {
  const arr = Array.isArray(lines) ? lines : [];
  const list = Array.isArray(records) ? records : [];
  const noop = (reason) => ({ lines: arr, records: list, edits: [], changed: false, reason });

  const record = list.find((r) => r?.id === id);
  if (!record) return noop("not-found");
  const { lineIndex, offset, text } = record;
  if (typeof lineIndex !== "number" || typeof offset !== "number" || typeof text !== "string" || !text) {
    return noop("stale-locator");
  }
  const sourceLine = String(arr[lineIndex] ?? "");
  if (sourceLine.slice(offset, offset + text.length) !== text) {
    return noop("stale-locator"); // hand-edited letter moved the span off its recorded offset (AC-A8)
  }

  const { minLine, maxLine } = bounds || bodyBounds(arr);
  // AC-A11: excise the WHOLE fact span first (its own internal [.!?], if
  // any, never reaches sentenceBounds below), then segment the CARRIER --
  // the atomicity falls straight out of this ordering.
  const { carrier, gapOffset } = exciseSpanLocal(sourceLine, offset, text.length);
  const gaps = gapsOf(carrier);
  let slotIndex = gaps.indexOf(gapOffset);
  if (slotIndex < 0) slotIndex = gaps.reduce((best, g, i) => (g <= gapOffset ? i : best), 0);
  const targetSlot = direction === "backward" ? slotIndex - 1 : slotIndex + 1;

  const outLines = [...arr];
  const changedLines = new Map();
  let movedLineIndex;
  let movedOffset;

  if (targetSlot >= 0 && targetSlot < gaps.length) {
    // Same-paragraph move: re-insert into the same carrier at the adjacent slot.
    const inserted = insertSpanLocal(carrier, gaps[targetSlot], text);
    outLines[lineIndex] = inserted.line;
    changedLines.set(lineIndex, inserted.line);
    movedLineIndex = lineIndex;
    movedOffset = inserted.offset;
  } else if (targetSlot < 0) {
    // AC-A3: backward past this paragraph's first slot -- cross into the
    // PREVIOUS body paragraph's last slot, or a boundary no-op at minLine.
    const prevLineIndex = lineIndex - 1;
    if (prevLineIndex < minLine) return noop("boundary"); // never into the greeting
    outLines[lineIndex] = carrier;
    changedLines.set(lineIndex, carrier);
    const destLine = String(arr[prevLineIndex] ?? "");
    const inserted = insertSpanLocal(destLine, destLine.length, text);
    outLines[prevLineIndex] = inserted.line;
    changedLines.set(prevLineIndex, inserted.line);
    movedLineIndex = prevLineIndex;
    movedOffset = inserted.offset;
  } else {
    // AC-A3: forward past this paragraph's last slot -- cross into the NEXT
    // body paragraph's first slot, or a boundary no-op at maxLine.
    const nextLineIndex = lineIndex + 1;
    if (nextLineIndex > maxLine) return noop("boundary"); // never into the closing/signature
    outLines[lineIndex] = carrier;
    changedLines.set(lineIndex, carrier);
    const destLine = String(arr[nextLineIndex] ?? "");
    const inserted = insertSpanLocal(destLine, 0, text);
    outLines[nextLineIndex] = inserted.line;
    changedLines.set(nextLineIndex, inserted.line);
    movedLineIndex = nextLineIndex;
    movedOffset = inserted.offset;
  }

  const newRecords = relocateAffected(list, changedLines, id, movedLineIndex, movedOffset);
  const edits = [...changedLines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([li, after]) => ({ lineIndex: li, before: String(arr[li] ?? ""), after }));

  return { lines: outLines, records: newRecords, edits, changed: true, reason: "ok" };
}

// AC-A5/A7: after a move, every OTHER record whose paragraph changed text
// (the source paragraph losing the fact, or -- on a cross-paragraph move --
// the destination paragraph gaining it) must still locate its own text at
// its own offset. The moved record's new position is already known exactly
// (`movedOffset`, from insertSpanLocal); every other affected record is
// relocated with a per-line cursor, processed in the order of its PRIOR
// offset -- the relative order among facts that did not move is unaffected
// by a move of a DIFFERENT fact, so this ordering finds each one's own
// occurrence rather than a sibling's (mirrors useCompanyResearch.js's own
// `relocateSurvivors`). A record on an unaffected line is returned by
// reference, unchanged.
function relocateAffected(list, changedLines, movedId, movedLineIndex, movedOffset) {
  const byLine = new Map();
  for (const r of list) {
    if (r?.id === movedId) continue;
    if (!changedLines.has(r?.lineIndex)) continue;
    if (!byLine.has(r.lineIndex)) byLine.set(r.lineIndex, []);
    byLine.get(r.lineIndex).push(r);
  }
  const relocatedById = new Map();
  for (const [li, recs] of byLine) {
    const lineText = changedLines.get(li);
    const sorted = [...recs].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
    let cursor = 0;
    for (const r of sorted) {
      let at = lineText.indexOf(r.text, cursor);
      if (at < 0) at = lineText.indexOf(r.text);
      if (at >= 0) cursor = at + r.text.length;
      relocatedById.set(r.id, at >= 0 ? { ...r, lineIndex: li, offset: at } : { ...r, lineIndex: li });
    }
  }
  return list.map((r) => {
    if (r?.id === movedId) return { ...r, lineIndex: movedLineIndex, offset: movedOffset };
    if (relocatedById.has(r.id)) return relocatedById.get(r.id);
    return r;
  });
}
