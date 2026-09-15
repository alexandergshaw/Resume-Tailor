import { describe, it, expect } from "vitest";
import { confirmRevealLabel, needsDraftOnConfirm, entryById } from "./confirmReveal.js";

describe("confirmRevealLabel — AC-N18.13 'Label by state'", () => {
  it("says the answer is still drafting while status is loading", () => {
    expect(confirmRevealLabel("loading")).toBe("Show answer (drafting)");
  });

  it("says plain 'Show answer' once the draft is done", () => {
    expect(confirmRevealLabel("done")).toBe("Show answer");
  });

  it("says plain 'Show answer' for idle/error/undefined — anything that isn't actively loading", () => {
    expect(confirmRevealLabel("idle")).toBe("Show answer");
    expect(confirmRevealLabel("error")).toBe("Show answer");
    expect(confirmRevealLabel(undefined)).toBe("Show answer");
  });

  // Control: proves the branch is load-bearing, not a constant that happens
  // to read right for both cases tested above.
  it("[control] the two statuses really do produce different labels", () => {
    expect(confirmRevealLabel("loading")).not.toBe(confirmRevealLabel("done"));
  });
});

describe("needsDraftOnConfirm — AC-N18.9/F-A1", () => {
  it("is true for an idle entry", () => {
    expect(needsDraftOnConfirm({ id: 1, status: "idle" })).toBe(true);
  });

  it("is false for a loading, done, or error entry", () => {
    expect(needsDraftOnConfirm({ id: 1, status: "loading" })).toBe(false);
    expect(needsDraftOnConfirm({ id: 1, status: "done" })).toBe(false);
    expect(needsDraftOnConfirm({ id: 1, status: "error" })).toBe(false);
  });

  it("is false for a missing entry, never throws", () => {
    expect(needsDraftOnConfirm(null)).toBe(false);
    expect(needsDraftOnConfirm(undefined)).toBe(false);
  });

  // Control: proves the predicate discriminates on `status` rather than
  // merely on "an entry object was passed at all".
  it("[control] a done entry and an idle entry differ only in status, and the predicate tells them apart", () => {
    const done = { id: 1, status: "done" };
    const idle = { id: 1, status: "idle" };
    expect(needsDraftOnConfirm(done)).not.toBe(needsDraftOnConfirm(idle));
  });
});

describe("entryById — m9/m10: resolve the LIVE entry, never a stale snapshot", () => {
  const questions = [
    { id: 1, question: "Q1" },
    { id: 2, question: "Q2" },
  ];

  it("finds the entry whose id matches", () => {
    expect(entryById(questions, 2)).toBe(questions[1]);
  });

  it("falls back to null when the id resolves to nothing", () => {
    expect(entryById(questions, 99)).toBeNull();
  });

  it("falls back to the given fallback, not null, when one is supplied", () => {
    const fallback = { id: 7, question: "Fallback" };
    expect(entryById(questions, 99, fallback)).toBe(fallback);
  });

  it("survives a missing or non-array list", () => {
    expect(entryById(undefined, 1)).toBeNull();
    expect(entryById(null, 1)).toBeNull();
    expect(entryById("nope", 1)).toBeNull();
  });

  // Control: proves the lookup is by id, not merely "something was found".
  it("[control] two different ids resolve to two different entries", () => {
    expect(entryById(questions, 1)).not.toBe(entryById(questions, 2));
  });
});
