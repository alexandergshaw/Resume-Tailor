// THE MATCHER -- where a stored posting term is found in an already-rendered
// answer line, and which of the found occurrences may actually be marked.
//
// PURE, AND DELIBERATELY IGNORANT. This module imports nothing from the
// network, nothing from the model layer and nothing from the database. It does
// not know whether a definition came from a search or from the model's own
// memory, and it must not learn: under the glossary's schedule a posting's
// sources arrive over the MINUTES AFTER it is opened, so a matcher that
// preferred sourced terms would make WHICH WORDS ARE UNDERLINED drift under a
// candidate mid-answer. `provenance` is therefore not a tie-break input, and a
// test asserts the tie-break reads only kind, offset and length.
//
// ---------------------------------------------------------------------------
// THE COMPOSITION RULE, WHICH IS THE WHOLE REASON THIS FILE EXISTS
// ---------------------------------------------------------------------------
// A drafted line carries an `emphasis` span -- two character offsets into
// `point` -- and AnswerLines.js renders exactly ONE <strong> over exactly
// `point.slice(start, end)`. Six assertions in AnswerLines.emphasis.test.js
// pin that, and this feature may not move it by a byte.
//
// So marks are computed ONCE against the WHOLE `point`, and then PARTITIONED by
// the emphasis boundary -- never recomputed per slice. Matching each of the
// three slices separately would be the obvious implementation and is wrong
// twice over: a term spanning the boundary would match in neither slice (a
// silent, invisible loss), and a term whose first characters end one slice
// would match a DIFFERENT, shorter term there than it does in the whole
// sentence, so the marks would depend on where the bold happens to start.
//
// A mark that CROSSES either edge of the span is DROPPED, whole. Not split:
// splitting produces two dotted runs where the reader sees one word, and it
// makes the emphasised run's own boundaries a function of the glossary. The
// drop is a real cost, and it is measured over the repository's own answer
// corpus in ./glossaryMatch.corpus.test.js rather than assumed away -- the
// counts there are pinned exactly, so a change that made this rule more
// expensive moves a number in a file rather than passing silently.
//
// ---------------------------------------------------------------------------
// WORD BOUNDARIES, AND THE ONE PLACE THIS IS STRICTER THAN `literallyMentioned`
// ---------------------------------------------------------------------------
// The semantics are `answerLocal.js`'s `literallyMentioned`: `\b`-anchored
// where the term starts or ends with a word character, case-insensitive, never
// a substring -- `index` must not fire inside `indexed`.
//
// With ONE deliberate strengthening: a HYPHEN counts as a word character for
// boundary purposes. `\b` fires happily between "reputation" and "-", so a
// plain `\b` rule marks "sender reputation" inside "sender
// reputation-management", which is a different thing and is one of the five
// near-misses the matcher-discipline corpus names. The fix belongs here rather
// than in the admission filter because the term itself is perfectly admissible;
// it is the OCCURRENCE that is wrong.

/** Marks per rendered line, applied AFTER the straddle drop (AC-M8). */
export const MAX_MARKS_PER_LINE = 2;

const KIND_RANK = { explicit: 0, anticipated: 1 };

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeKey(term) {
  return String(term ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A term is worth marking only if its card would have something in it. A term
 * with neither a definition nor a quote gets no affordance at all: a dotted
 * underline that opens an empty box is the unacceptable answer (AC-E5).
 */
function contentOf(record) {
  const definition = typeof record.definition === "string" ? record.definition.trim() : "";
  const quote =
    typeof record.evidence === "string" && record.evidence.trim()
      ? record.evidence.trim()
      : typeof record.anchor_quote === "string"
        ? record.anchor_quote.trim()
        : "";
  return { definition, quote };
}

/**
 * The closed vocabulary for one posting, built once per glossary row and held
 * in context. Terms are deduped case-insensitively, explicit winning over
 * anticipated and the longer surface form winning within a kind -- the same
 * collapse rule the admission filter applies at write time (G8), restated here
 * because a row written by an older ingest may not have had it.
 *
 * @param {Array<object>|null|undefined} terms the row's stored `terms[]`
 */
export function buildGlossaryIndex(terms) {
  const byKey = new Map();

  for (const record of Array.isArray(terms) ? terms : []) {
    if (!record || typeof record !== "object") continue;
    const surface = typeof record.term === "string" ? record.term.trim().replace(/\s+/g, " ") : "";
    if (!surface) continue;

    const { definition, quote } = contentOf(record);
    if (!definition && !quote) continue; // AC-E5

    const key = normalizeKey(surface);
    const kind = record.kind === "anticipated" ? "anticipated" : "explicit";
    const existing = byKey.get(key);
    if (existing) {
      const better =
        KIND_RANK[kind] < KIND_RANK[existing.kind] ||
        (kind === existing.kind && surface.length > existing.surface.length);
      if (!better) continue;
    }

    const startsWord = /^\w/.test(surface);
    const endsWord = /\w$/.test(surface);
    byKey.set(key, {
      key,
      surface,
      kind,
      record,
      // The `g` flag is reset per scan below; the object is shared, never the
      // regex's own lastIndex state across two concurrent scans.
      pattern: new RegExp(
        `${startsWord ? "(?<![\\w-])" : ""}${escapeRegExp(surface)}${endsWord ? "(?![\\w-])" : ""}`,
        "gi",
      ),
    });
  }

  const entries = [...byKey.values()];
  return Object.freeze({ entries: Object.freeze(entries), size: entries.length });
}

/** The frozen empty default AnswerLines gets when no provider is mounted. */
export const EMPTY_GLOSSARY_INDEX = buildGlossaryIndex([]);

/**
 * Every occurrence of every vocabulary term in one line, resolved into a
 * non-overlapping set, in reading order. UNCAPPED on purpose: the per-line cap
 * is applied by `glossaryMarksFor` AFTER the straddle drop, so a line with
 * three candidates one of which straddles yields two marks rather than one.
 *
 * @param {unknown} point the rendered sentence
 * @param {{entries: Array<object>}} index
 * @returns {Array<{start: number, end: number, term: object}>}
 */
export function findGlossaryMarks(point, index) {
  const text = typeof point === "string" ? point : "";
  const entries = index && Array.isArray(index.entries) ? index.entries : [];
  if (!text || entries.length === 0) return [];

  const candidates = [];
  for (const entry of entries) {
    entry.pattern.lastIndex = 0;
    let match = entry.pattern.exec(text);
    while (match) {
      candidates.push({ start: match.index, end: match.index + match[0].length, entry });
      // A zero-length match is impossible (an empty surface never enters the
      // index), so lastIndex always advances and this cannot spin.
      match = entry.pattern.exec(text);
    }
  }

  // AC-M14, and this ordering IS the tie-break: earliest in reading order
  // wins; at the same offset an explicit term beats an anticipated one; at the
  // same offset and kind the longer term wins. Nothing here reads provenance,
  // a source, or the order the terms happened to be stored in.
  candidates.sort(
    (a, b) =>
      a.start - b.start ||
      KIND_RANK[a.entry.kind] - KIND_RANK[b.entry.kind] ||
      b.end - b.start - (a.end - a.start) ||
      a.entry.key.localeCompare(b.entry.key),
  );

  const marks = [];
  let consumedTo = 0;
  for (const candidate of candidates) {
    if (candidate.start < consumedTo) continue; // non-overlapping
    marks.push({ start: candidate.start, end: candidate.end, term: candidate.entry.record });
    consumedTo = candidate.end;
  }
  return marks;
}

/**
 * The same span validation AnswerLines.js applies before it renders one. A
 * malformed span is treated as no emphasis at all, exactly as it is there, so
 * the matcher and the renderer can never disagree about which regions exist.
 */
function usableSpan(span, point) {
  if (!span) return null;
  const { start, end } = span;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > point.length) return null;
  return { start, end };
}

const crosses = (mark, span) =>
  (mark.start < span.start && mark.end > span.start) || (mark.start < span.end && mark.end > span.end);

/**
 * The marks one line may actually render: found once over the whole point,
 * partitioned by the emphasis boundary, straddlers dropped, THEN capped.
 *
 * `straddled` and `candidates` are returned rather than swallowed so the cost
 * of the drop is measurable over a corpus instead of being an article of faith.
 *
 * @param {unknown} point
 * @param {{entries: Array<object>}} index
 * @param {{start: number, end: number}|null} emphasis
 */
export function glossaryMarksFor(point, index, emphasis) {
  const text = typeof point === "string" ? point : "";
  const all = findGlossaryMarks(text, index);
  const span = usableSpan(emphasis, text);
  const kept = span ? all.filter((mark) => !crosses(mark, span)) : all;
  return {
    marks: kept.slice(0, MAX_MARKS_PER_LINE),
    candidates: all.length,
    straddled: all.length - kept.length,
  };
}

/**
 * The marks that fall wholly inside one region of the partition, offset-shifted
 * into that region's own coordinates. The renderer walks three regions
 * (before the bold, inside it, after it) or one (no emphasis) and asks this for
 * each; a mark that crosses a boundary belongs to no region and has already
 * been dropped by `glossaryMarksFor`.
 */
export function marksWithin(marks, from, to) {
  const out = [];
  for (const mark of marks) {
    if (mark.start >= from && mark.end <= to) out.push(mark);
  }
  return out;
}
