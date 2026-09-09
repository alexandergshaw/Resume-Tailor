// THE DETERMINISTIC (no-LLM) EXPANSION DRAFTER.
//
// Engine choice governs every AI feature in this app, so a Gemini-only
// expansion is an unfinished one. This is the embedded path: zero model calls,
// zero egress, and — because it only ever quotes lines the candidate wrote
// themselves — the privacy-preferred default rather than a degraded fallback.
//
// The criteria that ARE the feature are AC-R1..R5: a sub-bullet has to be
// about ITS OWN parent bullet. An implementation that draws from one
// undifferentiated pool per ANSWER — the same three sub-bullets under all six
// parents — satisfies every "shape" criterion in the chunk and is worthless.
//
// Type B red: the module does not exist, so this file fails at import. Every
// case below therefore names the source mutation that must turn it red once
// the module exists.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { significantTerms, overlapScore } from "./projectStories.js";
import { draftExpansionLocal } from "./answerExpansionLocal.js";

const SRC = readFileSync(fileURLToPath(new URL("./answerExpansionLocal.js", import.meta.url)), "utf8");

// One eligible page. Every bullet is a whole sentence the candidate wrote.
const PAGES = [
  {
    id: "p1",
    title: "Settlement ledger rebuild",
    archived_at: null,
    generated_kind: null,
    body: [
      "Some prose that is not a bullet and must never be mined.",
      "- I reconciled every settlement by hand for a week.",
      "- I wrote the replay script that closed the ledger gap.",
      "- I paged the on-call team twice during the incident.",
      "- I ran the postmortem with the marketing department.",
    ].join("\n"),
  },
];

// A question whose distinctive terms name the page, so the honesty gate opens.
const QUESTION = "Tell me about the settlement ledger rebuild.";

const PARENT_LEDGER = "I rebuilt the ledger after the settlement outage.";
const PARENT_ONCALL = "I paged the on-call team during the incident.";
const POINTS = [PARENT_LEDGER, PARENT_ONCALL];

function draft(parentPoint, overrides = {}) {
  return draftExpansionLocal({ question: QUESTION, parentPoint, points: POINTS, pages: PAGES, ...overrides });
}

describe("draftExpansionLocal — AC-R2: the drafter is sensitive to its PARENT", () => {
  it("returns different sub-bullets for two different parents of the same answer", () => {
    // Identical question, identical material, identical siblings. The ONLY
    // thing that changes is which parent is being elaborated.
    //
    // MUTATION PROOF: rank against `question` instead of `parentPoint`; red.
    // A drafter that ignores parentPoint cannot pass this, and no amount of
    // source containment rescues it.
    const a = draft(PARENT_LEDGER).subBullets.map((s) => s.text);
    const b = draft(PARENT_ONCALL).subBullets.map((s) => s.text);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });

  it("AC-R1: the two expansions of one answer share no sub-bullet", () => {
    const a = draft(PARENT_LEDGER).subBullets.map((s) => s.text);
    const b = draft(PARENT_ONCALL).subBullets.map((s) => s.text);
    const union = new Set([...a, ...b]);
    expect(union.size).toBe(a.length + b.length);
  });

  it("AC-R3: each expansion scores higher against its own parent than against a sibling", () => {
    for (const [parent, sibling] of [
      [PARENT_LEDGER, PARENT_ONCALL],
      [PARENT_ONCALL, PARENT_LEDGER],
    ]) {
      const joined = draft(parent).subBullets.map((s) => s.text).join(" ");
      expect(joined).not.toBe("");
      // The repo's own shared relevance rule, not a new metric.
      expect(overlapScore(significantTerms(parent), joined)).toBeGreaterThan(
        overlapScore(significantTerms(sibling), joined),
      );
    }
  });
});

describe("draftExpansionLocal — AC-R5: it declines rather than pads", () => {
  it("returns nothing for a parent no remaining bullet is about", () => {
    // Not "three bullets about another subject". The bullets are all about a
    // ledger; this parent is about a vendor contract.
    const out = draft("I negotiated the vendor contract renewal.");
    expect(out.subBullets).toEqual([]);
    expect(out.sources).toEqual([]);
  });

  it("excludes a page bullet that IS one of the answer's own points, even on a tie", () => {
    // The embedded answer drafter quotes page bullets verbatim as its STAR
    // beats, so a point of the answer IS one of these lines. Handing it back
    // as "further detail" hands the reader a sentence already on screen.
    //
    // THE FIXTURE IS CHOSEN TO MAKE THE EXCLUSION LOAD-BEARING, because two
    // other mechanisms already cover the easy version of this. A bullet equal
    // to the PARENT is dropped by the contract's parent-duplicate rule, and a
    // bullet equal to a SIBLING is normally assigned to that sibling because
    // it scores highest against itself. Measured: with the easy fixture,
    // deleting the exclusion left this file green.
    //
    // So: `sibling` is one of the page's bullets verbatim, and `parent` is
    // phrased to share every one of its significant terms. The two therefore
    // TIE on that bullet, the tie goes to the earlier point, and the bullet
    // lands under the parent as a verbatim restatement of the sibling beat
    // below it. MUTATION PROOF: delete the pointKeys exclusion; red.
    const sibling = "I closed the settlement ledger gap in one release.";
    const parent = "I closed the settlement ledger gap during that release cycle.";
    const pages = [
      {
        id: "p9",
        title: "Settlement ledger release",
        archived_at: null,
        generated_kind: null,
        body: [`- ${sibling}`, "- I reconciled every settlement ledger entry by hand."].join("\n"),
      },
    ];
    const texts = draftExpansionLocal({
      question: "Tell me about the settlement ledger release.",
      parentPoint: parent,
      points: [parent, sibling],
      pages,
    }).subBullets.map((s) => s.text);
    expect(texts).toEqual(["I reconciled every settlement ledger entry by hand."]);
    expect(texts).not.toContain(sibling);
  });

  it("never hands back the parent's own sentence", () => {
    const parent = "I wrote the replay script that closed the ledger gap.";
    const texts = draft(parent, { points: [parent, PARENT_ONCALL] }).subBullets.map((s) => s.text);
    expect(texts).not.toContain(parent);
  });

  it("AC-4.9: mines nothing from a story that did not clear the honesty gate", () => {
    // Pure interview scaffolding: no term in it could distinguish this page
    // from any other page the candidate has ever written, so `matched` is
    // false and the app may not speak the page as their own experience.
    // MUTATION PROOF: drop the `story.matched === true` gate; red.
    const out = draftExpansionLocal({
      question: "Tell me about a time you had a difficult problem.",
      parentPoint: PARENT_LEDGER,
      points: POINTS,
      pages: PAGES,
    });
    expect(out.subBullets).toEqual([]);
  });

  it("returns the empty shape for no pages at all, and never throws on junk", () => {
    expect(draft(PARENT_LEDGER, { pages: [] }).subBullets).toEqual([]);
    expect(draftExpansionLocal().subBullets).toEqual([]);
    expect(draftExpansionLocal({ pages: null, points: null }).subBullets).toEqual([]);
  });
});

describe("draftExpansionLocal — AC-3.7: document order, never relevance order", () => {
  it("emits page bullets in the order the page was written", () => {
    // selectBestStory hands back `bullets` RANKED by overlap with the question
    // and `bulletPositions` carrying each one's index in the page as written.
    // Emitting the ranked order reproduces, one nesting level down, the
    // reversed-STAR defect resultBeatFor was written to fix: a "Result" beat
    // printed before the action that produced it.
    //
    // Here the SECOND line as written scores higher against the question, so
    // `bullets` comes back reversed and only `bulletPositions` can undo it.
    // MUTATION PROOF: drop the position sort; red.
    const pages = [
      {
        id: "p2",
        title: "Kafka retention tuning",
        archived_at: null,
        generated_kind: null,
        body: [
          "- I scoped the retention failure mode across every partition.",
          "- I tuned Kafka retention on the ingestion cluster.",
        ].join("\n"),
      },
    ];
    const out = draftExpansionLocal({
      question: "Tell me about your Kafka retention tuning work.",
      parentPoint: "I fixed the partition retention problem on ingestion.",
      points: ["I fixed the partition retention problem on ingestion."],
      pages,
    });
    expect(out.subBullets.map((s) => s.text)).toEqual([
      "I scoped the retention failure mode across every partition.",
      "I tuned Kafka retention on the ingestion cluster.",
    ]);
  });
});

describe("draftExpansionLocal — provenance", () => {
  it("AC-4.2: every sub-bullet is quoted verbatim, modulo sentence casing, from ONE page bullet", () => {
    const out = draft(PARENT_LEDGER);
    const bodyLines = PAGES[0].body.split("\n").map((l) => l.replace(/^-\s*/, ""));
    for (const sub of out.subBullets) {
      expect(bodyLines).toContain(sub.text);
    }
  });

  it("AC-R4: every sub-bullet names the single source unit it came from", () => {
    const out = draft(PARENT_LEDGER);
    expect(out.subBullets.length).toBeGreaterThan(0);
    for (const sub of out.subBullets) {
      expect(sub.source).toMatchObject({ kind: "page", pageId: "p1" });
      expect(Number.isInteger(sub.source.bulletIndex)).toBe(true);
      expect(sub.pageId).toBe("p1");
    }
  });

  it("reports the page it mined, so the caption cannot claim one it did not", () => {
    expect(draft(PARENT_LEDGER).sources).toEqual([
      { kind: "page", pageId: "p1", pageTitle: "Settlement ledger rebuild" },
    ]);
  });

  it("never mines a bare paragraph, only markdown bullet lines", () => {
    const texts = draft(PARENT_LEDGER).subBullets.map((s) => s.text);
    expect(texts.some((t) => t.startsWith("Some prose"))).toBe(false);
  });

  it("AC-3.3: a page bullet that is not a speakable sentence never survives", () => {
    const pages = [
      {
        id: "p3",
        title: "Ledger settlement rebuild",
        archived_at: null,
        generated_kind: null,
        body: [
          "- ledger notes",
          "- Senior Engineering Manager, Acme Payments Corp, Jan 2019 - Mar 2022.",
          "- I closed the ledger settlement gap in one release.",
        ].join("\n"),
      },
    ];
    const texts = draftExpansionLocal({
      question: "Tell me about the ledger settlement rebuild.",
      parentPoint: "I rebuilt the settlement ledger under time pressure.",
      points: ["I rebuilt the settlement ledger under time pressure."],
      pages,
    }).subBullets.map((s) => s.text);
    expect(texts).toEqual(["I closed the ledger settlement gap in one release."]);
  });

  it("never returns more than EXPANSION_MAX", () => {
    const bullets = Array.from(
      { length: 12 },
      (_, i) => `- I closed the settlement ledger gap in release number ${i}.`,
    );
    const out = draftExpansionLocal({
      question: QUESTION,
      parentPoint: PARENT_LEDGER,
      points: [PARENT_LEDGER],
      pages: [{ id: "p4", title: "Settlement ledger rebuild", archived_at: null, generated_kind: null, body: bullets.join("\n") }],
    });
    expect(out.subBullets.length).toBeLessThanOrEqual(5);
  });

  it("never mines an ineligible page", () => {
    const archived = [{ ...PAGES[0], archived_at: "2020-01-01" }];
    expect(draft(PARENT_LEDGER, { pages: archived }).subBullets).toEqual([]);
    const generated = [{ ...PAGES[0], generated_kind: "tailored" }];
    expect(draft(PARENT_LEDGER, { pages: generated }).subBullets).toEqual([]);
  });
});

describe("draftExpansionLocal — AC-4.1: it is deterministic and offline", () => {
  it("imports no model client and calls no network", () => {
    expect(SRC).not.toMatch(/geminiClient|GoogleGenAI|generateContent|fetch\(/);
  });

  it("[control] the model-client sweep can actually fail", () => {
    expect('import { getGeminiClient } from "@/lib/llm/geminiClient";').toMatch(/geminiClient/);
  });

  it("declares no relevance metric, no word counter and no date vocabulary of its own", () => {
    // significantTerms/overlapScore are the repo's shared relevance rule;
    // pointWordCount is its one word counter; TITLE_KEYWORDS_RE and the date
    // patterns live in lib/resume/parseEmployment.js. A private copy of any of
    // them is the copy that drifts.
    expect(SRC).not.toMatch(/split\(\/\\s\+\/\)/);
    expect(SRC).not.toMatch(/\d{4}\s*-\s*\d{4}/);
    expect(SRC).toContain("significantTerms");
    expect(SRC).toContain("overlapScore");
  });

  it("is a pure function of its arguments", () => {
    const a = draft(PARENT_LEDGER).subBullets.map((s) => s.text);
    const b = draft(PARENT_LEDGER).subBullets.map((s) => s.text);
    expect(a).toEqual(b);
  });
});
