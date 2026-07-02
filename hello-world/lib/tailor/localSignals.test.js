import { describe, it, expect } from "vitest";
import {
  readSignals,
  recordMatchGaps,
  annotateAndRank,
  recordSteering,
  steeringHabitHint,
  recordEditRules,
  promotedEditRules,
} from "./localSignals.js";

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

describe("recordSteering / steeringHabitHint", () => {
  it("hints only once a term has been steered threshold times", () => {
    const storage = fakeStorage();
    const meta = { avoided: ["Java"], emphasized: [] };
    recordSteering(meta, { storage, now: 1 });
    recordSteering(meta, { storage, now: 2 });
    expect(steeringHabitHint(meta, { storage })).toBe(""); // 2 < 3
    recordSteering(meta, { storage, now: 3 });
    const hint = steeringHabitHint(meta, { storage });
    expect(hint).toContain("Java");
    expect(hint).toContain("3 revisions");
    expect(hint).toContain("/library");
  });

  it("hints on recurring emphasis too, with pin phrasing", () => {
    const storage = fakeStorage();
    const meta = { avoided: [], emphasized: ["React"] };
    for (let i = 0; i < 3; i += 1) recordSteering(meta, { storage, now: i });
    expect(steeringHabitHint(meta, { storage })).toContain("emphasized React");
  });

  it("only hints about terms in THIS revise, not old habits", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 5; i += 1) recordSteering({ avoided: ["Java"] }, { storage, now: i });
    // Current revise steers a different term — stay quiet about Java.
    expect(steeringHabitHint({ avoided: ["Perl"] }, { storage })).toBe("");
  });

  it("coexists with gap counters in the same store", () => {
    const storage = fakeStorage();
    recordMatchGaps(MATCH_A, { storage, now: 1 });
    recordSteering({ avoided: ["Java"] }, { storage, now: 2 });
    const s = readSignals(storage);
    expect(s.gaps.kubernetes.count).toBe(1);
    expect(s.steering.avoided.java.count).toBe(1);
  });
});

describe("recordEditRules / promotedEditRules", () => {
  const RULE = { before: "of 5 through", after: "of 8 through" };

  it("accumulates across sessions and documents into one counter", () => {
    const storage = fakeStorage();
    recordEditRules([RULE], { doc: "resume", storage, now: 1 });
    recordEditRules([RULE], { doc: "cover", storage, now: 2 });
    const rec = readSignals(storage).editRules["of 5 through→of 8 through"];
    expect(rec.count).toBe(2);
    expect(rec.docs).toEqual({ resume: 1, cover: 1 });
  });

  it("promotes only at the threshold, most-recent first", () => {
    const storage = fakeStorage();
    recordEditRules([RULE], { doc: "resume", storage, now: 1 });
    recordEditRules([RULE], { doc: "resume", storage, now: 2 });
    expect(promotedEditRules({ storage })).toEqual([]);
    recordEditRules([RULE], { doc: "cover", storage, now: 3 });
    expect(promotedEditRules({ storage })).toEqual([RULE]);
  });

  it("self-heals: one reversing edit deletes the rule and is not itself recorded", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i += 1) recordEditRules([RULE], { doc: "resume", storage, now: i });
    expect(promotedEditRules({ storage })).toHaveLength(1);
    // The user edits "of 8 through" back to "of 5 through" — an undo.
    recordEditRules([{ before: "of 8 through", after: "of 5 through" }], { doc: "resume", storage, now: 9 });
    const s = readSignals(storage);
    expect(promotedEditRules({ storage })).toEqual([]);
    expect(s.editRules["of 8 through→of 5 through"]).toBeUndefined();
  });

  it("conflicting targets for the same before compete — only the strongest fires", () => {
    const storage = fakeStorage();
    const other = { before: "of 5 through", after: "of 9 through" };
    for (let i = 0; i < 3; i += 1) recordEditRules([RULE], { doc: "resume", storage, now: i });
    for (let i = 0; i < 4; i += 1) recordEditRules([other], { doc: "resume", storage, now: 10 + i });
    const promoted = promotedEditRules({ storage });
    expect(promoted).toHaveLength(1);
    expect(promoted[0].after).toBe("of 9 through");
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
