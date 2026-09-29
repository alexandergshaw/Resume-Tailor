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
// double space elsewhere in the paragraph. `planMoveFact` therefore does NOT
// import or reuse `planRemoveFact`. A SAME-paragraph move (the common case)
// swaps the fact with its adjacent sentence UNIT (`swapWithNextUnit` /
// `swapWithPrevUnit` below) without discarding or reconstructing ANY
// whitespace -- the two units trade places and every separator, including a
// pre-existing double space on either side of the fact, is re-sliced
// verbatim off the original line. A CROSS-paragraph move (the fact leaves
// `line` entirely) still uses the excise/insert helpers, which touch only the
// fact's own span plus exactly one insertion-owned adjoining space.

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
//
// BUG-4 / AC-A10 INITIAL FIX: a closed token list can never name every
// possible personal-name initial ("J." in "J. Smith", "R." in "J. R. Smith"),
// so sentenceBounds also suppresses a boundary whenever the preceding token
// is a single capital letter plus period (`/^[A-Z]\.$/`), alongside the
// ABBREVIATIONS denylist above. That structural rule carries two disclosed,
// owner-accepted residuals (design section 1.2), never left silent:
// (a) a genuine single-capital sentence end is indistinguishable from an
// initial by any local rule -- a sentence that truly ends "...an A." right
// before a new capitalized sentence (e.g. "She earned an A. The next year
// improved.") now MERGES with the following sentence into one movable unit
// instead of splitting. Accepted because a rare merge is far less damaging
// than splicing a fact into the middle of a person's name.
// (b) a multi-letter abbreviation that is NOT on the closed ABBREVIATIONS
// denylist above is untouched by this single-capital rule and may still
// phantom-split -- the same class of known limitation the denylist itself
// already carries, restated here as an owner-accepted limitation rather than
// silently reintroduced by this fix.
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
  // Month abbreviations, "No.", and the clock-time markers -- each a single
  // whitespace-delimited token ending in a period, so a fact date like
  // "Aug. 2023" or a ranking like "No. 1" is never read as a sentence end.
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "Jun.",
  "Jul.",
  "Aug.",
  "Sep.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
  "No.",
  "a.m.",
  "p.m.",
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
    if (!ABBREVIATIONS.has(token) && !/^[A-Z]\.$/.test(token)) {
      bounds.push(match.index + match[0].length);
    }
    match = re.exec(raw);
  }
  return bounds;
}

// The fact's movable slot boundaries, computed directly on the UNTOUCHED
// `line` -- never a whitespace-eaten copy (AC-A4 / BUG 1: a carrier built by
// eating one of the fact's flanking spaces cannot tell a genuine boundary
// from the middle of a pre-existing double space, so slot-finding must never
// go through one). Any `sentenceBounds` offset strictly INSIDE the fact's own
// span (offset, offset+textLen) is excluded, so a multi-sentence fact
// (AC-A11) is one atomic unit -- its internal boundary is never a slot. The
// fact's own start/end are kept as slot markers when they coincide with a
// real boundary.
function lineGapsExcludingFact(line, offset, textLen) {
  const boundaries = sentenceBounds(line).filter((g) => g <= offset || g >= offset + textLen);
  return [0, ...boundaries, line.length];
}

// Excise the fact's own span (offset..offset+textLen) from `line`, dropping
// exactly ONE insertion-owned adjoining space -- preferring the one right
// before the clause, falling back to the one right after -- mirroring
// `planRemoveFact`'s own rule (factInsertion.js:243-251) but stopping before
// its line-global normalize (AC-A4). Used ONLY when a move crosses a
// paragraph boundary (the fact leaves `line` entirely); a same-paragraph move
// never calls this -- see `swapWithNextUnit`/`swapWithPrevUnit` below, which
// operate on the untouched line so neither flanking space is ever discarded.
function exciseSpanLocal(line, offset, textLen) {
  const head = line.slice(0, offset);
  const tail = line.slice(offset + textLen);
  const carrier = head.endsWith(" ") ? head.slice(0, -1) + tail : tail.startsWith(" ") ? head + tail.slice(1) : head + tail;
  return { carrier };
}

// AC-A4 / BUG 1: swap the fact with the unit immediately AFTER it. Neither
// unit's own flanking whitespace is touched -- the two units simply trade
// places, so `midSep` (the run between them) survives byte-for-byte
// regardless of whether it is a single space or a pre-existing double space,
// and the move is trivially its own inverse (`swapWithPrevUnit` undoes it
// exactly). `gaps`/`slotIndex` come from `lineGapsExcludingFact` on this same
// `line`, so `gaps[slotIndex]` is the fact's own start (`offset`).
function swapWithNextUnit(line, offset, textLen, gaps, slotIndex) {
  const nextStart = gaps[slotIndex + 1];
  const midSep = line.slice(offset + textLen, nextStart);
  const nextEnd = slotIndex + 2 < gaps.length ? gaps[slotIndex + 2] : line.length;
  const rawNext = line.slice(nextStart, nextEnd);
  const trailing = rawNext.match(/\s+$/);
  const nextText = trailing ? rawNext.slice(0, rawNext.length - trailing[0].length) : rawNext;
  const before = line.slice(0, offset);
  const fact = line.slice(offset, offset + textLen);
  // Whatever trails `nextText` (its own trailing separator, then anything
  // beyond) is re-sliced straight off `line` -- never reconstructed -- so it
  // is preserved byte-for-byte regardless of length.
  const after = line.slice(nextStart + nextText.length);
  return { line: `${before}${nextText}${midSep}${fact}${after}`, offset: before.length + nextText.length + midSep.length };
}

// The mirror of `swapWithNextUnit`: swap the fact with the unit immediately
// BEFORE it.
function swapWithPrevUnit(line, offset, textLen, gaps, slotIndex) {
  const prevStart = gaps[slotIndex - 1];
  const rawPrev = line.slice(prevStart, offset);
  const sepMatch = rawPrev.match(/\s+$/);
  const sep = sepMatch ? sepMatch[0] : "";
  const prevText = sep ? rawPrev.slice(0, rawPrev.length - sep.length) : rawPrev;
  const before = line.slice(0, prevStart);
  const fact = line.slice(offset, offset + textLen);
  const after = line.slice(offset + textLen);
  return { line: `${before}${fact}${sep}${prevText}${after}`, offset: before.length };
}

// Insert `text` into `carrier` at `gapOffset`, adding exactly one owned space
// on each side that needs one -- the exact inverse of `exciseSpanLocal`. Used
// ONLY for a cross-paragraph move's destination line (the fact's own
// paragraph never calls this -- see the swap helpers above). Returns the
// exact offset `text` now occupies (computed directly, never re-derived via
// `indexOf`, so a fact whose text recurs elsewhere on the same line is never
// mislocated).
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
  // AC-A4/A11/BUG 1: find the fact's slot directly on the untouched
  // `sourceLine` -- never a carrier that has already eaten one of its
  // flanking spaces (see `lineGapsExcludingFact`). Its own internal [.!?],
  // if any, is excluded from the boundary set, so a multi-sentence fact
  // (AC-A11) is one atomic unit.
  const gaps = lineGapsExcludingFact(sourceLine, offset, text.length);
  let slotIndex = gaps.indexOf(offset);
  if (slotIndex < 0) slotIndex = gaps.reduce((best, g, i) => (g <= offset ? i : best), 0);
  const hasPrevUnit = slotIndex > 0;
  const hasNextUnit = slotIndex + 1 < gaps.length - 1;

  const outLines = [...arr];
  const changedLines = new Map();
  let movedLineIndex;
  let movedOffset;

  if (direction === "backward" && hasPrevUnit) {
    // Same-paragraph move: swap with the unit immediately before, preserving
    // every separator byte-for-byte (AC-A4).
    const swapped = swapWithPrevUnit(sourceLine, offset, text.length, gaps, slotIndex);
    outLines[lineIndex] = swapped.line;
    changedLines.set(lineIndex, swapped.line);
    movedLineIndex = lineIndex;
    movedOffset = swapped.offset;
  } else if (direction !== "backward" && hasNextUnit) {
    // Same-paragraph move: swap with the unit immediately after.
    const swapped = swapWithNextUnit(sourceLine, offset, text.length, gaps, slotIndex);
    outLines[lineIndex] = swapped.line;
    changedLines.set(lineIndex, swapped.line);
    movedLineIndex = lineIndex;
    movedOffset = swapped.offset;
  } else if (direction === "backward") {
    // AC-A3: no earlier unit in this paragraph -- cross into the PREVIOUS
    // body paragraph's last slot, or a boundary no-op at minLine.
    const prevLineIndex = lineIndex - 1;
    if (prevLineIndex < minLine) return noop("boundary"); // never into the greeting
    const { carrier } = exciseSpanLocal(sourceLine, offset, text.length);
    outLines[lineIndex] = carrier;
    changedLines.set(lineIndex, carrier);
    const destLine = String(arr[prevLineIndex] ?? "");
    const inserted = insertSpanLocal(destLine, destLine.length, text);
    outLines[prevLineIndex] = inserted.line;
    changedLines.set(prevLineIndex, inserted.line);
    movedLineIndex = prevLineIndex;
    movedOffset = inserted.offset;
  } else {
    // AC-A3: no later unit in this paragraph -- cross into the NEXT body
    // paragraph's first slot, or a boundary no-op at maxLine.
    const nextLineIndex = lineIndex + 1;
    if (nextLineIndex > maxLine) return noop("boundary"); // never into the closing/signature
    const { carrier } = exciseSpanLocal(sourceLine, offset, text.length);
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
//
// BUG 3 (AC-A5/A7): the moved fact's OWN new span is reserved on its
// destination line before any survivor is resolved there, so a survivor with
// IDENTICAL text never resolves onto the occurrence the moved fact now
// occupies -- each keeps its own distinct physical occurrence.
function relocateAffected(list, changedLines, movedId, movedLineIndex, movedOffset) {
  const movedRecord = list.find((r) => r?.id === movedId);
  const movedTextLen = movedRecord && typeof movedRecord.text === "string" ? movedRecord.text.length : 0;

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
    const claimed = li === movedLineIndex && movedTextLen > 0 ? [[movedOffset, movedOffset + movedTextLen]] : [];
    const overlapsClaimed = (start, len) => claimed.some(([cs, ce]) => start < ce && start + len > cs);
    const findOwnOccurrence = (needle, fromIndex) => {
      let at = lineText.indexOf(needle, fromIndex);
      while (at >= 0 && overlapsClaimed(at, needle.length)) at = lineText.indexOf(needle, at + 1);
      if (at < 0 && fromIndex > 0) {
        at = lineText.indexOf(needle, 0);
        while (at >= 0 && overlapsClaimed(at, needle.length)) at = lineText.indexOf(needle, at + 1);
      }
      return at;
    };

    const sorted = [...recs].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
    let cursor = 0;
    for (const r of sorted) {
      const at = findOwnOccurrence(r.text, cursor);
      if (at >= 0) {
        claimed.push([at, at + r.text.length]);
        cursor = at + r.text.length;
      }
      relocatedById.set(r.id, at >= 0 ? { ...r, lineIndex: li, offset: at } : { ...r, lineIndex: li });
    }
  }
  return list.map((r) => {
    if (r?.id === movedId) return { ...r, lineIndex: movedLineIndex, offset: movedOffset };
    if (relocatedById.has(r.id)) return relocatedById.get(r.id);
    return r;
  });
}
