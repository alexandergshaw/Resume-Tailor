// AC-bullet-truncation r10 — AC-S.7's CORPUS GATE, AC-B.5, AC-B.13, AC-C.4.
// FAILING TESTS. R-337 (AC-S.7), R-334 (live's tail cut).
//
// This is the file that makes AC-S.7 a gate rather than a unit test. It sweeps
// the whole r10 §8 corpus — 8 questions x 8 materials x 7 interview types =
// 448 cells per mode — through BOTH public drafters and judges every point.
//
// THE BASELINE-RELATIVE RULE (AC-S.7, AC-D.3). r10 permits an exemption list
// and says it "may SHRINK and may never GROW". Both halves are asserted:
//
//   * NEVER GROW — every failing point string must appear in BASELINE_162,
//     the ten strings r10 §5.7.2 measured at 32a0626 and this agent
//     re-executed at 1515a16. A string that is not on it is a build failure.
//   * MUST SHRINK — the residue after this chunk is exactly the three strings
//     r10 §5.7.4 routes to §12.6/§12.9, at 44 points. The seven strings
//     AC-B.4, AC-B.10 and AC-B.18 rewrite must be GONE.
//
// The list lives here, in a test file the implementer may not weaken, rather
// than in a JSON fixture they could append to. That is deliberate: r10's own
// concern is the list growing, and a list in the fixture is a list that grows.
//
// MEASUREMENT CONVENTION (r10 §16.1, restated because it invites the wrong
// reading): jsdom has no layout and this file mounts nothing. Every "rendered
// line" below is a WORD COUNT OF A COMPOSED STRING — after this chunk the cue
// is gone, so a rendered line is `${label}: ${point}` (r10 §17). Nothing here
// measures wrapping, pixel width, line count or overflow, and no assertion
// below should be read as if it did.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { draftAnswerLocal } from "@/lib/copilot/answerLocal.js";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal.js";
import { INTERVIEW_TYPES } from "@/lib/copilot/interviewTypes.js";

const SOURCE_PATH = path.join(process.cwd(), "lib/copilot/pointLength.js");
const SPECIFIER = "./pointLength.js";

async function load() {
  expect(existsSync(SOURCE_PATH), "lib/copilot/pointLength.js does not exist yet").toBe(true);
  return import(SPECIFIER);
}

// --------------------------------------------------------------------------
// r10 §8's corpus, verbatim. Inlined rather than imported from a shared helper
// because this agent may create only test files.
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

const TYPES = INTERVIEW_TYPES.map((t) => t.value);

function sweep(mode) {
  const draft = mode === "live" ? draftAnswerLocal : draftSampleAnswerLocal;
  const out = [];
  for (const question of QUESTIONS) {
    for (const m of MATERIALS) {
      for (const interviewType of TYPES) {
        const r = draft({
          question,
          profile: m.profile,
          resume: m.resume,
          coverLetter: m.coverLetter,
          interviewType,
          story: m.story,
        });
        out.push({ materialId: m.id, question, interviewType, ...r });
      }
    }
  }
  return out;
}

const STAR_LABEL = /^(Situation|Task|Action|Result)\s*:\s*/;

// A rendered line AFTER this chunk: the cue is gone, the label survives.
function renderedAfter(point) {
  return String(point);
}

// --------------------------------------------------------------------------
// AC-D.3's baseline. Re-executed by this agent at 1515a16 against r10's own
// §5.7.2 table; all ten strings and all ten counts reproduced to the digit.
// --------------------------------------------------------------------------
const BASELINE_162 = Object.freeze([
  "Situation: Ledger Rebuild.",
  "That's close to work I've actually done — built and scaled a payments platform.",
  "That's close to work I've actually done — senior Engineer, Acme Payments | 2019 - Present.",
  "That's close to work I've actually done — the reconciliation ledger we rebuilt now closes the books in under an hour every night.",
  "That's close to work I've actually done — migrated the monolith to Kubernetes with zero downtime. | 2020 - 2023.",
  "And I'd want to talk through the specifics with you rather than speak in generalities.",
  "And it's why I'm genuinely excited about this opportunity.",
  "That's close to work I've actually done — owned the release process end to end and reduced rollback rate by 60%.",
  "That's close to work I've actually done — I am applying for this role because I want to work on developer tooling.",
  "And that's the background I'd bring to this specific role.",
]);

// r10 §5.7.4's residue: the three strings NO criterion in this chunk reaches,
// routed to §12.6 (producer 7) and §12.9 (the two short `And …` closes).
// 27 + 12 + 5 = 44 points.
const PERMITTED_RESIDUE_44 = Object.freeze([
  "Situation: Ledger Rebuild.",
  "And it's why I'm genuinely excited about this opportunity.",
  "And that's the background I'd bring to this specific role.",
]);

describe("AC-S.7 / R-337 — every bullet stands on its own", () => {
  it("the corpus is the one r10 measured: 448 cells and the pinned point counts", () => {
    expect(TYPES).toEqual([
      "general", "phone-screen", "behavioral", "technical", "system-design", "case-study", "leadership",
    ]);
    expect(QUESTIONS.length * MATERIALS.length * TYPES.length).toBe(448);
    // Guards the sweep itself: if a drafter stops emitting points these
    // assertions collapse to vacuous truths over an empty set.
    //
    // LIVE IS 1,976 BEFORE AND AFTER, exactly as r10 §11 predicted: every live
    // shape emits a fixed number of beats, so no selection change can move the
    // count. Re-measured at 1515a16 against HEAD's own drafter: 247 per
    // material, all eight materials, both sides.
    expect(sweep("live").flatMap((c) => c.points).length).toBe(1976);
    // PRACTICE IS 1,371, NOT r10 §11's 1,317 — and r10 is wrong about this
    // number under r10's OWN AC-B.12/AC-B.16. §11 modelled the chunk as a
    // rewrite of the shipped CLAUSE and concluded the point COUNT could not
    // move; but AC-B.12 demotes employment headers out of the candidate list,
    // and practice's shapes emit a beat CONDITIONALLY on having selected a
    // line they can speak. At HEAD the header won the selection and then
    // failed firstPersonExperienceClause, so the beat was never pushed at all
    // — §1.1's defect, silently costing the cell its only grounded sentence.
    //
    // Measured at 1515a16, HEAD's drafters against this same 448-cell corpus:
    //
    //   resumeRich      163 -> 181  (+18)  behavioral/general gain the Result
    //                                      beat quoting "Led the payments
    //                                      migration and cut deployment time
    //                                      by 40%" instead of shipping two
    //                                      beats with no material in them
    //   longHeadline    139 -> 178  (+39)  same, plus the technical shape,
    //                                      whose 146-char header hit
    //                                      cleanLine's 140 clamp and was
    //                                      rejected by usableExperienceLine,
    //                                      leaving it with no grounded beat
    //   motivationOnly  158 -> 155  (-3)   AC-H.4: the cover-letter line stops
    //                                      being quoted as past work
    //   the other five materials  unchanged
    //                             net +54
    //
    // The added points are not padding: practice cells whose material offers
    // an admissible line and that ship NO quote of it fall 239 -> 160 of 392.
    expect(sweep("practice").flatMap((c) => c.points).length).toBe(1371);
  });

  it("LIVE passes on every one of its 1,976 points, with NO exemptions at all", async () => {
    const { standsAlone } = await load();
    const points = sweep("live").flatMap((c) => c.points);
    const failing = points.filter((p) => !standsAlone(p));
    expect(failing, `live must be 100% with no exemptions; failing:\n${[...new Set(failing)].join("\n")}`).toEqual([]);
    expect(points.length).toBe(1976);
  });

  it("NEVER GROWS — no failing point string escapes AC-D.3's recorded baseline", async () => {
    const { standsAlone } = await load();
    const failing = [...sweep("live"), ...sweep("practice")]
      .flatMap((c) => c.points)
      .filter((p) => !standsAlone(p));
    const novel = [...new Set(failing)].filter((s) => !BASELINE_162.includes(s));
    expect(novel, `these strings fail AC-S.7 and are NOT on the baseline exemption list:\n${novel.join("\n")}`).toEqual([]);
  });

  it("MUST SHRINK — the residue is exactly the three routed strings, at 44 points", async () => {
    const { standsAlone } = await load();
    const failing = [...sweep("live"), ...sweep("practice")]
      .flatMap((c) => c.points)
      .filter((p) => !standsAlone(p));
    const distinct = [...new Set(failing)].sort();
    // The seven strings AC-B.4 / AC-B.10 / AC-B.18 rewrite must be GONE.
    expect(distinct).toEqual([...PERMITTED_RESIDUE_44].sort());
    expect(failing.length).toBe(44);
  });

  it("closes AC-B.4's whole `That's close to work…` carrier — 102 points to 0", async () => {
    const { standsAlone } = await load();
    const all = [...sweep("live"), ...sweep("practice")].flatMap((c) => c.points);
    const carrier = all.filter((p) => /close to work I've actually done/.test(p));
    expect(carrier, "sampleAnswerLocal.js:216's carrier still ships its pre-rewrite text").toEqual([]);
    expect(all.filter((p) => !standsAlone(p) && /^That's /.test(p))).toEqual([]);
  });

  it("closes AC-B.10's 16-word `And I'd want…` close (16 points to 0)", async () => {
    const all = [...sweep("practice")].flatMap((c) => c.points);
    expect(all.filter((p) => /^And I'd want to talk through the specifics/.test(p))).toEqual([]);
  });

  it("subsumes AC-N.2 — zero points open lowercase once their STAR label is stripped", async () => {
    const all = [...sweep("live"), ...sweep("practice")].flatMap((c) => c.points);
    const bad = all.filter((p) => {
      const body = p.replace(STAR_LABEL, "").trim();
      return body && /^[a-z]/.test(body);
    });
    expect(bad).toEqual([]);
  });
});

describe("AC-B.5 / AC-B.13 / R-334 — live's carriers are rewritten to MOD", () => {
  it("ships the four MOD carriers and NONE of the four they replace", () => {
    const points = sweep("live").flatMap((c) => c.points);
    const joined = points.join("\n");

    // The old fixed prose is gone.
    expect(joined).not.toMatch(/Action: Walk through the concrete steps you took — e\.g\./);
    expect(joined).not.toMatch(/Ground it in real work you've done — e\.g\./);
    expect(joined).not.toMatch(/Anchor your answer in a concrete example — e\.g\./);
    expect(joined).not.toMatch(/— a specific project at /);

    // The MOD prose is present, and it is `Describe it`, never `Your steps`.
    expect(joined).toMatch(/Action: Describe it — e\.g\. /);
    expect(joined).not.toMatch(/Your steps/);
    expect(joined).toMatch(/^Ground it — e\.g\. /m);
    expect(joined).toMatch(/^Anchor it — e\.g\. /m);
  });

  it("AC-B.13 — the UNGROUNDED arm of each carrier is left alone", () => {
    const joined = sweep("live").flatMap((c) => c.points).join("\n");
    // With no example to carry, the instruction IS the point.
    expect(joined).toMatch(/Action: Walk through the concrete steps you took\./);
    expect(joined).toMatch(/Anchor it in a real system you've built, not theory\./);
    expect(joined).toMatch(/Situation: (?:Set the scene briefly|Frame the context in a sentence|Open with where and when) — one specific, relevant project\./);
  });

  it("AC-C.4 / R-334 — live's tail is cut: max <= 21, lines >= 20 words <= 30", () => {
    const lens = sweep("live").flatMap((c) => c.points).map((p) => renderedAfter(p).trim().split(/\s+/).filter(Boolean).length);
    const sorted = [...lens].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    expect(median, "live median rendered line").toBeLessThanOrEqual(12);
    expect(Math.max(...lens), "live max rendered line (measured 25 today, 20 after MOD)").toBeLessThanOrEqual(21);
    expect(lens.filter((n) => n >= 20).length, "live lines of 20+ words (measured 153 today, 27 after MOD)").toBeLessThanOrEqual(30);
  });

  it("AC-H.2 / R-328 — no point in either mode carries a mid-word ellipsis", () => {
    const all = [...sweep("live"), ...sweep("practice")].flatMap((c) => c.points);
    expect(all.filter((p) => p.includes("…"))).toEqual([]);
  });
});
