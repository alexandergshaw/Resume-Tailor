// N49: THE THREE-CONVENTION LINE ATTACHMENT RULE, plus a fourth, per the
// orchestrator's ruling on citationLineAgreement.test.js's own disclosed
// residual. See that test file's header for the full domain reasoning; this
// module implements the rule it specifies.
//
// The vendor's citation offsets are documented as bytes, but not which
// STRING those bytes index -- the block the annotation sits on, the whole
// `output_text`, or the concatenation of every block. Reading it under the
// wrong convention lands a citation on the wrong line, which is worse than
// no citation at all (a wrong attribution is indistinguishable from a right
// one on screen). This rule attaches ONLY when every MODELLED convention's
// reading agrees on the same line -- never on a majority, never by dropping
// a convention that produces a line-crossing reading, because a convention
// that legitimately crosses a line still VOTES (a "cross"/"unplaceable"
// placement), and discarding it before the vote is exactly how a wrong
// convention can win alone.
//
// THE FOURTH CONVENTION. `allBlocksNL` -- blocks joined with "\n" rather than
// "" -- was originally left unmodelled: every offset it produces is shifted
// by one byte per preceding block, and on short prose that shift sometimes
// lands on a boundary the three modelled conventions read as the same,
// wrong line (measured: 3 misattributions of 490 attachments at one seed, 9
// of 472 at another). It is modelled here as a SILENT fourth check on top of
// the three-way vote, not as a fourth named member of `voting`: the exposed
// `voting` field stays exactly the three conventions it always named (landed
// rows pin that array verbatim), while the attach decision itself now also
// requires allBlocksNL's own reading -- when it is COMPUTABLE at all -- to
// agree with the line the three-way vote already reached. A convention that
// is structurally impossible under its own math still abstains (as every
// other convention does); one that lands but disagrees turns an "agree"
// into an "ambiguous" refusal, never into a different "agree". That is why
// this can only ever remove a wrong agreement, never introduce one: it is
// purely a second gate on an outcome the original three-way vote already
// reached, checked against the SAME truth every other convention is.
import { byteBoundaryMap, spanFor, spanRefusalReason, SPAN_REFUSAL } from "./citationSpans.js";

/** The stored shape's own version -- bumped only on an incompatible change
 *  to what `citationLineAgreement` returns. */
export const LINE_ATTACH_VERSION = 1;

const CONVENTIONS = ["block", "outputText", "allBlocks"];
const ENC = new TextEncoder();
const enc = (s) => ENC.encode(s).length;

function blockTexts(blocks) {
  return blocks.map((b) => (b && typeof b.text === "string" ? b.text : ""));
}

/** Step 3: the longest run of TRAILING blocks whose "" join equals `raw`.
 *  Returns the start index of that run, or null when none matches. */
function outputTail(texts, raw) {
  for (let start = 0; start <= texts.length; start += 1) {
    if (texts.slice(start).join("") === raw) return start;
  }
  return null;
}

/** Step 4's "inside a line" definition. Only the span's LAST covered unit
 *  may be the newline; a span that covers one earlier crosses. */
function lineOfSpan(raw, us, ue) {
  const covered = raw.slice(us, Math.max(us, ue - 1));
  if (covered.includes("\n")) return null;
  let line = 0;
  for (let i = 0; i < us; i += 1) if (raw[i] === "\n") line += 1;
  return line;
}

/** The `allBlocksNL`-style prefix through block `bi` (exclusive): every
 *  block before it, joined with "\n", plus one trailing "\n" once `bi > 0`.
 *  This is the SAME construction citationLineAgreement.test.js's own
 *  `buildScenario` uses to encode a citation under this convention. */
function allBlocksNLPrefix(texts, bi) {
  return texts.slice(0, bi).join("\n") + (bi > 0 ? "\n" : "");
}

function placeOne(conv, texts, bi, cite, raw, tailStart, map) {
  let s = cite?.startByte;
  let e = cite?.endByte;
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s) return { k: "invalid" };
  if (conv === "block") {
    if (e > enc(texts[bi])) return { k: "invalid" };
    if (tailStart === null || bi < tailStart) return { k: "outside" };
    const base = enc(texts.slice(tailStart, bi).join(""));
    s += base;
    e += base;
  } else if (conv === "allBlocks") {
    if (tailStart === null) return { k: "invalid" };
    const o = enc(texts.slice(0, tailStart).join(""));
    if (e <= o) return { k: "outside" };
    if (s < o && o < e) return { k: "cross" };
    s -= o;
    e -= o;
  } else if (conv === "allBlocksNL") {
    if (tailStart === null || bi < tailStart) return { k: "outside" };
    const oNL = enc(allBlocksNLPrefix(texts, bi));
    if (e <= oNL) return { k: "outside" };
    if (s < oNL && oNL < e) return { k: "cross" };
    if (e - oNL > enc(texts[bi])) return { k: "invalid" };
    const base = enc(texts.slice(tailStart, bi).join(""));
    s = s - oNL + base;
    e = e - oNL + base;
  }
  const reason = spanRefusalReason(raw, { startByte: s, endByte: e }, map);
  if (reason === SPAN_REFUSAL.WHOLE_DOCUMENT) return { k: "cross" };
  if (reason !== null) return { k: "invalid" };
  const span = spanFor(raw, { startByte: s, endByte: e }, map);
  const line = lineOfSpan(raw, span.start, span.end);
  return line === null ? { k: "cross" } : { k: "line", line };
}

/**
 * `gatedBy` is additive and always present: null for every basis the
 * three-way vote alone decides, and `"allBlocksNL"` for the one case the
 * silent fourth check is what actually turned an agreement into a refusal --
 * so a reader of a stored record can tell that apart from a genuine
 * three-way disagreement, which `voting`'s own three-member array (unchanged
 * on purpose -- see this module's header) cannot say on its own.
 *
 * @param {{outputText: unknown, blocks: unknown}} input
 * @returns {{basis: string, voting: string[], citations: number, lines: number[], gatedBy: string|null}}
 */
export function citationLineAgreement(input) {
  const raw = input?.outputText;
  const blocks = Array.isArray(input?.blocks) ? input.blocks : [];
  const texts = blockTexts(blocks);
  const walked = [];
  blocks.forEach((b, bi) => {
    const cites = Array.isArray(b?.citations) ? b.citations : [];
    for (const cite of cites) walked.push({ bi, cite });
  });
  if (walked.length === 0) return { basis: "no-citations", voting: [], citations: 0, lines: [], gatedBy: null };
  if (typeof raw !== "string") {
    return { basis: "inconsistent", voting: [], citations: walked.length, lines: [], gatedBy: null };
  }

  const tailStart = outputTail(texts, raw);
  const map = byteBoundaryMap(raw);

  const voting = [];
  const vectors = [];
  for (const conv of CONVENTIONS) {
    const placements = walked.map(({ bi, cite }) => placeOne(conv, texts, bi, cite, raw, tailStart, map));
    if (placements.some((p) => p.k === "invalid")) continue;
    voting.push(conv);
    vectors.push(placements);
  }
  if (voting.length === 0) return { basis: "inconsistent", voting: [], citations: walked.length, lines: [], gatedBy: null };

  const key = (v) => JSON.stringify(v);
  if (vectors.some((v) => key(v) !== key(vectors[0]))) {
    return { basis: "ambiguous", voting, citations: walked.length, lines: [], gatedBy: null };
  }
  if (vectors[0].some((p) => p.k !== "line")) {
    return { basis: "unplaceable", voting, citations: walked.length, lines: [], gatedBy: null };
  }

  // The silent fourth gate. `allBlocksNL` is computed on the same citations
  // and, only when it lands on a "line" of its own, must be that SAME line.
  // Structurally impossible (k !== "line" and k !== the placement kinds a
  // real disagreement produces) is an abstention and leaves the vote as-is;
  // anything else that disagrees turns this into a refusal.
  const nl = walked.map(({ bi, cite }) => placeOne("allBlocksNL", texts, bi, cite, raw, tailStart, map));
  if (!nl.some((p) => p.k === "invalid") && key(nl) !== key(vectors[0])) {
    return { basis: "ambiguous", voting, citations: walked.length, lines: [], gatedBy: "allBlocksNL" };
  }
  return { basis: "agree", voting, citations: walked.length, lines: vectors[0].map((p) => p.line), gatedBy: null };
}
