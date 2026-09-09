// THE STRADDLE DROP, MEASURED -- not asserted to be zero and not left silent.
//
// AC-M7 drops a mark that crosses either edge of a line's emphasis span rather
// than splitting it, because splitting is what would move the single <strong>
// AnswerLines.emphasis.test.js pins. r5 requires that cost to be BOUNDED,
// MEASURED AND VISIBLE. This file is the instrument: it sweeps the same corpus
// lib/copilot/pointLength.corpus.test.js sweeps -- 8 questions x 8 materials x
// 7 interview types, through BOTH public drafters -- runs every drafted line
// through the real `answerLines()` the three render sites call, and counts how
// many candidate marks the boundary rule discards.
//
// THE COUNTS ARE PINNED EXACTLY, not bounded loosely. A bound alone goes green
// when the matcher silently stops matching, and "0 dropped out of 0 candidates"
// is the shape of that failure. The candidate count is asserted first for that
// reason, and the emphasised-line count with it: a corpus in which no line
// carries an emphasis span cannot straddle anything.
//
// jsdom is NOT used and nothing is rendered here. These are string offsets.

import { describe, it, expect } from "vitest";

import { draftAnswerLocal } from "./answerLocal.js";
import { draftSampleAnswerLocal } from "./sampleAnswerLocal.js";
import { answerLines } from "./answerPoints.js";
import { deriveCues } from "./answerCues.js";
import { INTERVIEW_TYPES } from "./interviewTypes.js";
import { buildGlossaryIndex, findGlossaryMarks, glossaryMarksFor, marksWithin } from "./glossaryMatch.js";

// --------------------------------------------------------------------------
// r10 section 8's corpus, verbatim, inlined for the same reason
// pointLength.corpus.test.js inlines it: a shared fixture helper would be a
// module no entry point can reach.
// --------------------------------------------------------------------------
const QUESTIONS = [
  "Tell me about a time you had to deliver something under a hard deadline.",
  "Tell me about a time you disagreed with your manager.",
  "How would you design a rate limiter for a public API?",
  "Walk me through how you would debug a slow database query.",
  "Tell me about yourself.",
  "Why do you want this role?",
  "Tell me about a time you led an initiative without formal authority over the people involved.",
  "What would you do first in your first ninety days?",
];

const RESUME_RICH = [
  "Experience",
  "Senior Engineer, Acme Payments | 2019 - Present",
  "Led the payments migration and cut deployment time by 40%",
  "Built and scaled the settlement service across three regions",
  "Mentored four engineers on the billing service and ran the on-call rotation",
  "Migrated the monolith to Kubernetes with zero downtime",
  "Skills: React, Node.js, AWS, Kubernetes, PostgreSQL",
].join("\n");

const MATERIALS = [
  { id: "empty", profile: "", resume: "", coverLetter: "", story: null },
  { id: "minimal", profile: "Built and scaled a payments platform", resume: "", coverLetter: "", story: null },
  { id: "resumeRich", profile: "", resume: RESUME_RICH, coverLetter: "", story: null },
  {
    id: "motivationOnly",
    profile: "",
    resume: "",
    coverLetter: "I am applying for this role because I want to work on developer tooling.",
    story: null,
  },
  {
    id: "longHeadline",
    profile: "",
    resume: [
      "Experience",
      "Senior Staff Software Engineer, Developer Platform and Release Infrastructure, Northwind International Logistics Holdings Limited | 2018 - Present",
      "Owned the release process end to end and reduced rollback rate by 60%",
      "Designed the developer platform's build cache and cut CI time in half",
    ].join("\n"),
    coverLetter: "",
    story: null,
  },
  {
    id: "clampedLine",
    profile:
      "Owned the end-to-end migration of the legacy settlement platform onto a new event-driven architecture while keeping every downstream consumer live and coordinating with four separate partner teams across three regions and two regulatory regimes",
    resume: "",
    coverLetter: "",
    story: null,
  },
  {
    id: "pageStory",
    profile: "",
    resume: RESUME_RICH,
    coverLetter: "",
    story: {
      matched: true,
      pageId: "pg-1",
      title: "Ledger Rebuild",
      bullets: [
        "the reconciliation ledger we rebuilt now closes the books in under an hour every night",
        "Cut settlement time from three days to one",
      ],
      bulletPositions: [0, 1],
    },
  },
  {
    id: "misparsedHeader",
    profile: "",
    resume: "",
    coverLetter: [
      "Migrated the monolith to Kubernetes with zero downtime. | 2020 - 2023",
      "I am applying for this role because I want to work on developer tooling.",
      "Led the platform team and reduced build times by 35%",
    ].join("\n"),
    story: null,
  },
];

// A posting glossary of the shape the harvest actually stores, drawn from
// terms this corpus's own material contains. Every one of them clears
// glossaryTerms.js's admission rules (multiword, or a proper noun, never a
// bare AMBIGUOUS_SINGLE_WORD), so this is a plausible row rather than a
// vocabulary tuned to make the number look good.
const TERMS = [
  "payments platform",
  "payments migration",
  "settlement service",
  "settlement time",
  "legacy settlement platform",
  "billing service",
  "on-call rotation",
  "release process",
  "rollback rate",
  "deployment time",
  "developer platform",
  "developer tooling",
  "build cache",
  "reconciliation ledger",
  "event-driven architecture",
  "downstream consumer",
  "regulatory regimes",
  "partner teams",
  "rate limiter",
  "zero downtime",
  "Kubernetes",
  "PostgreSQL",
  "monolith",
].map((term) => ({
  term,
  kind: "explicit",
  category: "tech",
  evidence: `The posting mentions ${term}.`,
  definition: `${term}: a term this posting expects a candidate to be able to talk about without hedging.`,
  provenance: "recalled",
}));

const INDEX = buildGlossaryIndex(TERMS);

function sweep() {
  const rows = [];
  for (const mode of ["live", "practice"]) {
    const draft = mode === "live" ? draftAnswerLocal : draftSampleAnswerLocal;
    for (const question of QUESTIONS) {
      for (const m of MATERIALS) {
        for (const interviewType of INTERVIEW_TYPES.map((t) => t.value)) {
          const r = draft({
            question,
            profile: m.profile,
            resume: m.resume,
            coverLetter: m.coverLetter,
            interviewType,
            story: m.story,
          });
          // `deriveCues(points)` is the embedded path's own cue producer and
          // is exactly the pairing lib/copilot/answerPoints.cueEmphasis.test.js
          // sweeps this same corpus with. It is what makes `emphasis` non-null:
          // a cue that is a verbatim contiguous run of its point is DROPPED and
          // the run's offsets reported instead, which is the span the render
          // layer wraps in its single <strong> -- and therefore the boundary
          // this feature's marks have to be partitioned by.
          for (const line of answerLines(deriveCues(r.points), r.points, r.pageSources || [])) {
            rows.push(line);
          }
        }
      }
    }
  }
  return rows;
}

const LINES = sweep();

// The same span validation AnswerLines.js applies before it renders one, so a
// malformed span is counted as "no emphasis" here exactly as it is there.
function usableSpan(emphasis, point) {
  if (!emphasis) return null;
  const { start, end } = emphasis;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > String(point || "").length) return null;
  return { start, end };
}

const MEASURED = (() => {
  let candidates = 0;
  let straddled = 0;
  let withSpan = 0;
  let linesWithACandidate = 0;
  let linesWithSpanAndCandidate = 0;
  let candidatesOnEmphasisedLines = 0;
  let marksInsideTheBold = 0;
  for (const line of LINES) {
    const span = usableSpan(line.emphasis, line.point);
    if (span) withSpan += 1;
    const all = findGlossaryMarks(line.point, INDEX);
    if (all.length > 0) linesWithACandidate += 1;
    if (span && all.length > 0) {
      linesWithSpanAndCandidate += 1;
      candidatesOnEmphasisedLines += all.length;
    }
    candidates += all.length;
    const resolved = glossaryMarksFor(line.point, INDEX, span);
    straddled += resolved.straddled;
    // How often a KEPT mark lands inside the emphasised run. This is what
    // decides which of AnswerLines.js's two <strong> branches renders: with
    // none, the run is produced by the byte-identical expression it has always
    // been produced by.
    if (span) marksInsideTheBold += marksWithin(resolved.marks, span.start, span.end).length;
  }
  return {
    lines: LINES.length,
    withSpan,
    candidates,
    linesWithACandidate,
    linesWithSpanAndCandidate,
    candidatesOnEmphasisedLines,
    straddled,
    marksInsideTheBold,
  };
})();

// THE POSITIVE CONTROL FOR THE INSTRUMENT ITSELF. The measurement above comes
// out at ZERO, and a zero from an instrument nobody has proved can move is
// worthless -- a failed instrument is INVALID, never its zero value. So the
// same sweep is re-run over the same lines against an ADVERSARIAL span: one
// whose closing edge is placed in the middle of each line's first candidate
// mark. Every one of those must be dropped. If the counter ever stopped
// counting, this goes red while the real measurement stays a comfortable 0.
const CONTROL = (() => {
  let straddled = 0;
  let lines = 0;
  for (const line of LINES) {
    const [first] = findGlossaryMarks(line.point, INDEX);
    if (!first || first.end - first.start < 2) continue;
    const bisect = first.start + Math.floor((first.end - first.start) / 2);
    const span = usableSpan({ start: 0, end: bisect }, line.point);
    if (!span) continue;
    lines += 1;
    straddled += glossaryMarksFor(line.point, INDEX, span).straddled;
  }
  return { lines, straddled };
})();

// The measured rate, recorded so a change to the matcher, the drafters or the
// emphasis span moves a number in this file rather than passing silently.
const STRADDLE_DROP_RATE = MEASURED.straddled / MEASURED.candidates;

describe("the corpus is real, so nothing below can be vacuously green", () => {
  it("sweeps both drafters over all 896 cells and gets lines out of them", () => {
    expect(INTERVIEW_TYPES.map((t) => t.value)).toEqual([
      "general", "phone-screen", "behavioral", "technical", "system-design", "case-study", "leadership",
    ]);
    expect(QUESTIONS).toHaveLength(8);
    expect(MATERIALS).toHaveLength(8);
    expect(LINES.length).toBeGreaterThan(1000);
  });

  it("the glossary matches something, and the corpus emphasises something", () => {
    // Any of these at zero makes the drop rate meaningless: 0/0 straddles is
    // not "the rule is cheap", it is "the instrument measured nothing". The
    // last one is the load-bearing one -- a corpus in which no single line
    // carries BOTH an emphasis span and a candidate mark cannot straddle by
    // construction, and a zero from it would say nothing at all.
    expect(MEASURED.candidates).toBeGreaterThan(200);
    expect(MEASURED.withSpan).toBeGreaterThan(200);
    expect(MEASURED.linesWithACandidate).toBeGreaterThan(100);
    expect(MEASURED.linesWithSpanAndCandidate).toBeGreaterThan(100);
    expect(INDEX.size).toBe(TERMS.length);
  });
});

describe("AC-M7 -- the straddle drop is bounded, and this is the measurement", () => {
  it("costs ZERO marks on this repository's own answer corpus, pinned exactly", () => {
    // EXACT, not a bound: a loose bound goes green on a matcher that stopped
    // matching. If these numbers move, the new ones belong in this file with a
    // note saying what moved them.
    //
    // WHY IT IS ZERO, stated rather than left as a happy surprise. The
    // emphasis span on a locally drafted line is the run its CUE occupies, and
    // `deriveCues` builds a cue out of the first few words of the point -- so
    // the span's closing edge lands early in the sentence, on the imperative
    // ("Describe it"), while the terms a posting glossary stores sit further
    // in. The two rarely meet. That is a fact about THIS corpus, not a theorem:
    // the Gemini path supplies its own cues, and the CONTROL below is what
    // keeps the number honest when they land somewhere else.
    expect(MEASURED).toEqual({
      lines: 3347,
      withSpan: 3191,
      candidates: 882,
      linesWithACandidate: 560,
      linesWithSpanAndCandidate: 518,
      candidatesOnEmphasisedLines: 840,
      straddled: 0,
      marksInsideTheBold: 218,
    });
    expect(STRADDLE_DROP_RATE).toBe(0);
  });

  it("and 218 of those marks land INSIDE the emphasised run, which prices the alternative", () => {
    // The cheap way to protect the single <strong> would have been to refuse
    // to mark anything inside it at all. This is what that would have cost:
    // 218 of 882 marks, a QUARTER of the whole feature -- and the worst
    // quarter to lose, because the emphasised run is the cue, the words a
    // candidate glances at in the two seconds before speaking. So
    // AnswerLines.js marks inside the bold and carries two <strong>
    // expressions instead, and both branches are live on this corpus.
    expect(MEASURED.marksInsideTheBold / MEASURED.candidates).toBeGreaterThan(0.2);
    expect(MEASURED.marksInsideTheBold).toBeLessThan(MEASURED.candidates);
  });

  it("and the counter that produced that zero can produce a non-zero", () => {
    // The adversarial span: its closing edge bisects each line's first
    // candidate mark, so EVERY line that has one must lose it. 560 lines
    // carry a candidate; 559 of them survive the >= 2 character and usable-span
    // guards, and all 559 straddle.
    expect(CONTROL.lines).toBeGreaterThan(400);
    expect(CONTROL.straddled).toBe(CONTROL.lines);
    // The alternative to dropping is splitting the mark across the <strong>
    // boundary, which produces two dotted runs where the reader sees one word
    // and -- far worse -- makes the emphasised run's own boundaries depend on
    // the glossary. This is the population that trade would have applied to.
  });

  it("never drops a mark on a line with no emphasis span at all", () => {
    for (const line of LINES) {
      if (usableSpan(line.emphasis, line.point)) continue;
      expect(glossaryMarksFor(line.point, INDEX, null).straddled).toBe(0);
    }
  });
});

describe("AC-M21 -- marking changes no character of any line in the corpus", () => {
  it("every kept mark's slice reassembles its own point byte for byte", () => {
    for (const line of LINES) {
      const span = usableSpan(line.emphasis, line.point);
      const { marks } = glossaryMarksFor(line.point, INDEX, span);
      let at = 0;
      let out = "";
      for (const mark of marks) {
        out += line.point.slice(at, mark.start) + line.point.slice(mark.start, mark.end);
        at = mark.end;
      }
      expect(out + line.point.slice(at)).toBe(line.point);
    }
  });

  it("every kept mark lies wholly inside ONE region of the emphasis partition", () => {
    // This is the property that keeps the <strong> where it was: no kept mark
    // ever contains `span.start` or `span.end` in its interior.
    for (const line of LINES) {
      const span = usableSpan(line.emphasis, line.point);
      if (!span) continue;
      for (const mark of glossaryMarksFor(line.point, INDEX, span).marks) {
        const crosses =
          (mark.start < span.start && mark.end > span.start) ||
          (mark.start < span.end && mark.end > span.end);
        expect({ point: line.point, mark: line.point.slice(mark.start, mark.end), crosses }).toEqual({
          point: line.point,
          mark: line.point.slice(mark.start, mark.end),
          crosses: false,
        });
      }
    }
  });
});
