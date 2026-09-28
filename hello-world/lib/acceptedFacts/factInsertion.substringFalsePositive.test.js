// N81 CLOSING ROUND, BUG 1 (fresh-verifier NOT-SHIP on 5e96be2) -- THE SHARED
// SEAM's presence check must consult the RECORDED fact's text, not the
// INCOMING (possibly edited) text.
//
// THE BUG. 5e96be2 changed the id-only skip in `planCoverFacts`
// (factInsertion.js:134) to
//   if (fact.id != null && recordIds.has(fact.id) && priorText.includes(text)) continue;
// where `text = normalizeFactText(fact.text)` -- the INCOMING fact text, which
// the candidate can edit in the dialog's suggestion box with NO length floor
// (factStore.sanitizeFact caps at 600 chars, no minimum). `priorText` is the
// whole letter joined. So a candidate who accepts an article, then edits its
// suggestion down to a short fragment that happens to occur ANYWHERE in the
// letter (its own prose, a company name, another fact), and re-accepts the same
// article, is silently suppressed with "already present" -- though that short
// fragment was never itself inserted, and the article's RECORDED text may be
// long gone from the version on screen.
//
// THE FIX DIRECTION THIS FILE PINS (from the round brief -- the implementer may
// NOT substitute a weaker one). The presence check must consult the RECORDED
// fact's text -- the `.text` stored in `record` for this `fact.id`, i.e. what
// was actually inserted -- NOT the incoming, possibly-edited `text`. Suppress
// only when the recorded fact's own text is still present in the letter.
//   * FAILS if the guard compares the INCOMING text (HEAD / the buggy build);
//   * PASSES when it compares the RECORDED text (the fix).
// This preserves the version-switch healing (a regenerated letter lacking the
// recorded text re-inserts) AND keeps the id+presence PAIRING that a36d6ae/N81
// established (a genuine duplicate stays deduped; a new-id text-coincidence
// still inserts) -- both controls below must stay green through the fix.
//
// node env (pure planner, no DOM) -- mirrors factInsertion.versionSwitchReaccept.test.js.

import { describe, it, expect } from "vitest";
import { planAcceptForEntry } from "./factInsertion.js";

const GREETING = "Dear Hiring Manager,";
// > 40 chars, after line 0 -> introIndex() picks it as the 'intro' target. Its
// own prose already contains the short phrase "join the team" -- unrelated to
// any fact, the kind of coincidental collision the bug turns into a suppression.
const INTRO = "I am writing to apply for the Staff Engineer role at Acme, where I hope to join the team and contribute.";
// Carries the /in my current role/i anchor -> 'current' resolves HERE, a line
// distinct from INTRO, and does NOT contain "join the team".
const ROLE = "In my current role I lead a small platform group building telemetry.";
const SIGN = "Sincerely, Alex Shaw";

// The RECORDED fact text -- what was actually inserted on a PRIOR cover-letter
// VERSION. Absent from the version-2 lines below (a regenerated letter): the
// exact state selectDocumentVersion leaves -- the id lives on in the store, the
// text does not.
const RECORDED = "Acme opened a brand-new Dublin telemetry lab this spring.";
// The SHORT, generic phrase the candidate edits the suggestion box down to. It
// occurs in the letter's own UNRELATED prose (the intro line) and NOT on the
// 'current' target line. It was never itself inserted as a fact.
const EDITED_SHORT = "join the team";

function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}
const textOf = (plan) => plan.cover.lines.join("\n");
const linesOf = (plan) => plan.cover.lines;
function entry(lines) {
  return { status: "done", coverLetterResultLines: [...lines] };
}
// The exact shape acceptFacts/autoInsertFactsForJob pass as `coverRecord`: prior
// accepted facts reduced to {id, text} provenance (useCompanyResearch.js:432).
function priorRecord(...facts) {
  return facts.map((f) => ({ id: f.id, text: f.text }));
}

// ---------------------------------------------------------------------------
// Harness sanity -- if any of these is red, every verdict below is an
// instrument failure, not a product finding.
// ---------------------------------------------------------------------------

describe("N81 substring FP: harness sanity", () => {
  it("CANARY: count() counts non-overlapping occurrences", () => {
    expect(count("a b a b a", "a")).toBe(3);
    expect(count("nothing here", EDITED_SHORT)).toBe(0);
  });

  it("the version-2 fixture lacks the RECORDED text, carries the short fragment in intro prose, and NOT on the current-role line", () => {
    const v2 = [GREETING, INTRO, ROLE, SIGN];
    expect(v2.join("\n"), "fixture already contains the recorded fact").not.toContain(RECORDED);
    expect(v2[1], "the short fragment is not in the intro prose -- HEAD's incoming-text guard would not engage").toContain(EDITED_SHORT);
    expect(v2[2], "the short fragment is on the current-role line -- M1 would independently skip and mask the guard").not.toContain(EDITED_SHORT);
    const currentIdx = v2.findIndex((l) => /in my current role/i.test(l));
    expect(currentIdx, "no current-role line").toBeGreaterThanOrEqual(0);
    expect(currentIdx, "'current' coincides with the greeting line").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE BUG -- RED on HEAD. Discriminates compare-INCOMING (HEAD) from
// compare-RECORDED (the fix): the two disagree ONLY when the recorded text is
// absent while the incoming edited text coincidentally is present.
// ---------------------------------------------------------------------------

describe("N81 substring FP: an edited short fragment that only collides with unrelated prose is inserted, not suppressed", () => {
  it("id in record, RECORDED text absent from the letter, incoming edited to a fragment present only in unrelated prose -> the fact is inserted (RED on HEAD)", () => {
    // Version 2: a regenerated letter that does NOT contain the recorded fact.
    const v2 = [GREETING, INTRO, ROLE, SIGN];
    // The job-level accepted-facts log still carries the article's id AND its
    // ORIGINAL long text from the prior version -- exactly what a cover-version
    // switch leaves untouched. This is the guard's `coverRecord`.
    const record = priorRecord({ id: "art-a", text: RECORDED });

    // Non-vacuity: prove the guard's inputs are the ones under test, so the RED
    // is caused by comparing the WRONG string, not by a trivial fixture flaw.
    expect(record.some((r) => r.id === "art-a" && r.text === RECORDED), "fixture flaw: the recorded fact is not in the record").toBe(true);
    expect(v2.join("\n"), "fixture flaw: version 2 already contains the recorded text").not.toContain(RECORDED);
    expect(v2.join("\n"), "fixture flaw: the incoming edited fragment is absent, so HEAD would insert for the trivial reason").toContain(EDITED_SHORT);

    const run = planAcceptForEntry(entry(v2), {
      // The candidate re-accepts article art-a, but has edited the suggestion
      // box down to the short fragment. Placement 'current' -- a line that does
      // NOT already contain the fragment.
      facts: [{ id: "art-a", text: EDITED_SHORT, placement: "current" }],
      coverRecord: record,
    });

    // THE CRITERION. HEAD compares the INCOMING text: "join the team" is a
    // substring of the intro prose, so with the id in `record` it suppresses --
    // 0 edits. The fix compares the RECORDED text, which is absent, so it
    // inserts. RED on HEAD, green after the fix.
    expect(
      run.cover.edits.length,
      "the guard compared the INCOMING edited text against the whole letter and suppressed a fact whose RECORDED text is absent (N81 Bug 1)",
    ).toBeGreaterThan(0);
    const currentIdx = v2.findIndex((l) => /in my current role/i.test(l));
    expect(String(linesOf(run)[currentIdx]), "the re-accepted fragment did not land on the current-role line").toContain(EDITED_SHORT);
  });
});

// ---------------------------------------------------------------------------
// CONTROLS -- GREEN on HEAD and after the fix. They pin that the fix does NOT
// over-fire (become "always insert") and does NOT under-fire (revert to a
// text-only dedupe). If a "fix" trips either, that leg goes red.
// ---------------------------------------------------------------------------

describe("N81 substring FP: the id+presence pairing survives the fix", () => {
  it("CONTROL (no over-fire): a re-accept whose RECORDED text is still present is suppressed -- a genuine duplicate stays deduped", () => {
    // The recorded fact sits verbatim on the intro line (still present). The
    // SAME article is re-accepted, unedited, at a CHANGED placement ('current').
    // A genuine duplicate: must stay suppressed under both compare-incoming and
    // compare-recorded, or the fix has become "always insert".
    const introWithFact = `I am applying for the Staff Engineer role, and I already knew ${RECORDED} so the mission resonates.`;
    const base = [GREETING, introWithFact, ROLE, SIGN];
    const run = planAcceptForEntry(entry(base), {
      facts: [{ id: "art-a", text: RECORDED, placement: "current" }],
      coverRecord: priorRecord({ id: "art-a", text: RECORDED }),
    });
    expect(run.cover.edits.length, "a genuine duplicate re-accept emitted an edit").toBe(0);
    expect(count(textOf(run), RECORDED), "the fact was duplicated across a placement change").toBe(1);
  });

  it("CONTROL (no under-fire): a NEW-id fact whose text coincides with existing prose is still inserted -- the guard stays id-scoped", () => {
    // "join the team" sits in the intro prose. A DIFFERENT article -- 'fresh',
    // absent from the record -- carries that same phrase and is accepted at
    // 'current'. Id-scoping means this must insert; a text-only dedupe would
    // wrongly suppress it.
    const base = [GREETING, INTRO, ROLE, SIGN];
    const currentIdx = base.findIndex((l) => /in my current role/i.test(l));
    const run = planAcceptForEntry(entry(base), {
      facts: [{ id: "fresh", text: EDITED_SHORT, placement: "current" }],
      coverRecord: priorRecord({ id: "art-a", text: RECORDED }),
    });
    expect(run.cover.edits.length, "a new-id fact was suppressed because its text matched unrelated prose (text-only dedupe)").toBeGreaterThan(0);
    expect(String(linesOf(run)[currentIdx]), "the new fact did not land on the current-role line").toContain(EDITED_SHORT);
  });
});

// WHAT THIS FILE CANNOT CATCH. It exercises the pure planner only; the real
// mounted-dialog reachability of this edited-suggestion re-accept is driven by
// acceptFactSubstringFalsePositive.rc.test.js. It cannot detect a WRONG value
// the guard might let through, only a suppressed/inserted one, and it touches no
// docx bytes.
