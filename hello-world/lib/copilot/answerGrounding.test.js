import { describe, expect, it } from "vitest";
import { cachedAnswerFor, groundingFor, sameGrounding } from "./answerGrounding";

// Written from AC-N1 BEFORE the module existed.
//
// The invariant: a cached draft must never be served if it was built from a job
// posting or a prep context that is no longer selected. Live mode clears its
// answer cache on both changes, but clearing is not sufficient - a draft already
// in flight resolves afterwards and writes itself back in. So the entry has to
// carry the grounding it was actually built from, and the read has to compare.
//
// Practice mode already does exactly this (`cachedSampleAnswerFor` in
// sampleAnswerState.js). This module exists so both modes share ONE definition
// of "same grounding" - two copies of one comparison is precisely how they
// drift, which this codebase has already paid for once (BUG-J6).
//
// The failure mode to keep in mind while reading these: getting the
// not-applicable normalisation wrong does not throw and does not fail loudly.
// It just makes every lookup miss forever, silently disabling the cache and
// doubling what every predicted question costs. That is why the "cache still
// actually hits" cases below are as important as the rejection cases.

const LIVE = { profile: "six years in payments", applicationId: "app-1" };

describe("groundingFor normalisation", () => {
  it("treats a missing interview type the same however it is spelled", () => {
    // Live mode has no interview type at all; practice always sets one. If
    // undefined and null and "" are not folded together, a live entry written
    // by one path can never be read back by the other.
    const a = groundingFor({ ...LIVE, interviewType: undefined });
    const b = groundingFor({ ...LIVE, interviewType: null });
    const c = groundingFor({ ...LIVE, interviewType: "" });

    expect(sameGrounding(a, b)).toBe(true);
    expect(sameGrounding(b, c)).toBe(true);
  });

  it("treats a missing application the same however it is spelled", () => {
    // No posting selected is `null` in some call sites and `undefined` in
    // others.
    const a = groundingFor({ profile: "p", applicationId: null });
    const b = groundingFor({ profile: "p", applicationId: undefined });

    expect(sameGrounding(a, b)).toBe(true);
  });

  it("treats a missing prep context the same however it is spelled", () => {
    const a = groundingFor({ profile: "", applicationId: "app-1" });
    const b = groundingFor({ profile: undefined, applicationId: "app-1" });

    expect(sameGrounding(a, b)).toBe(true);
  });

  it("does not fold a real application id into the empty one", () => {
    const none = groundingFor({ profile: "p", applicationId: null });
    const some = groundingFor({ profile: "p", applicationId: "app-1" });

    expect(sameGrounding(none, some)).toBe(false);
  });
});

describe("sameGrounding discrimination", () => {
  it("matches when every field matches", () => {
    expect(
      sameGrounding(groundingFor({ ...LIVE }), groundingFor({ ...LIVE })),
    ).toBe(true);
  });

  it("rejects a different prep context", () => {
    expect(
      sameGrounding(
        groundingFor({ ...LIVE }),
        groundingFor({ ...LIVE, profile: "eight years in infrastructure" }),
      ),
    ).toBe(false);
  });

  it("rejects a different application", () => {
    expect(
      sameGrounding(groundingFor({ ...LIVE }), groundingFor({ ...LIVE, applicationId: "app-2" })),
    ).toBe(false);
  });

  it("rejects a different interview type", () => {
    expect(
      sameGrounding(
        groundingFor({ ...LIVE, interviewType: "behavioral" }),
        groundingFor({ ...LIVE, interviewType: "technical" }),
      ),
    ).toBe(false);
  });

  it("does not confuse the prep context with the application id", () => {
    // A naive implementation that concatenates the fields without a separator
    // makes ("ab", "c") and ("a", "bc") compare equal.
    expect(
      sameGrounding(
        groundingFor({ profile: "ab", applicationId: "c" }),
        groundingFor({ profile: "a", applicationId: "bc" }),
      ),
    ).toBe(false);
  });
});

describe("cachedAnswerFor", () => {
  const entry = (over = {}) => ({
    points: ["Led the billing migration", "Cut reconciliation to under an hour"],
    type: "behavioral",
    profile: LIVE.profile,
    applicationId: LIVE.applicationId,
    ...over,
  });

  it("serves an entry whose grounding still matches", () => {
    // The cache MUST still hit in the ordinary case. A grounding check that
    // rejects everything breaks nothing visibly - it just silently doubles what
    // every predicted question costs.
    expect(cachedAnswerFor(entry(), groundingFor({ ...LIVE }))).not.toBeNull();
  });

  it("rejects an entry built from a different posting", () => {
    expect(
      cachedAnswerFor(entry(), groundingFor({ ...LIVE, applicationId: "app-2" })),
    ).toBeNull();
  });

  it("rejects an entry built from a different prep context", () => {
    expect(
      cachedAnswerFor(entry(), groundingFor({ ...LIVE, profile: "something else entirely" })),
    ).toBeNull();
  });

  it("rejects an entry that never recorded its grounding", () => {
    // A write path that forgets to store grounding must produce a MISS, not a
    // false hit - otherwise the whole guard is opt-in and one forgetful call
    // site disables it.
    expect(
      cachedAnswerFor({ points: ["something"], type: "general" }, groundingFor({ ...LIVE })),
    ).toBeNull();
  });

  it("rejects nothing-cached", () => {
    expect(cachedAnswerFor(null, groundingFor({ ...LIVE }))).toBeNull();
    expect(cachedAnswerFor(undefined, groundingFor({ ...LIVE }))).toBeNull();
  });

  it("rejects an entry holding no usable points", () => {
    // An empty or malformed points array renders as a blank answer that looks
    // like a finished one.
    expect(cachedAnswerFor(entry({ points: [] }), groundingFor({ ...LIVE }))).toBeNull();
    expect(cachedAnswerFor(entry({ points: ["  ", ""] }), groundingFor({ ...LIVE }))).toBeNull();
    expect(cachedAnswerFor(entry({ points: "not an array" }), groundingFor({ ...LIVE }))).toBeNull();
  });

  it("hits for a live-mode entry, where there is no interview type on either side", () => {
    // The round trip that matters most: live writes without an interview type
    // and reads without one. If normalisation is wrong this is where the cache
    // silently stops working.
    const live = groundingFor({ profile: "p", applicationId: null });

    expect(cachedAnswerFor(entry({ profile: "p", applicationId: null }), live)).not.toBeNull();
  });
});
