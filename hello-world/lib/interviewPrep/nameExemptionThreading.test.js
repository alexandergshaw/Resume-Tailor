// TDD RED handoff -- how the O-15 exemption COMPOSES with normalizePack /
// countRefusedLines once `storedNames` exists as a trailing parameter
// (design-reconciled.r2.md ss4.2/ss4.3, RD-N33.4/5/6). This file does NOT
// re-test isUserSuppliedName/detectedNameSpans's own matching rule -- see
// ./nameExemption.test.js for that (the heart of this chunk). This file
// tests the INTEGRATION: does normalizePack actually consult storedNames at
// the right place, does the exemption survive being re-run (the real
// production shape -- normalizePack runs twice on the model path,
// route.js:455 then again inside writePrepPackResult, prepStore.js:377),
// does K1-PROHIBITION still fire on an exempted name (AC-N33.9), does
// refusesClaimText correctly take NO storedNames parameter (RD-N33.5), and
// -- the laundering property this seat's brief names by name -- can a
// hostile pack smuggle its own "storedNames" into the exemption by carrying
// a same-shaped field on the pack object itself, rather than through the
// caller's own explicit second argument?
//
// RED REASON: `normalizePack`/`countRefusedLines` exist today
// (lib/interviewPrep/prepParse.js:616,660) but take ONE and TWO arguments
// respectively, with NO `storedNames` parameter at all (confirmed by direct
// read this round: `export function normalizePack(pack) {`,
// `export function countRefusedLines(pack, claims) {`). Every test below
// that passes a THIRD argument and expects it to change the outcome is RED
// today because the parameter is silently ignored (JS does not error on an
// extra argument) -- the exemption never fires, so lines this suite expects
// KEPT are instead DROPPED. This is a real behavioural RED, not an
// import-time RED like ./nameExemption.test.js's.

import { describe, it, expect } from "vitest";
import { normalizePack, countRefusedLines } from "./prepParse.js";

/** A minimally-valid, four-section pack. Sections not under test in a given
 *  case get one innocuous, name-free line so normalizePack's own shape
 *  repair never has to guess. */
function buildPack({ aboutYouLines, whyRoleLines, askThemQuestions, stages, claims } = {}) {
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: aboutYouLines ?? [{ text: "I led three cross-functional launches." }] } },
      whyRole: { answer: { lines: whyRoleLines ?? [{ text: "This role matches my background in payments." }] } },
      askThem: { questions: askThemQuestions ?? [{ text: "How is this team's work measured?" }] },
      stages: { stages: stages ?? [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }] },
    },
    claims: claims ?? [],
  };
}

describe("normalizePack(pack, storedNames) -- the exemption actually reaches K1-SHAPE", () => {
  it("without storedNames (2-arg call, today's shape), an uncited line naming a real detected span is DROPPED -- the baseline this feature must not weaken", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    const result = normalizePack(pack);
    expect(result.sections.aboutYou.answer.lines).toEqual([]);
  });

  it("WITH storedNames containing the exact detected span, the SAME line is KEPT, unmodified", () => {
    const line = { text: "Alex Shaw led the migration to the new platform." };
    const pack = buildPack({ aboutYouLines: [line] });
    const result = normalizePack(pack, ["Alex Shaw"]);
    expect(result.sections.aboutYou.answer.lines).toEqual([line]);
  });

  it("a DIFFERENT stored name (not matching the detected span) does not exempt -- the exemption is not a blanket 'some name is stored' switch", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    const result = normalizePack(pack, ["Priya Nair"]);
    expect(result.sections.aboutYou.answer.lines).toEqual([]);
  });

  it("a line with ONE exempt name and ONE unrelated, uncited name is still refused on account of the unrelated one (AC-N33.1, per-span not per-line)", () => {
    const pack = buildPack({
      aboutYouLines: [{ text: "Jane Smith introduced herself before Alex Shaw asked the first question." }],
    });
    const result = normalizePack(pack, ["Alex Shaw"]);
    expect(result.sections.aboutYou.answer.lines).toEqual([]);
  });

  it("applies identically across all three name-bearing surfaces: whyRole, askThem, and a Stage's questions[]", () => {
    const pack = buildPack({
      whyRoleLines: [{ text: "Alex Shaw is drawn to this team's mission." }],
      askThemQuestions: [{ text: "Alex Shaw would like to know the team's roadmap." }],
      stages: [
        {
          name: "Overview",
          questions: ["Alex Shaw has one question about the on-call rotation."],
          recommendedAnswer: null,
          support: null,
        },
      ],
    });
    const withoutExemption = normalizePack(pack);
    expect(withoutExemption.sections.whyRole.answer.lines).toEqual([]);
    expect(withoutExemption.sections.askThem.questions).toEqual([]);
    expect(withoutExemption.sections.stages.stages[0].questions).toEqual([]);

    const withExemption = normalizePack(pack, ["Alex Shaw"]);
    expect(withExemption.sections.whyRole.answer.lines.length).toBe(1);
    expect(withExemption.sections.askThem.questions.length).toBe(1);
    expect(withExemption.sections.stages.stages[0].questions.length).toBe(1);
  });
});

describe("AC-N33.9 -- K1-PROHIBITION still refuses a correctly-exempted name's line", () => {
  it("a stored, correctly-exempted interviewer name inside a prediction sentence ('your interviewer... will ask') is STILL dropped", () => {
    // "your interviewer" is one of design-operate.r1.md ss1b's six
    // structural K1-PROHIBITION terms, copied verbatim into
    // PREDICTION_PREDICATE (prepParse.js:317-327).
    const pack = buildPack({
      aboutYouLines: [{ text: "Priya Nair, your interviewer, will ask about your Python experience." }],
    });
    const result = normalizePack(pack, ["Priya Nair"]);
    expect(result.sections.aboutYou.answer.lines).toEqual([]);
  });

  it("countRefusedLines counts this line as refused even though the name is exempted", () => {
    const pack = buildPack({
      aboutYouLines: [{ text: "Priya Nair, your interviewer, will ask about your Python experience." }],
    });
    expect(countRefusedLines(pack, pack.claims, ["Priya Nair"])).toBe(1);
  });

  it("[companion control] the identical name, in a sentence with NO prediction term, is kept once exempted -- proves the drop above is K1-PROHIBITION, not a refusal to exempt at all", () => {
    const pack = buildPack({
      aboutYouLines: [{ text: "Priya Nair is the name I was given for this process." }],
    });
    const result = normalizePack(pack, ["Priya Nair"]);
    expect(result.sections.aboutYou.answer.lines.length).toBe(1);
  });
});

describe("idempotence under storedNames -- a value exempted on the FIRST write pass is still exempt on the SECOND (the real production shape: route.js:455 then prepStore.js:377)", () => {
  it("running normalizePack twice with the SAME storedNames does not un-exempt a kept line", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    const firstPass = normalizePack(pack, ["Alex Shaw"]);
    const secondPass = normalizePack(firstPass, ["Alex Shaw"]);
    expect(secondPass.sections.aboutYou.answer.lines.length).toBe(1);
    expect(secondPass).toEqual(firstPass);
  });

  it("[the trap this test guards against] if the SECOND pass is called WITHOUT storedNames (a call site upgraded on only one of its two normalizePack calls), the already-kept line is silently dropped -- this is exactly why design-reconciled.r2.md ss4.3's reviewer property requires ALL FOUR call sites to resolve storedNames identically", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    const firstPass = normalizePack(pack, ["Alex Shaw"]);
    expect(firstPass.sections.aboutYou.answer.lines.length).toBe(1);
    const secondPassMissingStoredNames = normalizePack(firstPass);
    expect(secondPassMissingStoredNames.sections.aboutYou.answer.lines).toEqual([]);
  });
});

describe("the laundering property -- a pack cannot supply its OWN storedNames; only the caller's explicit argument counts", () => {
  it("a pack object carrying its own 'storedNames' field (as a hostile model reply might, guessing the parameter name) has ZERO effect on the exemption", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    pack.storedNames = ["Alex Shaw"]; // planted, must be ignored
    const result = normalizePack(pack); // no second argument supplied
    expect(result.sections.aboutYou.answer.lines).toEqual([]);
  });

  it("a pack object carrying its own 'candidateName'/'interviewerNames' fields (guessing the trustedNames.js shape) also has zero effect", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    pack.candidateName = "Alex Shaw";
    pack.interviewerNames = ["Alex Shaw"];
    const result = normalizePack(pack, []);
    expect(result.sections.aboutYou.answer.lines).toEqual([]);
  });

  it("[companion control] the SAME planted fields, with the REAL exemption correctly supplied as the second argument, still work -- proves the ban above is about SOURCE, not about breaking the pack's own shape", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    pack.storedNames = ["someone-else"];
    const result = normalizePack(pack, ["Alex Shaw"]);
    expect(result.sections.aboutYou.answer.lines.length).toBe(1);
  });
});

describe("RD-N33.5 -- refusesClaimText takes NO storedNames parameter; claims filtering is unaffected by it", () => {
  it("a claims[] entry naming a stored, correctly-exempted name inside a prediction sentence is STILL dropped from claims, regardless of storedNames", () => {
    const pack = buildPack({
      claims: [{ id: "c1", text: "Priya Nair will lead the panel discussion.", sourceUrl: "https://example.com/article" }],
    });
    const withoutStoredNames = normalizePack(pack);
    const withStoredNames = normalizePack(pack, ["Priya Nair"]);
    expect(withoutStoredNames.claims.map((c) => c.id)).toEqual([]);
    expect(withStoredNames.claims.map((c) => c.id)).toEqual([]);
  });

  it("countRefusedLines counts the SAME dropped claim identically with or without storedNames", () => {
    const pack = buildPack({
      claims: [{ id: "c1", text: "Priya Nair will lead the panel discussion.", sourceUrl: "https://example.com/article" }],
    });
    expect(countRefusedLines(pack, pack.claims)).toBe(1);
    expect(countRefusedLines(pack, pack.claims, ["Priya Nair"])).toBe(1);
  });

  it("[companion control] a claim naming a stored name with NO prediction term survives claims filtering either way -- refusesClaimText was never going to drop it, exemption or not", () => {
    const pack = buildPack({
      claims: [{ id: "c1", text: "Priya Nair is quoted in the company's engineering blog.", sourceUrl: "https://example.com/article" }],
    });
    const withoutStoredNames = normalizePack(pack);
    const withStoredNames = normalizePack(pack, ["Priya Nair"]);
    expect(withoutStoredNames.claims.map((c) => c.id)).toEqual(["c1"]);
    expect(withStoredNames.claims.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("countRefusedLines(pack, claims, storedNames) -- the count itself reflects the exemption", () => {
  it("a name-bearing, uncited line contributes 0 to the count once its name is exempted, and 1 without the exemption", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    expect(countRefusedLines(pack, pack.claims)).toBe(1);
    expect(countRefusedLines(pack, pack.claims, ["Alex Shaw"])).toBe(0);
  });

  it("omitting storedNames entirely (2-arg call, today's existing call shape) still works and counts as though no name were stored", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    expect(() => countRefusedLines(pack, pack.claims)).not.toThrow();
    expect(countRefusedLines(pack, pack.claims)).toBe(1);
  });
});

describe("backward compatibility -- every existing 1-arg/2-arg call shape keeps working once storedNames is added as a trailing, defaulted parameter", () => {
  it("normalizePack(pack) with no second argument behaves exactly as it does today (no exemption applied)", () => {
    const pack = buildPack({ aboutYouLines: [{ text: "Alex Shaw led the migration to the new platform." }] });
    expect(() => normalizePack(pack)).not.toThrow();
    expect(normalizePack(pack).sections.aboutYou.answer.lines).toEqual([]);
  });

  it("normalizePack(null)/(undefined) still return the input unchanged, storedNames or not", () => {
    expect(normalizePack(null)).toBe(null);
    expect(normalizePack(null, ["Alex Shaw"])).toBe(null);
    expect(normalizePack(undefined, ["Alex Shaw"])).toBe(undefined);
  });
});
