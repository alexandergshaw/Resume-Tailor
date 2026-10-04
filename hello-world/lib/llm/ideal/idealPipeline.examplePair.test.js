// N105 AC-14 - the example posting <-> resume pair RUNS the transformation.
//
// The fixture (./__fixtures__/examplePair.js) is not illustration: every row of it
// is driven through the real pipeline here - the real normalizeAnalysis and
// posting grounding, the real decompose / gate / chronology / recompose, the real
// live reviewer - with only the ENGINE stubbed to return the fixture's drafts. The
// real material is built from the fixture resume's text by the route's own builder,
// so the gate is judged against what production would judge it against.
//
// The chain asserted, for one requirement (EXAMPLE_CHAIN_ITEM):
//   posting requirement -> keyword-map entry -> hypothetical bullet -> application-
//   ready bullet
// and, for the whole pair, the three outcome classes of AC-4 / AC-14:
//   must-drop     a fabrication the model wrote is ABSENT from every emitted byte
//   must-survive  a truthful reframe is emitted
//   must-keep     a supported claim is emitted as it stood
//
// STATED COUNTS (AC-14: zero of either means the fixture is defective).
//   failable rows  6   claims that can fail the gate or the chronology check
//   keepable rows 11   supported lines that must be retained (9 kept + 2 reframed)
// Both are asserted below as literals and as non-zero, so shrinking the fixture
// into decoration reds here.
//
// POWER. The raw candidate the stub engine returns contains every failable row
// (asserted as a precondition), so a pipeline that emitted the candidate verbatim
// would fail every must-drop assertion; `violations()` is run on the candidate as
// the control that the instrument can see a violation at all.

import { describe, it, expect, beforeAll } from "vitest";
import { runIdealPipeline } from "./idealPipeline.js";
import { normalizeAnalysis } from "./idealStageResult.js";
import { GATE_REASON } from "./applicationReadyGate.js";
import { buildIdealRealMaterial } from "@/app/api/tailor/idealRealMaterial.js";
import { HYPOTHETICAL_TOKEN } from "@/lib/document/docx.js";
import {
  EXAMPLE_ANALYSIS,
  EXAMPLE_CANDIDATE_LINES,
  EXAMPLE_CHAIN_ITEM,
  EXAMPLE_HYPOTHETICAL_LINES,
  EXAMPLE_POSTING,
  EXAMPLE_RESUME_TEXT,
  EXAMPLE_ROWS,
} from "./__fixtures__/examplePair.js";

const FAILABLE_ROWS = 6;
const KEEPABLE_ROWS = 11;
const BEGINS_WITH_TOKEN = new RegExp(`^[^A-Za-z0-9]*${HYPOTHETICAL_TOKEN}`);

// engine.tailorIdeal as the chain resolves it: stage 1 through the real
// normalizer, the two drafts as line arrays.
function exampleEngine() {
  const { jobTitle, companyName, postingAnalysis, keywordMap } = normalizeAnalysis(EXAMPLE_ANALYSIS);
  const draft = (lines) => ({ result: lines.join("\n"), resultLines: lines, jobTitle, companyName });
  return {
    name: "gemini",
    supportsIdeal: true,
    async tailorIdeal() {
      return {
        postingAnalysis,
        keywordMap,
        hypothetical: draft(EXAMPLE_HYPOTHETICAL_LINES),
        applicationReadyCandidate: draft(EXAMPLE_CANDIDATE_LINES),
      };
    },
  };
}

const realMaterial = buildIdealRealMaterial(EXAMPLE_RESUME_TEXT);

let out;
beforeAll(async () => {
  out = await runIdealPipeline({
    engine: exampleEngine(),
    args: { jobPosting: EXAMPLE_POSTING, resumeText: EXAMPLE_RESUME_TEXT, resumeFileName: "resume.docx" },
    realMaterial,
  });
});

// Which of the failable rows' texts appear among `lines`.
const violations = (lines) =>
  EXAMPLE_ROWS.mustDrop.filter((row) => lines.some((line) => line.includes(row.text))).map((row) => row.id);

const emittedLines = () => out.ideal.applicationReady.resultLines;

describe("AC-14 fixture - the pair is defined with both kinds of power", () => {
  it("states a failable-row count and a keepable-row count, both above zero", () => {
    expect(EXAMPLE_ROWS.mustDrop).toHaveLength(FAILABLE_ROWS);
    expect(EXAMPLE_ROWS.mustKeep.length + EXAMPLE_ROWS.mustSurvive.length).toBe(KEEPABLE_ROWS);
    expect(FAILABLE_ROWS).toBeGreaterThan(0);
    expect(KEEPABLE_ROWS).toBeGreaterThan(0);
  });

  it("PRECONDITION: the engine's candidate carries every failable row, so a verbatim emit would fail", () => {
    expect(violations(EXAMPLE_CANDIDATE_LINES).sort()).toEqual(EXAMPLE_ROWS.mustDrop.map((r) => r.id).sort());
    // Every keepable row is in the candidate too: a keep assertion cannot pass on a
    // line the model never wrote.
    for (const text of [...EXAMPLE_ROWS.mustKeep, ...EXAMPLE_ROWS.mustSurvive]) {
      expect(EXAMPLE_CANDIDATE_LINES, `candidate lacks ${text}`).toContain(text);
    }
  });

  it("PRECONDITION: the hypothetical (never gated) carries every failable row", () => {
    expect(violations(EXAMPLE_HYPOTHETICAL_LINES).sort()).toEqual(EXAMPLE_ROWS.mustDrop.map((r) => r.id).sort());
  });

  it("PRECONDITION: the real material came from the resume text alone (two employers, one school)", () => {
    expect(realMaterial.chronology.employers.map((e) => e.name)).toEqual(["Brightwave Systems", "Cobalt Labs"]);
    expect(realMaterial.chronology.education.map((e) => e.institution)).toEqual(["Lakeview University"]);
  });
});

describe("AC-14 chain - one requirement through all four stages", () => {
  const item = EXAMPLE_CHAIN_ITEM;
  const requirement = () => out.ideal.postingAnalysis.requirements.find((r) => r.text === item.requirementText);

  it("stage 1a: the requirement is in the grounded posting analysis, verbatim from the posting", () => {
    expect(EXAMPLE_POSTING).toContain(item.requirementText.replace(/\.$/, ""));
    expect(requirement(), "requirement missing from ideal.postingAnalysis").toBeTruthy();
  });

  it("stage 1b: the keyword-map entry points at that requirement, in the section the model chose", () => {
    const entry = out.ideal.keywordMap.entries.find((e) => e.keyword === item.keyword);
    expect(entry, "keyword missing from ideal.keywordMap").toBeTruthy();
    expect(entry.requirementId).toBe(requirement().id);
    expect(entry.section).toBe(item.keywordSection);
  });

  it("stage 2: the hypothetical bullet is in the hypothetical and carries the keyword", () => {
    expect(out.ideal.hypothetical.resultLines).toContain(item.hypotheticalBullet);
    expect(item.hypotheticalBullet.toLowerCase()).toContain(item.keyword);
  });

  it("stage 3: the application-ready bullet is emitted, carries the keyword, and is not the hypothetical's", () => {
    expect(emittedLines()).toContain(item.applicationReadyBullet);
    expect(item.applicationReadyBullet.toLowerCase()).toContain(item.keyword);
    expect(item.applicationReadyBullet).not.toBe(item.hypotheticalBullet);
    expect(emittedLines()).not.toContain(item.hypotheticalBullet);
  });
});

describe("AC-14 grounding - the analysis stage's invented items are removed (AC-8, AC-9)", () => {
  it("the requirement and the keyword the posting never asked for are gone; the grounded ones stay in order", () => {
    const texts = out.ideal.postingAnalysis.requirements.map((r) => r.text);
    expect(texts.join("\n")).not.toMatch(/Terraform/);
    expect(out.ideal.keywordMap.entries.map((e) => e.keyword)).toEqual([
      "payments",
      "merchant onboarding",
      "PCI compliance",
      "Kubernetes",
      "mentoring",
    ]);
    // Control: the model's claim really did contain them, so this is a removal.
    expect(normalizeAnalysis(EXAMPLE_ANALYSIS).keywordMap.entries.map((e) => e.keyword)).toContain("Terraform");
    expect(texts).toHaveLength(4);
  });
});

describe("AC-14 must-drop - every failable row is ABSENT from every emitted byte", () => {
  it.each(EXAMPLE_ROWS.mustDrop.map((row) => [row.id, row]))("%s", (_id, row) => {
    for (const bytes of [
      out.result,
      out.resultLines.join("\n"),
      out.ideal.applicationReady.result,
      out.ideal.applicationReady.resultLines.join("\n"),
    ]) {
      expect(bytes).not.toContain(row.text);
    }
  });

  it("the instrument sees a violation: the engine's candidate fails it, the emitted document passes it", () => {
    expect(violations(EXAMPLE_CANDIDATE_LINES)).toHaveLength(FAILABLE_ROWS);
    expect(violations(emittedLines())).toEqual([]);
  });

  it("each is accounted for in the bucket and with the reason the fixture states", () => {
    for (const row of EXAMPLE_ROWS.mustDrop) {
      const hit = out.ideal[row.bucket].find((r) => r.text === row.text);
      expect(hit, `${row.id} not in ideal.${row.bucket}`).toBeTruthy();
      expect(hit.reasonCode).toBe(row.reasonCode);
      const other = row.bucket === "removed" ? "leftOut" : "removed";
      expect(out.ideal[other].some((r) => r.text === row.text), `${row.id} also in ideal.${other}`).toBe(false);
    }
    // The fixture's literal reason codes are the gate's own.
    expect(new Set(EXAMPLE_ROWS.mustDrop.map((r) => r.reasonCode))).toEqual(
      new Set([GATE_REASON.PARTIAL_MATCH, GATE_REASON.NO_MATCH, GATE_REASON.MEMBERSHIP]),
    );
    expect(out.ideal.counts.removed).toBe(out.ideal.removed.length);
    expect(out.ideal.counts.leftOut).toBe(out.ideal.leftOut.length);
  });
});

describe("AC-14 must-survive and must-keep - supported lines are emitted", () => {
  it.each(EXAMPLE_ROWS.mustSurvive.map((text) => [text]))("must-survive: %s", (text) => {
    expect(emittedLines()).toContain(text);
    expect(out.result).toContain(text);
  });

  it.each(EXAMPLE_ROWS.mustKeep.map((text) => [text]))("must-keep: %s", (text) => {
    expect(emittedLines()).toContain(text);
    expect(out.result).toContain(text);
  });

  it("nothing else is emitted: every non-blank line is a keep, a survivor or a section heading", () => {
    const allowed = new Set([...EXAMPLE_ROWS.mustKeep, ...EXAMPLE_ROWS.mustSurvive, "PROFESSIONAL EXPERIENCE", "EDUCATION"]);
    const stray = emittedLines().filter((line) => line.trim() !== "" && !allowed.has(line));
    expect(stray).toEqual([]);
  });
});

describe("AC-14 the pair visibly differs, and only the hypothetical is marked", () => {
  it("the two documents are different texts, and the hypothetical still carries every failable row", () => {
    expect(out.ideal.hypothetical.result).not.toBe(out.ideal.applicationReady.result);
    expect(out.ideal.hypothetical.resultLines.length).toBeGreaterThan(emittedLines().length);
    for (const row of EXAMPLE_ROWS.mustDrop) {
      expect(out.ideal.hypothetical.result).toContain(row.text);
    }
  });

  it("the hypothetical carries the marker and the flag; the application-ready carries neither", () => {
    expect(out.ideal.hypothetical.isHypothetical).toBe(true);
    expect(out.ideal.hypothetical.title).toMatch(BEGINS_WITH_TOKEN);
    expect(out.ideal.applicationReady.isHypothetical).toBe(false);
    expect(out.ideal.applicationReady.title).not.toMatch(new RegExp(HYPOTHETICAL_TOKEN));
    expect(out.result).not.toMatch(new RegExp(HYPOTHETICAL_TOKEN));
  });

  it("the top level of the response is the application-ready document, never the hypothetical", () => {
    expect(out.result).toBe(out.ideal.applicationReady.result);
    expect(out.result).not.toBe(out.ideal.hypothetical.result);
  });

  it("the review ran over the pair and does not claim to be complete (mechanical floor only)", () => {
    expect(out.ideal.review.coverage.engineMode).toBe("mechanical-only");
    expect(out.ideal.review.coverage.complete).toBe(false);
  });
});
