// AC-bullet-truncation r10 — AC-C.1, AC-C.3, AC-C.7, AC-C.9. R-322, R-324.
// FAILING TESTS for the cue-duplication fix, r10's central result.
//
// THE FINDING THIS IMPLEMENTS (r10 §0.1, §6). Re-executed by this agent at
// 1515a16: 3,137 of 3,137 cued lines have their cue's normalised tokens
// present as a CONTIGUOUS RUN inside their own point (live 1,895/1,895,
// practice 1,242/1,242), and ZERO cues anywhere add a word the point does not
// already contain. Every cued line today therefore renders its own words
// twice. Removing the duplication is free, because the cue is display-only.
//
// THE CONTRACT THIS FILE PINS — one NEW field on answerLines' line objects:
//
//   answerLines(cues, points, pageSources) -> [{ label, cue, point, pageSource,
//                                                emphasis }]
//
//     emphasis: { start, end } | null
//       CHARACTER OFFSETS INTO `line.point` (not into the raw point, which
//       still carries its STAR label) delimiting AC-C.9's TIGHT span: from the
//       first character of the run's first normalised token to the last
//       character of its last. `null` when there is nothing to emphasise.
//
//     cue: "" whenever `emphasis` is non-null — the cue is DROPPED, not
//       rendered alongside. The two fields are mutually exclusive by
//       construction, and that is asserted.
//
// WHY THE SPAN AND NOT THE INDEX. r10 AC-C.9 rules the mapping TIGHT rather
// than WORDWISE on executed evidence: WORDWISE drags trailing punctuation into
// the emphasis on 424 live lines (394 comma + 30 colon). Character offsets are
// the only shape that expresses that ruling; a token index cannot.
//
// NOT ASSERTED HERE, AND WHY. jsdom has no layout, and this file mounts
// nothing at all — it is a pure-module test. Nothing below is a claim about
// visual wrapping, pixel width, or how many screen lines a bullet occupies.
// The render-side assertions are in app/copilot/AnswerLines.emphasis.test.js.

import { describe, it, expect } from "vitest";
import { answerLines } from "@/lib/copilot/answerPoints.js";
import { deriveCues, resolveCues } from "@/lib/copilot/answerCues.js";
import { draftAnswerLocal } from "@/lib/copilot/answerLocal.js";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal.js";
import { INTERVIEW_TYPES } from "@/lib/copilot/interviewTypes.js";

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
    id: "motivationOnly", profile: "", resume: "",
    coverLetter: "I am applying for this role because I want to work on developer tooling.", story: null,
  },
  {
    id: "longHeadline", profile: "", coverLetter: "", story: null,
    resume: [
      "Experience",
      "Senior Staff Software Engineer, Developer Platform and Release Infrastructure, Northwind International Logistics Holdings Limited | 2018 - Present",
      "Owned the release process end to end and reduced rollback rate by 60%",
      "Designed the developer platform's build cache and cut CI time in half",
    ].join("\n"),
  },
  {
    id: "clampedLine", resume: "", coverLetter: "", story: null,
    profile:
      "Owned the end-to-end migration of the legacy settlement platform onto a new event-driven architecture while keeping every downstream consumer live and coordinating with four separate partner teams across three regions and two regulatory regimes",
  },
  {
    id: "pageStory", profile: "", resume: RESUME_RICH, coverLetter: "",
    story: {
      matched: true, pageId: "pg-1", title: "Ledger Rebuild",
      bullets: [
        "the reconciliation ledger we rebuilt now closes the books in under an hour every night",
        "Cut settlement time from three days to one",
      ],
      bulletPositions: [0, 1],
    },
  },
  {
    id: "misparsedHeader", profile: "", resume: "", story: null,
    coverLetter: [
      "Migrated the monolith to Kubernetes with zero downtime. | 2020 - 2023",
      "I am applying for this role because I want to work on developer tooling.",
      "Led the platform team and reduced build times by 35%",
    ].join("\n"),
  },
];

const TYPES = INTERVIEW_TYPES.map((t) => t.value);

function sweepLines() {
  const out = [];
  for (const question of QUESTIONS) {
    for (const m of MATERIALS) {
      for (const interviewType of TYPES) {
        const args = {
          question, profile: m.profile, resume: m.resume,
          coverLetter: m.coverLetter, interviewType, story: m.story,
        };
        for (const [mode, draft] of [["live", draftAnswerLocal], ["practice", draftSampleAnswerLocal]]) {
          const r = draft(args);
          for (const line of answerLines(deriveCues(r.points), r.points, r.pageSources || [])) {
            out.push({ mode, ...line });
          }
        }
      }
    }
  }
  return out;
}

function normTokens(text) {
  const lowered = String(text || "").toLowerCase();
  const out = [];
  let cur = "";
  let start = -1;
  for (let i = 0; i <= lowered.length; i += 1) {
    const ch = i < lowered.length ? lowered[i] : "";
    if (/[a-z0-9]/.test(ch)) {
      if (start === -1) start = i;
      cur += ch;
    } else if (cur) {
      out.push({ t: cur, start, end: i });
      cur = "";
      start = -1;
    }
  }
  return out;
}

describe("AC-C.1 — a cue that is a contiguous run of its own point is DROPPED and LOCATED", () => {
  it("(a) an interior-run cue is dropped, and its TIGHT span is reported", () => {
    const point = "I built and scaled a payments platform.";
    const [line] = answerLines(["Built and scaled a payments platform"], [point]);
    expect(line.cue, "the cue must be dropped, not rendered in front of its own words").toBe("");
    expect(line.emphasis, "the run must be located so the render layer can bold it").not.toBeNull();
    expect(point.slice(line.emphasis.start, line.emphasis.end)).toBe("built and scaled a payments platform");
  });

  it("(b) a genuinely PARAPHRASING cue survives untouched, with no span", () => {
    const point = "I rebuilt the settlement ledger end to end.";
    const [line] = answerLines(["Ledger overhaul"], [point]);
    expect(line.cue).toBe("Ledger overhaul");
    expect(line.emphasis).toBeNull();
  });

  it("(c) the two existing rules at answerPoints.js:197/:198 are UNCHANGED", () => {
    // identity, modulo case and trailing punctuation
    expect(answerLines(["I shipped it."], ["I shipped it"])[0].cue).toBe("");
    // not strictly shorter by whitespace word count
    expect(answerLines(["one two three"], ["one two three"])[0].cue).toBe("");
    // a cue that is only a label is still nothing
    expect(answerLines(["Action:"], ["Action: I shipped it."])[0].cue).toBe("");
  });

  it("cue and emphasis are MUTUALLY EXCLUSIVE — never two things to render", () => {
    const cases = [
      [["Built and scaled a payments platform"], ["I built and scaled a payments platform."]],
      [["Ledger overhaul"], ["I rebuilt the settlement ledger end to end."]],
      [[""], ["I shipped the migration."]],
    ];
    for (const [cues, points] of cases) {
      const [line] = answerLines(cues, points);
      // NOT VACUOUS: without the presence check below, `emphasis` being
      // absent entirely satisfies the exclusion on every line.
      expect(Object.prototype.hasOwnProperty.call(line, "emphasis"), `no emphasis field on: ${points[0]}`).toBe(true);
      expect(Boolean(line.cue) && Boolean(line.emphasis), `both set on: ${points[0]}`).toBe(false);
    }
  });

  it("locates the run when the cue is an INTERIOR run, not only a prefix", () => {
    // 1,008 of practice's cues are interior rather than prefix runs, because
    // LEADING_SUBJECT_RE / LEADING_FILLER_RE strip the point's own opening
    // before shortening. A prefix-only rule misses every one of them.
    const point = "Honestly, I ran the on-call rotation for two years.";
    const [line] = answerLines(["Ran the on-call rotation"], [point]);
    expect(line.cue).toBe("");
    expect(point.slice(line.emphasis.start, line.emphasis.end)).toBe("ran the on-call rotation");
    expect(line.emphasis.start).toBeGreaterThan(0);
  });
});

describe("AC-C.3 — a run that IS the whole point bolds nothing", () => {
  it("a punctuation-only difference does not turn the whole line bold", () => {
    // r10 §6.3's reachable Gemini case: :198's whitespace word count says the
    // cue is shorter (4 < 5) while the normalised token run is the WHOLE point.
    const point = "Cut CI time in half";
    const cue = "Cut CI time in-half";
    expect(cue.trim().split(/\s+/).length).toBe(4);
    expect(point.trim().split(/\s+/).length).toBe(5);
    expect(resolveCues([cue], [point])[0]).toBe(cue); // reachable: resolveCues ships it

    const [line] = answerLines([cue], [point]);
    expect(line.cue, "treated as :197's identity case").toBe("");
    expect(line.emphasis, "a bold span covering the whole line is not emphasis").toBeNull();
  });

  it("a run strictly shorter in normalised tokens IS bolded", () => {
    const point = "Cut CI time in half for the platform team";
    const [line] = answerLines(["Cut CI time in-half"], [point]);
    expect(line.emphasis).not.toBeNull();
    expect(point.slice(line.emphasis.start, line.emphasis.end)).toBe("Cut CI time in half");
  });
});

describe("AC-C.9 — the span is TIGHT, and never lands inside a word", () => {
  it("excludes trailing punctuation the WORDWISE mapping would have dragged in", () => {
    const point = "Ask a clarifying question, then state your assumptions.";
    const [line] = answerLines(["Ask a clarifying question"], [point]);
    const bold = point.slice(line.emphasis.start, line.emphasis.end);
    expect(bold).toBe("Ask a clarifying question");
    expect(bold.endsWith(","), "a bolded trailing comma is the defect TIGHT exists to avoid").toBe(false);
  });

  it("excludes a trailing colon too — 30 of the 424 live differences (r10 §6.2)", () => {
    const point = "Highlight the strengths most relevant to this role: React, Node.js, AWS.";
    const [line] = answerLines(["Highlight the strengths most relevant to this role"], [point]);
    expect(point.slice(line.emphasis.start, line.emphasis.end)).toBe(
      "Highlight the strengths most relevant to this role",
    );
  });

  it("does not begin or end inside a word — over EVERY cued line in the corpus", () => {
    const lines = sweepLines();
    const cued = lines.filter((l) => l.emphasis);
    const midWord = cued.filter((l) => {
      const { start, end } = l.emphasis;
      const before = start > 0 ? l.point[start - 1] : "";
      const after = end < l.point.length ? l.point[end] : "";
      return /[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after);
    });
    expect(midWord.map((l) => `${l.point} @${l.emphasis.start}-${l.emphasis.end}`)).toEqual([]);
    // NOT VACUOUS: an implementation that never sets `emphasis` passes the
    // filter above over an empty set. r10 §6 measured 3,137 cued lines at
    // 32a0626; re-executed at 1515a16 it is 3,191, and the +54 is exactly
    // AC-B.12's 54 added practice points (see pointLength.corpus.test.js for
    // the per-material derivation). Every one of them carries a resolved cue,
    // which is why the UNCUED count below is unchanged at 156.
    expect(cued.length, "cued lines carrying an emphasis span").toBe(3191);
  });

  it("every span reproduces a real substring of its own point", () => {
    const spanned = sweepLines().filter((x) => x.emphasis);
    // NOT VACUOUS: the loop below is empty until `emphasis` is populated.
    // 3,191 rather than r10 §6's 3,137 — AC-B.12's 54 added practice points,
    // all cued. See the sibling assertion above.
    expect(spanned.length, "no line carries an emphasis span at all").toBe(3191);
    for (const l of spanned) {
      const { start, end } = l.emphasis;
      expect(Number.isInteger(start) && Number.isInteger(end)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(l.point.length);
      expect(l.point.slice(start, end).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("AC-C.7 / R-322 — the census: no cue is repeated anywhere in the corpus", () => {
  it("ZERO lines survive with a duplicate cue, across all 896 mode-cells", () => {
    const survivors = sweepLines().filter((l) => {
      if (!l.cue) return false;
      const ct = normTokens(l.cue).map((x) => x.t);
      const pt = normTokens(l.point).map((x) => x.t);
      for (let i = 0; i + ct.length <= pt.length; i += 1) {
        if (ct.every((t, j) => pt[i + j] === t)) return true;
      }
      return false;
    });
    expect(
      survivors.slice(0, 5).map((l) => `${l.cue} || ${l.point}`),
      "a cue whose words are already in its own point must never render twice",
    ).toEqual([]);
  });

  it("exactly one emphasis decision per line: cued lines 3,191, uncued 156", () => {
    const lines = sweepLines();
    // 3,347 = live 1,976 (unmoved, as r10 §11 predicted) + practice 1,371.
    // r10 §11's "3,293 points ship before and after" is false under r10's own
    // AC-B.12: the header demotion adds a grounded beat to 54 practice cells
    // that shipped none. Derived per material in pointLength.corpus.test.js.
    expect(lines.length, "rendered lines across both modes").toBe(3347);
    expect(lines.filter((l) => l.emphasis).length).toBe(3191);
    // THE INVARIANT THAT ACTUALLY CARRIES THIS CASE, and it is unmoved: live
    // 81 + practice 75 lines carry no resolved cue and must still render with
    // no emphasis at all. All 54 added points are cued, so this stays 156 —
    // which is what makes 3,347 - 3,191 = 156 a check on the two counts above
    // rather than a restatement of them.
    expect(lines.filter((l) => !l.emphasis && !l.cue).length).toBe(156);
  });

  it("the line's own text is UNCHANGED — this fix removes the cue, not content", () => {
    // AC-C.6: `point` is byte-identical for the cue fix. A "shortening" that
    // edited the sentence would satisfy every span assertion above and be a
    // completely different change.
    const point = "I built and scaled a payments platform.";
    expect(answerLines(["Built and scaled a payments platform"], [point])[0].point).toBe(point);
  });

  it("`emphasis` is present on every line object, as null when there is none", () => {
    for (const l of answerLines(["Ledger overhaul", ""], ["I rebuilt the ledger.", "I shipped it."])) {
      expect(Object.prototype.hasOwnProperty.call(l, "emphasis"), "every line carries the field").toBe(true);
    }
  });
});
