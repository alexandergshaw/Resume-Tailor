// N104 Waves D/E (4b) - the pure, total availability state machine behind the
// Regenerate row (UX 5.2 / UXW-2). It decides ONE state from a descriptor of the
// surface; the leaf (RegenerateRow) only draws the state this returns. RED on HEAD:
// lib/review/regenerateAvailability.js does not exist.
//
// WHY A PURE STATE MACHINE AND NOT A RENDER: the safety property here is "the button
// is reachable ONLY when a gated regenerate can actually run" - every other input
// falls to a not-ready state, never to `ready`. That is a total function of its
// inputs, so it is tested exhaustively here and the leaf test only checks that each
// state draws its own chrome. The precedence (design 5.2) is first-match-wins:
// hidden, unsupported-scope, unsupported-job, running, engine-cannot, needs-material,
// stale, nothing-to-address, ready. `failed` is a UI overlay (K11 above the row), not
// a precedence rung, so it is NOT a value this function returns.

import { describe, it, expect } from "vitest";
import { REGENERATE_STATE, regenerateAvailability } from "./regenerateAvailability.js";

// A descriptor on which every rung above `ready` is clear: the single input the
// READY state is built from, so every other case below is this with ONE field
// changed and the change is the only reason the state moves off `ready`.
const READY_INPUT = Object.freeze({
  tab: "resume",
  jobKind: "ideal",
  idealEnabled: true,
  engine: "gemini",
  reviewSource: { kind: "ideal-band" }, // a live review exists (truthy)
  fresh: true,
  inputs: { posting: true, realMaterial: true },
  resolvableCount: 3,
  confirmCount: 1,
  unqualifiedCount: 2,
  inFlight: false,
});

const at = (overrides) => regenerateAvailability({ ...READY_INPUT, ...overrides });

describe("regenerateAvailability - the positive control (or every assertion below is vacuous)", () => {
  it("returns `ready` when every precedence rung is clear and there is something to address", () => {
    expect(at({})).toBe(REGENERATE_STATE.READY);
  });

  it("every state value is a distinct string (the leaf keys its chrome on them)", () => {
    const values = Object.values(REGENERATE_STATE);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("ready");
  });
});

describe("regenerateAvailability - the SAFETY row: `ready` is unreachable off the Ideal resume path", () => {
  it("a level 1-5 (standard) resume job NEVER regenerates - it is unsupported-job, not ready", () => {
    // The mutant the plan names: availability-shows-on-level-1-5. If the standard-job
    // guard is dropped this returns `ready` and an ungated conversion is offered.
    expect(at({ jobKind: "standard" })).toBe(REGENERATE_STATE.UNSUPPORTED_JOB);
  });

  it("the cover tab is unsupported-scope (the gated chain is resume-only)", () => {
    expect(at({ tab: "cover" })).toBe(REGENERATE_STATE.UNSUPPORTED_SCOPE);
  });

  it("the hypothetical and email tabs are hidden (nothing is sent from them)", () => {
    expect(at({ tab: "hypothetical" })).toBe(REGENERATE_STATE.HIDDEN);
    expect(at({ tab: "email" })).toBe(REGENERATE_STATE.HIDDEN);
  });

  it("no live review -> hidden (there is nothing to regenerate against)", () => {
    expect(at({ reviewSource: null })).toBe(REGENERATE_STATE.HIDDEN);
    expect(at({ reviewSource: undefined })).toBe(REGENERATE_STATE.HIDDEN);
  });

  it("the Ideal level kill-switch off -> hidden on every tab", () => {
    expect(at({ idealEnabled: false })).toBe(REGENERATE_STATE.HIDDEN);
  });
});

describe("regenerateAvailability - engine reality and missing inputs keep it off `ready`", () => {
  it("an engine that cannot run Ideal (embedded / external) is engine-cannot", () => {
    expect(at({ engine: "embedded" })).toBe(REGENERATE_STATE.ENGINE_CANNOT);
    expect(at({ engine: "external" })).toBe(REGENERATE_STATE.ENGINE_CANNOT);
  });

  it("a missing posting or real resume -> needs-material (the class split cannot be made)", () => {
    expect(at({ inputs: { posting: false, realMaterial: true } })).toBe(REGENERATE_STATE.NEEDS_MATERIAL);
    expect(at({ inputs: { posting: true, realMaterial: false } })).toBe(REGENERATE_STATE.NEEDS_MATERIAL);
  });

  it("a review that no longer describes the text on screen -> stale", () => {
    expect(at({ fresh: false })).toBe(REGENERATE_STATE.STALE);
  });

  it("no resolvable gap -> nothing-to-address (never `ready` with zero to address)", () => {
    expect(at({ resolvableCount: 0 })).toBe(REGENERATE_STATE.NOTHING_TO_ADDRESS);
  });

  it("a regenerate already in flight for this job -> running", () => {
    expect(at({ inFlight: true })).toBe(REGENERATE_STATE.RUNNING);
  });
});

describe("regenerateAvailability - precedence is first-match-wins (design 5.2)", () => {
  it("hidden outranks every other reason (hypothetical tab even while in flight / wrong engine)", () => {
    expect(at({ tab: "hypothetical", inFlight: true, engine: "embedded" })).toBe(REGENERATE_STATE.HIDDEN);
  });

  it("unsupported-job outranks running / engine-cannot (a standard job never regenerates)", () => {
    expect(at({ jobKind: "standard", inFlight: true, engine: "embedded" })).toBe(REGENERATE_STATE.UNSUPPORTED_JOB);
  });

  it("running outranks engine-cannot, needs-material and stale", () => {
    expect(at({ inFlight: true, engine: "embedded", fresh: false, inputs: { posting: false, realMaterial: false } })).toBe(
      REGENERATE_STATE.RUNNING,
    );
  });

  it("engine-cannot outranks needs-material, stale and nothing-to-address", () => {
    expect(at({ engine: "external", fresh: false, resolvableCount: 0, inputs: { posting: false, realMaterial: true } })).toBe(
      REGENERATE_STATE.ENGINE_CANNOT,
    );
  });

  it("needs-material outranks stale and nothing-to-address", () => {
    expect(at({ inputs: { posting: false, realMaterial: true }, fresh: false, resolvableCount: 0 })).toBe(
      REGENERATE_STATE.NEEDS_MATERIAL,
    );
  });

  it("stale outranks nothing-to-address", () => {
    expect(at({ fresh: false, resolvableCount: 0 })).toBe(REGENERATE_STATE.STALE);
  });
});

describe("regenerateAvailability - total over junk input, and junk never yields `ready`", () => {
  it("an empty / undefined descriptor is hidden, not a throw and not ready", () => {
    expect(regenerateAvailability()).toBe(REGENERATE_STATE.HIDDEN);
    expect(regenerateAvailability({})).toBe(REGENERATE_STATE.HIDDEN);
  });

  it("a non-object `inputs`, or a non-number count, is treated as missing - never `ready`", () => {
    expect(at({ inputs: null })).not.toBe(REGENERATE_STATE.READY);
    expect(at({ inputs: "yes" })).not.toBe(REGENERATE_STATE.READY);
    expect(at({ resolvableCount: "3" })).not.toBe(REGENERATE_STATE.READY);
    expect(at({ resolvableCount: undefined })).not.toBe(REGENERATE_STATE.READY);
    expect(at({ resolvableCount: Number.NaN })).not.toBe(REGENERATE_STATE.READY);
  });

  it("an unknown tab on an otherwise-ready descriptor is not `ready`", () => {
    expect(at({ tab: "sidebar" })).not.toBe(REGENERATE_STATE.READY);
  });
});
