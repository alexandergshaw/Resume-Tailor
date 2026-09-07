// @vitest-environment jsdom
//
// THE ACCUMULATION HALF of the duplicate-application log (the standing
// feature-logs rule). lib/duplicateApply/duplicateApplyLog.download.test.js
// covers what the FILE says and what it is CALLED, as pure functions, because
// jsdom has no download implementation and a click cannot be proven to produce
// a file. This file covers the property those pure functions cannot see from
// inside themselves: that the ledger handed to them was ACCUMULATED as the
// session ran, in a ref, and therefore still contains a verdict the user has
// since dismissed and survives the one action ("Clear all") that empties this
// surface.
//
// `triggerBlobDownload` is mocked at the SAME specifier the hook imports it by
// ("@/lib/document/download.js"): this repo's vitest setup does not unify the
// "@/" alias with a relative path into one module id, so a mock registered
// under the other spelling silently does not apply (app/hooks/useKnowledgeScope.js
// carries the same warning in its own import comment).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/document/download.js", () => ({ triggerBlobDownload: vi.fn() }));

vi.mock("@/lib/duplicateApply/duplicateApplyVerdict.js", async () => {
  const actual = await vi.importActual("@/lib/duplicateApply/duplicateApplyVerdict.js");
  return { ...actual, evaluatePriorApplications: vi.fn(actual.evaluatePriorApplications) };
});

import { useDuplicateApplyCheck } from "./useDuplicateApplyCheck.js";
import { evaluatePriorApplications } from "@/lib/duplicateApply/duplicateApplyVerdict.js";
import { triggerBlobDownload } from "@/lib/document/download.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_750_000_000_000;

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

function run(...args) {
  act(() => {
    api.runDuplicateCheck(...args);
  });
}

function hitVerdict(overrides = {}) {
  return {
    samePosition: {
      verdict: "hit",
      reason: "undated-match",
      route: "url",
      match: { applicationId: "app-1", company: "Acme Corp", title: "Staff Engineer", url: "https://acme.example.com/j/1" },
    },
    company: { verdict: "clear", count: 0, undatableCount: 0, futureCount: 0 },
    checkedAt: T0,
    diagnostics: {
      rowsExamined: 12,
      rowsCounted: 1,
      rowsState: "ready",
      candidateKey: "u:https://acme.example.com/j/1",
      candidateCompanyKey: "a:acme",
      windowDays: 30,
    },
    ...overrides,
  };
}

function companyVerdict() {
  return {
    samePosition: { verdict: "clear" },
    company: { verdict: "indeterminate", reason: "undated-company-rows", count: 3, undatableCount: 2, futureCount: 0, evidence: [{}, {}] },
    checkedAt: T0,
    diagnostics: { rowsExamined: 40, rowsCounted: 3, rowsState: "ready", candidateKey: "u:x", candidateCompanyKey: "a:acme", windowDays: 30 },
  };
}

// The bytes the download control WOULD have written, read back off the Blob it
// was handed. jsdom will not save it, but it will let us read it.
async function downloadedText() {
  const blob = triggerBlobDownload.mock.calls.at(-1)[0];
  return await blob.text();
}

function downloadedName() {
  return triggerBlobDownload.mock.calls.at(-1)[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(T0);
  evaluatePriorApplications.mockImplementation(() => hitVerdict());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The control only exists once there is something to download.
// ---------------------------------------------------------------------------
describe("useDuplicateApplyCheck -- the log control appears only once a check has recorded something", () => {
  it("exposes onDupeDownloadLog as null before any check has fired", async () => {
    await mount(baseProps());
    expect(api.onDupeDownloadLog).toBeNull();
  });

  it("exposes a callable onDupeDownloadLog after one check, even though that check was CLEAR and raised no banner", async () => {
    evaluatePriorApplications.mockImplementation(() => ({
      samePosition: { verdict: "clear" },
      company: { verdict: "clear", count: 0 },
      checkedAt: T0,
      diagnostics: { rowsExamined: 40, rowsCounted: 0, rowsState: "ready" },
    }));
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E1" });
    // The whole reason this log exists: a clear verdict renders NOTHING on
    // screen, so the file is the only place the check is visible at all.
    expect(api.dupeNotice).toBeNull();
    expect(typeof api.onDupeDownloadLog).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ACCUMULATED, NOT REBUILT. Every named mutant in this area lives here.
// ---------------------------------------------------------------------------
describe("useDuplicateApplyCheck -- the ledger is accumulated as the session runs", () => {
  it("records one entry per fire -- two rapid checks for the SAME job are two entries, not one merged entry", async () => {
    await mount(baseProps());
    evaluatePriorApplications.mockImplementationOnce(() => hitVerdict()).mockImplementationOnce(() => companyVerdict());
    act(() => {
      api.runDuplicateCheck({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
      api.runDuplicateCheck({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    });
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    expect(text).toMatch(/Entries recorded: 2/);
    expect(text.match(/^### \d+\./gm)).toHaveLength(2);
  });

  it("records each fire's OWN verdict, not just the merge -- both signals' evidence survives", async () => {
    await mount(baseProps());
    evaluatePriorApplications.mockImplementationOnce(() => hitVerdict()).mockImplementationOnce(() => companyVerdict());
    act(() => {
      api.runDuplicateCheck({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
      api.runDuplicateCheck({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    });
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    expect(text).toContain("undated-match"); // fire 1's same-position reason
    expect(text).toContain("undated-company-rows"); // fire 2's company reason
    expect(text).toMatch(/examined\s*12/);
    expect(text).toMatch(/examined\s*40/);
  });

  it("A DISMISSED VERDICT DOES NOT VANISH -- the check that produced it is still in the file, and the dismissal is recorded too", async () => {
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    expect(api.dupeNotice).not.toBeNull();
    act(() => api.onDupeDismiss("url-x"));
    // Dismissed on screen...
    expect(api.dupeNotice).toBeNull();
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    // ...but not in the record.
    expect(text).toContain("undated-match");
    expect(text).toMatch(/Checks: 1/);
    expect(text).toMatch(/Dismissals: 1/);
    expect(text.match(/^### \d+\./gm)).toHaveLength(2);
  });

  it("a dismissal of a job that was never checked records nothing (no phantom entry)", async () => {
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    act(() => api.onDupeDismiss("url-never-checked"));
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    expect(text).toMatch(/Dismissals: 0/);
  });

  it("records a check that THREW -- the state with no other evidence anywhere", async () => {
    evaluatePriorApplications.mockImplementation(() => {
      throw new Error("boom");
    });
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E1" });
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    expect(text).toContain("check-threw");
    expect(text).toMatch(/Entries recorded: 1/);
  });
});

// ---------------------------------------------------------------------------
// SURVIVES CLEAR. "Clear all" (app/components/StatusBar.js) calls
// setTrackedJobs([]) and nothing else, so the hook sees exactly one thing: a
// re-render with an empty trackedJobs array.
// ---------------------------------------------------------------------------
describe("useDuplicateApplyCheck -- the log survives Clear", () => {
  it("keeps every entry, and keeps the control callable, after trackedJobs is emptied", async () => {
    const job = { id: "url-x", title: "Staff Engineer", company: "Acme" };
    await mount(baseProps({ trackedJobs: [job] }));
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    act(() => api.onDupeDownloadLog());
    const before = await downloadedText();

    // Exactly what "Clear all" does, and all it does.
    await mount(baseProps({ trackedJobs: [] }));
    expect(typeof api.onDupeDownloadLog).toBe("function");
    act(() => api.onDupeDownloadLog());
    const after = await downloadedText();

    expect(after).toBe(before);
    expect(after).toContain("undated-match");
    expect(after).toMatch(/Entries recorded: 1/);
  });

  it("a check fired AFTER a Clear appends to the same ledger rather than starting a new one", async () => {
    await mount(baseProps({ trackedJobs: [{ id: "url-x" }] }));
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    await mount(baseProps({ trackedJobs: [] }));
    run({ id: "2" }, { jobId: "manual-y", entryPoint: "E4" });
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    expect(text).toMatch(/Entries recorded: 2/);
    expect(text).toContain("url-");
    expect(text).toContain("manual-");
  });
});

// ---------------------------------------------------------------------------
// The download itself: one click, one file, no confirmation.
// ---------------------------------------------------------------------------
describe("useDuplicateApplyCheck -- one click produces one file", () => {
  it("hands triggerBlobDownload a markdown Blob and a .md name, exactly once per click", async () => {
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    act(() => api.onDupeDownloadLog());
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob, name] = triggerBlobDownload.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/markdown");
    expect(blob.size).toBeGreaterThan(200);
    expect(name).toMatch(/^duplicate-check-log-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  });

  it("the file name is stable across two downloads even though the clock has moved on", async () => {
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    act(() => api.onDupeDownloadLog());
    const first = downloadedName();
    Date.now.mockReturnValue(T0 + 6 * 60 * 60 * 1000);
    act(() => api.onDupeDownloadLog());
    expect(downloadedName()).toBe(first);
  });

  it("the session start is the FIRST entry's instant and does not drift forward as later checks are recorded", async () => {
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-x", entryPoint: "E3" });
    // Six hours of tailoring later, another check lands.
    Date.now.mockReturnValue(T0 + 6 * 60 * 60 * 1000);
    run({ id: "2" }, { jobId: "manual-y", entryPoint: "E4" });
    act(() => api.onDupeDownloadLog());
    // Still named, and still reported, for when the session STARTED -- a
    // start that moved with each entry would silently retitle the same
    // session on every check and make two downloads of it look unrelated.
    expect(downloadedName()).toContain(new Date(T0).toISOString().slice(0, 10));
    expect(downloadedName()).toBe("duplicate-check-log-2025-06-15-1506.md");
    const text = await downloadedText();
    expect(text).toContain(`Session started: ${new Date(T0).toISOString()}`);
  });

  it("forwards the entry-point CODE it was called with, never the job id", async () => {
    await mount(baseProps());
    run({ id: "1" }, { jobId: "url-https://acme.example.com/j/1", entryPoint: "E3" });
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    // A hook that passed `jobId` where `entryPoint` belongs would put a posting
    // URL into a field the record keeps verbatim up to 64 characters. The
    // renderer refuses free text, so the leak would show up here not as a URL
    // but as an entry point that had silently become "none".
    expect(text).toMatch(/Entry point: E3/);
    expect(text).not.toMatch(/Entry point: none/);
  });

  it("the downloaded bytes never carry the company, title or posting URL the verdict's own evidence held", async () => {
    await mount(baseProps({ trackedJobs: [{ id: "url-x", title: "Staff Engineer", company: "Acme Corp" }] }));
    run({ id: "1" }, { jobId: "url-https://acme.example.com/j/1", entryPoint: "E3" });
    act(() => api.onDupeDownloadLog());
    const text = await downloadedText();
    expect(text).not.toContain("Acme Corp");
    expect(text).not.toContain("Staff Engineer");
    expect(text).not.toContain("acme.example.com");
    // Positive control: it is still a real record of that check.
    expect(text).toContain("undated-match");
  });
});
