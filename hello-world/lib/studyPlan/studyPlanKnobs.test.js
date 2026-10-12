// N157 SC-D wave D-a (step 4b TDD) -- the PURE customization model.
//
// Binds to docs/loop/N157.SC-D.design.r1.md section 4 (the oracle, rows 1-20
// and the idempotence/exclusivity property) and section 3, and to the SHIPPED
// lib/studyPlan/studyPlanSchema.js (DEFAULT_KNOBS + normalizeKnobs + the knobs
// SHAPE). The model MUST produce knobs of EXACTLY that shape; this suite
// imports the REAL normalizeKnobs and JOINs through it, never a hand fixture.
//
// RED ON HEAD, and WHY: lib/studyPlan/studyPlanKnobs.js does not exist yet, so
// the dynamic import in beforeAll throws "cannot find module" and every `it`
// reds the first time it touches `mod.*` -- the honest greenfield red
// (vi.mock cannot substitute an unresolvable specifier, so a dynamic import in
// beforeAll is the idiom that still collects and gives per-`it` reds). The
// schema, GRADE, itemKey and DIGEST_SECTIONS imports are the SHIPPED modules,
// imported statically because they already resolve.
//
// SETTLED ORCHESTRATOR RULINGS ENCODED HERE (not re-opened):
//   * weakTopicIds carries AREA-LABEL free text, never topic ids (PD-SD-1).
//   * the time knob is DAYS-UNTIL only (no hours-per-day).
//   * preset values and the caps are RETUNABLE CONSTANTS exported from the
//     model; every cap/preset assertion pins the CONSTANT, never a magic
//     literal, so the owner can retune without editing a test.
//
// THE THREE NON-ZERO-POWER CANARIES this suite carries (each named in the
// brief), with the mutant each reds:
//   * CAP canary: a build that drops a cap (daysUntil > MAX, > MAX_AREA_OPTIONS
//     rows, a label past MAX_AREA_LABEL) reds the cap rows below.
//   * LABELS-NOT-IDS canary: a build that writes topic.id instead of the area
//     label reds areaOf / suggestFocusAreas.
//   * SCHEMA-JOIN canary: a build that emits a shape the schema normalizer
//     would rewrite (an extra pace.hoursPerDay, an unclamped ratio) reds the
//     idempotence JOIN `normalizeKnobs(out)` deep-equals `out`.

import { describe, it, expect, beforeAll } from "vitest";
import { normalizeKnobs, DEFAULT_KNOBS, itemKey } from "@/lib/studyPlan/studyPlanSchema.js";
import { GRADE } from "@/lib/studyPlan/studyWalkthroughModel.js";
import { DIGEST_SECTIONS } from "@/lib/tracking/applicationDigest.js";

let mod = null;

beforeAll(async () => {
  mod = await import("@/lib/studyPlan/studyPlanKnobs.js");
});

// A fresh defaults object every call, from the REAL normalizer.
const base = () => normalizeKnobs(null);
// The exact top-level key set the schema shape pins. Sorted for comparison.
const SHAPE_KEYS = ["newReviewRatio", "pace", "topicScope", "weakTopicIds"].sort();
const keysOf = (o) => Object.keys(o).sort();
const lower = (a) => a.map((s) => s.toLowerCase());

// A knob object shaped by UI selections, built through the REAL normalizer so
// the fixture itself never asserts a shape the schema would reject.
function knobsWith({ ratio = 0.5, weak = [], excluded = [], days = 7 } = {}) {
  return normalizeKnobs({
    newReviewRatio: ratio,
    weakTopicIds: weak,
    pace: { daysUntil: days },
    topicScope: { excludedAreas: excluded },
  });
}

// --- constants: exist, sane relationships, retunable --------------------

describe("exported constants (retunable; tests pin the CONSTANT, not a literal)", () => {
  it("MIN/MAX_PLAN_DAYS are integers with MIN=1 < MAX", () => {
    expect(Number.isInteger(mod.MIN_PLAN_DAYS)).toBe(true);
    expect(Number.isInteger(mod.MAX_PLAN_DAYS)).toBe(true);
    expect(mod.MIN_PLAN_DAYS).toBe(1);
    expect(mod.MAX_PLAN_DAYS).toBeGreaterThan(mod.MIN_PLAN_DAYS);
  });

  it("MAX_AREA_OPTIONS and MAX_AREA_LABEL are positive integers", () => {
    expect(Number.isInteger(mod.MAX_AREA_OPTIONS)).toBe(true);
    expect(mod.MAX_AREA_OPTIONS).toBeGreaterThan(0);
    expect(Number.isInteger(mod.MAX_AREA_LABEL)).toBe(true);
    expect(mod.MAX_AREA_LABEL).toBeGreaterThan(0);
  });

  it("RATIO_PRESETS = three distinct, valid presets with stable ids", () => {
    expect(Array.isArray(mod.RATIO_PRESETS)).toBe(true);
    expect(mod.RATIO_PRESETS).toHaveLength(3);
    const ids = mod.RATIO_PRESETS.map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set(["mostly-new", "even", "mostly-review"]));
    const values = mod.RATIO_PRESETS.map((p) => p.value);
    // distinct, each a valid ratio the schema keeps unchanged (so a preset
    // always round-trips through normalizeKnobs).
    expect(new Set(values).size).toBe(3);
    for (const v of values) {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("AREA_STATE enumerates include / focus / skip", () => {
    expect(mod.AREA_STATE).toEqual({ INCLUDE: "include", FOCUS: "focus", SKIP: "skip" });
  });
});

// --- areaOf: label, trimmed, sliced, NEVER the id ------------------------

describe("areaOf (oracle rows 1-2; labels-not-ids canary)", () => {
  it("prefers a trimmed area, falls back to the trimmed title, else empty", () => {
    expect(mod.areaOf({ area: " Behavioral ", title: "X" })).toBe("Behavioral");
    expect(mod.areaOf({ title: "T" })).toBe("T");
    expect(mod.areaOf({})).toBe("");
  });

  it("returns the LABEL, never the content-derived id (labels-not-ids)", () => {
    const out = mod.areaOf({ id: "t_9xhash", area: "Interview process", title: "X" });
    expect(out).toBe("Interview process");
    expect(out).not.toBe("t_9xhash");
  });

  it("slices an over-long area to MAX_AREA_LABEL (cap canary)", () => {
    const out = mod.areaOf({ area: "x".repeat(200) });
    expect(out).toHaveLength(mod.MAX_AREA_LABEL);
  });
});

// --- areaOptions: plan areas UNION selected, seed pre-plan, capped --------

describe("areaOptions (oracle rows 3-6; section 3.8)", () => {
  const planWithAreas = (areas) => ({
    modules: [{ id: "m1", topics: areas.map((a, i) => ({ id: `t${i}`, area: a, items: [] })) }],
  });

  it("de-duplicates plan areas case-insensitively, keeping first casing (row 3)", () => {
    const options = mod.areaOptions({
      plan: planWithAreas(["Culture", "culture", "Risks"]),
      knobs: base(),
      seedAreas: DIGEST_SECTIONS,
    });
    expect(options).toEqual(["Culture", "Risks"]);
  });

  it("keeps a selected area that is absent from the plan, so it stays toggleable (row 4, F6)", () => {
    const options = mod.areaOptions({
      plan: planWithAreas(["What the company does"]),
      knobs: knobsWith({ excluded: ["Size and stage"] }),
      seedAreas: DIGEST_SECTIONS,
    });
    expect(options).toContain("What the company does");
    expect(options).toContain("Size and stage");
  });

  it("pre-first-plan (no plan) returns the seed areas in fixed order (row 5)", () => {
    const options = mod.areaOptions({ plan: null, knobs: base(), seedAreas: DIGEST_SECTIONS });
    expect(options).toEqual(DIGEST_SECTIONS);
  });

  it("caps plan areas at MAX_AREA_OPTIONS in first-seen order (cap canary)", () => {
    const areas = Array.from({ length: 40 }, (_, i) => `A${i}`);
    const options = mod.areaOptions({ plan: planWithAreas(areas), knobs: base(), seedAreas: DIGEST_SECTIONS });
    expect(options).toHaveLength(mod.MAX_AREA_OPTIONS);
    expect(options).toEqual(areas.slice(0, mod.MAX_AREA_OPTIONS));
  });

  it("never drops a selected label even past the cap (row 6)", () => {
    const areas = Array.from({ length: 40 }, (_, i) => `A${i}`);
    const picked = `A${mod.MAX_AREA_OPTIONS + 6}`; // beyond the cap window
    const options = mod.areaOptions({
      plan: planWithAreas(areas),
      knobs: knobsWith({ weak: [picked] }),
      seedAreas: DIGEST_SECTIONS,
    });
    expect(options).toContain(picked);
    expect(options).toHaveLength(mod.MAX_AREA_OPTIONS + 1);
    expect(options).not.toContain(`A${mod.MAX_AREA_OPTIONS}`); // a non-selected cut area is gone
  });
});

// --- areaState + setAreaState: one state per area, skip wins, guard -------

describe("areaState / setAreaState (oracle rows 7-11; exclusivity)", () => {
  const S = () => mod.AREA_STATE;
  const twoOpts = ["Interview process", "Watch-outs"];

  it("skip moves an area out of weak and into excluded (row 7)", () => {
    const start = knobsWith({ weak: ["Interview process"] });
    const { knobs, ok } = mod.setAreaState(start, "Interview process", S().SKIP, twoOpts);
    expect(ok).toBe(true);
    expect(knobs.weakTopicIds).not.toContain("Interview process");
    expect(knobs.topicScope.excludedAreas).toContain("Interview process");
  });

  it("focus moves an area out of excluded and into weak (row 8)", () => {
    const start = knobsWith({ excluded: ["Size and stage"] });
    const { knobs, ok } = mod.setAreaState(start, "Size and stage", S().FOCUS, ["Size and stage", "Other"]);
    expect(ok).toBe(true);
    expect(knobs.topicScope.excludedAreas).not.toContain("Size and stage");
    expect(knobs.weakTopicIds).toContain("Size and stage");
  });

  it("include leaves an area in neither list, and is idempotent (row 9)", () => {
    const start = knobsWith({ weak: ["Culture"] });
    const once = mod.setAreaState(start, "Culture", S().INCLUDE, ["Culture", "Other"]);
    expect(once.ok).toBe(true);
    expect(once.knobs.weakTopicIds).not.toContain("Culture");
    expect(once.knobs.topicScope.excludedAreas).not.toContain("Culture");
    const twice = mod.setAreaState(once.knobs, "Culture", S().INCLUDE, ["Culture", "Other"]);
    expect(twice.knobs).toEqual(once.knobs);
  });

  it("refuses to skip the last non-skipped option; knobs unchanged (row 10, F7)", () => {
    const start = knobsWith({ excluded: ["Interview process"] }); // only Watch-outs left included
    const before = normalizeKnobs(start);
    const { knobs, ok } = mod.setAreaState(start, "Watch-outs", S().SKIP, twoOpts);
    expect(ok).toBe(false);
    expect(knobs).toEqual(before);
  });

  it("areaState reports skip when a foreign write put an area in BOTH lists (row 11)", () => {
    const start = knobsWith({ weak: ["Overlap"], excluded: ["Overlap"] });
    expect(mod.areaState(start, "Overlap")).toBe(S().SKIP);
  });

  it("areaState compares case-insensitively", () => {
    const start = knobsWith({ weak: ["Culture"] });
    expect(mod.areaState(start, "culture")).toBe(S().FOCUS);
    expect(mod.areaState(start, "Risks")).toBe(S().INCLUDE);
  });
});

// --- new/review ratio ----------------------------------------------------

describe("setNewReviewRatio / ratioPresetId (oracle row 14)", () => {
  it("each preset value round-trips to its own id", () => {
    for (const preset of mod.RATIO_PRESETS) {
      const knobs = mod.setNewReviewRatio(base(), preset.value);
      expect(knobs.newReviewRatio).toBe(preset.value);
      expect(mod.ratioPresetId(knobs)).toBe(preset.id);
    }
  });

  it("an off-preset ratio matches no preset (exact equality only)", () => {
    const presetValues = new Set(mod.RATIO_PRESETS.map((p) => p.value));
    const off = 0.6;
    // canary: 0.6 really is off-preset for the current tune; if the owner
    // retunes a preset onto it this fails LOUD rather than lying.
    expect(presetValues.has(off)).toBe(false);
    expect(mod.ratioPresetId(knobsWith({ ratio: off }))).toBe(null);
  });
});

// --- days until ----------------------------------------------------------

describe("setDaysUntil (oracle rows 12-13; F9 + cap canary)", () => {
  it("commits a whole number, trimming spaces and leading zeros (row 12)", () => {
    expect(mod.setDaysUntil(base(), "10")).toMatchObject({ ok: true });
    expect(mod.setDaysUntil(base(), "10").knobs.pace.daysUntil).toBe(10);
    expect(mod.setDaysUntil(base(), " 7 ").knobs.pace.daysUntil).toBe(7);
    expect(mod.setDaysUntil(base(), "007").knobs.pace.daysUntil).toBe(7);
  });

  it("commits the MAX but refuses MAX+1 (cap canary, pinned to the CONSTANT)", () => {
    const atMax = mod.setDaysUntil(base(), String(mod.MAX_PLAN_DAYS));
    expect(atMax.ok).toBe(true);
    expect(atMax.knobs.pace.daysUntil).toBe(mod.MAX_PLAN_DAYS);

    const overMax = mod.setDaysUntil(base(), String(mod.MAX_PLAN_DAYS + 1));
    expect(overMax.ok).toBe(false);
    expect(overMax.knobs.pace.daysUntil).toBe(base().pace.daysUntil);
  });

  it.each([["" ], ["0"], ["-3"], ["1.5"], ["abc"], [null], [NaN]])(
    "refuses %s and leaves the knobs unchanged (row 13; the normalizer never sees garbage)",
    (raw) => {
      const start = knobsWith({ days: 7 });
      const before = normalizeKnobs(start);
      const { knobs, ok } = mod.setDaysUntil(start, raw);
      expect(ok).toBe(false);
      expect(knobs).toEqual(before);
    },
  );
});

// --- knobsEqual ----------------------------------------------------------

describe("knobsEqual (oracle row 15)", () => {
  it("is order-insensitive on the arrays and case-insensitive on labels", () => {
    const a = knobsWith({ ratio: 0.5, weak: ["Alpha", "Beta"], excluded: ["Gamma"] });
    const b = knobsWith({ ratio: 0.5, weak: ["beta", "alpha"], excluded: ["gamma"] });
    expect(mod.knobsEqual(a, b)).toBe(true);
  });

  it("a different ratio is not equal", () => {
    const a = knobsWith({ ratio: 0.5, weak: ["Alpha"] });
    const c = knobsWith({ ratio: 0.75, weak: ["Alpha"] });
    expect(mod.knobsEqual(a, c)).toBe(false);
  });
});

// --- isBuildableKnobs ----------------------------------------------------

describe("isBuildableKnobs (oracle row 16)", () => {
  const opts = ["A", "B"];
  it("false when every option is skipped", () => {
    expect(mod.isBuildableKnobs(knobsWith({ excluded: ["A", "B"] }), opts)).toBe(false);
  });
  it("true when at least one option is included", () => {
    expect(mod.isBuildableKnobs(knobsWith({ excluded: ["A"] }), opts)).toBe(true);
  });
  it("true when the option list is empty (nothing to skip)", () => {
    expect(mod.isBuildableKnobs(base(), [])).toBe(true);
  });
});

// --- suggestFocusAreas: graded-again cards, orphans ignored --------------

describe("suggestFocusAreas (oracle rows 17-18; labels-not-ids + orphan canary)", () => {
  // Items with DISTINCT content so itemKey (the REAL key function) never
  // collides. seen is keyed by that key -- the independent derivation, not
  // suggestFocusAreas' own output.
  const a1 = { topicHint: "ip", text: "Walk me through your process" };
  const a2 = { topicHint: "ip", text: "A hard interview question" };
  const b1 = { topicHint: "wo", text: "A watch-out to raise" };
  const c1 = { topicHint: "cu", text: "A culture question" };
  const c2 = { topicHint: "cu", text: "A second culture question" };

  const plan = {
    modules: [
      { id: "m1", topics: [{ id: "tA", area: "Interview process", items: [a1, a2] }] },
      { id: "m2", topics: [{ id: "tB", area: "Watch-outs", items: [b1] }] },
      { id: "m3", topics: [{ id: "tC", area: "Culture", items: [c1, c2] }] },
    ],
  };
  const seen = {
    [itemKey(a1)]: { grade: GRADE.AGAIN, revealedAt: "2026-01-01T00:00:00Z" },
    [itemKey(a2)]: { grade: GRADE.AGAIN, revealedAt: "2026-01-01T00:00:00Z" },
    [itemKey(b1)]: { grade: GRADE.AGAIN, revealedAt: "2026-01-01T00:00:00Z" },
    [itemKey(c1)]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00Z" },
    [itemKey(c2)]: { revealedAt: "2026-01-01T00:00:00Z" }, // revealed, not graded
    orphan_not_a_card: { grade: GRADE.AGAIN, revealedAt: "2026-01-01T00:00:00Z" },
  };

  it("counts only current-plan cards graded AGAIN, grouped by AREA LABEL, sorted desc", () => {
    expect(mod.suggestFocusAreas({ plan, seen })).toEqual([
      { area: "Interview process", missed: 2 },
      { area: "Watch-outs", missed: 1 },
    ]);
  });

  it("breaks a tie in plan order", () => {
    const tiePlan = {
      modules: [
        { id: "m1", topics: [{ id: "tX", area: "Alpha", items: [a1] }] },
        { id: "m2", topics: [{ id: "tY", area: "Beta", items: [b1] }] },
      ],
    };
    const tieSeen = {
      [itemKey(a1)]: { grade: GRADE.AGAIN, revealedAt: "t" },
      [itemKey(b1)]: { grade: GRADE.AGAIN, revealedAt: "t" },
    };
    expect(mod.suggestFocusAreas({ plan: tiePlan, seen: tieSeen })).toEqual([
      { area: "Alpha", missed: 1 },
      { area: "Beta", missed: 1 },
    ]);
  });

  it("no plan or no grades yields no suggestion (row 18; REMOVAL case)", () => {
    expect(mod.suggestFocusAreas({ plan: null, seen: {} })).toEqual([]);
    expect(mod.suggestFocusAreas({ plan, seen: {} })).toEqual([]);
  });
});

// --- knobEffects: per-engine honesty -------------------------------------

describe("knobEffects (oracle row 19; the honesty table F3)", () => {
  it("embedded honours the ratio and skipped areas only", () => {
    expect(mod.knobEffects("embedded")).toEqual({
      newReviewRatio: true,
      weakAreas: false,
      pace: false,
      topicScope: true,
    });
  });

  it("every non-embedded engine reads as Gemini (all four honoured)", () => {
    const all = { newReviewRatio: true, weakAreas: true, pace: true, topicScope: true };
    expect(mod.knobEffects("gemini")).toEqual(all);
    expect(mod.knobEffects("external")).toEqual(all);
    expect(mod.knobEffects(undefined)).toEqual(all);
  });
});

// --- summarizeKnobs: the closed-panel one-liner --------------------------

describe("summarizeKnobs (section 0 / 3.2 pinned caption; data-driven)", () => {
  it("defaults read '7 days. Even mix. All areas.'", () => {
    expect(mod.summarizeKnobs(base(), { engine: "gemini" })).toBe("7 days. Even mix. All areas.");
  });

  it("reflects a mostly-new preset in the mix clause", () => {
    const mostlyNew = mod.RATIO_PRESETS.find((p) => p.id === "mostly-new");
    const knobs = mod.setNewReviewRatio(base(), mostlyNew.value);
    expect(mod.summarizeKnobs(knobs, { engine: "gemini" })).toBe("7 days. Mostly new. All areas.");
  });

  it("counts focus and skipped areas (data, not a baked value)", () => {
    const knobs = knobsWith({ weak: ["Alpha", "Beta"], excluded: ["Gamma"] });
    expect(mod.summarizeKnobs(knobs, { engine: "gemini" })).toBe("7 days. Even mix. 2 focus, 1 skipped.");
  });
});

// --- SCHEMA-JOIN + exclusivity: the load-bearing property ----------------

describe("schema-shape conformance: every emitted object JOINs through the REAL normalizer", () => {
  // The schema-bypass canary. If a setter emits a field the normalizer drops
  // (an extra pace.hoursPerDay) or a value it rewrites (an unclamped ratio),
  // normalizeKnobs(out) stops deep-equalling out and this reds -- without this
  // suite re-implementing a single schema rule.
  const noSharedLabel = (k) => {
    const weak = new Set(lower(k.weakTopicIds));
    for (const a of lower(k.topicScope.excludedAreas)) expect(weak.has(a)).toBe(false);
  };
  const assertConformant = (k) => {
    expect(keysOf(k)).toEqual(SHAPE_KEYS);
    expect(normalizeKnobs(k)).toEqual(k); // idempotence JOIN through the shipped normalizer
    noSharedLabel(k);
  };

  it("the zero-touch base equals the schema DEFAULT (zero-click generate)", () => {
    const b = base();
    assertConformant(b);
    expect(mod.knobsEqual(b, DEFAULT_KNOBS)).toBe(true);
    expect(mod.summarizeKnobs(b, { engine: "gemini" })).toBe("7 days. Even mix. All areas.");
  });

  it("holds after every setter in a mixed sequence (idempotence + exclusivity)", () => {
    const S = mod.AREA_STATE;
    const opts = ["Interview process", "Watch-outs", "Culture", "Size and stage"];
    const take = (res) => (res && typeof res === "object" && "knobs" in res ? res.knobs : res);
    // A deterministic sequence that exercises moves between the two lists, the
    // last-included guard, ratio and days -- an implicit property check.
    const steps = [
      (k) => mod.setDaysUntil(k, "21"),
      (k) => mod.setNewReviewRatio(k, mod.RATIO_PRESETS[0].value),
      (k) => mod.setAreaState(k, "Interview process", S.FOCUS, opts),
      (k) => mod.setAreaState(k, "Interview process", S.SKIP, opts), // focus -> skip
      (k) => mod.setAreaState(k, "Culture", S.FOCUS, opts),
      (k) => mod.setAreaState(k, "Size and stage", S.SKIP, opts),
      (k) => mod.setAreaState(k, "Size and stage", S.FOCUS, opts), // skip -> focus: must leave NO label in both
      (k) => mod.setAreaState(k, "Culture", S.INCLUDE, opts), // back to include
      (k) => mod.setDaysUntil(k, "3"),
    ];
    let cur = base();
    assertConformant(cur);
    for (const step of steps) {
      cur = take(step(cur));
      assertConformant(cur);
    }
  });

  it("never returns DEFAULT_KNOBS and never aliases its frozen arrays (row 20)", () => {
    const out = mod.setNewReviewRatio(base(), mod.RATIO_PRESETS[0].value);
    expect(out).not.toBe(DEFAULT_KNOBS);
    expect(out.weakTopicIds).not.toBe(DEFAULT_KNOBS.weakTopicIds);
    expect(out.topicScope.excludedAreas).not.toBe(DEFAULT_KNOBS.topicScope.excludedAreas);
    // Mutating an emitted object must not reach the frozen defaults.
    out.weakTopicIds.push("x");
    out.pace.daysUntil = 999;
    expect(DEFAULT_KNOBS.newReviewRatio).toBe(0.5);
    expect(DEFAULT_KNOBS.weakTopicIds).toHaveLength(0);
    expect(DEFAULT_KNOBS.pace.daysUntil).toBe(7);
    expect(Object.isFrozen(DEFAULT_KNOBS)).toBe(true);
  });
});
