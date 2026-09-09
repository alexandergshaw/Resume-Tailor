// THE MATCHER -- AC-M1, AC-M7, AC-M8, AC-M11, AC-M13, AC-M14, AC-M15, AC-M18,
// AC-M20, AC-E5. FAILING TESTS FIRST: `./glossaryMatch.js` does not exist yet,
// so every case in this file is red at collection time until it does.
//
// WHAT THIS MODULE IS AND IS NOT. It is a pure, closed-vocabulary matcher over
// one already-rendered line. It knows nothing about where a definition came
// from -- `provenance` is deliberately NOT a tie-break input (AC-M14), because
// a posting's sources arrive over the minutes AFTER it is opened, so a
// provenance-sensitive tie-break would make WHICH WORDS ARE MARKED drift under
// a reader mid-answer.
//
// THE STRADDLE RULE IS THE ONE THAT PROTECTS THE EXISTING CONTRACT. Marks are
// computed ONCE against the whole `point` and then partitioned by the emphasis
// boundary -- never per-slice -- and a mark that crosses either edge of the
// emphasis span is DROPPED, never split. That is what keeps
// AnswerLines.emphasis.test.js's single <strong> over exactly
// `point.slice(start, end)` from moving. Its cost is measured over the real
// corpus in ./glossaryMatch.corpus.test.js rather than asserted to be zero.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MAX_MARKS_PER_LINE,
  EMPTY_GLOSSARY_INDEX,
  buildGlossaryIndex,
  findGlossaryMarks,
  glossaryMarksFor,
} from "./glossaryMatch.js";

const SOURCE = readFileSync(fileURLToPath(new URL("./glossaryMatch.js", import.meta.url)), "utf8");

/** A stored term row of the shape lib/copilot/glossaryTerms.js admits. */
const explicit = (term, over = {}) => ({
  term,
  kind: "explicit",
  category: "tech",
  evidence: `The posting says ${term}.`,
  definition: `A ${term} is a thing worth knowing about before this interview happens.`,
  provenance: "recalled",
  ...over,
});

const anticipated = (term, over = {}) => ({
  term,
  kind: "anticipated",
  category: "tech",
  parent: "SQL",
  anchor_quote: "You will work with SQL every day.",
  definition: `A ${term} is a thing worth knowing about before this interview happens.`,
  provenance: "recalled",
  ...over,
});

const surfaces = (point, marks) => marks.map((m) => point.slice(m.start, m.end));

describe("AC-M1 -- a CLOSED vocabulary", () => {
  it("marks only terms the row actually stores", () => {
    const index = buildGlossaryIndex([explicit("idempotency")]);
    const point = "I made the retry path idempotent using a settlement ledger.";
    expect(findGlossaryMarks(point, index)).toEqual([]);
  });

  it("marks a term that IS stored, so the negative above is not vacuous", () => {
    const index = buildGlossaryIndex([explicit("idempotency")]);
    const point = "I leaned on idempotency to make the retry safe.";
    expect(surfaces(point, findGlossaryMarks(point, index))).toEqual(["idempotency"]);
  });

  it("an empty vocabulary yields nothing, and the shared empty index is frozen", () => {
    expect(findGlossaryMarks("anything at all here", EMPTY_GLOSSARY_INDEX)).toEqual([]);
    expect(Object.isFrozen(EMPTY_GLOSSARY_INDEX)).toBe(true);
    expect(EMPTY_GLOSSARY_INDEX.size).toBe(0);
    expect(buildGlossaryIndex([]).size).toBe(0);
    expect(buildGlossaryIndex(null).size).toBe(0);
    expect(buildGlossaryIndex(undefined).size).toBe(0);
  });
});

describe("AC-M13 -- word-boundary, case-insensitive, NEVER substring", () => {
  const index = buildGlossaryIndex([explicit("index"), explicit("schema normalization")]);

  it("matches case-insensitively and reports the POINT's own characters", () => {
    const point = "Schema Normalization was the first thing I reached for.";
    expect(surfaces(point, findGlossaryMarks(point, index))).toEqual(["Schema Normalization"]);
  });

  it("does not fire inside a longer word", () => {
    // r5's named case: `index` must not fire inside `indexed`.
    for (const point of ["We indexed the table.", "The reindex took an hour.", "indexes everywhere"]) {
      expect(findGlossaryMarks(point, index)).toEqual([]);
    }
  });

  it("does fire on the bare word, so the superstring cases above are not vacuous", () => {
    const point = "The index was missing.";
    expect(surfaces(point, findGlossaryMarks(point, index))).toEqual(["index"]);
  });
});

describe("AC-M18 -- the matcher-discipline corpus, BOTH halves", () => {
  const index = buildGlossaryIndex([explicit("covering index"), explicit("sender reputation")]);

  it("produces ZERO marks on all five near-misses", () => {
    const zero = [
      "we shipped three covering indexes last quarter", // plural
      "index coverage was the real problem", // reordered
      "covering the index rebuild took a week", // interpolated token
      "recovering index health after the outage", // superstring
      "the sender reputation-management vendor", // hyphenated superstring
    ];
    for (const point of zero) {
      expect({ point, marks: surfaces(point, findGlossaryMarks(point, index)) }).toEqual({ point, marks: [] });
    }
  });

  it("produces EXACTLY ONE mark on each positive control", () => {
    // Without this half the case above passes when the matcher marks nothing
    // at all, which is the vacuous green r5 names by hand.
    const one = {
      "our covering index cut the scan in half": "covering index",
      "sender reputation collapsed after the migration": "sender reputation",
    };
    for (const [point, expected] of Object.entries(one)) {
      expect({ point, marks: surfaces(point, findGlossaryMarks(point, index)) }).toEqual({
        point,
        marks: [expected],
      });
    }
  });
});

describe("AC-M14 -- a deterministic tie-break that never reads provenance", () => {
  it("earliest in reading order wins", () => {
    const index = buildGlossaryIndex([explicit("message queue"), explicit("idempotency")]);
    const point = "Idempotency mattered more than the message queue did.";
    expect(surfaces(point, findGlossaryMarks(point, index))).toEqual(["Idempotency", "message queue"]);
  });

  it("at the SAME offset, explicit beats anticipated", () => {
    const index = buildGlossaryIndex([anticipated("covering index"), explicit("covering index")]);
    const point = "The covering index fixed it.";
    const [mark] = findGlossaryMarks(point, index);
    expect(mark.term.kind).toBe("explicit");
  });

  it("at the same offset AND the same kind, the LONGER term wins", () => {
    const index = buildGlossaryIndex([explicit("covering"), explicit("covering index")]);
    const point = "The covering index fixed it.";
    expect(surfaces(point, findGlossaryMarks(point, index))).toEqual(["covering index"]);
  });

  it("gives the SAME marks whatever the provenance is", () => {
    // A sourced term must not out-rank an unsourced one for the RIGHT TO BE
    // MARKED: sources land minutes after a posting is opened, so a
    // provenance-sensitive tie-break moves the dotted underlines under a
    // reader mid-answer.
    const point = "The covering index and the message queue both mattered.";
    const recalledFirst = buildGlossaryIndex([
      explicit("covering index"),
      explicit("message queue"),
    ]);
    const sourcedFirst = buildGlossaryIndex([
      explicit("covering index", {
        provenance: "researched",
        source_url: "https://www.postgresql.org/docs/current/indexes-index-only-scans.html",
        source_host: "postgresql.org",
      }),
      explicit("message queue"),
    ]);
    expect(findGlossaryMarks(point, sourcedFirst).map((m) => [m.start, m.end])).toEqual(
      findGlossaryMarks(point, recalledFirst).map((m) => [m.start, m.end]),
    );
  });

  it("never returns two marks that overlap", () => {
    const index = buildGlossaryIndex([explicit("covering index"), explicit("index")]);
    const point = "The covering index fixed it.";
    const marks = findGlossaryMarks(point, index);
    for (let i = 1; i < marks.length; i += 1) expect(marks[i].start).toBeGreaterThanOrEqual(marks[i - 1].end);
  });
});

describe("AC-M7 / AC-M8 -- straddle-drop, then cap", () => {
  const index = buildGlossaryIndex([
    explicit("payments platform"),
    explicit("settlement ledger"),
    explicit("message queue"),
  ]);

  it("DROPS a mark that straddles the emphasis boundary, never splits it", () => {
    const point = "I built the payments platform and the settlement ledger.";
    const start = point.indexOf("platform");
    const span = { start, end: point.length - 1 };
    // "payments platform" begins before `start` and ends after it: it crosses
    // the boundary and is dropped whole.
    const { marks, straddled } = glossaryMarksFor(point, index, span);
    expect(straddled).toBe(1);
    expect(surfaces(point, marks)).toEqual(["settlement ledger"]);
  });

  it("drops on the CLOSING edge too", () => {
    const point = "The settlement ledger closed the books.";
    const span = { start: 0, end: point.indexOf("ledger") };
    const { marks, straddled } = glossaryMarksFor(point, index, span);
    expect(straddled).toBe(1);
    expect(marks).toEqual([]);
  });

  it("keeps a mark that sits ENTIRELY inside the emphasis", () => {
    const point = "I built the payments platform end to end.";
    const span = { start: point.indexOf("built"), end: point.indexOf(" end to end") };
    const { marks, straddled } = glossaryMarksFor(point, index, span);
    expect(straddled).toBe(0);
    expect(surfaces(point, marks)).toEqual(["payments platform"]);
  });

  it("AC-M8 -- three candidates, one straddling, yields 2 and NOT 1", () => {
    // The whole point of drop-then-cap. Cap-then-drop would spend one of the
    // two slots on the straddler and then throw it away, leaving one mark.
    expect(MAX_MARKS_PER_LINE).toBe(2);
    const point = "The message queue, the payments platform and the settlement ledger all shipped.";
    const start = point.indexOf("platform");
    const span = { start, end: point.length - 1 };
    const { marks, straddled, candidates } = glossaryMarksFor(point, index, span);
    expect({ candidates, straddled, kept: marks.length }).toEqual({ candidates: 3, straddled: 1, kept: 2 });
    expect(surfaces(point, marks)).toEqual(["message queue", "settlement ledger"]);
  });

  it("caps a line with no emphasis at MAX_MARKS_PER_LINE, in reading order", () => {
    const point = "The message queue, the payments platform and the settlement ledger all shipped.";
    const { marks, straddled } = glossaryMarksFor(point, index, null);
    expect(straddled).toBe(0);
    expect(surfaces(point, marks)).toEqual(["message queue", "payments platform"]);
  });
});

describe("AC-M11 / AC-M21 -- the matcher adds no text", () => {
  it("the marks PARTITION the point: reassembling the slices reproduces it byte for byte", () => {
    const index = buildGlossaryIndex([explicit("payments platform"), explicit("settlement ledger")]);
    const point = "I built the payments platform and then the settlement ledger.";
    const { marks } = glossaryMarksFor(point, index, null);
    let at = 0;
    let out = "";
    for (const mark of marks) {
      out += point.slice(at, mark.start) + point.slice(mark.start, mark.end);
      at = mark.end;
    }
    out += point.slice(at);
    expect(out).toBe(point);
  });

  it("never reports a span outside the point", () => {
    const index = buildGlossaryIndex([explicit("payments platform")]);
    const point = "A payments platform.";
    for (const mark of findGlossaryMarks(point, index)) {
      expect(mark.start).toBeGreaterThanOrEqual(0);
      expect(mark.end).toBeLessThanOrEqual(point.length);
      expect(mark.end).toBeGreaterThan(mark.start);
    }
  });

  it("tolerates a non-string point and a malformed span rather than throwing", () => {
    const index = buildGlossaryIndex([explicit("payments platform")]);
    expect(glossaryMarksFor(null, index, null).marks).toEqual([]);
    expect(glossaryMarksFor(undefined, index, { start: 3, end: 1 }).marks).toEqual([]);
    const point = "A payments platform.";
    // A span the render layer would already have rejected must not make the
    // matcher drop everything silently -- it is treated as no span at all.
    expect(glossaryMarksFor(point, index, { start: 9999, end: 10000 }).marks).toHaveLength(1);
  });
});

describe("AC-E5 -- no affordance without content", () => {
  it("leaves out a term with neither a definition nor a quote", () => {
    const index = buildGlossaryIndex([
      { term: "coined process", kind: "explicit", evidence: "", definition: "", provenance: "recalled" },
    ]);
    expect(index.size).toBe(0);
    expect(findGlossaryMarks("Our coined process ran nightly.", index)).toEqual([]);
  });

  it("KEEPS a quotes-only term, whose definition is '' but whose evidence is real", () => {
    // The embedded path stores exactly this shape, and it is useful: it
    // answers "why is this term here?" rather than "what does it mean?".
    const index = buildGlossaryIndex([
      {
        term: "coined process",
        kind: "explicit",
        evidence: "Our coined process runs nightly.",
        definition: "",
        provenance: "recalled",
      },
    ]);
    expect(index.size).toBe(1);
    expect(findGlossaryMarks("Our coined process ran nightly.", index)).toHaveLength(1);
  });

  it("drops a term whose surface form is unusable", () => {
    const index = buildGlossaryIndex([explicit("  "), explicit(""), null, 7, { term: 4 }]);
    expect(index.size).toBe(0);
  });

  it("collapses a duplicate case-variant, explicit winning over anticipated", () => {
    const index = buildGlossaryIndex([anticipated("Covering Index"), explicit("covering index")]);
    expect(index.size).toBe(1);
    const [mark] = findGlossaryMarks("The covering index fixed it.", index);
    expect(mark.term.kind).toBe("explicit");
  });
});

describe("AC-M15 -- the matcher is pure", () => {
  const IMPURE = /@\/lib\/supabase|lib\/llm\/|\bfetch\s*\(/;

  it("imports nothing from the network, the model layer or the database", () => {
    expect(SOURCE).not.toMatch(IMPURE);
    // In fact it imports NOTHING AT ALL, which is the stronger property and
    // the reason the positive control below has to live in another file.
    expect(SOURCE).not.toMatch(/^import /m);
    expect(SOURCE.length).toBeGreaterThan(1000); // the sweep read a real file
  });

  it("the sweep can fail: a sibling glossary module DOES trip it", () => {
    const sibling = readFileSync(
      fileURLToPath(new URL("./glossaryResearch.js", import.meta.url)),
      "utf8",
    );
    expect(sibling).toMatch(IMPURE);
  });
});
