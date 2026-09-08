// AC-bullet-truncation r10 — AC-B.4, AC-B.10, AC-B.17, AC-B.18, AC-C.4's
// practice row, AC-P.3. R-323, R-329, R-335.
// FAILING TESTS for practice mode's EIGHT carriers.
//
// WHY THIS FILE EXISTS AT ALL (r10 §6.4.1). r7 gated live against three
// carriers when there are four. r8 gated practice against four when there are
// five. r10 attributed all 1,317 practice lines to their producer and found
// THREE MORE that no criterion in r7, r8 or r9 names — and one of them ships
// 23 words on 27 cells, which is what actually sets the post-chunk practice
// maximum. An unnamed carrier is how a gate comes to be written against
// arithmetic instead of against the tree, so every one of the eight is named
// here and asserted by its own shape.
//
// THE EIGHT, with the r10 criterion that owns each:
//   1-3  sampleAnswerLocal.js :182 / :186 / :274  mined-clause   AC-B.3's ceiling
//   4    :216  "that's close to work I've actually done — …"      AC-B.4 (fixed 8 -> <=2)
//   5    :266  "I can point to this: …"                           AC-B.17 (NOT rewritten)
//   6    :158-165  "Situation: As <title> at <company>, …"        AC-B.18
//   7    :276-283  "My most relevant experience is from …"        AC-B.18
//   8    :293  "What draws me to this role is that …"             AC-B.18
//
// MEASUREMENT CONVENTION. Word counts of composed strings only. jsdom has no
// layout, this file mounts nothing, and nothing below is a claim about visual
// wrapping or width (r10 §16.1).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal.js";
import { draftAnswerLocal } from "@/lib/copilot/answerLocal.js";
import { INTERVIEW_TYPES } from "@/lib/copilot/interviewTypes.js";

// Specifiers held in variables so Vite's import analysis leaves resolution to
// runtime — a literal dynamic import of an absent module fails the whole file
// at transform time. app/copilot/dashboard/StatsRow.test.js's idiom.
const POINT_LENGTH_PATH = path.join(process.cwd(), "lib/copilot/pointLength.js");
const MATERIAL_QUOTE_PATH = path.join(process.cwd(), "lib/copilot/materialQuote.js");
const POINT_LENGTH = "./pointLength.js";
const MATERIAL_QUOTE = "./materialQuote.js";

async function loadGates() {
  expect(existsSync(POINT_LENGTH_PATH), "lib/copilot/pointLength.js does not exist yet").toBe(true);
  return import(POINT_LENGTH);
}
async function loadMaterialQuote() {
  expect(existsSync(MATERIAL_QUOTE_PATH), "lib/copilot/materialQuote.js does not exist yet").toBe(true);
  return import(MATERIAL_QUOTE);
}

const words = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;

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

const LONG_HEADLINE = [
  "Experience",
  "Senior Staff Software Engineer, Developer Platform and Release Infrastructure, Northwind International Logistics Holdings Limited | 2018 - Present",
  "Owned the release process end to end and reduced rollback rate by 60%",
  "Designed the developer platform's build cache and cut CI time in half",
].join("\n");

const PAGE_BULLET = "the reconciliation ledger we rebuilt now closes the books in under an hour every night";

const MATERIALS = [
  { id: "empty", profile: "", resume: "", coverLetter: "", story: null },
  { id: "minimal", profile: "Built and scaled a payments platform", resume: "", coverLetter: "", story: null },
  { id: "resumeRich", profile: "", resume: RESUME_RICH, coverLetter: "", story: null },
  {
    id: "motivationOnly", profile: "", resume: "",
    coverLetter: "I am applying for this role because I want to work on developer tooling.", story: null,
  },
  { id: "longHeadline", profile: "", resume: LONG_HEADLINE, coverLetter: "", story: null },
  {
    id: "clampedLine", resume: "", coverLetter: "", story: null,
    profile:
      "Owned the end-to-end migration of the legacy settlement platform onto a new event-driven architecture while keeping every downstream consumer live and coordinating with four separate partner teams across three regions and two regulatory regimes",
  },
  {
    id: "pageStory", profile: "", resume: RESUME_RICH, coverLetter: "",
    story: {
      matched: true, pageId: "pg-1", title: "Ledger Rebuild",
      bullets: [PAGE_BULLET, "Cut settlement time from three days to one"],
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

function practicePoints(filterIds) {
  const out = [];
  for (const question of QUESTIONS) {
    for (const m of MATERIALS) {
      if (filterIds && !filterIds.includes(m.id)) continue;
      for (const interviewType of TYPES) {
        const r = draftSampleAnswerLocal({
          question, profile: m.profile, resume: m.resume,
          coverLetter: m.coverLetter, interviewType, story: m.story,
        });
        for (const p of r.points) out.push({ materialId: m.id, point: p });
      }
    }
  }
  return out;
}

describe("AC-B.17 — the FIFTH practice carrier, deliberately NOT rewritten", () => {
  it("is emitted from exactly ONE site in the tree", () => {
    // r10's grep check, executed as a test so it cannot rot. Two copies of
    // this wrap is how the exempt page path acquires a second, capped one.
    const roots = ["lib", "app"];
    const hits = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === ".next") continue;
          walk(full);
        } else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) {
          if (readFileSync(full, "utf8").includes("I can point to this")) hits.push(full);
        }
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(hits.map((h) => path.relative(process.cwd(), h).split(path.sep).join("/"))).toEqual([
      "lib/copilot/sampleAnswerLocal.js",
    ]);
  });

  it("still ships the page bullet WHOLE, at 20 words, over the ceiling", async () => {
    const { MAX_POINT_WORDS } = await loadGates();
    const wrapped = practicePoints(["pageStory"]).filter((p) => /^I can point to this: /.test(p.point));
    expect(wrapped.length, "the exempt page wrap must still be reachable").toBe(6);
    for (const { point } of wrapped) {
      expect(point).toContain(PAGE_BULLET); // quoted whole, never truncated
      expect(words(point)).toBe(20);
      expect(words(point)).toBeGreaterThan(MAX_POINT_WORDS); // exempt, by design
    }
  });

  it("AC-B.3 (iv) / R-335 — every matched-story cell quotes bullets[0] and cites the page", () => {
    for (const question of QUESTIONS) {
      for (const interviewType of TYPES) {
        const m = MATERIALS.find((x) => x.id === "pageStory");
        const r = draftSampleAnswerLocal({
          question, profile: m.profile, resume: m.resume,
          coverLetter: m.coverLetter, interviewType, story: m.story,
        });
        // CASE-INSENSITIVE, and R-335's own Expected clause is why: "a
        // producer building a SENTENCE out of the bullet capitalises its first
        // letter, so a check for the bullet inside a point has to be
        // case-insensitive." The fixture bullet is written lowercase; every
        // producer that speaks it as its own sentence runs it through
        // toSentence/sentence, which capitalises the first letter. Measured
        // over all 56 matched-story cells at 1515a16: 56 quote the bullet, 6
        // verbatim (the exempt `I can point to this: <bullet>` wrap, which
        // keeps it mid-sentence) and 50 with the leading capital.
        //
        // A verbatim case-SENSITIVE match is not a stricter test, it is a
        // demand for a DEFECT: it would require the app to open a bullet
        // lowercase, which fails AC-S.7's S1 (the label-stripped body must
        // open on a capital) and AC-N.2, both of which
        // pointLength.corpus.test.js gates over this same corpus. The
        // property — every matched-story cell quotes bullets[0] WHOLE and
        // cites the page — is unchanged, and "whole" is re-asserted below so
        // case-folding cannot smuggle in a truncation.
        const lower = PAGE_BULLET.toLowerCase();
        const i = r.points.findIndex((p) => p.toLowerCase().includes(lower));
        expect(i, `no point quotes the page bullet: ${question} / ${interviewType}`).toBeGreaterThanOrEqual(0);
        expect(r.points[i], "the bullet must be quoted WHOLE, never clipped").not.toMatch(/…|\.\.\./);
        expect(r.pageSources[i]).toEqual({ id: "pg-1", title: "Ledger Rebuild" });
      }
    }
  });
});

describe("AC-B.18 — the three interpolated carriers no earlier revision named", () => {
  it("carrier 6 (:158-165) — the 23-word behavioral Situation beat is brought under 20", () => {
    const hits = practicePoints().filter((p) => /^Situation: /.test(p.point));
    // The pre-rewrite prose must be gone. Measured today: 54 points, 2
    // distinct strings, 18 words on resumeRich and 23 on longHeadline.
    expect(
      hits.filter((p) => /I ran into a situation that put this to the test/.test(p.point)).map((p) => p.point),
      "sampleAnswerLocal.js:158-165 still ships its pre-rewrite fixed prose",
    ).toEqual([]);
  });

  it("carrier 6's OBSERVED MAXIMUM is the gate — it cannot carry a hard word cap", async () => {
    // ${title}/${company} come from profileHeadline, not cleanLine, so they
    // are NOT bounded by 140 characters and no fixed-prose figure can
    // guarantee <= 12 (r10 AC-B.18). The gate is the observed maximum, the
    // same way AC-B.11 already bounds over-ceiling points.
    const sit = practicePoints(["resumeRich", "longHeadline"]).filter((p) => /^Situation: /.test(p.point));
    expect(sit.length).toBeGreaterThan(0);
    // Measured today: 18 on resumeRich, 23 on longHeadline. 23 is what puts
    // the post-chunk practice maximum at 23 rather than 20.
    expect(Math.max(...sit.map((p) => words(p.point))), "behavioral Situation beat").toBeLessThan(20);
  });

  it("carrier 7 (:276-283) — the general experience beat is rewritten", () => {
    const hits = practicePoints().filter((p) => /^My most relevant experience is from /.test(p.point));
    expect(hits.map((p) => p.point), "sampleAnswerLocal.js:276-283 still ships its pre-rewrite prose").toEqual([]);
  });

  it("carrier 8 (:293) — the GROUNDED motivation close, which no r9 check could see", () => {
    // r10 §6.4.1: this one is grounded (its ${reason} is a >=4-token run of
    // the material's own motivation line), so it is over the ceiling at 15
    // words while AC-B.10's ungrounded census cannot see it and AC-B.3's
    // ceiling does not apply to a carrier. It needs its own assertion.
    const hits = practicePoints().filter((p) => /^What draws me to this role is that /.test(p.point));
    expect(hits.map((p) => p.point), "sampleAnswerLocal.js:293 still ships its pre-rewrite prose").toEqual([]);
  });

  it("all three rewrites still speak the company, the title and the reason", async () => {
    const { standsAlone } = await loadGates();
    // A rewrite that reaches the word gate by DELETING the interpolated value
    // is not a truncation, it is a different (worse) answer. Each carrier must
    // still carry its own slot value somewhere, and still stand alone.
    const rich = practicePoints(["resumeRich"]);
    const behavioral = rich.filter((p) => /^Situation: /.test(p.point));
    expect(behavioral.some((p) => /Acme Payments/.test(p.point)), "the Situation beat must still name the company").toBe(true);
    expect(behavioral.some((p) => /Senior Engineer/.test(p.point)), "the Situation beat must still name the title").toBe(true);
    const motiv = practicePoints(["motivationOnly"]);
    expect(motiv.some((p) => /developer tooling/.test(p.point)), "the motivation close must still speak the reason").toBe(true);
    for (const p of [...behavioral, ...motiv]) expect(standsAlone(p.point), `fails AC-S.7: ${p.point}`).toBe(true);
  });
});

describe("AC-B.4 — the mined-clause carriers go to fixed <= 2", () => {
  it("carrier 4 (:216) is rewritten away from its fixed-8 prose", () => {
    const hits = practicePoints().filter((p) => /close to work I've actually done/.test(p.point));
    expect(hits.map((p) => p.point).slice(0, 3), "sampleAnswerLocal.js:216 still ships fixed 8").toEqual([]);
  });

  it("the `I ` that firstPersonExperienceClause prepends COUNTS toward fixed 2", () => {
    // r10 AC-B.4: :182/:186/:274 are fixed 1 in the source and 2 at runtime.
    // A rewrite of :216 that measures its own prose without the prepended
    // subject is measuring the wrong string.
    const rich = practicePoints(["resumeRich"]).map((p) => p.point);
    const mined = rich.filter((p) => /^(Action|Result): I /.test(p));
    expect(mined.length).toBeGreaterThan(0);
    for (const p of mined) {
      const body = p.replace(/^(Action|Result):\s*/, "");
      expect(body.startsWith("I "), `the first-person wrap must survive: ${p}`).toBe(true);
    }
  });
});

describe("AC-C.4 / R-323 — practice's gates, conditional on AC-B.4, AC-B.10 and AC-B.18", () => {
  it("practice max rendered <= 20, and it is set by the EXEMPT page bullet", () => {
    const all = practicePoints();
    // 1,371, not r10 §11's 1,317. AC-B.12's header demotion adds a grounded
    // beat to 54 practice cells that shipped none at HEAD, because practice's
    // shapes emit their example beat CONDITIONALLY and at HEAD the demoted
    // header won the selection and then failed the first-person speakability
    // test, so no beat was pushed. Measured at 1515a16 against HEAD's own
    // drafter: resumeRich +18, longHeadline +39, motivationOnly -3 (AC-H.4).
    // Derived in full in pointLength.corpus.test.js, which pins the same
    // number from the same sweep.
    expect(all.length, "practice points across the 448 cells").toBe(1371);
    const lens = all.map((p) => words(p.point));
    // r10 §6.4.1: 27 today (two pure-scaffold strings), 23 without AC-B.18,
    // 20 with it. 20 is the exempt page wrap, which no length rule may touch.
    expect(Math.max(...lens), "practice max rendered line").toBeLessThanOrEqual(20);
    const longest = all.filter((p) => words(p.point) === Math.max(...lens));
    expect(longest.every((p) => p.point.includes(PAGE_BULLET)), "the practice tail must be the exempt page bullet").toBe(true);
  });

  it("practice median rendered <= 13", () => {
    const lens = practicePoints().map((p) => words(p.point)).sort((a, b) => a - b);
    const median = lens.length % 2 ? lens[(lens.length - 1) / 2] : (lens[lens.length / 2 - 1] + lens[lens.length / 2]) / 2;
    // Measured today, cue fix alone: 16. Model after the ceiling: 12.
    expect(median).toBeLessThanOrEqual(13);
  });

  it("AC-B.10 — every UNGROUNDED practice string is <= 12 words and stands alone", async () => {
    const { MAX_POINT_WORDS, standsAlone } = await loadGates();
    const { materialQuote, isEmploymentHeaderLine } = await loadMaterialQuote();

    const offenders = [];
    for (const question of QUESTIONS) {
      for (const m of MATERIALS) {
        const sources = [m.profile, m.resume, m.coverLetter]
          .join("\n")
          .split(/\r?\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
          .concat(m.story?.bullets || [])
          .filter((l) => !isEmploymentHeaderLine(l));
        for (const interviewType of TYPES) {
          const r = draftSampleAnswerLocal({
            question, profile: m.profile, resume: m.resume,
            coverLetter: m.coverLetter, interviewType, story: m.story,
          });
          for (const point of r.points) {
            const grounded = materialQuote(point, sources).words > 0;
            if (grounded) continue;
            if (words(point) > MAX_POINT_WORDS) offenders.push(`[${words(point)}] ${point}`);
            if (!standsAlone(point)) offenders.push(`[AC-S.7] ${point}`);
          }
        }
      }
    }
    // Measured today: 13 distinct scaffold strings exceed 12 words, the two
    // longest at 27. After AC-B.10's rewrite there must be none.
    //
    // THE LENGTH HALF IS ABSOLUTE. The AC-S.7 half is not, and this case as
    // originally written contradicted AC-S.7 itself: AC-S.7's own Check reads
    // "every point either passes OR IS ON THE LIST", and r10 §5.7.4 routes
    // exactly three strings — producer 7's Situation beat to §12.6 and the two
    // short `And ...` closes to §12.9 — as the 44-point residue no criterion
    // in this chunk reaches. AC-B.10 rewrites the strings OVER THE CEILING; it
    // never claimed to close the two 9- and 10-word `And ...` closes, which
    // are UNDER the ceiling and so out of its scope by construction. A
    // no-exemption assertion here would have forced a rewrite of prose r10
    // deliberately deferred. So the exemption is named, string for string, and
    // the property is kept whole: no OTHER ungrounded practice point may fail
    // AC-S.7, and each of these three must still actually be reached (a
    // rewrite that silently deleted one would be hidden by a bare `not on the
    // list` filter). pointLength.corpus.test.js's MUST-SHRINK pins the same
    // three at the same 44 points over both modes.
    const ROUTED_RESIDUE = [
      "[AC-S.7] Situation: Ledger Rebuild.",
      "[AC-S.7] And it's why I'm genuinely excited about this opportunity.",
      "[AC-S.7] And that's the background I'd bring to this specific role.",
    ];
    const distinct = [...new Set(offenders)];
    expect(distinct.filter((s) => !ROUTED_RESIDUE.includes(s))).toEqual([]);
    expect(distinct.sort(), "a routed residue string must still be REACHED, not deleted").toEqual(
      [...ROUTED_RESIDUE].sort(),
    );
  });

  it("AC-B.13 — LIVE's ungrounded scaffold strings are NOT rewritten", () => {
    // The mirror of the rule above. Live's 24 connective strings carry the
    // coaching the grounded arms are giving up; shortening them is out of
    // scope and a sweep that shortens both modes has overshot.
    const live = [];
    for (const question of QUESTIONS) {
      for (const interviewType of TYPES) {
        for (const p of draftAnswerLocal({ question, resume: RESUME_RICH, interviewType }).points) live.push(p);
      }
    }
    const joined = live.join("\n");
    expect(joined).toContain("Task: State the goal you personally owned and why it mattered.");
    expect(joined).toContain("Think out loud — outline your approach before diving into details.");
    expect(joined).toContain("Call out the trade-offs (time vs. space, simplicity vs. scale) and justify your choice.");
    expect(joined).toContain("Keep it to ~60-90 seconds — lead with the point, then the evidence.");
  });
});

describe("AC-P.3 / R-329 — a one-word page title is refused, not padded", () => {
  it("a single-word story title produces the résumé-grounded draft instead", () => {
    const story = { matched: true, pageId: "pg-2", title: "API", bullets: ["Built it"], bulletPositions: [0] };
    const r = draftSampleAnswerLocal({
      question: "Tell me about a time you disagreed with your manager.",
      resume: RESUME_RICH, interviewType: "behavioral", story,
    });
    expect(r.points.join("\n")).not.toMatch(/Situation: API\./);
    expect(r.points.length, "the refusal must not cascade into an empty answer").toBeGreaterThan(0);
  });

  it("a two-word title is still accepted — the floor is MIN_TITLE_WORDS, not a ban", async () => {
    const { MIN_TITLE_WORDS } = await loadGates();
    expect(MIN_TITLE_WORDS).toBe(2);
    const story = {
      matched: true, pageId: "pg-1", title: "Ledger Rebuild",
      bullets: ["Cut settlement time from three days to one"], bulletPositions: [0],
    };
    const r = draftSampleAnswerLocal({
      question: "Tell me about a time you disagreed with your manager.",
      resume: RESUME_RICH, interviewType: "behavioral", story,
    });
    expect(r.points.join("\n")).toMatch(/Ledger Rebuild/);
  });
});
