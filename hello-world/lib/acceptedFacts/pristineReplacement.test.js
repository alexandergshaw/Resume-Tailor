// N35 / 4b -- PB2 from `chunks/N40/plan.check.r2.md`.
//
// WHAT THIS PINS. `planAcceptForEntry` must update `pristineCoverLines` by
// CONTENT-KEYED REPLACEMENT, not by the content UNION that plan r3 §7.3 and
// §2.6 specify. An accept does not append a line to the letter -- it splices
// text INSIDE an existing paragraph -- so a union leaves the PRE-accept text
// of that paragraph sitting in `pristine` forever, with nothing in the
// document to pair against. `lib/tailor/editRules.js#pairEdits` then pairs it
// with whatever the candidate types NEXT (greedy Jaccard, MIN_SIMILARITY =
// 0.45), and `deriveEditRules` distils a whole-line rewrite rule. That rule is
// POSTed by `useDocumentPreview.js#syncTemplateEdits` (:368) and, past
// EDIT_RULE_THRESHOLD = 3 (`lib/tailor/localSignals.js:288`), promoted into
// the SERVER-SIDE template library and applied to every future generation on
// every device. Silent, cross-device, permanent.
//
// WHY THE PLAN'S OWN TESTS CANNOT SEE IT. Plan r3 §11's T3 join leg asserts
// that `addedEditText` and `deriveEditRules` contain NONE OF THE FACT TEXT.
// The spurious rule contains no fact text -- it is 114 characters of the
// candidate's own resume prose. Both existing legs pass on the union. So this
// file asserts "NO RULE AT ALL", which is a different measurement.
//
// INSTRUMENT DISCRIMINATION. Every leg below that asserts an empty result
// carries its POSITIVE CONTROL in the same `it`: the union array, hand-built
// from plan r3 §7.3's own formula, run through the same real consumers. If the
// control does not produce exactly one rule, the assertion under it is
// measuring nothing and the test says so by failing on the control first.
// Executed against the real `editRules.js`/`editMining.js` before this file
// was written: union -> 1 rule, replacement -> 0 rules.
//
// These are the REAL consumers, imported from their shipping modules. Nothing
// here stubs `pairEdits`, `deriveEditRules` or `addedEditText`.

import { describe, it, expect, beforeAll } from "vitest";
import { deriveEditRules, pairEdits } from "@/lib/tailor/editRules.js";
import { addedEditText } from "@/lib/tailor/editMining.js";

// The module under test does not exist yet. A STATIC import of it would make
// this whole file fail to load, vitest would print "Tests  no tests", and the
// controls below -- the ones that prove the instrument can discriminate --
// would never run at all. A red that reports no tests is inconclusive, so the
// planner is loaded lazily and only the legs that need it go red.
let planner = null;
let plannerLoadError = null;
beforeAll(async () => {
  try {
    ({ planAcceptForEntry: planner } = await import("./factInsertion.js"));
  } catch (err) {
    plannerLoadError = err;
  }
});
function planAcceptForEntry(...args) {
  if (typeof planner !== "function") {
    throw new Error(
      `lib/acceptedFacts/factInsertion.js#planAcceptForEntry is not available: ${plannerLoadError?.message || "not exported"}`,
    );
  }
  return planner(...args);
}

// ---------------------------------------------------------------------------
// Fixture -- plan.check.r2 PB2's executed counter-example, verbatim.
//
// The fact carries placement "current", whose PLACEMENTS anchor is
// /in my current role/i with position "end" (lib/document/coverLetterWeave.js:15),
// so the planner appends it to the END of BODY_ROLE. That makes the modified
// line deterministic without this file reaching into the planner's internals.
// ---------------------------------------------------------------------------

const GREETING = "Dear Hiring Manager,";
const BODY_INTRO = "I am writing to apply for the Staff Engineer position at Acme.";
const BODY_ROLE =
  "In my current role at Mutual of Omaha, I lead an engineering team of five on web platform engineering initiatives.";
const BODY_CLOSE = "I would welcome the chance to discuss how my background fits your team.";
const SIGN_OFF = "Sincerely,";

const FACT_TEXT = "Acme opened a Dublin telemetry lab in 2026.";
const BODY_ROLE_ACCEPTED = `${BODY_ROLE} ${FACT_TEXT}`;

// The candidate's NEXT hand edit, after the accept: they reword their own
// sentence. Jaccard(pre-accept, this) is above 0.45 and Jaccard(post-accept,
// this) is below it -- which is exactly why the leftover pre-accept line in a
// union is dangerous and the post-accept line in a replacement is not.
const LATER_HAND_EDIT =
  "I lead an engineering team of eight across web platform initiatives at Mutual of Omaha.";

const GENERATED_LINES = [GREETING, BODY_INTRO, BODY_ROLE, BODY_CLOSE, SIGN_OFF];

function fact(over = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    text: FACT_TEXT,
    url: "https://acme.example.com/newsroom/dublin-lab",
    title: "Acme opens Dublin telemetry lab",
    source: "Acme Newsroom",
    placement: "current",
    textOrigin: "template",
    acceptedAt: "2026-09-23T00:00:00.000Z",
    ...over,
  };
}

// An entry as `useDocumentPreview#saveDocumentPreview` (:452-457) leaves it
// after the candidate's FIRST hand edit: the pristine snapshot exists and holds
// the pre-edit generated lines, `edited.cover` is true, and the current lines
// are whatever they have typed since.
function handEditedEntry(currentLines, pristine = GENERATED_LINES) {
  return {
    status: "done",
    coverLetterResultLines: currentLines,
    pristineCoverLines: pristine,
    coverLetterDocxB64: "",
    edited: { resume: false, cover: true },
  };
}

function planFor(entry, over = {}) {
  return planAcceptForEntry(entry, {
    facts: [fact()],
    coverRecord: [],
    emailRecord: [],
    previousFacts: [],
    ...over,
  });
}

// Plan r3 §7.3's union, hand-built here so the control is the PLAN's formula
// and not this file's paraphrase of it:
//   [...entry.pristineCoverLines, ...cover.lines.filter(l => normalised l is
//    absent from new Set(entry.pristineCoverLines.map(normalised)))]
function unionOf(pristine, coverLines) {
  const norm = (l) => String(l || "").replace(/\s+/g, " ").trim().toLowerCase();
  const have = new Set(pristine.map(norm));
  return [...pristine, ...coverLines.filter((l) => !have.has(norm(l)))];
}

// ---------------------------------------------------------------------------
// Harness sanity control (repo standing practice): a no-op that must be GREEN
// before any RED below is believed to be about the product.
// ---------------------------------------------------------------------------

describe("harness sanity control", () => {
  it("the real consumers are the real ones, and they still behave as measured", () => {
    // The whole file rests on these three being the shipping implementations.
    expect(typeof deriveEditRules).toBe("function");
    expect(typeof pairEdits).toBe("function");
    expect(typeof addedEditText).toBe("function");
    // And on the 0.45 pairing threshold still separating these two strings.
    expect(pairEdits([BODY_ROLE], [LATER_HAND_EDIT])).toHaveLength(1);
    expect(pairEdits([BODY_ROLE_ACCEPTED], [LATER_HAND_EDIT])).toHaveLength(0);
  });
});

describe("planAcceptForEntry replaces the accepted line in pristineCoverLines (PB2)", () => {
  it("derives NO rewrite rule from the candidate's next hand edit -- the union derives one", () => {
    const entry = handEditedEntry([...GENERATED_LINES]);
    const plan = planFor(entry);

    // The accept really did modify a line in place (not append one). If this
    // fails the rest of the case is meaningless, so it is asserted first.
    expect(plan.cover.edits.length).toBeGreaterThan(0);
    const modified = plan.cover.edits[0].lineIndex;
    expect(entry.coverLetterResultLines[modified]).toBe(BODY_ROLE);
    expect(plan.cover.lines[modified]).toBe(BODY_ROLE_ACCEPTED);

    // One later hand edit: the candidate rewords their own sentence.
    const later = [...plan.cover.lines];
    later[modified] = LATER_HAND_EDIT;

    // POSITIVE CONTROL, first: the union plan r3 §7.3 specifies DOES mine a
    // spurious whole-line rewrite rule out of this. If this control is not
    // exactly 1, the assertion below is not discriminating anything.
    const union = unionOf(entry.pristineCoverLines, plan.cover.lines);
    const unionRules = deriveEditRules(union, later);
    expect(unionRules).toHaveLength(1);
    expect(unionRules[0].before).toBe(BODY_ROLE);
    expect(unionRules[0].after).toBe(LATER_HAND_EDIT);

    // THE ASSERTION. Not "no fact text in the rule" (the plan's T3 leg, which
    // passes on the union because the spurious rule contains no fact text) but
    // NO RULE AT ALL.
    expect(deriveEditRules(plan.pristineCoverLines, later)).toEqual([]);
    expect(pairEdits(plan.pristineCoverLines, later)).toEqual([]);
  });

  it("does not leave the pre-accept text of the modified line in pristine", () => {
    const entry = handEditedEntry([...GENERATED_LINES]);
    const plan = planFor(entry);
    const modified = plan.cover.edits[0].lineIndex;

    // The replaced form: the post-accept text is present, the pre-accept text
    // of THAT line is gone. A union keeps both, which is what this kills.
    expect(plan.pristineCoverLines).toContain(BODY_ROLE_ACCEPTED);
    expect(plan.pristineCoverLines).not.toContain(BODY_ROLE);
    // Length is preserved: a replacement swaps, it never grows the array.
    expect(plan.pristineCoverLines).toHaveLength(entry.pristineCoverLines.length);
    // Every line the accept did NOT touch keeps its exact original text --
    // per element, not a length check (this is what kills an index transplant
    // on an array that happens to be the same length).
    entry.pristineCoverLines.forEach((line, i) => {
      if (line === BODY_ROLE) return;
      expect(plan.pristineCoverLines[i]).toBe(line);
    });
    expect(plan.pristineCoverLines[modified]).toBe(BODY_ROLE_ACCEPTED);
  });

  it("still closes the mining leg the union closed -- the fact itself is never mined", () => {
    // UNDER-FIRE CONTROL for the case above. A replacement that simply dropped
    // the line (rather than swapping it) would also satisfy "no rule", while
    // re-opening the leak §2.6 exists to close. So: the fact text must not
    // reach `addedEditText`, and must not reach `deriveEditRules`, when the
    // pristine array is diffed against the post-accept document.
    const entry = handEditedEntry([...GENERATED_LINES]);
    const plan = planFor(entry);

    expect(addedEditText(plan.pristineCoverLines, plan.cover.lines)).toBe("");
    expect(deriveEditRules(plan.pristineCoverLines, plan.cover.lines)).toEqual([]);

    // OVER-FIRE CONTROL: the fix must not blind the miner to prose the
    // candidate really did type. After a later genuine edit, that edit IS
    // reported as added text.
    const modified = plan.cover.edits[0].lineIndex;
    const later = [...plan.cover.lines];
    later[modified] = LATER_HAND_EDIT;
    expect(addedEditText(plan.pristineCoverLines, later)).toContain(LATER_HAND_EDIT);

    // And the no-fix baseline, so "" above is not vacuously true for an
    // implementation that returns an empty array: with pristine untouched the
    // fact IS mined today.
    expect(addedEditText(entry.pristineCoverLines, plan.cover.lines)).toContain(FACT_TEXT);
  });

  it("keys on CONTENT, never on index -- a pristine array of a different shape is untouched elsewhere", () => {
    // The candidate inserted a paragraph of their own at index 1 before
    // accepting, so `coverLetterResultLines` and `pristineCoverLines` no longer
    // share indices. An index transplant of `cover.edits` would rewrite the
    // WRONG pristine line. plan.check.r2's N1-idx mutant lives here.
    const typed = "I have followed Acme's platform work for two years.";
    const current = [GREETING, typed, BODY_INTRO, BODY_ROLE, BODY_CLOSE, SIGN_OFF];
    const entry = handEditedEntry(current, GENERATED_LINES);
    const plan = planFor(entry);

    const modified = plan.cover.edits[0].lineIndex;
    expect(current[modified]).toBe(BODY_ROLE); // index 3 in `current`
    // The same text sits at index 2 in `pristine`. Content keying must land
    // there and nowhere else.
    expect(plan.pristineCoverLines[2]).toBe(BODY_ROLE_ACCEPTED);
    expect(plan.pristineCoverLines[3]).toBe(BODY_CLOSE);
    expect(plan.pristineCoverLines).toEqual([
      GREETING,
      BODY_INTRO,
      BODY_ROLE_ACCEPTED,
      BODY_CLOSE,
      SIGN_OFF,
    ]);
    // The candidate's own typed line was never in pristine and must not be
    // added to it -- that is the snapshot's whole purpose.
    expect(plan.pristineCoverLines).not.toContain(typed);
  });

  it("returns undefined when no snapshot exists, and never invents one", () => {
    const entry = {
      status: "done",
      coverLetterResultLines: [...GENERATED_LINES],
      coverLetterDocxB64: "",
    };
    expect(entry.pristineCoverLines).toBeUndefined();
    const plan = planFor(entry);
    expect(plan.pristineCoverLines).toBeUndefined();
    // Control: the accept still happened. A planner that returned `undefined`
    // for everything would pass the line above and nothing else.
    expect(plan.cover.edits.length).toBeGreaterThan(0);
    expect(plan.cover.lines.join("\n")).toContain(FACT_TEXT);
  });
});

describe("the normalisation the replacement keys on is named, and agrees with BOTH consumers (PB2 tail)", () => {
  // plan.check.r2: plan r3 §7.3 says "whose NORMALISED form" without saying
  // which normalisation, and the two consumers do not agree on one.
  //   editMining.js#normalizeLine  (:8-14) strips a leading [\s|bullet|dash]+
  //                                 run, collapses whitespace, lowercases.
  //   editRules.js#norm            (:15-17) collapses whitespace and trims;
  //                                 set membership then lowercases.
  // Executed: for two lines differing only by a leading "- ", `addedEditText`
  // calls them the SAME line while `pairEdits` calls it a modification and
  // `deriveEditRules` distils {before: "- Led the", after: "Led the"}.
  //
  // CONTRACT PINNED HERE: the replacement matches a pristine line when it
  // equals the pre-accept text under EITHER consumer's normalisation, so
  // neither consumer can be left holding a stale line. A single-normalisation
  // implementation fails exactly one of the two cases below.
  it("the consumers really do disagree -- the reason this leg exists", () => {
    const bulleted = ["- Led the platform team through a migration to a new build system."];
    const plain = ["Led the platform team through a migration to a new build system."];
    expect(addedEditText(bulleted, plain)).toBe("");
    expect(deriveEditRules(bulleted, plain)).toHaveLength(1);
  });

  it("replaces a pristine line that differs from the letter only by a leading bullet", () => {
    const bulletRole = `- ${BODY_ROLE}`;
    const entry = handEditedEntry([...GENERATED_LINES], [
      GREETING,
      BODY_INTRO,
      bulletRole,
      BODY_CLOSE,
      SIGN_OFF,
    ]);
    const plan = planFor(entry);

    expect(plan.pristineCoverLines).not.toContain(bulletRole);
    expect(plan.pristineCoverLines).toContain(BODY_ROLE_ACCEPTED);

    // And the harm is closed: with the bullet line left in place, a later hand
    // edit mines a rule. POSITIVE CONTROL first.
    const modified = plan.cover.edits[0].lineIndex;
    const later = [...plan.cover.lines];
    later[modified] = LATER_HAND_EDIT;
    expect(deriveEditRules(entry.pristineCoverLines, later)).toHaveLength(1);
    expect(deriveEditRules(plan.pristineCoverLines, later)).toEqual([]);
  });

  it("replaces a pristine line that differs only by collapsed whitespace", () => {
    const spacedRole = BODY_ROLE.replace(" I lead ", "  I   lead  ");
    expect(spacedRole).not.toBe(BODY_ROLE);
    const entry = handEditedEntry([...GENERATED_LINES], [
      GREETING,
      BODY_INTRO,
      spacedRole,
      BODY_CLOSE,
      SIGN_OFF,
    ]);
    const plan = planFor(entry);
    expect(plan.pristineCoverLines).not.toContain(spacedRole);
    expect(plan.pristineCoverLines).toContain(BODY_ROLE_ACCEPTED);
  });

  it("appends, rather than dropping, when no pristine line matches the accepted one", () => {
    // The candidate reworded the paragraph beyond recognition before
    // accepting. There is nothing to replace, and the post-accept text must
    // still enter pristine or the fact becomes mineable -- the one case where
    // "append" is correct, stated so it is a decision and not an accident.
    const rewritten = "Leading a platform team is the centre of my current work at Mutual of Omaha.";
    const current = [GREETING, BODY_INTRO, `${rewritten} In my current role I ship weekly.`, BODY_CLOSE, SIGN_OFF];
    const entry = handEditedEntry(current, GENERATED_LINES);
    const plan = planFor(entry);
    const modified = plan.cover.edits[0].lineIndex;
    const accepted = plan.cover.lines[modified];

    expect(plan.pristineCoverLines).toContain(accepted);
    expect(plan.pristineCoverLines.length).toBe(entry.pristineCoverLines.length + 1);
    // The original snapshot survives intact underneath it.
    entry.pristineCoverLines.forEach((line, i) => {
      expect(plan.pristineCoverLines[i]).toBe(line);
    });
    // The fact is still not mineable.
    expect(addedEditText(plan.pristineCoverLines, plan.cover.lines)).not.toContain(FACT_TEXT);
  });
});

// WHAT THIS FILE CANNOT CATCH, stated so the next reader does not over-trust
// it. It measures `planAcceptForEntry`'s RETURN VALUE only. That the hook
// actually WRITES `plan.pristineCoverLines` onto the entry, and that
// `closeResumePreview` then mines from the written array, is a different
// question and belongs with the hook's own accept test (plan r3 §11 T12's
// hand-edit-then-accept case). A planner that returned a perfect array which
// nobody stored would pass every assertion above.
