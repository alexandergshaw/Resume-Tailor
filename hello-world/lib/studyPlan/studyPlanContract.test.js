// N157 SC-B-schema -- the pure contract module's unit suite (plan.r1.md
// Step 2b, §4.1). RED on HEAD: lib/studyPlan/studyPlanContract.js does not
// exist yet, so the dynamic import in beforeAll throws and every test in this
// file reds with a "cannot find module" error. That is the honest greenfield
// red -- there is no way to assert a module's exports without the module, and
// vi.mock cannot substitute an unresolvable specifier ([[loop-traps-tests]]).
// The reference implementation that turns these green is a frozen 12-column
// projection built with Object.freeze + join(", "), mirroring
// lib/interviewPrep/prepContract.js's PREP_LIST_COLUMNS/PREP_LIST_PROJECTION.
//
// WHY dynamic-import-in-beforeAll rather than a static top-level import: it
// lets each `it` carry its own meaningful assertion (visible in the summary)
// instead of collapsing the file into one collection-time parse error, and it
// still fails loudly while the module is absent. The import specifier is the
// SAME one production consumers (SC-B-persist's studyPlanStore.js) will use,
// so this harness does not wire the module differently from production.

import { describe, it, expect, beforeAll } from "vitest";

let mod = null;

beforeAll(async () => {
  mod = await import("@/lib/studyPlan/studyPlanContract.js");
});

describe("studyPlanContract -- table name + RPC name constants", () => {
  it("STUDY_PLANS_TABLE is exactly \"study_plans\"", () => {
    expect(mod.STUDY_PLANS_TABLE).toBe("study_plans");
  });

  it("MERGE_STUDY_PLAN_PROGRESS_FN is exactly \"merge_study_plan_progress\" (the RPC name the store will .rpc())", () => {
    expect(mod.MERGE_STUDY_PLAN_PROGRESS_FN).toBe("merge_study_plan_progress");
  });
});

describe("studyPlanContract -- the whole-row column projection", () => {
  it("STUDY_PLAN_COLUMNS is the exact, ordered 12-column set (closed in BOTH directions -- a dropped OR an added column reds)", () => {
    // toEqual, never a length>=N lower bound: a lower bound cannot detect a
    // dropped user_id (the tenant filter column) nor an accidentally-added
    // column that would silently widen the read. plan.r1.md §4.1 fixes both
    // the membership and the order.
    expect(mod.STUDY_PLAN_COLUMNS).toEqual([
      "application_id",
      "user_id",
      "status",
      "plan",
      "knobs",
      "progress",
      "cached_research",
      "posting_fingerprint",
      "researched_at",
      "engine",
      "created_at",
      "updated_at",
    ]);
  });

  it("STUDY_PLAN_COLUMNS is frozen -- a consumer cannot mutate the shared projection", () => {
    expect(Object.isFrozen(mod.STUDY_PLAN_COLUMNS)).toBe(true);
  });

  it("STUDY_PLAN_PROJECTION is a non-empty comma-joined string, never a select(\"*\") (kills a `*` projection)", () => {
    // Guard the operand FIRST so the negative assertion below cannot pass
    // vacuously against an `undefined` export ([[loop-traps-tests]]: a
    // negative assertion whose operand can be undefined is a positive
    // assertion about nothing). With the module absent this guard reds in
    // beforeAll anyway; with it present this pins a real string.
    expect(typeof mod.STUDY_PLAN_PROJECTION).toBe("string");
    expect(mod.STUDY_PLAN_PROJECTION.length).toBeGreaterThan(0);
    expect(mod.STUDY_PLAN_PROJECTION).not.toContain("*");
  });

  it("STUDY_PLAN_PROJECTION names application_id, user_id AND progress (the identity + resume columns)", () => {
    const cols = mod.STUDY_PLAN_PROJECTION.split(",").map((c) => c.trim());
    expect(cols).toContain("application_id");
    expect(cols).toContain("user_id");
    expect(cols).toContain("progress");
  });

  it("STUDY_PLAN_PROJECTION is exactly STUDY_PLAN_COLUMNS joined by \", \" (the projection cannot drift from the column list)", () => {
    // Derived, not re-typed: proves the one source of truth is the column
    // array, so a column added there automatically reaches the select().
    expect(mod.STUDY_PLAN_PROJECTION).toBe(mod.STUDY_PLAN_COLUMNS.join(", "));
  });
});
