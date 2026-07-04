import { describe, it, expect } from "vitest";
import {
  readSignals,
  recordMatchGaps,
  annotateAndRank,
  recordSteering,
  steeringHabitHint,
  recordEditRules,
  promotedEditRules,
  persistedEditRules,
  newlyPromotableEditRules,
  markEditRulePersisted,
  recordFocusOverride,
  focusOverrideHint,
  recordVariantOverride,
  variantOverrideHint,
  recordBuzzwordEdits,
  buzzwordEditHints,
  buzzwordEditCounts,
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

describe("template-edit persistence (newlyPromotableEditRules / markEditRulePersisted)", () => {
  const RULE = { before: "of 5 through", after: "of 8 through" };

  it("offers a rule to persist only once it clears the threshold", () => {
    const storage = fakeStorage();
    recordEditRules([RULE], { doc: "resume", storage, now: 1 });
    recordEditRules([RULE], { doc: "resume", storage, now: 2 });
    expect(newlyPromotableEditRules({ storage })).toEqual([]); // 2 < 3
    recordEditRules([RULE], { doc: "resume", storage, now: 3 });
    expect(newlyPromotableEditRules({ storage })).toEqual([RULE]);
  });

  it("stops offering a rule once it's marked persisted, and tracks it as persisted", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i += 1) recordEditRules([RULE], { doc: "resume", storage, now: i });
    expect(persistedEditRules({ storage })).toEqual([]);
    markEditRulePersisted(RULE, { storage });
    expect(persistedEditRules({ storage })).toEqual([RULE]);
    expect(newlyPromotableEditRules({ storage })).toEqual([]);
    // Auto-apply is unchanged — a persisted rule still promotes (server dedupes).
    expect(promotedEditRules({ storage })).toEqual([RULE]);
  });

  it("an undo that self-heals a persisted rule drops it from the persisted set", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i += 1) recordEditRules([RULE], { doc: "resume", storage, now: i });
    markEditRulePersisted(RULE, { storage });
    expect(persistedEditRules({ storage })).toEqual([RULE]);
    // The user edits it back — recordEditRules deletes the rule (and its flag).
    recordEditRules([{ before: "of 8 through", after: "of 5 through" }], { doc: "resume", storage, now: 9 });
    expect(persistedEditRules({ storage })).toEqual([]);
  });
});

describe("recordFocusOverride / focusOverrideHint", () => {
  it("counts detected→chosen corrections and hints at the threshold, for THAT detection only", () => {
    const storage = fakeStorage();
    recordFocusOverride({ detected: "Engineering Leadership", chosen: "Web Development" }, { storage, now: 1 });
    recordFocusOverride({ detected: "Engineering Leadership", chosen: "Web Development" }, { storage, now: 2 });
    expect(focusOverrideHint("Engineering Leadership", { storage })).toBe(""); // 2 < 3
    const count = recordFocusOverride(
      { detected: "Engineering Leadership", chosen: "Web Development" },
      { storage, now: 3 },
    );
    expect(count).toBe(3);
    const hint = focusOverrideHint("Engineering Leadership", { storage });
    expect(hint).toContain("Engineering Leadership");
    expect(hint).toContain("Web Development");
    expect(hint).toContain("/library");
    // A different current detection stays quiet about this history.
    expect(focusOverrideHint("Mathematics", { storage })).toBe("");
  });

  it("handles the nothing-detected case with add-match-terms phrasing", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i += 1) recordFocusOverride({ detected: "", chosen: "Web Development" }, { storage, now: i });
    const hint = focusOverrideHint("", { storage });
    expect(hint).toMatch(/nothing was detected/i);
    expect(hint).toContain("Web Development");
  });

  it("ignores no-op corrections (same area, or clearing to auto)", () => {
    const storage = fakeStorage();
    expect(recordFocusOverride({ detected: "Web Development", chosen: "Web Development" }, { storage })).toBe(0);
    expect(recordFocusOverride({ detected: "X", chosen: "" }, { storage })).toBe(0);
    expect(readSignals(storage).focusOverrides).toEqual({});
  });
});

describe("recordVariantOverride / variantOverrideHint", () => {
  it("counts framing corrections and hints at the threshold for the current detection", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i += 1) {
      recordVariantOverride({ detected: "teaching", chosen: "staff" }, { storage, now: i });
    }
    const hint = variantOverrideHint("teaching", { storage });
    expect(hint).toContain("teaching");
    expect(hint).toContain("staff");
    expect(hint).toContain("3 postings");
    // Different current detection stays quiet.
    expect(variantOverrideHint("industry", { storage })).toBe("");
  });

  it("ignores no-op toggles", () => {
    const storage = fakeStorage();
    expect(recordVariantOverride({ detected: "staff", chosen: "staff" }, { storage })).toBe(0);
    expect(recordVariantOverride({ detected: "teaching", chosen: "" }, { storage })).toBe(0);
    expect(readSignals(storage).variantOverrides).toEqual({});
  });
});

describe("recordBuzzwordEdits / buzzwordEditHints / buzzwordEditCounts", () => {
  it("counts per-term toggles across postings and badges the counts", () => {
    const storage = fakeStorage();
    recordBuzzwordEdits({ exclude: ["Business Intelligence"], boost: ["Web Analytics"] }, { storage, now: 1 });
    recordBuzzwordEdits({ exclude: ["Business Intelligence", "Journalism"] }, { storage, now: 2 });
    const counts = buzzwordEditCounts({ storage });
    expect(counts.exclude.get("business intelligence")).toBe(2);
    expect(counts.exclude.get("journalism")).toBe(1);
    expect(counts.boost.get("web analytics")).toBe(1);
  });

  it("hints only for terms in the CURRENT edit set that crossed the threshold, one hint per apply", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i += 1) recordBuzzwordEdits({ exclude: ["Business Intelligence"] }, { storage, now: i });
    expect(buzzwordEditHints({ exclude: ["Business Intelligence"] }, { storage })).toEqual([
      expect.stringMatching(/excluded Business Intelligence on 3 postings.*\/library/),
    ]);
    // Recurring history, but the current apply doesn't touch that term: quiet.
    expect(buzzwordEditHints({ exclude: ["Journalism"] }, { storage })).toEqual([]);
  });

  it("coexists with the other signal buckets", () => {
    const storage = fakeStorage();
    recordMatchGaps(MATCH_A, { storage, now: 1 });
    recordBuzzwordEdits({ exclude: ["SEO"] }, { storage, now: 2 });
    recordFocusOverride({ detected: "", chosen: "Web Development" }, { storage, now: 3 });
    const s = readSignals(storage);
    expect(s.gaps.kubernetes.count).toBe(1);
    expect(s.buzzwordEdits.exclude.seo.count).toBe(1);
    expect(Object.keys(s.focusOverrides)).toHaveLength(1);
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
