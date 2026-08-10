import { describe, it, expect } from "vitest";
import {
  PREDICTION_STORAGE_KEY,
  DEFAULT_SHOW_PREDICTIONS,
  normalizeShowPredictions,
  serializeShowPredictions,
  speculativeWorkEnabled,
  preDraftDisclosureApplies,
} from "./predictionPrefs";

// The predicted-question and predicted-answer panels are speculative: the
// copilot guesses what will be asked next and drafts an answer for it before
// anyone asks. That roughly DOUBLES the model calls a detected question costs
// (see R-105), and mid-interview it is two more panels competing for a phone
// screen. This module owns the preference that turns them off.
//
// Pure on purpose: `vitest.config.js` is `environment: "node"` with no jsdom,
// so a decision living inside a component or a hook cannot be tested at all.

describe("normalizeShowPredictions", () => {
  it("defaults to ON, so the feature is unchanged for everyone who never touches it", () => {
    expect(DEFAULT_SHOW_PREDICTIONS).toBe(true);
    expect(normalizeShowPredictions(null)).toBe(true);
    expect(normalizeShowPredictions(undefined)).toBe(true);
    expect(normalizeShowPredictions("")).toBe(true);
  });

  it("only an explicit stored 'false' turns it off", () => {
    expect(normalizeShowPredictions("false")).toBe(false);
    expect(normalizeShowPredictions("true")).toBe(true);
  });

  it("treats an unrecognized stored value as ON rather than silently disabling a feature", () => {
    // A corrupt or hand-edited value must fail toward the incumbent behaviour.
    // Falling to `false` would turn a whole panel pair off with no user action
    // and nothing on screen to explain it.
    for (const junk of ["0", "off", "no", "FALSE", "  false  ", "{}", "null", 0, 1, {}, []]) {
      expect(normalizeShowPredictions(junk), `junk input: ${JSON.stringify(junk)}`).toBe(true);
    }
  });

  it("round-trips through serialize for both values", () => {
    expect(normalizeShowPredictions(serializeShowPredictions(true))).toBe(true);
    expect(normalizeShowPredictions(serializeShowPredictions(false))).toBe(false);
  });

  it("serializes to strings, since localStorage stores nothing else", () => {
    expect(typeof serializeShowPredictions(true)).toBe("string");
    expect(typeof serializeShowPredictions(false)).toBe("string");
  });

  it("uses a storage key distinct from the copilot's other preferences", () => {
    // The audio source, the microphone and the prep context each persist under
    // their own key so one control can never overwrite another's choice.
    expect(PREDICTION_STORAGE_KEY).toBe("copilot-show-predictions");
    expect(PREDICTION_STORAGE_KEY).not.toBe("copilot-audio-source");
    expect(PREDICTION_STORAGE_KEY).not.toBe("copilot-mic-device");
  });
});

describe("speculativeWorkEnabled", () => {
  it("requires BOTH a running session and visible predictions", () => {
    expect(speculativeWorkEnabled(true, true)).toBe(true);
    expect(speculativeWorkEnabled(true, false)).toBe(false);
    expect(speculativeWorkEnabled(false, true)).toBe(false);
    expect(speculativeWorkEnabled(false, false)).toBe(false);
  });

  it("keeps the existing session gate intact when predictions are visible", () => {
    // Before this preference existed, speculative work was gated on `active`
    // alone — without it, selecting a posting fired a prediction and a
    // pre-draft just for looking at the page. Turning predictions ON must not
    // hand that back.
    expect(speculativeWorkEnabled(false, true)).toBe(false);
  });

  it("returns a real boolean, never a truthy passthrough", () => {
    // The result feeds an effect's dependency array; a changing object or a
    // string would re-fire it and re-run the model call.
    for (const a of [true, false]) {
      for (const b of [true, false]) {
        expect(typeof speculativeWorkEnabled(a, b)).toBe("boolean");
      }
    }
  });
});

describe("preDraftDisclosureApplies", () => {
  // This is the load-bearing one. Practice mode's privacy notice gains a
  // clause stating that a predicted question and the prep context are sent to
  // Gemini AUTOMATICALLY, before the user reveals anything. Once predictions
  // can be switched off, that send no longer happens — and a notice that keeps
  // claiming it does is a false statement about where the user's data goes.
  // Adding a feature can falsify an existing notice in either direction.
  it("is true only when the pre-draft switch is on AND predictions are visible", () => {
    expect(preDraftDisclosureApplies(true, true)).toBe(true);
    expect(preDraftDisclosureApplies(true, false)).toBe(false);
    expect(preDraftDisclosureApplies(false, true)).toBe(false);
    expect(preDraftDisclosureApplies(false, false)).toBe(false);
  });

  it("never claims a transfer that hiding predictions has already prevented", () => {
    // Stated as its own case because it is the whole reason this function
    // exists rather than the notice reading the switch directly.
    expect(preDraftDisclosureApplies(true, false)).toBe(false);
  });

  it("agrees with speculativeWorkEnabled about whether a pre-draft can happen", () => {
    // If the notice and the gate ever disagree, one of them is lying. Asserted
    // against each other rather than each in isolation, the same discipline
    // R-111 uses for `cachedSampleAnswerFor` vs `needsRedraft`.
    for (const show of [true, false]) {
      const canRun = speculativeWorkEnabled(true, show);
      expect(preDraftDisclosureApplies(true, show)).toBe(canRun);
    }
  });
});
