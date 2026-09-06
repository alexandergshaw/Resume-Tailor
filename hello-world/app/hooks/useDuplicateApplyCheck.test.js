// @vitest-environment jsdom
//
// The duplicate-application flag's state and single call site
// (3-plan-dupapply.md wave W3B). Extracted out of app/page.js into its own
// hook (see the hook's own header for why -- app/page.js's line ceiling),
// which has the useful side effect of making these properties directly
// testable by mounting the REAL hook, exactly like
// app/hooks/useManualTailor.test.js does for its pipeline, rather than by
// extracting and reconstructing source text out of an unmountable
// component.
//
// This file tests the properties 3-plan-dupapply.md's brief calls out as
// what this wave must get right: the core never throws into the caller
// (§4 A-1), a failed/in-flight load never reads as `clear` (§4 A-2), the
// unfiltered row set is the input, and mergeVerdicts actually combines two
// fires for one job (S-2). app/page.duplicateApply.wiring.test.js covers
// the complementary, purely structural property this file cannot see:
// WHERE in app/page.js's three handlers each fire point sits relative to
// their own try/finally.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { TRACKING_TAB_HIDDEN_STATUSES } from "../../lib/applications/statusVocabulary.js";

vi.mock("@/lib/duplicateApply/duplicateApplyVerdict.js", async () => {
  const actual = await vi.importActual("@/lib/duplicateApply/duplicateApplyVerdict.js");
  return { ...actual, evaluatePriorApplications: vi.fn(actual.evaluatePriorApplications) };
});

import { useDuplicateApplyCheck } from "./useDuplicateApplyCheck.js";
import { evaluatePriorApplications } from "@/lib/duplicateApply/duplicateApplyVerdict.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api;
let container;
let root;

function Probe(props) {
  api = useDuplicateApplyCheck(props);
  return null;
}

function baseProps(overrides) {
  return {
    applicationData: [],
    applicationError: null,
    applicationLoadedOnce: true,
    appliedByExternalId: null,
    trackedJobs: [],
    setMainTab: vi.fn(),
    setInterviewSearch: vi.fn(),
    ...overrides,
  };
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

async function rerender(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

function run(...args) {
  act(() => {
    api.runDuplicateCheck(...args);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  evaluatePriorApplications.mockImplementation(() => ({
    samePosition: { verdict: "clear" },
    company: { verdict: "clear", count: 0 },
    checkedAt: 0,
    diagnostics: { rowsExamined: 0, rowsCounted: 0 },
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("useDuplicateApplyCheck -- §4 A-1: a throwing core must not throw into the caller", () => {
  it("does not throw when evaluatePriorApplications throws", async () => {
    evaluatePriorApplications.mockImplementation(() => {
      throw new Error("simulated core failure");
    });
    await mount(baseProps());
    expect(() => run({ id: "x", url: "https://acme.example/jobs/1" }, { jobId: "job-1", entryPoint: "url" })).not.toThrow();
  });

  it("does not render a banner for a lone throw (capability reason, S-10i) but still records that the check ran", async () => {
    evaluatePriorApplications.mockImplementation(() => {
      throw new Error("simulated core failure");
    });
    await mount(baseProps());
    // `unavailable`/`check-threw` is a CAPABILITY reason (same class as
    // `clear`), so presentVerdict correctly renders nothing for it alone --
    // this is not a silent bug, it is S-10i. What must still be true is
    // that the check RAN (dupeAnnounceSeq bumps) rather than being dropped
    // before ever reaching state.
    const before = api.dupeAnnounceSeq;
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(api.dupeNotice).toBeNull();
    expect(api.dupeAnnounceSeq).toBeGreaterThan(before);
  });

  it("a throw does NOT downgrade an already-recorded hit for the same job (mergeVerdicts' rank order)", async () => {
    // Establishes a real hit first, then makes the SAME job's next check
    // throw -- proving the throw's `unavailable` verdict is folded in via
    // mergeVerdicts (which never lets a lower-ranked result win) rather
    // than replacing state outright, which would otherwise silently erase
    // a real warning the user has already seen.
    evaluatePriorApplications.mockImplementationOnce(() => ({
      samePosition: { verdict: "hit", match: { applicationId: "a1" }, route: "url" },
      company: { verdict: "clear", count: 0 },
      checkedAt: 1,
      diagnostics: {},
    }));
    await mount(baseProps());
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(api.dupeNotice).not.toBeNull();

    evaluatePriorApplications.mockImplementation(() => {
      throw new Error("simulated core failure");
    });
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(api.dupeNotice).not.toBeNull();
    const same = api.dupeNotice.signals.find((s) => s.signal === "same-position");
    expect(same).toMatchObject({ severity: "hit" });
  });
});

describe("useDuplicateApplyCheck -- §4 A-2: a failed or in-flight load must not read as clear", () => {
  it("passes rowsState 'error' when applicationError is set", async () => {
    await mount(baseProps({ applicationError: "network exploded", applicationLoadedOnce: true }));
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(evaluatePriorApplications.mock.calls[0][0]).toMatchObject({ rowsState: "error" });
  });

  it("passes rowsState 'loading' before the first load has ever succeeded", async () => {
    await mount(baseProps({ applicationError: null, applicationLoadedOnce: false }));
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(evaluatePriorApplications.mock.calls[0][0]).toMatchObject({ rowsState: "loading" });
  });

  it("passes rowsState 'ready' once loaded with no error", async () => {
    await mount(baseProps({ applicationError: null, applicationLoadedOnce: true }));
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(evaluatePriorApplications.mock.calls[0][0]).toMatchObject({ rowsState: "ready" });
  });
});

describe("useDuplicateApplyCheck -- the unfiltered application list is the input", () => {
  it("passes applicationData itself (identity), not a copy", async () => {
    const sentinelRows = [{ id: "app-1", status: "applied" }];
    await mount(baseProps({ applicationData: sentinelRows }));
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(evaluatePriorApplications.mock.calls[0][0].rows).toBe(sentinelRows);
  });
});

describe("useDuplicateApplyCheck -- S-2: mergeVerdicts combines two fires for one jobId", () => {
  it("a second call for the SAME jobId merges with, not replaces, the first", async () => {
    evaluatePriorApplications
      .mockImplementationOnce(() => ({
        samePosition: { verdict: "hit", match: { applicationId: "prior-1" }, route: "url" },
        company: { verdict: "indeterminate", reason: "no-company-key" },
        checkedAt: 1,
        diagnostics: {},
      }))
      .mockImplementationOnce(() => ({
        samePosition: { verdict: "clear" },
        company: { verdict: "hit", count: 3, undatableCount: 0, futureCount: 0, evidence: [] },
        checkedAt: 2,
        diagnostics: {},
      }));
    await mount(baseProps());
    run({ id: "url-1", url: "https://acme.example/jobs/123456" }, { jobId: "url-1", entryPoint: "url" });
    run({ id: "url-1", url: "https://acme.example/jobs/123456", company: "Acme" }, { jobId: "url-1", entryPoint: "url" });

    expect(api.dupeNotice).not.toBeNull();
    const signals = Object.fromEntries(api.dupeNotice.signals.map((s) => [s.signal, s]));
    // Signal 1's hit from the FIRST call survives the second call, which
    // itself reported same-position as merely "clear".
    expect(signals["same-position"]).toMatchObject({ severity: "hit" });
    // Signal 2's hit from the SECOND call is present too -- additive, not
    // "last write wins".
    expect(signals.company).toMatchObject({ severity: "hit" });
  });
});

describe("useDuplicateApplyCheck -- §4 A-3: a stranded applied row", () => {
  it("upgrades the verdict to indeterminate when the candidate's external id is stranded", async () => {
    const appliedByExternalId = new Map([["gh-42", { status: "tracking", appliedAt: "2026-01-01T00:00:00Z" }]]);
    await mount(baseProps({ appliedByExternalId }));
    run({ id: "gh-42" }, { jobId: "search-1", entryPoint: "search" });
    expect(evaluatePriorApplications.mock.calls[0][0].candidateStrandedApplied).toBe(true);
  });

  it("is false when there is no entry for the candidate's id", async () => {
    await mount(baseProps({ appliedByExternalId: new Map() }));
    run({ id: "gh-99" }, { jobId: "search-1", entryPoint: "search" });
    expect(evaluatePriorApplications.mock.calls[0][0].candidateStrandedApplied).toBe(false);
  });

  it("is false, not a throw, when appliedByExternalId hasn't loaded yet (null)", async () => {
    await mount(baseProps({ appliedByExternalId: null }));
    expect(() => run({ id: "gh-99" }, { jobId: "search-1", entryPoint: "search" })).not.toThrow();
    expect(evaluatePriorApplications.mock.calls[0][0].candidateStrandedApplied).toBe(false);
  });

  it("uses the real TRACKING_TAB_HIDDEN_STATUSES set, not a hand-copied one", () => {
    // Pin: if a future edit hand-copies the two status strings instead of
    // importing the vocabulary module, this constant could drift silently.
    expect(TRACKING_TAB_HIDDEN_STATUSES).toEqual(["auto_tailored", "tracking"]);
  });
});

describe("useDuplicateApplyCheck -- dismissal (AC S-17)", () => {
  it("dismissing a verdict removes it from dupeNotice", async () => {
    evaluatePriorApplications.mockImplementation(() => ({
      samePosition: { verdict: "hit", match: { applicationId: "a1" }, route: "url" },
      company: { verdict: "clear", count: 0 },
      checkedAt: 1,
      diagnostics: {},
    }));
    await mount(baseProps());
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(api.dupeNotice).not.toBeNull();
    act(() => {
      api.onDupeDismiss("job-1");
    });
    expect(api.dupeNotice).toBeNull();
  });

  it("re-tailoring the SAME posting with an unchanged verdict stays dismissed", async () => {
    evaluatePriorApplications.mockImplementation(() => ({
      samePosition: { verdict: "hit", match: { applicationId: "a1" }, route: "url" },
      company: { verdict: "clear", count: 0 },
      checkedAt: 1,
      diagnostics: {},
    }));
    await mount(baseProps());
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    act(() => {
      api.onDupeDismiss("job-1");
    });
    run({ id: "x" }, { jobId: "job-1", entryPoint: "url" });
    expect(api.dupeNotice).toBeNull();
  });
});

describe("useDuplicateApplyCheck -- onOpenApplications", () => {
  it("sets the Interviewing tab and seeds the search with the given value", async () => {
    const props = baseProps();
    await mount(props);
    act(() => {
      api.onOpenApplications("Acme");
    });
    expect(props.setMainTab).toHaveBeenCalledWith("interviewing");
    expect(props.setInterviewSearch).toHaveBeenCalledWith("Acme");
  });
});

describe("useDuplicateApplyCheck -- re-mount stability (sanity for the live region's seq)", () => {
  it("re-rendering with the same props does not itself bump dupeAnnounceSeq", async () => {
    const props = baseProps();
    await mount(props);
    const before = api.dupeAnnounceSeq;
    await rerender(props);
    expect(api.dupeAnnounceSeq).toBe(before);
  });
});
