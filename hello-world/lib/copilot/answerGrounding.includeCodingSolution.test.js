import { describe, expect, it } from "vitest";
import { cachedAnswerFor, groundingFor, sameGrounding } from "./answerGrounding";

// N162 Wave A AC-N162-21 (FD-3) — the coding toggle joins `groundingFor` as a
// FIFTH field, so flipping the toggle forces a cache MISS exactly the way a
// `codeLanguage` change already does.
//
// Written from the AC/design BEFORE the field exists. On HEAD `groundingFor`
// emits four fields and ignores `includeCodingSolution` entirely, so a flip is
// invisible to the cache — the exact FD-3 hole this pins shut. The flip cases
// below are RED on HEAD for that reason; the "both OFF (the default)"
// regression cases are GREEN on HEAD and must stay green (byte-identical cache
// behaviour when the toggle is off).
//
// The strict-boolean normalization is deliberate and DIFFERENT from the
// generic `normalizeField` the other four fields use: an omitted field and an
// explicit OFF must BOTH resolve to `false` (so an entry written before the
// field existed still HITs a default OFF request), while only the literal
// boolean `true` arms it (so a truthy string/number from a malformed caller
// never silently turns coding on). See answerGrounding.js's own header and the
// N162 design §3.1.
//
// NEIGHBOUR GUARD: this file touches `includeCodingSolution` only. It must NOT
// disturb the existing `codingSolution` OBJECT, which the N161 suite
// (sampleAnswerState.codingSolution.test.js) pins as an OUTPUT that must never
// join the grounding key. `includeCodingSolution` (the toggle) and
// `codingSolution` (the worked answer) are different facts.

const LIVE = { profile: "six years in payments", applicationId: "app-1" };

describe("groundingFor emits includeCodingSolution as a strict boolean fifth field", () => {
  it("emits the literal boolean true only for an explicit true", () => {
    expect(groundingFor({ ...LIVE, includeCodingSolution: true }).includeCodingSolution).toBe(true);
  });

  it("folds an omitted toggle and an explicit false BOTH to false", () => {
    // Fail-safe: a pre-field entry (no toggle recorded) and a current default
    // OFF request must compare equal, so the common OFF case keeps hitting.
    expect(groundingFor({ ...LIVE }).includeCodingSolution).toBe(false);
    expect(groundingFor({ ...LIVE, includeCodingSolution: false }).includeCodingSolution).toBe(false);
    expect(groundingFor({ ...LIVE, includeCodingSolution: undefined }).includeCodingSolution).toBe(false);
    expect(groundingFor({ ...LIVE, includeCodingSolution: null }).includeCodingSolution).toBe(false);
  });

  it("coerces a truthy non-true value to false (strict === true, not !!value)", () => {
    // A malformed caller sending the string "true" or the number 1 must NOT
    // arm coding through the grounding key — only the real boolean does. This
    // is the FD-1 discipline carried into the grounding contract.
    expect(groundingFor({ ...LIVE, includeCodingSolution: "true" }).includeCodingSolution).toBe(false);
    expect(groundingFor({ ...LIVE, includeCodingSolution: 1 }).includeCodingSolution).toBe(false);
  });
});

describe("sameGrounding compares includeCodingSolution (FD-3 flip forces a miss)", () => {
  it("is NOT the same grounding when only the toggle differs — ON vs OFF", () => {
    // THE flip case. RED on HEAD: groundingFor ignores the toggle, so both
    // sides normalize identically and sameGrounding returns true. This is the
    // assertion that kills the named mutant — a groundingFor that omits the
    // fifth field (or a sameGrounding that never compares it) lets the flip
    // read as a hit and this goes red.
    const on = groundingFor({ ...LIVE, includeCodingSolution: true });
    const off = groundingFor({ ...LIVE, includeCodingSolution: false });
    expect(sameGrounding(on, off)).toBe(false);
  });

  it("is the same grounding when both are OFF — the default (regression guard, GREEN on HEAD)", () => {
    // With the toggle equal (both the OFF default), grounding behaves EXACTLY
    // as today. Control against an over-firing build that treats every pair as
    // a miss: if this went red, the cache would silently stop working for the
    // common OFF path.
    const a = groundingFor({ ...LIVE, includeCodingSolution: false });
    const b = groundingFor({ ...LIVE, includeCodingSolution: false });
    expect(sameGrounding(a, b)).toBe(true);
  });

  it("is the same grounding when both are ON", () => {
    const a = groundingFor({ ...LIVE, includeCodingSolution: true });
    const b = groundingFor({ ...LIVE, includeCodingSolution: true });
    expect(sameGrounding(a, b)).toBe(true);
  });

  it("treats an omitted toggle and an explicit OFF as the same grounding", () => {
    // The pre-field entry vs default-OFF request round trip — must HIT.
    const omitted = groundingFor({ ...LIVE });
    const explicitOff = groundingFor({ ...LIVE, includeCodingSolution: false });
    expect(sameGrounding(omitted, explicitOff)).toBe(true);
  });

  it("still rejects a different posting even when the toggle matches (the other four fields survive)", () => {
    // Control that the new field did not replace or short-circuit the existing
    // comparison: an over-eager implementation that returns true as soon as the
    // toggles match would pass the flip test and fail here.
    expect(
      sameGrounding(
        groundingFor({ ...LIVE, includeCodingSolution: true }),
        groundingFor({ ...LIVE, applicationId: "app-2", includeCodingSolution: true }),
      ),
    ).toBe(false);
  });
});

describe("cachedAnswerFor refuses a cross-toggle entry (FD-3 at the cache read)", () => {
  // The entry carries the grounding it was drafted under (the hook spreads
  // `...grounding` onto the cache entry, so includeCodingSolution rides it).
  // cachedAnswerFor re-derives groundingFor(entry) and compares via
  // sameGrounding, so a flip is an ordinary miss.
  const entry = (over = {}) => ({
    points: ["Led the billing migration", "Cut reconciliation to under an hour"],
    type: "behavioral",
    profile: LIVE.profile,
    applicationId: LIVE.applicationId,
    ...over,
  });

  it("refuses an ON-drafted entry when the current request is OFF", () => {
    // RED on HEAD: the toggle is invisible to the grounding comparison, so the
    // stale ON entry is served to an OFF request (serving a coding answer to a
    // user who turned coding off — FD-3's worse direction).
    const onEntry = entry({ includeCodingSolution: true });
    expect(cachedAnswerFor(onEntry, groundingFor({ ...LIVE, includeCodingSolution: false }))).toBeNull();
  });

  it("refuses an OFF-drafted entry when the current request is ON", () => {
    const offEntry = entry({ includeCodingSolution: false });
    expect(cachedAnswerFor(offEntry, groundingFor({ ...LIVE, includeCodingSolution: true }))).toBeNull();
  });

  it("serves an entry whose toggle still matches — both OFF (regression guard, GREEN on HEAD)", () => {
    // The ordinary OFF path must keep hitting. Control against a build that
    // turns every toggle comparison into a miss.
    const offEntry = entry({ includeCodingSolution: false });
    expect(cachedAnswerFor(offEntry, groundingFor({ ...LIVE, includeCodingSolution: false }))).not.toBeNull();
  });

  it("serves an entry whose toggle still matches — both ON", () => {
    const onEntry = entry({ includeCodingSolution: true });
    expect(cachedAnswerFor(onEntry, groundingFor({ ...LIVE, includeCodingSolution: true }))).not.toBeNull();
  });

  it("serves a pre-field entry (no toggle recorded) to a default-OFF request", () => {
    // An entry written before the field existed normalizes its toggle to false
    // and HITs a default OFF request — the fail-safe direction. GREEN on HEAD.
    expect(cachedAnswerFor(entry(), groundingFor({ ...LIVE }))).not.toBeNull();
  });
});
