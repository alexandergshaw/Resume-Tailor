// N81 REGRESSION (fresh-verifier NOT-SHIP on a36d6ae, Finding A) -- THE SHARED
// SEAM's id guard must not suppress a fact that is not ACTUALLY PRESENT in the
// lines being planned against.
//
// THE REGRESSION. `planCoverFacts` (factInsertion.js) added an id-keyed skip:
//   const recordIds = new Set(record.filter((r) => r?.id != null).map((r) => r.id));
//   ... if (fact.id != null && recordIds.has(fact.id)) continue;   // :114,:123
// It fires on id membership alone, with NO check that the fact's text is present
// in `lines`. `record` (the caller's `coverRecord`) is built from
// `acceptedFactsByJob[jobId].facts` -- scoped to one APPLICATION, never to a
// cover-letter VERSION. When the candidate switches to a freshly-regenerated
// letter (version 2) that does NOT contain a fact accepted against version 1,
// the fact's id is still in `record`, so a re-accept into version 2 is silently
// suppressed and the fact becomes permanently unreachable for that letter.
//
// THE PAIRING THAT IS THE WHOLE POINT (per the round brief). BOTH must hold at
// once, and this file must go red if EITHER is lost:
//   (A) presence required -- a fact whose text is absent from these lines is
//       INSERTED even when its id is in `record` (the regression above);
//   (B) id required        -- the guard stays ID-scoped, never reverting to a
//       text-only dedupe: a genuinely NEW fact (id absent from `record`) is
//       inserted even when its text happens to coincide with existing prose,
//       and a re-accept whose text IS present (a real duplicate) is still
//       suppressed.
// The FALLING-OUT mutants proved in tests.r1.md: dropping the presence check
// reds "Finding A" below; dropping the id check reds "id-scoping" below.
//
// node env (pure planner, no DOM) -- mirrors factInsertion.reacceptDedupe.test.js.

import { describe, it, expect } from "vitest";
import { planAcceptForEntry } from "./factInsertion.js";

const GREETING = "Dear Hiring Manager,";
// > 40 chars, after line 0 -> introIndex() picks it as the 'intro' target.
const INTRO = "I am writing to apply for the Staff Engineer position at Acme, where I have deep platform experience.";
// Carries the /in my current role/i anchor -> 'current' resolves HERE, a line
// distinct from INTRO.
const ROLE = "In my current role at Acme I lead a small platform team building telemetry.";
const SIGN = "Sincerely, Alex Shaw";

// A fact whose text is a substring of NO base line below, so the only way it can
// appear in the letter is by insertion (never a reconstructing fixture).
const FACT = "Acme opened a Dublin telemetry lab this spring.";
const OTHER = "Acme also won a national sustainability award.";

// A version-1 letter carrying FACT at its intro (as a prior accept would leave
// it), reused for the two "text is present" legs. FACT appears verbatim on the
// intro line and NOWHERE near the current-role line.
const INTRO_WITH_FACT = `I am applying for the Staff Engineer position, and I already knew that ${FACT} so the mission resonates.`;

function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}
const textOf = (plan) => plan.cover.lines.join("\n");
const linesOf = (plan) => plan.cover.lines;
function entry(lines) {
  return { status: "done", coverLetterResultLines: [...lines] };
}
// The exact shape acceptFacts/autoInsertFactsForJob pass as `coverRecord`: prior
// accepted facts reduced to {id, text} provenance (useCompanyResearch.js:377,:709).
function priorRecord(...facts) {
  return facts.map((f) => ({ id: f.id, text: f.text }));
}

// ---------------------------------------------------------------------------
// Harness sanity -- if any of these is red, every verdict below is an
// instrument failure, not a product finding.
// ---------------------------------------------------------------------------

describe("N81 version-switch: harness sanity", () => {
  it("CANARY: count() counts non-overlapping occurrences", () => {
    expect(count("a b a b a", "a")).toBe(3);
    expect(count("nothing here", FACT)).toBe(0);
  });

  it("the plain fixture carries NEITHER fact, and 'intro'/'current' resolve to DISTINCT lines", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    for (const f of [FACT, OTHER]) expect(base.join("\n"), `fixture already contains: ${f}`).not.toContain(f);
    const atIntro = planAcceptForEntry(entry(base), { facts: [{ id: "x", text: FACT, placement: "intro" }] });
    const atCurrent = planAcceptForEntry(entry(base), { facts: [{ id: "y", text: OTHER, placement: "current" }] });
    expect(atIntro.cover.edits[0]?.lineIndex, "intro fact was not placed").toBeGreaterThanOrEqual(0);
    expect(atCurrent.cover.edits[0]?.lineIndex, "current fact was not placed").toBeGreaterThanOrEqual(0);
    expect(atCurrent.cover.edits[0].lineIndex, "'intro' and 'current' coincide -- cannot discriminate").not.toBe(
      atIntro.cover.edits[0].lineIndex,
    );
  });

  it("the FACT-bearing fixture carries FACT on the intro line and NOT on the current-role line", () => {
    const base = [GREETING, INTRO_WITH_FACT, ROLE, SIGN];
    const introIdx = 1;
    const currentIdx = base.findIndex((l) => /in my current role/i.test(l));
    expect(String(base[introIdx]), "FACT not on the intro line").toContain(FACT);
    expect(currentIdx, "no current-role line").toBeGreaterThanOrEqual(0);
    expect(String(base[currentIdx]), "FACT unexpectedly present on the current-role line").not.toContain(FACT);
  });
});

// ---------------------------------------------------------------------------
// (A) PRESENCE REQUIRED -- RED on HEAD (the regression). Kills the mutant that
// drops the presence check (that mutant IS HEAD).
// ---------------------------------------------------------------------------

describe("N81 version-switch: a fact absent from the current lines is inserted even when its id is in the record", () => {
  it("id in record, text NOT in lines (version 2) -> the fact is inserted exactly once (RED on HEAD)", () => {
    // Version 2: a freshly regenerated letter that does NOT contain FACT.
    const v2 = [GREETING, INTRO, ROLE, SIGN];
    // The job-level accepted-facts log still carries FACT's id from when it was
    // accepted against version 1 -- exactly what `selectDocumentVersion` leaves
    // untouched on a cover-version switch. This is the guard's `coverRecord`.
    const record = priorRecord({ id: "art-a", text: FACT });

    // Non-vacuity guard: if the id were NOT in the record, HEAD would insert for
    // the trivial reason (no guard) and this test could never be red. Prove the
    // id really is present, so the RED is caused by the guard over-firing.
    expect(record.some((r) => r.id === "art-a"), "fixture flaw: the id is not in the record").toBe(true);
    expect(v2.join("\n"), "fixture flaw: version 2 already contains FACT").not.toContain(FACT);

    const run = planAcceptForEntry(entry(v2), {
      facts: [{ id: "art-a", text: FACT, placement: "intro" }],
      coverRecord: record,
    });

    // THE CRITERION. On HEAD this is 0 edits / 0 occurrences: the id guard
    // suppresses an insertion into a letter that demonstrably does not contain
    // the fact. After the fix, the fact lands once.
    expect(
      run.cover.edits.length,
      "the id guard suppressed a fact whose text is absent from the current lines (N81 regression, Finding A)",
    ).toBeGreaterThan(0);
    expect(count(textOf(run), FACT), "the recovered fact must appear exactly once").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (B) ID REQUIRED -- controls. GREEN on HEAD and after the fix. These fail if a
// fix "reverts to text-only dedupe" (drops the id check) or drops the guard.
// ---------------------------------------------------------------------------

describe("N81 version-switch: the guard stays ID-scoped, not text-only", () => {
  it("a re-accept whose text IS present (real duplicate) is still suppressed -- Finding A must not become 'always insert'", () => {
    // FACT already sits on the intro line; the SAME article (art-a, in record)
    // is re-accepted at a CHANGED placement ('current'). This is a genuine
    // duplicate and must stay deduped -- the property a36d6ae added.
    const base = [GREETING, INTRO_WITH_FACT, ROLE, SIGN];
    const run = planAcceptForEntry(entry(base), {
      facts: [{ id: "art-a", text: FACT, placement: "current" }],
      coverRecord: priorRecord({ id: "art-a", text: FACT }),
    });
    expect(run.cover.edits.length, "a real duplicate re-accept emitted an edit").toBe(0);
    expect(count(textOf(run), FACT), "the fact was duplicated across a placement change").toBe(1);
  });

  it("a genuinely NEW fact (id absent from record) is inserted even when its text coincides with existing prose", () => {
    // FACT appears on the intro line as ORDINARY PROSE (F2: 'the same text can
    // occur elsewhere in the letter'). A DIFFERENT article -- 'fresh', whose id
    // is NOT in the record -- carries the same sentence and is accepted at
    // 'current'. Id-scoping means this must insert; a text-only dedupe would
    // wrongly suppress it. This is the leg that reds the drop-the-id-check mutant.
    const base = [GREETING, INTRO_WITH_FACT, ROLE, SIGN];
    const currentIdx = base.findIndex((l) => /in my current role/i.test(l));
    const run = planAcceptForEntry(entry(base), {
      facts: [{ id: "fresh", text: FACT, placement: "current" }],
      coverRecord: priorRecord({ id: "other", text: OTHER }),
    });
    expect(run.cover.edits.length, "a new-id fact was suppressed because its text matched unrelated prose (text-only dedupe)").toBeGreaterThan(0);
    expect(String(linesOf(run)[currentIdx]), "the new fact did not land on the current-role line").toContain(FACT);
  });

  it("a first-time fact whose text is absent inserts normally (unchanged path)", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    const run = planAcceptForEntry(entry(base), {
      facts: [{ id: "fresh", text: FACT, placement: "current" }],
      coverRecord: priorRecord({ id: "someone-else", text: OTHER }),
    });
    expect(count(textOf(run), FACT), "a first-time fact was suppressed").toBe(1);
  });
});

// WHAT THIS FILE CANNOT CATCH. It exercises the pure planner only: it does not
// prove either CALLER reaches the seam with these arguments across a real
// version switch -- acceptFactVersionSwitch.rc.test.js drives that. It cannot
// detect a WRONG value the guard might let through, only a suppressed/duplicated
// one; and `planCoverFacts` is fed lines directly, so nothing here touches docx
// bytes.
