import { describe, it, expect } from "vitest";
import { readSignals, recordMatchGaps, annotateAndRank } from "./localSignals.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

const MATCH_A = {
  missing: [{ canonical: "Kubernetes", category: "tool_platform" }],
  unrecognized: [{ term: "wound care", score: 3 }],
};
const MATCH_B = {
  missing: [{ canonical: "Kubernetes", category: "tool_platform" }],
  unrecognized: [{ term: "telemetry monitoring", score: 2 }],
};

describe("recordMatchGaps", () => {
  it("counts each term once per run, accumulating across postings", () => {
    const storage = fakeStorage();
    recordMatchGaps(MATCH_A, { storage, now: 1 });
    recordMatchGaps(MATCH_B, { storage, now: 2 });
    const s = readSignals(storage);
    expect(s.gaps.kubernetes.count).toBe(2);
    expect(s.gaps["wound care"].count).toBe(1);
    expect(s.gaps["telemetry monitoring"].count).toBe(1);
  });

  it("does not double-count a term appearing in both gap lists of one run", () => {
    const storage = fakeStorage();
    recordMatchGaps(
      { missing: [{ canonical: "Epic" }], unrecognized: [{ term: "epic", score: 1 }] },
      { storage, now: 1 },
    );
    expect(readSignals(storage).gaps.epic.count).toBe(1);
  });

  it("is a no-op without a match or storage", () => {
    const storage = fakeStorage();
    recordMatchGaps(null, { storage });
    expect(readSignals(storage).gaps).toEqual({});
    expect(() => recordMatchGaps(MATCH_A, { storage: null })).not.toThrow();
  });

  it("survives corrupted storage contents", () => {
    const storage = fakeStorage();
    storage.setItem("tailorLocalSignals", "{not json");
    recordMatchGaps(MATCH_A, { storage, now: 1 });
    expect(readSignals(storage).gaps.kubernetes.count).toBe(1);
  });
});

describe("annotateAndRank", () => {
  it("ranks recurring gap terms first and badges their counts", () => {
    const storage = fakeStorage();
    recordMatchGaps(MATCH_A, { storage, now: 1 });
    recordMatchGaps(MATCH_B, { storage, now: 2 });
    const ranked = annotateAndRank(
      [
        { canonical: "Fresh Term", category: "", score: 99 },
        { canonical: "Kubernetes", category: "tool_platform", score: 5 },
      ],
      { storage },
    );
    expect(ranked[0].canonical).toBe("Kubernetes");
    expect(ranked[0].seenCount).toBe(2);
    expect(ranked[1].seenCount).toBe(0);
  });

  it("preserves the scrape's score order within equal counts", () => {
    const ranked = annotateAndRank(
      [
        { canonical: "A", score: 9 },
        { canonical: "B", score: 5 },
      ],
      { storage: fakeStorage() },
    );
    expect(ranked.map((b) => b.canonical)).toEqual(["A", "B"]);
  });
});
