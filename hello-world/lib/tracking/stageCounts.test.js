// The falsifier for the monotone-chain primitive.
//
// WRITTEN BEFORE THE MODULE EXISTED, from the plan's stated contract, so every
// case below describes behaviour the primitive must have rather than behaviour
// an implementation happens to produce. That matters more than usual here,
// because this module is an EXTRACTION: the engine it holds already shipped
// inside lib/tracking/digestCitations.js, and the only way an extraction can go
// wrong invisibly is for the tests to be written from the new code.
//
// THE ONE PROPERTY EVERYTHING ELSE HANGS OFF:
//
//   A NON-ZERO INPUT BECOMING A ZERO OUTPUT IS A REPORTABLE ANOMALY, not a
//   normal empty. It is only a normal empty when the input was also zero.
//
// Three rules follow from it, and each has its own section below because each
// is a different way to get the same thing wrong:
//
//   1. FIRST BREACH ONLY. Once a stage has eaten everything, every later zero
//      is an honest consequence of that stage, not a second finding. An
//      implementation that reports the last breach, or all of them, names the
//      wrong stage — which digestCitations.js's own header calls worse than
//      naming none.
//   2. ZERO, NOT MERELY SMALLER. Narrowing is what these stages are FOR. An
//      implementation that fires on 11 -> 10 reports an anomaly on every
//      healthy run and the record stops meaning anything.
//   3. RECORDED, NEVER REPAIRED. A count that has to be clamped to satisfy the
//      invariant is a wiring bug upstream, and clamping it reproduces the exact
//      failure this record exists to expose: an arithmetic that always looks
//      consistent and therefore proves nothing. A missing count is a
//      VIOLATION, never a zero.
//
// WHY THE STAGE LIST IS A PARAMETER. digestCitations.js closed over one
// module-level chain, so a second feature needing a chain had to hand-copy the
// engine — a second recogniser, which is the exact defect the citation work
// exists to close. The knowledge-page feature needs THREE chains (retrieval,
// citations, and the digest's own), so the parameterisation pays for itself at
// the first caller rather than on a promise.

import { describe, it, expect } from "vitest";
import { COUNTS_NOT_OBJECT, stageAnomaly, stageViolation, transitionsFor } from "./stageCounts.js";

// A three-stage chain, deliberately NOT the digest's, so nothing here can pass
// by accidentally agreeing with the one shipped caller's constant.
const STAGES = Object.freeze(["fetched", "eligible", "included"]);
const PAIRS = transitionsFor(STAGES);

// ---------------------------------------------------------------------------
// 1. transitionsFor -- adjacency is the whole contract
// ---------------------------------------------------------------------------

describe("transitionsFor", () => {
  it("pairs each stage with the one immediately after it, in order", () => {
    expect(transitionsFor(["a", "b", "c", "d"])).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ]);
  });

  it("never pairs a stage with a NON-adjacent one", () => {
    // The plausible-wrong implementation is "head against every later stage",
    // which reports `a -> d` as a transition and blames the first stage for a
    // loss the third caused. Asserted as an explicit absence because the
    // ordering assertion above passes for a superset.
    const pairs = transitionsFor(["a", "b", "c", "d"]);
    expect(pairs).toHaveLength(3);
    expect(pairs.map((p) => p.join(">"))).not.toContain("a>c");
    expect(pairs.map((p) => p.join(">"))).not.toContain("a>d");
    expect(pairs.map((p) => p.join(">"))).not.toContain("b>d");
  });

  it("produces one fewer transition than there are stages, down to none", () => {
    expect(transitionsFor(["only"])).toEqual([]);
    expect(transitionsFor([])).toEqual([]);
  });

  it("returns an empty list for anything that is not an array, and never throws", () => {
    expect(transitionsFor(null)).toEqual([]);
    expect(transitionsFor(undefined)).toEqual([]);
    expect(transitionsFor("fetched,included")).toEqual([]);
    expect(transitionsFor({ 0: "a", 1: "b", length: 2 })).toEqual([]);
  });

  it("freezes what it hands back, outer list and every pair", () => {
    // These are module-level constants at every call site. A caller that can
    // push onto the returned list can silently give one feature a chain
    // another feature never declared.
    const pairs = transitionsFor(["a", "b", "c"]);
    expect(Object.isFrozen(pairs)).toBe(true);
    expect(pairs.every((pair) => Object.isFrozen(pair))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. stageAnomaly -- the reportable narrowing
// ---------------------------------------------------------------------------

describe("stageAnomaly", () => {
  it("is null when every stage merely narrowed", () => {
    expect(stageAnomaly({ fetched: 9, eligible: 6, included: 2 }, PAIRS)).toBe(null);
  });

  it("is null when the input was also zero -- that is a normal empty", () => {
    expect(stageAnomaly({ fetched: 0, eligible: 0, included: 0 }, PAIRS)).toBe(null);
  });

  it("names the stage, both endpoints and both counts when a non-zero input yields zero", () => {
    expect(stageAnomaly({ fetched: 9, eligible: 0, included: 0 }, PAIRS)).toEqual({
      stage: "eligible",
      from: "fetched",
      to: "eligible",
      inputCount: 9,
      outputCount: 0,
    });
  });

  it("reports the FIRST breach only -- every later zero is that stage's consequence", () => {
    // fetched -> eligible is the breach. eligible -> included is 0 -> 0, an
    // honest empty. An implementation that scans backwards, or collects all
    // breaches, blames `included` for what `eligible` ate.
    const anomaly = stageAnomaly({ fetched: 9, eligible: 0, included: 0 }, PAIRS);
    expect(anomaly.from).toBe("fetched");
    expect(anomaly.to).toBe("eligible");
  });

  it("reports the first breach even when a LATER transition also breaches", () => {
    const chain = transitionsFor(["a", "b", "c", "d", "e"]);
    // a -> b breaches (4 -> 0). c -> d breaches too (3 -> 0), and it is later.
    const anomaly = stageAnomaly({ a: 4, b: 0, c: 3, d: 0, e: 0 }, chain);
    expect(anomaly).toEqual({ stage: "b", from: "a", to: "b", inputCount: 4, outputCount: 0 });
  });

  it("does not fire on a large but non-zero drop", () => {
    expect(stageAnomaly({ fetched: 5000, eligible: 1, included: 1 }, PAIRS)).toBe(null);
  });

  it("uses the transition's own stage label when the caller supplies named transitions", () => {
    // digestCitations.js names the PROCESS between two counts ("url-control"),
    // which is not either count's name. That vocabulary is stored in jsonb and
    // must survive the parameterisation.
    const named = [
      { stage: "extraction", from: "searched", to: "annotations" },
      { stage: "url-control", from: "annotations", to: "urlsUsable" },
    ];
    expect(stageAnomaly({ searched: 1, annotations: 11, urlsUsable: 0 }, named)).toEqual({
      stage: "url-control",
      from: "annotations",
      to: "urlsUsable",
      inputCount: 11,
      outputCount: 0,
    });
  });

  it("names the output stage itself when the caller supplies bare pairs", () => {
    // A bare chain has no separate name for the process, so the stage that
    // produced the zero names itself. The log line reads "<stage> N -> 0".
    expect(stageAnomaly({ a: 3, b: 0 }, transitionsFor(["a", "b"])).stage).toBe("b");
  });

  it("treats a count that is missing, fractional or the wrong type as zero output", () => {
    // A stage that reported nothing at all did not report a healthy number.
    // (stageViolation is the function that calls this a defect; here it must
    // not read as "the chain is fine".)
    expect(stageAnomaly({ fetched: 9 }, PAIRS).to).toBe("eligible");
    expect(stageAnomaly({ fetched: 9, eligible: "0" }, PAIRS).to).toBe("eligible");
    expect(stageAnomaly({ fetched: 9, eligible: 1.5 }, PAIRS).to).toBe("eligible");
    expect(stageAnomaly({ fetched: 9, eligible: null }, PAIRS).to).toBe("eligible");
  });

  it("treats a non-integer INPUT as zero, so it cannot manufacture an anomaly", () => {
    expect(stageAnomaly({ fetched: "9", eligible: 0, included: 0 }, PAIRS)).toBe(null);
  });

  it("returns null rather than throwing on junk", () => {
    expect(stageAnomaly(null, PAIRS)).toBe(null);
    expect(stageAnomaly("nine", PAIRS)).toBe(null);
    expect(stageAnomaly({ fetched: 9, eligible: 0 }, null)).toBe(null);
    expect(stageAnomaly({ fetched: 9, eligible: 0 }, "fetched,eligible")).toBe(null);
    expect(stageAnomaly({ fetched: 9, eligible: 0 }, [null, 7, "x"])).toBe(null);
  });

  it("does not mutate the counts it was handed", () => {
    const counts = { fetched: 9, eligible: 0, included: 0 };
    stageAnomaly(counts, PAIRS);
    expect(counts).toEqual({ fetched: 9, eligible: 0, included: 0 });
  });
});

// ---------------------------------------------------------------------------
// 3. stageViolation -- recorded, never repaired
// ---------------------------------------------------------------------------

describe("stageViolation", () => {
  it("returns null for a monotone chain", () => {
    expect(stageViolation({ fetched: 9, eligible: 6, included: 6 }, STAGES)).toBe(null);
  });

  it("names the first pair that breaks, at every position in the chain", () => {
    const base = { fetched: 5, eligible: 5, included: 5 };
    expect(stageViolation({ ...base, eligible: 6 }, STAGES)).toBe("eligible (6) exceeds fetched (5)");
    expect(stageViolation({ ...base, included: 6 }, STAGES)).toBe("included (6) exceeds eligible (5)");
  });

  it("reports the EARLIER break when two pairs are broken", () => {
    expect(stageViolation({ fetched: 1, eligible: 2, included: 3 }, STAGES)).toBe(
      "eligible (2) exceeds fetched (1)"
    );
  });

  it("calls a missing, non-integer or negative count a violation -- never a zero", () => {
    const base = { fetched: 5, eligible: 5, included: 5 };
    expect(stageViolation({ ...base, eligible: undefined }, STAGES)).toBe(
      "eligible is not a non-negative integer"
    );
    expect(stageViolation({ ...base, included: "5" }, STAGES)).toBe(
      "included is not a non-negative integer"
    );
    expect(stageViolation({ ...base, included: -1 }, STAGES)).toBe(
      "included is not a non-negative integer"
    );
    expect(stageViolation({ ...base, included: 1.5 }, STAGES)).toBe(
      "included is not a non-negative integer"
    );
  });

  it("checks every count's type BEFORE comparing any pair", () => {
    // Otherwise `{fetched: undefined, eligible: 3}` compares 3 > undefined,
    // which is false, and a chain with no first count reads as healthy.
    expect(stageViolation({ fetched: undefined, eligible: 3, included: 3 }, STAGES)).toBe(
      "fetched is not a non-negative integer"
    );
  });

  it("returns the shared not-an-object sentence for anything that is not a plain object", () => {
    expect(stageViolation(null, STAGES)).toBe(COUNTS_NOT_OBJECT);
    expect(stageViolation(undefined, STAGES)).toBe(COUNTS_NOT_OBJECT);
    expect(stageViolation(7, STAGES)).toBe(COUNTS_NOT_OBJECT);
    expect(stageViolation("9,6,2", STAGES)).toBe(COUNTS_NOT_OBJECT);
    expect(stageViolation([9, 6, 2], STAGES)).toBe(COUNTS_NOT_OBJECT);
  });

  it("exports that sentence as a constant, so a caller can relabel it without restating the rule", () => {
    expect(typeof COUNTS_NOT_OBJECT).toBe("string");
    expect(COUNTS_NOT_OBJECT).toBe("counts are missing or not an object");
  });

  it("checks the integer rule even when there is no pair to compare", () => {
    expect(stageViolation({ only: 3 }, ["only"])).toBe(null);
    expect(stageViolation({ only: -3 }, ["only"])).toBe("only is not a non-negative integer");
  });

  it("does not mutate or clamp the counts it was handed", () => {
    const counts = { fetched: 1, eligible: 2, included: 3 };
    stageViolation(counts, STAGES);
    expect(counts).toEqual({ fetched: 1, eligible: 2, included: 3 });
  });

  it("returns null rather than throwing when the stage list is unusable", () => {
    expect(stageViolation({ fetched: 1 }, null)).toBe(null);
    expect(stageViolation({ fetched: 1 }, "fetched")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 4. The two functions answer different questions about the same counts
// ---------------------------------------------------------------------------

describe("stageAnomaly and stageViolation together", () => {
  it("a broken chain is a violation and NOT an anomaly", () => {
    const counts = { fetched: 1, eligible: 2, included: 2 };
    expect(stageViolation(counts, STAGES)).not.toBe(null);
    expect(stageAnomaly(counts, PAIRS)).toBe(null);
  });

  it("a zero-out chain is an anomaly and NOT a violation", () => {
    const counts = { fetched: 9, eligible: 0, included: 0 };
    expect(stageViolation(counts, STAGES)).toBe(null);
    expect(stageAnomaly(counts, PAIRS)).not.toBe(null);
  });

  it("a chain can be both at once, and each reports its own finding", () => {
    const counts = { fetched: 9, eligible: 0, included: 4 };
    expect(stageAnomaly(counts, PAIRS)).toEqual({
      stage: "eligible",
      from: "fetched",
      to: "eligible",
      inputCount: 9,
      outputCount: 0,
    });
    expect(stageViolation(counts, STAGES)).toBe("included (4) exceeds eligible (0)");
  });
});
