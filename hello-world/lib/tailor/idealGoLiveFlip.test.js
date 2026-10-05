// N107 go-live -- the FLIP: idealLevelEnabled() turns ON by default.
//
// The whole point of go-live is that the committed default of the dark-launch
// gate becomes TRUE. These rows use the REAL idealDelivery.js and the REAL
// tailorLevelRequest.js with NO gate mock, so they measure the committed
// default itself -- the one thing a mocked-gate test (which every other Ideal
// suite is) can never see.
//
// RED on HEAD: IDEAL_LEVEL_ENABLED is still `false`, so idealLevelEnabled()
// returns false and the default slider model ends at the fifth stop.
//
// This OBSOLETES the landed OFF-by-default canary idealDelivery.test.js:24
// (`expect(idealLevelEnabled()).toBe(false)`), exactly as the Step-9 review:null
// case was obsoleted -- a TDD seat cannot edit landed tests, so that line is
// flagged in the hand-off for the implementer to flip in the same change.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { idealLevelEnabled } from "./idealDelivery.js";
import { LEVEL_STOPS, IDEAL_STOP } from "./tailorLevel.js";

// recordDecision is a side effect of appendTailorLevel only; levelSliderModel
// (the only tailorLevelRequest export used here) never records, so no mock of
// the activity log is needed and the gate stays REAL.
vi.mock("@/lib/activityLog/appActivityLog", () => ({ recordDecision: vi.fn() }));

let levelSliderModel;
beforeEach(async () => {
  vi.resetModules();
  ({ levelSliderModel } = await import("./tailorLevelRequest.js"));
});

describe("the committed gate default is ON after go-live", () => {
  it("idealLevelEnabled() returns true by default (no mock)", () => {
    // RED on HEAD (returns false). Mutant after go-live: set the constant back
    // to false -> this reds; it is the obsoleted canary's inverse.
    expect(idealLevelEnabled()).toBe(true);
  });
});

describe("the slider DEFAULT (no per-test gate mock) exposes the Ideal stop", () => {
  it("levelSliderModel default max is the Ideal stop, with an 'Ideal' mark", () => {
    const model = levelSliderModel("", 3);
    // RED on HEAD: the real gate is off, so the model clips to max 5 with no
    // Ideal mark. Control: value stays on the saved level (3), so this is not a
    // model that merely jams everything to 6.
    expect(model.max).toBe(IDEAL_STOP);
    expect(model.marks.map((m) => m.label)).toContain("Ideal");
    expect(model.value).toBe(3);
  });

  it("a saved Ideal mode now reaches the Ideal stop by default", () => {
    // RED on HEAD: with the gate off a stale 'ideal' mode is ignored and the
    // slider shows the saved level (4). After the flip it reaches stop 6.
    expect(levelSliderModel("ideal", 4).value).toBe(IDEAL_STOP);
  });

  it("CONTROL: the vocabulary's sixth stop really is the Ideal stop (the flip exposes an existing stop, not a new number)", () => {
    // Independent of the gate: pins that max===IDEAL_STOP above is testing the
    // Ideal stop, not an accidental off-by-one.
    expect(LEVEL_STOPS[LEVEL_STOPS.length - 1].value).toBe(IDEAL_STOP);
    expect(LEVEL_STOPS[LEVEL_STOPS.length - 1].mark).toBe("Ideal");
  });
});
