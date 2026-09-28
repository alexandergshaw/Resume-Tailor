// N81 -- THE SHARED SEAM both accept paths route through must dedupe a fact
// by its ID, not merely by the resolved-target paragraph's text.
//
// THE DEFECT (demonstrated, backlog N81). `planCoverFacts` dedupes only with
// `original[index].includes(text) || group.seen.has(text)`
// (factInsertion.js:131), keyed on the RESOLVED-TARGET line's text. When the
// same fact is re-accepted at a CHANGED placement, it resolves to a DIFFERENT
// paragraph than the first accept landed it in; that new paragraph does not
// contain the text, so the M1 dedupe never fires and the fact is inserted a
// SECOND time -- a duplicated claim in the employer-bound letter. The prior
// record (`record`), which carries the fact's id, is spread into the output
// but never consulted for dedupe.
//
// WHY THIS FILE IS THE CLASS GUARD. `planCoverFacts` / `planAcceptForEntry` is
// the single seam BOTH the manual accept (`acceptFacts`, useCompanyResearch.js
// :352) and the automatic insert (`autoInsertFactsForJob`, :610) call. The auto
// path currently carries its OWN, caller-level id guard (`insertedIds`,
// :694-699); the manual path has none. The regression-class fix puts ONE guard
// at this seam so a THIRD caller cannot reintroduce the defect. These tests pin
// the seam property directly; the two reachability files
// (acceptFactReacceptPlacement.rc.test.js and autoInsertReacceptPlacement.test.js)
// prove each caller actually depends on it.
//
// node env (pure planner, no DOM).

import { describe, it, expect } from "vitest";
import { planAcceptForEntry } from "./factInsertion.js";

const GREETING = "Dear Hiring Manager,";
// > 40 chars and after line 0, so introIndex() picks it as the "intro" target.
const INTRO = "I am writing to apply for the Staff Engineer position at Acme, where I have deep platform experience.";
// Carries the /in my current role/i anchor, so the "current" placement
// resolves HERE -- a line distinct from INTRO.
const ROLE = "In my current role at Acme I lead a small platform team building telemetry.";
const SIGN = "Sincerely, Alex Shaw";

// A fact whose text is NOT a substring of any fixture line, so the only way it
// can appear in the letter is by insertion (never a reconstructing fixture).
const FACT = "Acme opened a Dublin telemetry lab this spring.";
const OTHER = "Acme also won a national sustainability award.";

function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}
const linesOf = (plan) => plan.cover.lines;
const textOf = (plan) => plan.cover.lines.join("\n");

// The exact shape `acceptFacts`/`autoInsertFactsForJob` pass as `coverRecord`:
// the PRIOR accepted facts reduced to `{id, text}` provenance. The bug is that
// the seam ignores it for dedupe even though the caller supplies it.
function priorRecord(...facts) {
  return facts.map((f) => ({ id: f.id, text: f.text }));
}

function entry(lines) {
  return { status: "done", coverLetterResultLines: [...lines] };
}

// ---------------------------------------------------------------------------
// Harness sanity -- if any of these is red, every verdict below is an
// instrument failure, not a product finding.
// ---------------------------------------------------------------------------

describe("N81 seam: harness sanity", () => {
  it("CANARY: count() counts non-overlapping occurrences", () => {
    expect(count("a b a b a", "a")).toBe(3);
    expect(count("nothing here", FACT)).toBe(0);
  });

  it("the fixture carries neither fact, and 'intro' and 'current' resolve to DISTINCT lines", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    for (const f of [FACT, OTHER]) expect(base.join("\n"), `fixture already contains: ${f}`).not.toContain(f);
    const atIntro = planAcceptForEntry(entry(base), { facts: [{ id: "x", text: FACT, placement: "intro" }] });
    const atCurrent = planAcceptForEntry(entry(base), { facts: [{ id: "y", text: OTHER, placement: "current" }] });
    const introIdx = atIntro.cover.edits[0].lineIndex;
    const currentIdx = atCurrent.cover.edits[0].lineIndex;
    expect(introIdx, "intro fact was not placed").toBeGreaterThanOrEqual(0);
    expect(currentIdx, "current fact was not placed").toBeGreaterThanOrEqual(0);
    expect(
      currentIdx,
      "'intro' and 'current' resolved to the SAME line -- this file cannot discriminate the defect",
    ).not.toBe(introIdx);
  });
});

// ---------------------------------------------------------------------------
// The class guard -- RED on HEAD.
// ---------------------------------------------------------------------------

describe("N81 seam: a re-accept of the same fact at a CHANGED placement does not duplicate it", () => {
  it("intro -> current, same id, yields the fact exactly ONCE in the letter text (RED on HEAD)", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    // Run 1: accept the fact at the default 'intro' placement.
    const run1 = planAcceptForEntry(entry(base), { facts: [{ id: "art-a", text: FACT, placement: "intro" }] });
    // Non-vacuity: the first accept really inserted the fact once.
    expect(count(textOf(run1), FACT), "the first accept did not insert the fact once -- test is vacuous").toBe(1);

    // Run 2: the SAME fact, re-accepted at a different placement ('current'),
    // against the post-run-1 lines, with the prior record the caller supplies.
    const run2 = planAcceptForEntry(entry(linesOf(run1)), {
      facts: [{ id: "art-a", text: FACT, placement: "current" }],
      coverRecord: priorRecord({ id: "art-a", text: FACT }),
    });

    // THE CRITERION: still exactly once. On HEAD this is 2 (the second copy
    // lands on the 'current' line, which the text-keyed M1 dedupe never checks).
    expect(count(textOf(run2), FACT), "the fact was duplicated on re-accept at a changed placement (N81)").toBe(1);
  });

  it("the deduped re-accept produces NO new edit and the fact stays on its ORIGINAL line", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    const run1 = planAcceptForEntry(entry(base), { facts: [{ id: "art-a", text: FACT, placement: "intro" }] });
    const firstLine = linesOf(run1).findIndex((l) => l.includes(FACT));
    expect(firstLine, "fact not located after run 1").toBeGreaterThanOrEqual(0);

    const run2 = planAcceptForEntry(entry(linesOf(run1)), {
      facts: [{ id: "art-a", text: FACT, placement: "current" }],
      coverRecord: priorRecord({ id: "art-a", text: FACT }),
    });

    // No second insertion means no edit and no line change.
    expect(run2.cover.edits.length, "a no-op re-accept still emitted an edit").toBe(0);
    expect(run2.cover.changed, "a no-op re-accept reported changed=true").toBe(false);
    expect(linesOf(run2)[firstLine], "the original line changed on a no-op re-accept").toBe(linesOf(run1)[firstLine]);
    // The 'current' line must NOT have gained a copy.
    const currentLine = base.findIndex((l) => /in my current role/i.test(l));
    expect(String(linesOf(run2)[currentLine]), "a duplicate landed on the current-role line").not.toContain(FACT);
  });

  it("the located record carries the fact ONCE, not twice, after the re-accept (highlight/removal stay sound)", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    const run1 = planAcceptForEntry(entry(base), { facts: [{ id: "art-a", text: FACT, placement: "intro" }] });
    const run2 = planAcceptForEntry(entry(linesOf(run1)), {
      facts: [{ id: "art-a", text: FACT, placement: "current" }],
      coverRecord: priorRecord({ id: "art-a", text: FACT }),
    });
    const forFact = run2.cover.record.filter((r) => r.text === FACT);
    // On HEAD the seam appends a SECOND located entry for art-a -> two records
    // pointing at two occurrences, one of which the removal UI can never fully
    // clear. After the fix there is exactly one.
    expect(forFact.length, "the fact is recorded twice after a re-accept (N81)").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Controls -- the guard must be ID-SCOPED, never a blanket "skip on re-accept"
// or "skip on placement change" (rule 8: distinguish from an over-firing fix).
// These are GREEN on HEAD and must STAY green after the fix.
// ---------------------------------------------------------------------------

describe("N81 seam: over-fire controls -- a legitimate insert is never suppressed", () => {
  it("a DIFFERENT fact (different id) accepted alongside a prior fact still lands", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    const run1 = planAcceptForEntry(entry(base), { facts: [{ id: "art-a", text: FACT, placement: "intro" }] });
    // art-b is NEW -- its id is not in the prior record, so it must insert even
    // though art-a's id is. A guard that skipped every fact once any prior
    // record existed would fail here.
    const run2 = planAcceptForEntry(entry(linesOf(run1)), {
      facts: [{ id: "art-b", text: OTHER, placement: "current" }],
      coverRecord: priorRecord({ id: "art-a", text: FACT }),
    });
    expect(count(textOf(run2), OTHER), "a new fact was wrongly suppressed by the id guard").toBe(1);
    expect(count(textOf(run2), FACT), "the prior fact was disturbed").toBe(1);
  });

  it("a fact whose id is NOT in the record inserts normally (first-accept path unchanged)", () => {
    const base = [GREETING, INTRO, ROLE, SIGN];
    const run = planAcceptForEntry(entry(base), {
      facts: [{ id: "fresh", text: FACT, placement: "current" }],
      coverRecord: priorRecord({ id: "someone-else", text: OTHER }),
    });
    expect(count(textOf(run), FACT), "a first-time fact was suppressed").toBe(1);
  });

  it("the SAME placement re-accept (existing M1 text dedupe) still dedupes -- not regressed", () => {
    // The pre-existing text-keyed dedupe must survive: re-accepting at the SAME
    // placement (so the text IS on the resolved line) still yields one copy.
    const base = [GREETING, INTRO, ROLE, SIGN];
    const run1 = planAcceptForEntry(entry(base), { facts: [{ id: "art-a", text: FACT, placement: "intro" }] });
    const run2 = planAcceptForEntry(entry(linesOf(run1)), {
      facts: [{ id: "art-a", text: FACT, placement: "intro" }],
      coverRecord: priorRecord({ id: "art-a", text: FACT }),
    });
    expect(count(textOf(run2), FACT), "same-placement re-accept duplicated the fact").toBe(1);
  });
});

// WHAT THIS FILE CANNOT CATCH. It exercises the pure seam only: it does not
// prove that either CALLER (manual dialog, auto effect) actually reaches the
// seam with these arguments -- that is the job of the two reachability files.
// It also cannot detect a WRONG value the guard might let through, only a
// duplicated one; and `planCoverFacts` is fed lines directly, so nothing here
// touches the docx bytes.
