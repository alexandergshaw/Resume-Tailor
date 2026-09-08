// AC-bullet-truncation r10 — AC-B.16, AC-B.3, AC-B.8, AC-B.12, AC-S.6,
// AC-H.4, AC-H.5. R-325, R-326, R-332, R-333, R-336.
// FAILING TESTS for the ONE genuine design change in this chunk: the ceiling
// preference is confined to NON-HEADER candidates.
//
// WHAT §2.8 RULED, AND WHY THIS FILE IS SHAPED THE WAY IT IS. Four options
// were measured. All four ship the candidate's own real work on a classifier
// FALSE POSITIVE; only B and C ship real work on a TRUE positive. B's failure
// mode is a LONGER CORRECT answer (+2 to +6 words per cell); A's and D's is a
// WRONG one (a job title quoted as an accomplishment). B is the ruling.
//
// THE GROUNDING METRIC CANNOT ARBITRATE THIS, and no assertion below pretends
// it can: AC-S.3 filters the source set with the SAME classifier that orders
// the candidate list, so a cell shipping a misread accomplishment records as
// ungrounded BY DEFINITION. That is why every assertion here names the exact
// line that must and must not be quoted, rather than counting grounded cells.
//
// THE THREE HALVES OF R-336 ARE ALL HERE, INCLUDING THE ONE THAT PINS THE COST.
// r10 §2.8 is explicit that (iii) is where this design LOSES two words per
// cell, and that it exists so a future revert to r8's unconfined ordering shows
// up as a diff rather than as a silent improvement in the grounding table. A
// suite that asserted only (i) and (ii) would go green on r8's rule.
//
// NOT ASSERTED. Nothing about wrapping or width; this file mounts nothing.
// Word counts of composed strings only (r10 §16.1).

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal.js";
import { draftAnswerLocal, rankedExperienceLines } from "@/lib/copilot/answerLocal.js";
import { INTERVIEW_TYPES } from "@/lib/copilot/interviewTypes.js";

const TYPES = INTERVIEW_TYPES.map((t) => t.value);

// Specifiers held in variables so Vite's import analysis leaves resolution to
// runtime: a LITERAL dynamic import of an absent module fails the whole FILE
// at transform time and reports one unresolved-import stack instead of every
// named red below. Same idiom as app/copilot/dashboard/StatsRow.test.js.
const POINT_LENGTH = "./pointLength.js";
const MATERIAL_QUOTE = "./materialQuote.js";

async function loadPointLength() {
  expect(existsSync(path.join(process.cwd(), "lib/copilot/pointLength.js")), "lib/copilot/pointLength.js does not exist yet").toBe(true);
  return import(POINT_LENGTH);
}
async function loadMaterialQuote() {
  expect(existsSync(path.join(process.cwd(), "lib/copilot/materialQuote.js")), "lib/copilot/materialQuote.js does not exist yet").toBe(true);
  return import(MATERIAL_QUOTE);
}

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

const SKILLS = "Skills: React, Node.js, AWS, Kubernetes, PostgreSQL";
const HEADER = "Senior Engineer, Acme Payments | 2019 - Present";
const WORK = "Mentored four engineers on the billing service and ran the on-call rotation";
const WORK_LONG = "Mentored four engineers on the billing service and ran the on-call rotation for the platform group";
const FP_HEADER = "Owned Sales Engineering, Support and Onboarding | 2019 - 2022";

// r10 §8.1 / §8.2
const noShortBullet = ["Experience", HEADER, WORK, SKILLS].join("\n");
const headerOnly = ["Experience", HEADER, SKILLS].join("\n");
const fpHeaderB = ["Experience", FP_HEADER, WORK, SKILLS].join("\n");
const fpHeaderOnlyLong = ["Experience", FP_HEADER, WORK_LONG, SKILLS].join("\n");
const resumeRich = [
  "Experience", HEADER,
  "Led the payments migration and cut deployment time by 40%",
  "Built and scaled the settlement service across three regions",
  WORK,
  "Migrated the monolith to Kubernetes with zero downtime",
  SKILLS,
].join("\n");

const NOTHING_ON_FILE = /don't have a specific story|nothing specific from my background|don't have specific résumé details/i;
const words = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;

// Quoted-clause detection that survives every carrier rewrite this chunk makes:
// it looks for the MATERIAL LINE inside the answer, never for the scaffold
// prose around it. `cleanLine` lowercases the leading word, so compare folded.
function quotes(joined, line) {
  return joined.toLowerCase().includes(line.toLowerCase());
}

function sweep(mode, resume) {
  const draft = mode === "live" ? draftAnswerLocal : draftSampleAnswerLocal;
  const cells = [];
  for (const question of QUESTIONS) {
    for (const interviewType of TYPES) {
      const r = draft({ question, resume, interviewType });
      cells.push({ question, interviewType, shape: r.type, joined: r.points.join("\n"), points: r.points });
    }
  }
  return cells;
}

const count = (cells, line) => cells.filter((c) => quotes(c.joined, line)).length;

describe("R-336 (i) / AC-S.6 / R-333 — a résumé with no short bullets still gets a real example", () => {
  for (const mode of ["practice", "live"]) {
    it(`${mode}: quotes the WORK LINE, whole and over the ceiling, on all 56 cells`, () => {
      const cells = sweep(mode, noShortBullet);
      expect(cells.length).toBe(56);
      // Measured today: work 0/56 in BOTH modes.
      expect(count(cells, WORK), `${mode} must quote the accomplishment line`).toBe(56);
      // ...and the whole line, never a proper prefix (AC-B.3 check (ii)).
      for (const c of cells) expect(c.joined).toMatch(/on-call rotation/);
    });

    it(`${mode}: NEVER quotes the position header while the work line exists`, () => {
      // AC-B.16. Measured today: practice 23/56, live 56/56 quote the header.
      const cells = sweep(mode, noShortBullet);
      const bad = cells.filter((c) => quotes(c.joined, "Engineer, Acme Payments | 2019"));
      expect(bad.map((c) => `${c.shape} :: ${c.question}`)).toEqual([]);
    });
  }

  it("practice: no cell claims nothing is on file while the résumé is attached", () => {
    for (const c of sweep("practice", noShortBullet)) {
      expect(NOTHING_ON_FILE.test(c.joined), `"nothing on file" on ${c.shape} :: ${c.question}`).toBe(false);
    }
  });

  it("the over-ceiling point is a WHOLE material line — no truncator is added anywhere", async () => {
    const { MAX_POINT_WORDS } = await loadPointLength();
    const cells = sweep("practice", noShortBullet);
    const over = cells.flatMap((c) => c.points).filter((p) => words(p) > MAX_POINT_WORDS);
    expect(over.length, "the fallback must actually be exercised here").toBeGreaterThan(0);
    for (const p of over) {
      expect(p, "an over-ceiling point must be a whole line, never a clipped one").not.toMatch(/…|\.\.\./);
    }
  });
});

describe("R-336 (ii) — DEMOTION, not deletion: on a header-only résumé the header IS quoted", () => {
  it("practice: the header survives on the shape that can speak it (23 of 56 cells)", () => {
    // This is the ONLY input on which demotion beats deletion — all 92 of
    // r10 §1.8's cell-ceiling differences are this fixture. If the classifier
    // DELETED rather than demoted, the app would say nothing is on file while
    // the candidate's résumé is open, which §2.2 rules is the worst outcome
    // available. Asserting it is what separates option B from option C.
    const cells = sweep("practice", headerOnly);
    expect(count(cells, "Engineer, Acme Payments | 2019"), "a demoted candidate must still be reachable").toBe(23);
  });

  it("practice: and it never claims nothing is on file instead", () => {
    for (const c of sweep("practice", headerOnly)) {
      expect(NOTHING_ON_FILE.test(c.joined), `${c.shape} :: ${c.question}`).toBe(false);
    }
  });
});

describe("R-336 (iii) — THE COST, pinned: a misread accomplishment costs +2 words per cell", () => {
  it("fpHeaderB: ships the 12-word WORK line, NOT the 10-word misread header", () => {
    // Both lines are the candidate's own real work. The classifier calls
    // FP_HEADER a header (r10 §1.4, Set B 8/8), so AC-B.16 demotes it and the
    // longer line wins. That is deliberately the MORE expensive answer on the
    // very axis this chunk exists to improve, and it is asserted so a revert
    // to r8's unconfined ordering fails here rather than looking like a win.
    const cells = sweep("practice", fpHeaderB);
    expect(count(cells, FP_HEADER), "the misread line must lose the ordering rule").toBe(0);
    // Measured today: the misread line ships on 53 of 56 practice cells.
    expect(count(cells, WORK)).toBeGreaterThanOrEqual(53);
    expect(words(WORK)).toBe(12);
    expect(words(FP_HEADER.replace(/^\w+/, (w) => w.toLowerCase()))).toBe(10);
  });

  it("fpHeaderOnlyLong: the same, widened — an 18-word line where option A ships 12", () => {
    const cells = sweep("practice", fpHeaderOnlyLong);
    expect(count(cells, FP_HEADER)).toBe(0);
    expect(count(cells, WORK_LONG)).toBeGreaterThanOrEqual(53);
    expect(words(WORK_LONG)).toBe(16);
  });

  it("live loses the same way, and that is intended (AC-B.8's demotion applies to both drafters)", () => {
    const cells = sweep("live", fpHeaderB);
    expect(count(cells, FP_HEADER)).toBe(0);
    expect(count(cells, WORK)).toBeGreaterThanOrEqual(53);
  });
});

describe("R-325 — no bullet quotes a job title as an example of work", () => {
  for (const mode of ["practice", "live"]) {
    it(`${mode}: on an ordinary résumé the example is an accomplishment, not the header`, () => {
      // Measured today: practice 23/56, live 49/56 quote the position header
      // on this, the corpus's flagship material.
      const cells = sweep(mode, resumeRich);
      expect(cells.filter((c) => quotes(c.joined, "Engineer, Acme Payments | 2019")).length).toBe(0);
    });
  }

  it("R-325's three variant header shapes are all recognised", () => {
    // The shapes r8's classifier missed: a single terminal date, and a
    // one-word title with a one-word employer.
    const variants = [
      "Senior Engineer, Acme Payments — 2019",
      "Engineer, Acme | 2019 - 2021",
    ];
    for (const h of variants) {
      const cells = sweep("practice", ["Experience", h, WORK, SKILLS].join("\n"));
      expect(cells.filter((c) => quotes(c.joined, h)).length, `still quoting ${h}`).toBe(0);
      expect(count(cells, WORK), `must fall through to the work line for ${h}`).toBe(56);
    }
  });

  it("R-325's fourth variant — a MISREAD accomplishment is still quoted, because it is all there is", () => {
    // "Managed Engineering, Design and Product Teams, 2019 - 2021" is Set B's
    // first line: the classifier calls it a header and it is the only work
    // line on file. Demotion is why it survives (r10 R-325's last sentence).
    const line = "Managed Engineering, Design and Product Teams, 2019 - 2021";
    const cells = sweep("practice", ["Experience", line, SKILLS].join("\n"));
    expect(cells.filter((c) => quotes(c.joined, line)).length).toBeGreaterThan(0);
  });
});

describe("AC-H.4 / R-326 — a cover letter is never quoted as work", () => {
  const MOTIVATION = "I am applying for this role because I want to work on developer tooling.";
  const misparsedHeader = [
    "Migrated the monolith to Kubernetes with zero downtime. | 2020 - 2023",
    MOTIVATION,
    "Led the platform team and reduced build times by 35%",
  ].join("\n");

  for (const [id, coverLetter] of [["cover letter alone", MOTIVATION], ["with two real accomplishments", misparsedHeader]]) {
    it(`${id}: the technical shape applies the past-work filter too`, () => {
      // sampleAnswerLocal.js:374 passes the UNFILTERED expRef where :371 and
      // :379 pass pastWorkExperienceLine. Measured today: 3 cells each.
      let bad = 0;
      for (const question of QUESTIONS) {
        for (const interviewType of TYPES) {
          const r = draftSampleAnswerLocal({ question, coverLetter, interviewType });
          const j = r.points.join("\n");
          if (/applying for this role because/i.test(j) && !/^What draws me to this role/m.test(j)) bad += 1;
        }
      }
      expect(bad, "the motivation sentence is being quoted as an example of past work").toBe(0);
    });
  }
});

describe("AC-H.5 / R-332 — a skill the candidate never wrote is never claimed", () => {
  it("the no-documents mining branch filters through literallyMentioned", () => {
    // answerLocal.js:497 does not filter where :492 does. The profile below
    // contains "teams" and never contains "Microsoft". Measured today: the
    // taxonomy inference names Microsoft Teams on 6 live cells.
    const profile =
      "Owned the end-to-end migration of the legacy settlement platform onto a new event-driven architecture while keeping every downstream consumer live and coordinating with four separate partner teams across three regions and two regulatory regimes";
    expect(profile).not.toMatch(/Microsoft/);
    let bad = 0;
    for (const question of QUESTIONS) {
      for (const interviewType of TYPES) {
        if (/Microsoft Teams/.test(draftAnswerLocal({ question, profile, interviewType }).points.join("\n"))) bad += 1;
      }
    }
    expect(bad).toBe(0);
  });
});

describe("AC-B.8 — rankedExperienceLines itself is NOT changed (R-257 is not this chunk's business)", () => {
  it("the header still OUT-RANKS the accomplishments; the fix is at the CONSUMER", async () => {
    const ranked = rankedExperienceLines(resumeRich, "Tell me about yourself.", 8);
    // r10 §12.11: the ranking defect is real and is deliberately left alone
    // here. If a future change "fixes" it inside the ranker instead, R-257's
    // pinned ordering moves and this assertion is the warning.
    expect(ranked[0].toLowerCase()).toContain("engineer, acme payments");
    const { isEmploymentHeaderLine } = await loadMaterialQuote();
    expect(isEmploymentHeaderLine(ranked[0])).toBe(true);
  });
});
