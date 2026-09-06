import { describe, it, expect, vi } from "vitest";

import {
  evaluatePriorApplications,
  findPriorSamePosting,
  inWindow,
  mergeVerdicts,
} from "@/lib/duplicateApply/duplicateApplyVerdict.js";

// ---------------------------------------------------------------------------
// AC-duplicate-apply-r4.md C-9 .. C-19, plus the five criteria
// 3-plan-dupapply.md §4 adds (A-1 .. A-5). Standing bias: a false alarm is
// the expensive failure -- every "clear" here must be a GENUINE clear, and
// every ambiguous shape must land on `indeterminate` or `unavailable`,
// never silently read as `clear`.
//
// This file does NOT re-derive postingIdentity.js/companyIdentity.js's own
// algebraic properties (the C-16b pairwise invariant, the ReDoS timing
// cases, the Unicode-fold pins) -- those are W1A's shipped test files'
// job. This file tests what is UNIQUE to the evaluator: which rows count,
// the four-valued verdict, the merge, and the extraRoutes seam.
// ---------------------------------------------------------------------------

const RUN_STARTED_AT = Date.parse("2026-06-15T12:00:00.000Z");

function positionRow({
  positionId = "pos-1",
  url = "https://boards.greenhouse.io/acme/jobs/4012345",
  external_id,
  company = "Acme Inc",
  title = "Software Engineer",
} = {}) {
  return { id: positionId, url, external_id, company, title };
}

function appRow({
  id = "app-1",
  status = "applied",
  applied_at = "2026-06-01T00:00:00.000Z",
  positions = positionRow(),
} = {}) {
  return { id, status, applied_at, positions };
}

function candidate({
  id = "candidate-1",
  url = "https://boards.greenhouse.io/acme/jobs/4012345",
  external_id,
  company = "Acme Inc",
  title = "Software Engineer",
} = {}) {
  return { id, url, external_id, company, title };
}

function baseArgs(overrides = {}) {
  return {
    candidate: candidate(),
    rows: [],
    rowsState: "ready",
    runStartedAt: RUN_STARTED_AT,
    ...overrides,
  };
}

// ===========================================================================
// A-2 -- the highest-value fix in the chunk: a failed or in-flight load must
// NOT read as `clear`. Asserted on the VERDICT OBJECT only -- the plan (V-5)
// notes the DOM is byte-identical for `clear` and `unavailable` (both render
// nothing), so a DOM assertion here would be unfalsifiable. This file has no
// DOM at all (node environment, pure function) -- there is nothing else to
// assert against.
// ===========================================================================
describe("A-2 -- rowsState gates BOTH signals to `unavailable`, before any row is read", () => {
  it("rowsState: 'loading' is unavailable/rows-unavailable for both signals, even with rows already present", () => {
    const rows = [appRow(), appRow({ id: "app-2" })];
    const result = evaluatePriorApplications(baseArgs({ rows, rowsState: "loading" }));
    expect(result.samePosition).toEqual({ verdict: "unavailable", reason: "rows-unavailable" });
    expect(result.company).toEqual({ verdict: "unavailable", reason: "rows-unavailable" });
  });

  it("rowsState: 'error' is unavailable/rows-unavailable for both signals", () => {
    const result = evaluatePriorApplications(baseArgs({ rows: [appRow()], rowsState: "error" }));
    expect(result.samePosition.verdict).toBe("unavailable");
    expect(result.samePosition.reason).toBe("rows-unavailable");
    expect(result.company.verdict).toBe("unavailable");
    expect(result.company.reason).toBe("rows-unavailable");
  });

  it("rows == null is unavailable/rows-unavailable even when rowsState claims 'ready' -- a caller-contract violation must not be read as clear", () => {
    const result = evaluatePriorApplications(baseArgs({ rows: null, rowsState: "ready" }));
    expect(result.samePosition.verdict).toBe("unavailable");
    expect(result.company.verdict).toBe("unavailable");
  });

  it("rows === undefined is unavailable/rows-unavailable", () => {
    const result = evaluatePriorApplications(baseArgs({ rows: undefined, rowsState: "ready" }));
    expect(result.samePosition.verdict).toBe("unavailable");
    expect(result.company.verdict).toBe("unavailable");
  });

  it("[control, not a defect] rowsState: 'ready' with a genuinely EMPTY array is clear, not unavailable -- the two states must remain distinguishable", () => {
    const result = evaluatePriorApplications(baseArgs({ rows: [], rowsState: "ready" }));
    expect(result.samePosition.verdict).toBe("clear");
    expect(result.company.verdict).toBe("clear"); // a valid, non-empty candidate company key with 0 rows is a genuine clear
  });

  it("diagnostics.rowsExamined and rowsCounted are 0 when unavailable -- no row is read, not merely none counted", () => {
    const result = evaluatePriorApplications(
      baseArgs({ rows: [appRow(), appRow({ id: "app-2" })], rowsState: "loading" }),
    );
    expect(result.diagnostics.rowsExamined).toBe(0);
    expect(result.diagnostics.rowsCounted).toBe(0);
    expect(result.diagnostics.rowsState).toBe("loading");
  });

  it("[mutant-discriminating] a rows-unavailable verdict is STRUCTURALLY distinct from clear -- verdict string differs, not merely a reason field", () => {
    const unavailable = evaluatePriorApplications(baseArgs({ rows: null, rowsState: "ready" }));
    const clear = evaluatePriorApplications(baseArgs({ rows: [], rowsState: "ready" }));
    expect(unavailable.samePosition.verdict).not.toBe(clear.samePosition.verdict);
  });
});

// ===========================================================================
// C-15 / C-9 / C-14 -- Signal 1 core.
// ===========================================================================
describe("Signal 1 (samePosition) -- C-14, C-9, C-15", () => {
  it("C-15: no posting identity on the candidate -> indeterminate/no-posting-identity, never clear", () => {
    const result = evaluatePriorApplications(baseArgs({ candidate: candidate({ url: "not-a-url", external_id: undefined }) }));
    expect(result.samePosition).toEqual({ verdict: "indeterminate", reason: "no-posting-identity" });
  });

  it("C-14: a genuine prior applied-or-later row at the same posting key is a hit, carrying raw evidence", () => {
    const rows = [appRow({ id: "prior-1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("hit");
    expect(result.samePosition.route).toBe("url");
    expect(result.samePosition.match).toMatchObject({
      applicationId: "prior-1",
      company: "Acme Inc",
      title: "Software Engineer",
      status: "applied",
      appliedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("a row at a DIFFERENT posting key never matches -- true negative", () => {
    const rows = [appRow({ positions: positionRow({ url: "https://boards.greenhouse.io/other/jobs/9999999" }) })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("clear");
  });

  it("a row at the same posting but a PRE-APPLY status (e.g. 'tailored') is not evidence -- ignored, not indeterminate", () => {
    const rows = [appRow({ status: "tailored", applied_at: null })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("clear");
  });

  it("C-12: an undated applied-or-later row at a matching key yields indeterminate/undated-match, not clear and not hit", () => {
    const rows = [appRow({ status: "applied", applied_at: null })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition).toEqual({ verdict: "indeterminate", reason: "undated-match" });
  });

  it("C-12: an applied_at value parseStageInstant cannot parse (garbage string) is treated the same as undated", () => {
    const rows = [appRow({ status: "applied", applied_at: "not-a-date" })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition).toEqual({ verdict: "indeterminate", reason: "undated-match" });
  });

  it("C-9b: a matching row stamped AFTER runStartedAt yields indeterminate/future-or-concurrent, not clear, not hit", () => {
    const rows = [appRow({ status: "applied", applied_at: "2027-06-15T12:00:00.000Z" })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition).toEqual({ verdict: "indeterminate", reason: "future-or-concurrent" });
  });

  it("C-9b: a row stamped EXACTLY at runStartedAt (diff === 0) is future-routed, not a hit -- it may be this run's own write", () => {
    const rows = [appRow({ status: "applied", applied_at: new Date(RUN_STARTED_AT).toISOString() })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.reason).toBe("future-or-concurrent");
  });

  it("C-9b: a row stamped one millisecond BEFORE runStartedAt is a genuine hit", () => {
    const rows = [appRow({ status: "applied", applied_at: new Date(RUN_STARTED_AT - 1).toISOString() })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("hit");
  });

  it("C-11a: an off-vocabulary ('unknown') status at a matching key is indeterminate/unknown-status-match, not clear -- the core takes an arbitrary array, so this is seeded directly", () => {
    const rows = [appRow({ status: "submitted", applied_at: "2026-06-01T00:00:00.000Z" })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition).toEqual({ verdict: "indeterminate", reason: "unknown-status-match" });
  });

  it("C-1c / C-25: a row with a null positions embed does not throw and is silently excluded (an accepted miss -- it has no company either)", () => {
    const rows = [{ id: "ghost", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: null }];
    expect(() => evaluatePriorApplications(baseArgs({ rows }))).not.toThrow();
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("clear");
  });

  it("[pair, C-25] a null-embed row does NOT corrupt evaluation of a genuinely matching row elsewhere in the same array -- never a silent clear caused by a neighboring bad row", () => {
    const rows = [
      { id: "ghost", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: null },
      { id: "ghost2", positions: undefined },
      null,
      undefined,
      "garbage",
      42,
      appRow({ id: "real-hit", status: "applied", applied_at: "2026-06-02T00:00:00.000Z" }),
    ];
    expect(() => evaluatePriorApplications(baseArgs({ rows }))).not.toThrow();
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("hit");
    expect(result.samePosition.match.applicationId).toBe("real-hit");
  });

  it("never matches on title+company alone -- byte-identical title/company at a DIFFERENT URL is not a hit (delegated to postingIdentity's matchesCandidate)", () => {
    const rows = [
      appRow({
        status: "applied",
        applied_at: "2026-06-01T00:00:00.000Z",
        positions: positionRow({ url: "https://boards.greenhouse.io/other/jobs/8888888", company: "Acme Inc", title: "Software Engineer" }),
      }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("clear");
  });
});

// ===========================================================================
// C-7 / C-16 / C-16a / C-16c / C-17 -- Signal 2 core.
// ===========================================================================
describe("Signal 2 (company) -- C-7, C-16, C-16a, C-16c, C-17", () => {
  it("C-7: an empty candidate company key -> indeterminate/no-company-key, never '0 applications'", () => {
    const result = evaluatePriorApplications(baseArgs({ candidate: candidate({ company: "" }) }));
    expect(result.company).toEqual({ verdict: "indeterminate", reason: "no-company-key" });
  });

  it("C-7: a punctuation-only candidate company also yields no-company-key", () => {
    const result = evaluatePriorApplications(baseArgs({ candidate: candidate({ company: "---" }) }));
    expect(result.company.reason).toBe("no-company-key");
  });

  it("fewer than 2 in-window applied-or-later rows at the company is clear", () => {
    const rows = [appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company.verdict).toBe("clear");
    expect(result.company.count).toBe(1);
  });

  it("C-16: 2 applied rows at the same company, DIFFERENT postings, both in-window -> hit, count 2", () => {
    const rows = [
      appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p1", url: "https://boards.greenhouse.io/acme/jobs/1111111" }) }),
      appRow({ id: "a2", status: "applied", applied_at: "2026-06-05T00:00:00.000Z", positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company.verdict).toBe("hit");
    expect(result.company.count).toBe(2);
    expect(result.company.evidence).toHaveLength(2);
  });

  it("C-16 regression guard: 2 application ROWS sharing ONE posting URL count as ONE group, not two -- the exact case naive argument types get wrong", () => {
    const shared = positionRow({ positionId: "p1", url: "https://boards.greenhouse.io/acme/jobs/1111111" });
    const rows = [
      appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: shared }),
      appRow({ id: "a2", status: "interviewing", applied_at: "2026-06-05T00:00:00.000Z", positions: shared }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company.verdict).not.toBe("hit");
    expect(result.company.count).toBe(1);
  });

  it("C-16a [pin]: one posting stored once WITH a url and once WITHOUT counts as two groups for Signal 2, AND is consistently reported (not a Signal-1 match either) -- known, accepted over-count", () => {
    const rows = [
      appRow({
        id: "a1",
        status: "applied",
        applied_at: "2026-06-01T00:00:00.000Z",
        positions: positionRow({ positionId: "p1", url: "https://boards.greenhouse.io/acme/jobs/1111111" }),
      }),
      appRow({
        id: "a2",
        status: "applied",
        applied_at: "2026-06-05T00:00:00.000Z",
        positions: { id: "p1", url: "", company: "Acme Inc", title: "Software Engineer" }, // same posting, no URL
      }),
    ];
    const result = evaluatePriorApplications(baseArgs({ candidate: candidate({ url: "https://boards.greenhouse.io/unrelated/jobs/5551212" }), rows }));
    expect(result.company.verdict).toBe("hit");
    expect(result.company.count).toBe(2);
    // Consistently reported: Signal 1 (evaluated against a THIRD, unrelated
    // candidate posting) does not also claim these two rows are one match.
    expect(result.samePosition.verdict).toBe("clear");
  });

  it("C-16c: one dated row plus one UNDATED row at the same company yields indeterminate/undated-company-rows, not clear -- Signal 2 must not silently drop an undatable qualifying row", () => {
    const rows = [
      appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p1" }) }),
      appRow({ id: "a2", status: "applied", applied_at: null, positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company).toMatchObject({ verdict: "indeterminate", reason: "undated-company-rows", count: 1, undatableCount: 1 });
    expect(result.company.evidence.some((e) => e.applicationId === "a2")).toBe(true);
  });

  it("C-16c: one dated row plus one FUTURE-dated row at the same company yields indeterminate/future-company-rows, not clear -- red against a naive 'fewer than two' rule", () => {
    const rows = [
      appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p1" }) }),
      appRow({ id: "a2", status: "applied", applied_at: "2027-06-15T12:00:00.000Z", positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company).toMatchObject({ verdict: "indeterminate", reason: "future-company-rows", count: 1, futureCount: 1 });
  });

  it("C-16c: BOTH an undated row and a future row alongside one dated row -- still indeterminate, never a definite clear or hit", () => {
    const rows = [
      appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p1" }) }),
      appRow({ id: "a2", status: "applied", applied_at: null, positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
      appRow({ id: "a3", status: "applied", applied_at: "2027-01-01T00:00:00.000Z", positions: positionRow({ positionId: "p3", url: "https://boards.greenhouse.io/acme/jobs/3333333" }) }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company.verdict).toBe("indeterminate");
    expect(["undated-company-rows", "future-company-rows"]).toContain(result.company.reason);
    expect(result.company.undatableCount).toBe(1);
    expect(result.company.futureCount).toBe(1);
  });

  it("a row out-of-window (too old, but validly dated) is simply not counted -- not undatable, not future, not an error", () => {
    const rows = [
      appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p1" }) }),
      appRow({ id: "a2", status: "applied", applied_at: "2026-01-01T00:00:00.000Z", positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company.verdict).toBe("clear");
    expect(result.company.count).toBe(1);
    expect(result.company.undatableCount).toBe(0);
    expect(result.company.futureCount).toBe(0);
  });

  it("C-17: the Signal-1-matching row DOES count toward the company total -- a real prior application at that employer, reported by both signals on one row", () => {
    const rows = [
      appRow({ id: "same-posting", status: "applied", applied_at: "2026-06-01T00:00:00.000Z" }), // matches candidate's own posting
      appRow({ id: "other-posting", status: "applied", applied_at: "2026-06-05T00:00:00.000Z", positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.samePosition.verdict).toBe("hit");
    expect(result.company.verdict).toBe("hit");
    expect(result.company.count).toBe(2);
  });

  it("[mutant-discriminating] company.evidence is OMITTED (not merely empty) on a clear verdict -- nothing renders", () => {
    const rows = [appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p1" }) })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.company.verdict).toBe("clear");
    expect(result.company.evidence).toBeUndefined();
  });

  it("a row whose positions embed is null does not throw and is excluded from the company count", () => {
    const rows = [{ id: "ghost", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: null }];
    expect(() => evaluatePriorApplications(baseArgs({ rows }))).not.toThrow();
  });
});

// ===========================================================================
// C-13 -- the window, via the exported test-only `inWindow`.
// ===========================================================================
describe("inWindow -- C-13, the 9 boundary cases", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = RUN_STARTED_AT;

  it.each([
    ["exactly 30 days out", now - 30 * DAY, 30, false],
    ["29d23h in", now - (29 * DAY + 23 * 60 * 60 * 1000), 30, true],
    ["30d minus 1ms in", now - (30 * DAY - 1), 30, true],
    ["30d plus 1ms out", now - (30 * DAY + 1), 30, false],
    ["diff === 0 in", now, 30, true],
    ["1ms future out", now + 1, 30, false],
    ["31 days out", now - 31 * DAY, 30, false],
    ["1 day in", now - DAY, 30, true],
  ])("%s", (_label, ms, windowDays, expected) => {
    expect(inWindow(ms, now, windowDays)).toBe(expected);
  });

  it("a typo'd future year (2027) is out of window", () => {
    expect(inWindow(Date.parse("2027-01-01T00:00:00.000Z"), now, 30)).toBe(false);
  });

  it("honors a custom windowDays (0 disables Signal 2 -- the named free partial kill switch, N-8)", () => {
    const rows = [
      appRow({ id: "a1", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p1" }) }),
      appRow({ id: "a2", status: "applied", applied_at: "2026-06-05T00:00:00.000Z", positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
    ];
    const result = evaluatePriorApplications(baseArgs({ rows, windowDays: 0 }));
    expect(result.company.verdict).not.toBe("hit"); // nothing can be "in window" with a 0-length window
  });
});

// ===========================================================================
// §4 A-3 -- candidateStrandedApplied.
// ===========================================================================
describe("A-3 -- candidateStrandedApplied", () => {
  it("true, with an otherwise-clear scan, upgrades Signal 1 to indeterminate/stranded-applied-row -- never clear", () => {
    const result = evaluatePriorApplications(baseArgs({ candidateStrandedApplied: true }));
    expect(result.samePosition).toEqual({ verdict: "indeterminate", reason: "stranded-applied-row" });
  });

  it("false (the default) leaves an otherwise-clear scan clear", () => {
    const result = evaluatePriorApplications(baseArgs());
    expect(result.samePosition.verdict).toBe("clear");
  });

  it("true never turns an existing HIT into indeterminate -- the flag can only add, never remove, a warning", () => {
    const rows = [appRow({ status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })];
    const result = evaluatePriorApplications(baseArgs({ rows, candidateStrandedApplied: true }));
    expect(result.samePosition.verdict).toBe("hit");
  });

  it("true does not affect Signal 2 -- the lookup carries no company (stated in writing, 1f L-5's second option)", () => {
    const clearArgs = baseArgs();
    const strandedArgs = baseArgs({ candidateStrandedApplied: true });
    const clearResult = evaluatePriorApplications(clearArgs);
    const strandedResult = evaluatePriorApplications(strandedArgs);
    expect(strandedResult.company).toEqual(clearResult.company);
  });
});

// ===========================================================================
// S-2 / mergeVerdicts -- a monotone upgrade, used TODAY (E3's two-evaluation
// pattern), not a speculative extension point.
// ===========================================================================
describe("mergeVerdicts -- S-2, monotone, exported and used today", () => {
  const CAPABILITY_REASONS = ["no-posting-identity", "no-company-key", "rows-unavailable", "check-threw"];
  function referenceRank(v) {
    if (v.verdict === "hit") return 4;
    if (v.verdict === "indeterminate") return CAPABILITY_REASONS.includes(v.reason) ? 2 : 3;
    if (v.verdict === "unavailable") return 1;
    return 0; // clear
  }
  const SAMPLE_VERDICTS = [
    { verdict: "clear" },
    { verdict: "unavailable", reason: "rows-unavailable" },
    { verdict: "indeterminate", reason: "no-posting-identity" }, // capability
    { verdict: "indeterminate", reason: "undated-match" }, // evidence-bearing
    { verdict: "hit", match: { applicationId: "z" }, route: "url" },
  ];

  it("[monotone] over all 25 ordered pairs of the five verdict tiers, for BOTH signals: the merged rank is exactly max(rank(a), rank(b))", () => {
    for (const a of SAMPLE_VERDICTS) {
      for (const b of SAMPLE_VERDICTS) {
        const prev = { samePosition: a, company: a, checkedAt: 1, diagnostics: {} };
        const next = { samePosition: b, company: b, checkedAt: 2, diagnostics: {} };
        const merged = mergeVerdicts(prev, next);
        const expectedRank = Math.max(referenceRank(a), referenceRank(b));
        expect(referenceRank(merged.samePosition)).toBe(expectedRank);
        expect(referenceRank(merged.company)).toBe(expectedRank);
      }
    }
  });

  it("[real-world shape, E3] an early Signal-1-only evaluation (company unresolved) merges with a later full evaluation without erasing either signal's best result", () => {
    const early = evaluatePriorApplications(
      baseArgs({ candidate: candidate({ company: "" }), rows: [appRow({ status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })] }),
    );
    expect(early.samePosition.verdict).toBe("hit");
    expect(early.company.reason).toBe("no-company-key");

    const rowsAtResponse = [
      appRow({ id: "same", status: "applied", applied_at: "2026-06-01T00:00:00.000Z" }),
      appRow({ id: "other", status: "applied", applied_at: "2026-06-05T00:00:00.000Z", positions: positionRow({ positionId: "p2", url: "https://boards.greenhouse.io/acme/jobs/2222222" }) }),
    ];
    const later = evaluatePriorApplications(baseArgs({ rows: rowsAtResponse }));
    expect(later.samePosition.verdict).toBe("hit");
    expect(later.company.verdict).toBe("hit");

    const merged = mergeVerdicts(early, later);
    expect(merged.samePosition.verdict).toBe("hit"); // not erased
    expect(merged.company.verdict).toBe("hit"); // not erased by the earlier no-company-key
  });

  it("commutative in outcome: merge(a,b) and merge(b,a) report the same verdict tier for both signals", () => {
    const a = { samePosition: { verdict: "hit", match: { applicationId: "1" }, route: "url" }, company: { verdict: "clear" }, checkedAt: 1, diagnostics: {} };
    const b = { samePosition: { verdict: "clear" }, company: { verdict: "hit", count: 2 }, checkedAt: 2, diagnostics: {} };
    const merged1 = mergeVerdicts(a, b);
    const merged2 = mergeVerdicts(b, a);
    expect(merged1.samePosition.verdict).toBe(merged2.samePosition.verdict);
    expect(merged1.company.verdict).toBe(merged2.company.verdict);
    expect(merged1.samePosition.verdict).toBe("hit");
    expect(merged1.company.verdict).toBe("hit");
  });

  it("unions company.evidence rather than discarding one side's rows when both are evidence-bearing", () => {
    const a = {
      samePosition: { verdict: "clear" },
      company: { verdict: "hit", count: 2, undatableCount: 0, futureCount: 0, evidence: [{ applicationId: "1", company: "Acme" }] },
      checkedAt: 1,
      diagnostics: {},
    };
    const b = {
      samePosition: { verdict: "clear" },
      company: { verdict: "hit", count: 2, undatableCount: 0, futureCount: 0, evidence: [{ applicationId: "2", company: "Acme" }] },
      checkedAt: 2,
      diagnostics: {},
    };
    const merged = mergeVerdicts(a, b);
    const ids = merged.company.evidence.map((e) => e.applicationId).sort();
    expect(ids).toEqual(["1", "2"]);
  });

  it("de-duplicates evidence by applicationId when the same row appears on both sides", () => {
    const shared = { applicationId: "1", company: "Acme" };
    const a = { samePosition: { verdict: "clear" }, company: { verdict: "hit", count: 2, evidence: [shared] }, checkedAt: 1, diagnostics: {} };
    const b = { samePosition: { verdict: "clear" }, company: { verdict: "hit", count: 2, evidence: [shared] }, checkedAt: 2, diagnostics: {} };
    const merged = mergeVerdicts(a, b);
    expect(merged.company.evidence).toHaveLength(1);
  });

  it("previous == null returns next unchanged; next == null returns previous unchanged", () => {
    const only = { samePosition: { verdict: "hit", match: {}, route: "url" }, company: { verdict: "clear" }, checkedAt: 1, diagnostics: {} };
    expect(mergeVerdicts(null, only)).toEqual(only);
    expect(mergeVerdicts(only, null)).toEqual(only);
    expect(mergeVerdicts(undefined, only)).toEqual(only);
  });

  it("[mutant-discriminating] a last-write-wins merge would let a later CLEAR erase an earlier HIT -- this must not happen", () => {
    const withHit = { samePosition: { verdict: "hit", match: { applicationId: "1" }, route: "url" }, company: { verdict: "clear" }, checkedAt: 1, diagnostics: {} };
    const laterClear = { samePosition: { verdict: "clear" }, company: { verdict: "clear" }, checkedAt: 2, diagnostics: {} };
    const merged = mergeVerdicts(withHit, laterClear);
    expect(merged.samePosition.verdict).toBe("hit"); // NOT "clear" -- a last-write-wins mutant fails this line
  });
});

// ===========================================================================
// extraRoutes -- the phase-two seam (S-1). Union-only; consulted only when
// the primary route is not already a hit; never touches the identity key.
// ===========================================================================
describe("extraRoutes -- the phase-two identity-route seam", () => {
  it("defaults to [] and has no effect when omitted", () => {
    const result = evaluatePriorApplications(baseArgs());
    expect(result.samePosition.verdict).toBe("clear");
  });

  it("an extra route reporting 'match' for a row promotes an otherwise-clear Signal 1 to hit", () => {
    const otherRow = appRow({ id: "described-match", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p9", url: "https://boards.greenhouse.io/other/jobs/9999999" }) });
    const fakeDescriptionRoute = () => new Map([["described-match", "match"]]);
    const result = evaluatePriorApplications(baseArgs({ rows: [otherRow], extraRoutes: [fakeDescriptionRoute] }));
    expect(result.samePosition.verdict).toBe("hit");
    expect(result.samePosition.match.applicationId).toBe("described-match");
  });

  it("an extra route reporting {reason} upgrades an otherwise-clear Signal 1 to indeterminate, never to hit by itself", () => {
    const fakeRoute = () => new Map([["row-x", { reason: "borderline-description-match" }]]);
    const result = evaluatePriorApplications(baseArgs({ extraRoutes: [fakeRoute] }));
    expect(result.samePosition.verdict).toBe("indeterminate");
    expect(result.samePosition.reason).toBe("borderline-description-match");
  });

  it("an extra route reporting 'clear' is a no-op", () => {
    const fakeRoute = () => new Map([["row-x", "clear"]]);
    const result = evaluatePriorApplications(baseArgs({ extraRoutes: [fakeRoute] }));
    expect(result.samePosition.verdict).toBe("clear");
  });

  it("[union-only] an extra route is NOT consulted when the URL route already fired a hit -- proven with a spy that must not be called", () => {
    const rows = [appRow({ status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })];
    const spyRoute = vi.fn(() => new Map());
    const result = evaluatePriorApplications(baseArgs({ rows, extraRoutes: [spyRoute] }));
    expect(result.samePosition.verdict).toBe("hit");
    expect(spyRoute).not.toHaveBeenCalled();
  });

  it("[union] multiple routes ratchet upward only -- once one route reports a hit, a later route's weaker outcome cannot undo it", () => {
    const otherRow = appRow({ id: "described-match", status: "applied", applied_at: "2026-06-01T00:00:00.000Z", positions: positionRow({ positionId: "p9", url: "https://boards.greenhouse.io/other/jobs/9999999" }) });
    const routeA = () => new Map([["described-match", "match"]]);
    const routeB = () => new Map([["described-match", "clear"]]);
    const result = evaluatePriorApplications(baseArgs({ rows: [otherRow], extraRoutes: [routeA, routeB] }));
    expect(result.samePosition.verdict).toBe("hit");
  });

  it("a throwing extra route does not crash the evaluator -- purity is preserved even when a future route is buggy", () => {
    const brokenRoute = () => {
      throw new Error("boom");
    };
    expect(() => evaluatePriorApplications(baseArgs({ extraRoutes: [brokenRoute] }))).not.toThrow();
  });

  it("a route returning something other than a Map is ignored, not crashed on", () => {
    const badRoute = () => ({ notAMap: true });
    expect(() => evaluatePriorApplications(baseArgs({ extraRoutes: [badRoute] }))).not.toThrow();
    const result = evaluatePriorApplications(baseArgs({ extraRoutes: [badRoute] }));
    expect(result.samePosition.verdict).toBe("clear");
  });
});

// ===========================================================================
// C-19 -- purity.
// ===========================================================================
describe("C-19 -- the core is pure", () => {
  it("never calls Date.now() -- 'now' is always the injected nowMs/runStartedAt parameter", () => {
    const spy = vi.spyOn(Date, "now");
    evaluatePriorApplications(
      baseArgs({ rows: [appRow({ status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })] }),
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is deterministic for identical input", () => {
    const rows = [appRow({ status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })];
    const args = baseArgs({ rows });
    const first = evaluatePriorApplications(args);
    const second = evaluatePriorApplications(args);
    expect(first).toEqual(second);
  });

  it("never throws for a battery of hostile row shapes", () => {
    const hostileRows = [null, undefined, 0, "", "garbage", 42, [], {}, { positions: 1 }, { positions: "x" }, { positions: [] }, { status: {}, applied_at: {} }];
    expect(() => evaluatePriorApplications(baseArgs({ rows: hostileRows }))).not.toThrow();
  });

  it("never throws for a hostile candidate", () => {
    for (const badCandidate of [null, undefined, {}, "garbage", 42]) {
      expect(() => evaluatePriorApplications(baseArgs({ candidate: badCandidate }))).not.toThrow();
    }
  });

  it("findPriorSamePosting itself never throws and is independently callable (test-only export)", () => {
    expect(() => findPriorSamePosting({ candidate: null, rows: null, runStartedAt: RUN_STARTED_AT })).not.toThrow();
    expect(findPriorSamePosting({ candidate: candidate(), rows: [], runStartedAt: RUN_STARTED_AT })).toEqual({ verdict: "clear" });
  });
});

// ===========================================================================
// C-18 -- verdict shape.
// ===========================================================================
describe("C-18 -- the verdict shape", () => {
  it("checkedAt equals the injected nowMs, never wall-clock time", () => {
    const result = evaluatePriorApplications(baseArgs({ runStartedAt: RUN_STARTED_AT, nowMs: RUN_STARTED_AT + 5000 }));
    expect(result.checkedAt).toBe(RUN_STARTED_AT + 5000);
  });

  it("nowMs defaults to runStartedAt when omitted", () => {
    const result = evaluatePriorApplications(baseArgs({ runStartedAt: RUN_STARTED_AT }));
    expect(result.checkedAt).toBe(RUN_STARTED_AT);
  });

  it("diagnostics carries the raw candidate keys, rowsExamined, rowsCounted, rowsState, windowDays and runStartedAt", () => {
    const rows = [appRow({ status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })];
    const result = evaluatePriorApplications(baseArgs({ rows }));
    expect(result.diagnostics.rowsExamined).toBe(1);
    expect(result.diagnostics.rowsCounted).toBeGreaterThan(0);
    expect(result.diagnostics.rowsState).toBe("ready");
    expect(result.diagnostics.candidateKey).toBe("u:https://boards.greenhouse.io/acme/jobs/4012345");
    expect(result.diagnostics.candidateCompanyKey).toBe("a:acme");
    expect(result.diagnostics.windowDays).toBe(30);
    expect(result.diagnostics.runStartedAt).toBe(RUN_STARTED_AT);
  });

  it("verdict is always one of the four defined values, for both signals, across every scenario in this file", () => {
    const VALID = new Set(["clear", "hit", "indeterminate", "unavailable"]);
    const scenarios = [
      baseArgs(),
      baseArgs({ rows: null }),
      baseArgs({ rowsState: "loading" }),
      baseArgs({ candidateStrandedApplied: true }),
      baseArgs({ candidate: candidate({ company: "" }) }),
      baseArgs({ rows: [appRow({ status: "applied", applied_at: "2026-06-01T00:00:00.000Z" })] }),
    ];
    for (const args of scenarios) {
      const result = evaluatePriorApplications(args);
      expect(VALID.has(result.samePosition.verdict)).toBe(true);
      expect(VALID.has(result.company.verdict)).toBe(true);
    }
  });
});
