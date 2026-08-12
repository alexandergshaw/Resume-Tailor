// @vitest-environment jsdom
//
// The queue's pure logic lives in lib/tailor/postingQueue.js and has its own
// node-environment tests. What THIS file exists for is the glue: whether the
// hook actually wires those pieces to the tailoring pipeline the way the
// acceptance criteria say. That is a composition question, and a composition
// defect is invisible to pure unit tests by construction -- see R-166, where
// two individually-correct, individually-tested halves were wired together
// wrong and the whole suite stayed green.
//
// So the assertions below are all about OBSERVABLE OUTBOUND WORK: how many
// times the tailoring pipeline was invoked, with which posting text, under
// which tracked-job id, and with which preview instruction. `tailorPosting`
// is injected rather than reached for through a module mock, precisely so
// this file can stay about wiring.
//
// The docblock on line 1 is a PER-FILE override; vitest.config.js stays
// `environment: "node"` and no other file is affected by it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useManualPostings } from "./useManualPostings.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RESUME = { name: "resume.docx" };

// The latest value the hook returned, refreshed on every render so a test can
// call an action and then read the state that action produced.
let api;

function Probe(props) {
  api = useManualPostings(props);
  return null;
}

let container;
let root;

// Echoes the id the hook minted for this posting back as the tracked job id,
// which is what the real pipeline does. A mock returning a CONSTANT id would
// quietly model the bug where every concurrent posting collapses onto one
// tracked job -- the exact defect `manual-${Date.now()}` shipped.
function echoingPipeline(impl) {
  return vi.fn(async (opts) => {
    const extra = impl ? await impl(opts) : {};
    return { ok: true, jobId: opts.syntheticJobId, ...extra };
  });
}

function baseProps(overrides) {
  return {
    tailorPosting: echoingPipeline(),
    resumeFile: RESUME,
    tailoringMap: {},
    openResumePreview: vi.fn(),
    previewScopeAvailable: () => false,
    onRunRequested: vi.fn(),
    ...overrides,
  };
}

async function flush(times = 1) {
  for (let i = 0; i < times; i += 1) {
    // Sequential on purpose: each flush must commit before the next is queued.
    await act(async () => {});
  }
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush(2);
}

async function rerender(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush(2);
}

// Fill the queue with one box per text, adding boxes as needed.
async function typePostings(texts) {
  for (let i = 0; i < texts.length; i += 1) {
    if (i >= api.entries.length) {
      await act(async () => {
        api.addPosting();
      });
    }
    const id = api.entries[i].id;
    await act(async () => {
      api.setPostingText(id, texts[i]);
    });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
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

describe("useManualPostings -- the queue itself (AC-1)", () => {
  it("starts with a single empty posting box", async () => {
    await mount(baseProps());
    expect(api.entries).toHaveLength(1);
    expect(api.entries[0].text).toBe("");
  });

  it("adds and removes boxes, and never removes the last one", async () => {
    await mount(baseProps());
    await act(async () => {
      api.addPosting();
    });
    expect(api.entries).toHaveLength(2);

    const secondId = api.entries[1].id;
    await act(async () => {
      api.removePosting(secondId);
    });
    expect(api.entries).toHaveLength(1);

    const lastId = api.entries[0].id;
    await act(async () => {
      api.removePosting(lastId);
    });
    expect(api.entries).toHaveLength(1);
  });

  it("gives every box a distinct id, so editing one never edits another", async () => {
    await mount(baseProps());
    await typePostings(["A", "B", "C"]);
    const ids = api.entries.map((e) => e.id);
    // Distinctness must come from a counter, not from a clock: three
    // addPosting calls in the same millisecond are the normal case here.
    expect(new Set(ids).size).toBe(3);
    expect(api.entries.map((e) => e.text)).toEqual(["A", "B", "C"]);
  });

  it("ignores a remove while a run is in flight, so the queue cannot desync from the run", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A", "B"]);

    let run;
    await act(async () => {
      run = api.submitAll();
    });
    const victimId = api.entries[1].id;
    await act(async () => {
      api.removePosting(victimId);
    });
    expect(api.entries).toHaveLength(2);

    // Same backstop for typing. The field is disabled mid-run, but without
    // this the entry would be reset to idle under an in-flight worker, whose
    // patch then re-attaches the OLD text's tracked job to the NEW text.
    const typedId = api.entries[0].id;
    await act(async () => {
      api.setPostingText(typedId, "edited mid-run");
    });
    expect(api.entries[0].text).toBe("A");

    await act(async () => {
      releases.forEach((r) => r());
      await run;
    });
    await flush(2);
    expect(api.entries).toHaveLength(2);
  });
});

describe("useManualPostings -- submitting the queue (AC-2, AC-3)", () => {
  it("runs every non-blank posting through the tailoring pipeline, once each", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["First posting", "   ", "Second posting"]);

    await act(async () => {
      await api.submitAll();
    });

    expect(props.tailorPosting).toHaveBeenCalledTimes(2);
    const sent = props.tailorPosting.mock.calls.map(([opts]) => opts.overridePosting);
    expect(sent.sort()).toEqual(["First posting", "Second posting"]);
  });

  it("gives every posting its own tracked-job id", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["A", "B", "C"]);

    await act(async () => {
      await api.submitAll();
    });

    const ids = props.tailorPosting.mock.calls.map(([opts]) => opts.syntheticJobId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // handleRegenerateSyntheticJob dispatches on this prefix (app/page.js),
    // so a chip regenerate finds the manual pipeline rather than silently
    // doing nothing.
    ids.forEach((id) => expect(id).toMatch(/^manual-/));
    expect(new Set(api.entries.map((e) => e.jobId)).size).toBe(3);
  });

  it("submits with the queued flag, so no posting writes to the tab-wide status or error", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["A", "B"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(props.tailorPosting).toHaveBeenCalledTimes(2);
    for (const [opts] of props.tailorPosting.mock.calls) {
      expect(opts.queued).toBe(true);
    }
  });

  it("never submits a blank box", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["Only this one", "", "  \n "]);

    await act(async () => {
      await api.submitAll();
    });

    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
    expect(props.tailorPosting.mock.calls[0][0].overridePosting).toBe("Only this one");
  });

  it("prevents the form's default submit when handed a submit event", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["A"]);
    const preventDefault = vi.fn();

    await act(async () => {
      await api.submitAll({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
  });

  it("marks each posting done or failed on its own, and one failure does not stop the others", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) =>
        overridePosting === "Bad"
          ? { ok: false, error: "The engine said no." }
          : { ok: true, jobId: syntheticJobId },
      ),
    });
    await mount(props);
    await typePostings(["Good one", "Bad", "Good two"]);

    await act(async () => {
      await api.submitAll();
    });

    expect(props.tailorPosting).toHaveBeenCalledTimes(3);
    expect(api.entries.map((e) => e.status)).toEqual(["done", "error", "done"]);
    expect(api.entries[1].error).toBe("The engine said no.");
    expect(api.entries[0].jobId).toBeTruthy();
    expect(api.entries[2].jobId).toBeTruthy();
    // A run must never eat the text the user typed.
    expect(api.entries.map((e) => e.text)).toEqual(["Good one", "Bad", "Good two"]);
  });

  it("keeps a posting that succeeded with a warning as done, and shows the warning", async () => {
    // The real pipeline's cover-letter failure: the résumé generated fine, so
    // the posting is NOT a failure, but the user still has to be told.
    const props = baseProps({
      tailorPosting: echoingPipeline(({ overridePosting }) =>
        overridePosting === "Warned" ? { warning: "Cover letter failed." } : {},
      ),
    });
    await mount(props);
    await typePostings(["Fine", "Warned"]);

    await act(async () => {
      await api.submitAll();
    });

    expect(api.entries.map((e) => e.status)).toEqual(["done", "done"]);
    expect(api.entries[1].warning).toBe("Cover letter failed.");
    expect(api.entries[1].error).toBe("");
    expect(api.entries[0].warning).toBe("");
  });

  it("records the title and company each posting resolved to", async () => {
    const props = baseProps({
      tailorPosting: echoingPipeline(() => ({ jobTitle: "Staff Engineer", company: "Acme" })),
    });
    await mount(props);
    await typePostings(["A"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(api.entries[0]).toMatchObject({ jobTitle: "Staff Engineer", company: "Acme" });
  });

  it("survives a pipeline that rejects outright, failing only that posting", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) => {
        if (overridePosting === "Bad") throw new Error("Network died");
        return { ok: true, jobId: syntheticJobId };
      }),
    });
    await mount(props);
    await typePostings(["Good", "Bad"]);

    await act(async () => {
      await api.submitAll();
    });

    expect(api.entries[0].status).toBe("done");
    expect(api.entries[1].status).toBe("error");
    expect(api.entries[1].error).toBeTruthy();
    expect(api.running).toBe(false);
  });

  it("reports progress while running and clears it when the run ends", async () => {
    const deferred = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { deferred.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A", "B"]);

    let run;
    await act(async () => {
      run = api.submitAll();
    });
    expect(api.running).toBe(true);
    expect(api.total).toBe(2);
    expect(api.completed).toBe(0);

    await act(async () => {
      deferred[0]();
      await Promise.resolve();
    });
    await flush(2);
    expect(api.completed).toBe(1);
    expect(api.running).toBe(true);

    await act(async () => {
      deferred[1]();
      await run;
    });
    await flush(2);
    expect(api.running).toBe(false);
    expect(api.completed).toBe(2);
  });

  it("keeps at most three postings in flight at once", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A", "B", "C", "D", "E"]);

    let run;
    await act(async () => {
      run = api.submitAll();
    });
    // runWithConcurrency starts its runners synchronously, so this call count
    // IS the cap: unbounded would read 5, a cap of 2 would read 2.
    expect(props.tailorPosting).toHaveBeenCalledTimes(3);

    await act(async () => {
      while (releases.length > 0) {
        releases.shift()();
        // Sequential on purpose: each release must let the runner pick up
        // the next queued item before the following one fires.
        await Promise.resolve();
        await Promise.resolve();
      }
      await run;
    });
    await flush(2);
    expect(props.tailorPosting).toHaveBeenCalledTimes(5);
    expect(api.entries.every((e) => e.status === "done")).toBe(true);
  });
});

describe("useManualPostings -- the preview (AC-4)", () => {
  it("lets a lone posting open its preview automatically, exactly as before", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["Only posting"]);

    await act(async () => {
      await api.submitAll();
    });

    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
    expect(props.tailorPosting.mock.calls[0][0].openPreview).toBe(true);
  });

  it("does not let any posting open the preview when the tab holds several", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["A", "B", "C"]);

    await act(async () => {
      await api.submitAll();
    });

    expect(props.tailorPosting).toHaveBeenCalledTimes(3);
    for (const [opts] of props.tailorPosting.mock.calls) {
      expect(opts.openPreview).toBe(false);
    }
  });

  it("does not pop the preview open on a retry just because one posting failed", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) =>
        overridePosting === "Bad" ? { ok: false, error: "nope" } : { ok: true, jobId: syntheticJobId },
      ),
    });
    await mount(props);
    await typePostings(["Good", "Bad"]);
    await act(async () => {
      await api.submitAll();
    });
    props.tailorPosting.mockClear();

    await act(async () => {
      await api.retryFailed();
    });

    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
    expect(props.tailorPosting.mock.calls[0][0].openPreview).toBe(false);
  });

  it("opens the preview for a finished posting on demand, on the tab that has content", async () => {
    const props = baseProps({ previewScopeAvailable: () => true });
    await mount(props);
    await typePostings(["A", "B"]);
    await act(async () => {
      await api.submitAll();
    });

    const finished = api.entries[0];
    await rerender({
      ...props,
      tailoringMap: {
        [finished.jobId]: { generatedJobTitle: "Staff Engineer", jobDescription: "JD text" },
      },
    });
    await act(async () => {
      api.previewEntry(api.entries[0]);
    });

    expect(props.openResumePreview).toHaveBeenCalledTimes(1);
    const [job, opts] = props.openResumePreview.mock.calls[0];
    expect(job).toMatchObject({ id: finished.jobId, title: "Staff Engineer" });
    expect(opts).toMatchObject({ tab: "cover" });
  });

  it("hands the preview the posting text, so revising from it is possible at all", async () => {
    // The manual pipeline never writes `jobDescription` into tailoringMap --
    // only the URL and feed flows do -- so reading it here yields "" every
    // time. openResumePreview stores that as `posting`, and every Revise,
    // steering, focus-area, framing and persona action inside the preview
    // then fails with "Couldn't find the job posting to revise against."
    // The text is right here on the entry.
    const props = baseProps();
    await mount(props);
    await typePostings(["The posting text", "Another posting"]);
    await act(async () => {
      await api.submitAll();
    });
    await act(async () => {
      api.previewEntry(api.entries[0]);
    });
    expect(props.openResumePreview.mock.calls[0][0]).toMatchObject({
      description: "The posting text",
    });
  });

  it("falls back to the résumé tab when there is no cover letter", async () => {
    const props = baseProps({ previewScopeAvailable: () => false });
    await mount(props);
    await typePostings(["A", "B"]);
    await act(async () => {
      await api.submitAll();
    });
    await act(async () => {
      api.previewEntry(api.entries[0]);
    });
    expect(props.openResumePreview.mock.calls[0][1]).toMatchObject({ tab: "resume" });
  });

  it("does nothing when asked to preview a posting that never produced a document", async () => {
    const props = baseProps();
    await mount(props);
    await act(async () => {
      api.previewEntry(api.entries[0]);
    });
    expect(props.openResumePreview).not.toHaveBeenCalled();
  });
});

describe("useManualPostings -- retrying (AC-5)", () => {
  it("re-runs only the postings that failed", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) =>
        overridePosting === "Bad" ? { ok: false, error: "nope" } : { ok: true, jobId: syntheticJobId },
      ),
    });
    await mount(props);
    await typePostings(["Good", "Bad"]);
    await act(async () => {
      await api.submitAll();
    });
    props.tailorPosting.mockClear();
    props.tailorPosting.mockImplementation(async ({ syntheticJobId }) => ({ ok: true, jobId: syntheticJobId }));

    await act(async () => {
      await api.retryFailed();
    });

    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
    expect(props.tailorPosting.mock.calls[0][0].overridePosting).toBe("Bad");
    expect(api.entries.map((e) => e.status)).toEqual(["done", "done"]);
    expect(api.total).toBe(1);
  });

  it("leaves an already-succeeded posting's tracked job alone", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) =>
        overridePosting === "Bad" ? { ok: false, error: "nope" } : { ok: true, jobId: syntheticJobId },
      ),
    });
    await mount(props);
    await typePostings(["Good", "Bad"]);
    await act(async () => {
      await api.submitAll();
    });
    const goodJobId = api.entries[0].jobId;
    expect(goodJobId).toBeTruthy();

    props.tailorPosting.mockImplementation(async ({ syntheticJobId }) => ({ ok: true, jobId: syntheticJobId }));
    await act(async () => {
      await api.retryFailed();
    });

    expect(api.entries[0].jobId).toBe(goodJobId);
    expect(api.entries[1].jobId).toBeTruthy();
    expect(api.entries[1].jobId).not.toBe(goodJobId);
  });

  it("does nothing when nothing failed", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["A"]);
    await act(async () => {
      await api.submitAll();
    });
    props.tailorPosting.mockClear();

    await act(async () => {
      await api.retryFailed();
    });
    expect(props.tailorPosting).not.toHaveBeenCalled();
  });

  it("refuses to retry with no résumé, exactly as a first submit does", async () => {
    // submitAll guards this; retryFailed did not. Reachable by re-picking
    // the résumé file and cancelling the dialog between runs. Unguarded,
    // every retried posting reaches the pipeline's own guard and writes the
    // same message into the one shared banner while also showing it inline.
    const props = baseProps({
      tailorPosting: vi.fn(async () => ({ ok: false, error: "nope" })),
    });
    await mount(props);
    await typePostings(["A"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(api.entries[0].status).toBe("error");

    await rerender({ ...props, resumeFile: null });
    props.tailorPosting.mockClear();
    await act(async () => {
      await api.retryFailed();
    });

    expect(props.tailorPosting).not.toHaveBeenCalled();
    expect(api.error).toMatch(/resume/i);
  });
});

describe("useManualPostings -- what the last run produced (AC-3)", () => {
  it("reports nothing before the first run", async () => {
    await mount(baseProps());
    expect(api.lastRun).toBeNull();
  });

  it("reports how many postings were tailored and how many failed", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) =>
        overridePosting === "Bad" ? { ok: false, error: "nope" } : { ok: true, jobId: syntheticJobId },
      ),
    });
    await mount(props);
    await typePostings(["Good one", "Bad", "Good two"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(api.lastRun).toEqual({ done: 2, failed: 1 });
  });

  it("does not change when the user edits a box afterwards", async () => {
    // Derived from live entries instead, this drives a polite live-region
    // announcement that fires WHILE the user types, reporting a shrinking
    // count of boxes rather than the documents the run produced.
    const props = baseProps();
    await mount(props);
    await typePostings(["A", "B"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(api.lastRun).toEqual({ done: 2, failed: 0 });

    await act(async () => {
      api.setPostingText(api.entries[0].id, "edited since");
    });
    expect(api.lastRun).toEqual({ done: 2, failed: 0 });
  });

  it("describes the retry, once one has happened", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) =>
        overridePosting === "Bad" ? { ok: false, error: "nope" } : { ok: true, jobId: syntheticJobId },
      ),
    });
    await mount(props);
    await typePostings(["Good", "Bad"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(api.lastRun).toEqual({ done: 1, failed: 1 });

    props.tailorPosting.mockImplementation(async ({ syntheticJobId }) => ({ ok: true, jobId: syntheticJobId }));
    await act(async () => {
      await api.retryFailed();
    });
    expect(api.lastRun).toEqual({ done: 1, failed: 0 });
  });
});

describe("useManualPostings -- guardrails (AC-6)", () => {
  it("refuses to submit with no resume uploaded, and submits nothing", async () => {
    const props = baseProps({ resumeFile: null });
    await mount(props);
    await typePostings(["A", "B"]);

    await act(async () => {
      await api.submitAll();
    });

    expect(props.tailorPosting).not.toHaveBeenCalled();
    expect(api.error).toMatch(/resume/i);
    expect(api.running).toBe(false);
  });

  it("refuses to submit when every box is blank", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["   ", ""]);

    await act(async () => {
      await api.submitAll();
    });

    expect(props.tailorPosting).not.toHaveBeenCalled();
    expect(api.error).toMatch(/job posting/i);
  });

  it("clears a previous guardrail message once a real run starts", async () => {
    const props = baseProps();
    await mount(props);
    await act(async () => {
      await api.submitAll();
    });
    expect(api.error).toBeTruthy();

    await typePostings(["A real posting"]);
    await act(async () => {
      await api.submitAll();
    });
    // "" is the no-error sentinel throughout this hook, so the tab can render
    // `error ? <Alert/> : null` without a null check of its own.
    expect(api.error).toBe("");
  });

  it("ignores a second submit while a run is already in flight", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A"]);

    let first;
    await act(async () => {
      first = api.submitAll();
    });
    // NOT awaited inside act(): if the re-entrancy guard is missing, the
    // second call starts a run whose promise never settles, and awaiting it
    // here would hang the test into a timeout instead of failing an
    // assertion.
    let second;
    await act(async () => {
      second = api.submitAll();
    });
    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
    // The guard must sit BEFORE the queue is re-marked: a guard placed after
    // it calls the pipeline zero extra times but still resets every entry to
    // pending and restarts the progress counter.
    expect(api.total).toBe(1);
    expect(api.entries[0].status).toBe("processing");

    await act(async () => {
      releases.forEach((r) => r());
      await first;
      await second;
    });
  });
});

// The Job Description tab shows ONE error banner, fed by two sources: this
// hook's own guardrail messages, and the shared manual pipeline's error
// (app/hooks/useManualTailor.js), which a StatusBar chip's "Regenerate" can
// also set from outside this tab entirely. The pre-feature code cleared that
// shared error at the top of every manual submit; without an equivalent, a
// failed chip regenerate leaves a banner up permanently -- including after a
// run in which every posting succeeded.
//
// This lives here, as a callback the hook fires, rather than as a wrapper
// function in app/page.js, precisely so it can fail: page.js is not rendered
// by any test in this repo, so the wrapper version was invisible to all three
// gates (eslint, the whole vitest suite, and the build all stayed green with
// the wiring deliberately removed).
describe("useManualPostings -- clearing the shared error banner (AC-6)", () => {
  it("announces a requested run so the caller can clear the shared error", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["A"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(props.onRunRequested).toHaveBeenCalledTimes(1);
  });

  it("announces it before the guards, so a guardrail message is never masked by a stale error", async () => {
    // The banner renders the shared error in preference to this hook's own,
    // so clearing it only on a run that PASSES the guards would leave the
    // stale message covering "Please upload a resume file."
    const props = baseProps({ resumeFile: null });
    await mount(props);
    await typePostings(["A"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(props.onRunRequested).toHaveBeenCalledTimes(1);
    expect(props.tailorPosting).not.toHaveBeenCalled();
    expect(api.error).toMatch(/resume/i);
  });

  it("announces a retry too", async () => {
    const props = baseProps({
      tailorPosting: vi.fn(async ({ overridePosting, syntheticJobId }) =>
        overridePosting === "Bad" ? { ok: false, error: "nope" } : { ok: true, jobId: syntheticJobId },
      ),
    });
    await mount(props);
    await typePostings(["Bad"]);
    await act(async () => {
      await api.submitAll();
    });
    props.onRunRequested.mockClear();

    await act(async () => {
      await api.retryFailed();
    });
    expect(props.onRunRequested).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a second submit is ignored mid-run", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A"]);

    let first;
    await act(async () => {
      first = api.submitAll();
    });
    props.onRunRequested.mockClear();
    let second;
    await act(async () => {
      second = api.submitAll();
    });
    expect(props.onRunRequested).not.toHaveBeenCalled();

    await act(async () => {
      releases.forEach((r) => r());
      await first;
      await second;
    });
  });

  it("does not require the callback", async () => {
    const props = baseProps({ onRunRequested: undefined });
    await mount(props);
    await typePostings(["A"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
  });
});

describe("useManualPostings -- persistence (AC-8)", () => {
  it("restores the postings saved by a previous session", async () => {
    window.localStorage.setItem("jobPostings", JSON.stringify(["Saved A", "Saved B"]));
    await mount(baseProps());
    expect(api.entries.map((e) => e.text)).toEqual(["Saved A", "Saved B"]);
  });

  it("restores a value saved by the single-textarea version as one posting", async () => {
    window.localStorage.setItem("jobPosting", "Legacy posting");
    await mount(baseProps());
    expect(api.entries.map((e) => e.text)).toEqual(["Legacy posting"]);
  });

  it("never writes an empty queue over the saved postings, not even for one commit", async () => {
    window.localStorage.setItem("jobPostings", JSON.stringify(["Saved A", "Saved B"]));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await mount(baseProps());
    const written = setItem.mock.calls
      .filter(([key]) => key === "jobPostings")
      .map(([, value]) => JSON.parse(value));
    // Every write, not just the last: a persist effect that fires before the
    // restore has run writes [""] first, and on a reload race that is the
    // value the next session reads.
    written.forEach((value) => expect(value).toEqual(["Saved A", "Saved B"]));
    expect(JSON.parse(window.localStorage.getItem("jobPostings"))).toEqual(["Saved A", "Saved B"]);
  });

  it("saves every posting as the user types", async () => {
    await mount(baseProps());
    await typePostings(["A", "B"]);
    await flush(2);
    expect(JSON.parse(window.localStorage.getItem("jobPostings"))).toEqual(["A", "B"]);
  });

  it("never writes to the legacy single-posting key", async () => {
    window.localStorage.setItem("jobPosting", "Legacy posting");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await mount(baseProps());
    await typePostings(["Something else"]);
    await flush(2);
    expect(setItem.mock.calls.some(([key]) => key === "jobPosting")).toBe(false);
    expect(window.localStorage.getItem("jobPosting")).toBe("Legacy posting");
  });
});

// Chunk 11: keep pasting while the manual tab tailors. Every guard in this
// hook used to protect a batch (runWithConcurrency) that could not grow --
// see lib/tailor/rollingQueue.js for the pure rules. These tests are the
// composition proof that the hook actually drives that reducer the way the
// acceptance criteria describe: submitting mid-run adds to the SAME run
// instead of starting a second pool, `running` goes false exactly once, a
// posting that already succeeded is not re-tailored, editing/removing a
// DIFFERENT posting is unaffected by another one still being in flight, and
// the lone-posting auto-open does not fire twice.
describe("useManualPostings -- the rolling queue (chunk 11)", () => {
  it("adds a posting submitted mid-run to the SAME run, instead of starting a second pool", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A", "B"]);

    let first;
    await act(async () => {
      first = api.submitAll();
    });
    expect(api.running).toBe(true);
    expect(api.total).toBe(2);
    expect(props.tailorPosting).toHaveBeenCalledTimes(2);

    // Paste a third posting and press Tailor again while A and B are still
    // running.
    await act(async () => {
      api.addPosting();
    });
    const thirdId = api.entries[2].id;
    await act(async () => {
      api.setPostingText(thirdId, "C");
    });

    let second;
    await act(async () => {
      second = api.submitAll();
    });
    // Adds to the run: total grows, completed is NOT reset, running stays
    // true across the whole period, and this is still one pool -- three
    // tailorPosting calls total, never a fourth from a second independent
    // run.
    expect(api.total).toBe(3);
    expect(api.completed).toBe(0);
    expect(api.running).toBe(true);
    expect(props.tailorPosting).toHaveBeenCalledTimes(3);

    const runningSamples = [];

    await act(async () => {
      releases[0](); // A finishes
      await Promise.resolve();
      await Promise.resolve();
    });
    runningSamples.push(api.running);
    expect(api.completed).toBe(1);

    await act(async () => {
      releases[1](); // B finishes
      await Promise.resolve();
      await Promise.resolve();
    });
    runningSamples.push(api.running);
    expect(api.completed).toBe(2);

    await act(async () => {
      releases[2](); // C finishes
      await first;
      await second;
    });
    runningSamples.push(api.running);

    // running stays true while ANY item of the period remains, and flips to
    // false exactly once -- at the very end, not when A and B (the original
    // submission) finish while C is still going.
    expect(runningSamples).toEqual([true, true, false]);
    expect(api.completed).toBe(3);
    expect(api.running).toBe(false);
    expect(api.lastRun).toEqual({ done: 3, failed: 0 });
  });

  it("does not re-submit a posting that already succeeded when a new one is added", async () => {
    const props = baseProps();
    await mount(props);
    await typePostings(["First"]);
    await act(async () => {
      await api.submitAll();
    });
    expect(api.entries[0].status).toBe("done");
    const firstJobId = api.entries[0].jobId;
    props.tailorPosting.mockClear();

    await act(async () => {
      api.addPosting();
    });
    const secondId = api.entries[1].id;
    await act(async () => {
      api.setPostingText(secondId, "Second");
    });
    await act(async () => {
      await api.submitAll();
    });

    // Only the new posting goes through the pipeline -- a second wasted
    // model call on "First" (and its result being replaced) is exactly the
    // A3 defect this excludes.
    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
    expect(props.tailorPosting.mock.calls[0][0].overridePosting).toBe("Second");
    expect(api.entries[0].status).toBe("done");
    expect(api.entries[0].jobId).toBe(firstJobId);
    expect(api.entries[1].status).toBe("done");
  });

  it("lets a posting that is NOT in flight be edited while another one is, and the in-flight one still lands on its own row", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A"]);
    await act(async () => {
      api.addPosting();
    });
    const secondId = api.entries[1].id;

    let run;
    await act(async () => {
      run = api.submitAll(); // only "A" is non-blank, so only it goes in flight
    });
    expect(api.entries[0].status).toBe("processing");

    // The second box was never submitted (still blank) -- it must stay
    // freely editable while the first is in flight.
    await act(async () => {
      api.setPostingText(secondId, "typed during the run");
    });
    expect(api.entries[1].text).toBe("typed during the run");
    // Untouched by the edit to the OTHER row.
    expect(api.entries[0].status).toBe("processing");
    expect(api.entries[0].text).toBe("A");

    await act(async () => {
      releases.forEach((r) => r());
      await run;
    });
    await flush(2);

    // The in-flight posting's result lands correctly on its own row, and
    // the edited row is untouched by the run it was never part of.
    expect(api.entries[0].status).toBe("done");
    expect(api.entries[0].text).toBe("A");
    expect(api.entries[1].text).toBe("typed during the run");
    expect(api.entries[1].status).toBe("idle");
  });

  it("lets a posting that is NOT in flight be removed while another one is", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["A", "B"]);
    // A third, still-blank box -- never submitted, so it must stay idle
    // (and therefore removable) no matter what A and B are doing.
    await act(async () => {
      api.addPosting();
    });
    const thirdId = api.entries[2].id;

    let run;
    await act(async () => {
      run = api.submitAll(); // A and B go in flight; the blank box is skipped
    });
    expect(api.entries[2].status).toBe("idle");

    await act(async () => {
      api.removePosting(thirdId);
    });
    expect(api.entries).toHaveLength(2);
    expect(api.entries.some((e) => e.id === thirdId)).toBe(false);
    // The two in-flight rows are untouched by removing an unrelated one.
    expect(api.entries[0].status).toBe("processing");
    expect(api.entries[1].status).toBe("processing");

    await act(async () => {
      releases.forEach((r) => r());
      await run;
    });
    await flush(2);
    expect(api.entries.every((e) => e.status === "done")).toBe(true);
  });

  it("does not auto-open the preview for a posting submitted while a lone posting's run is still in flight", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    await typePostings(["Only one"]);

    let first;
    await act(async () => {
      first = api.submitAll();
    });
    expect(props.tailorPosting.mock.calls[0][0].openPreview).toBe(true);

    await act(async () => {
      api.addPosting();
    });
    const secondId = api.entries[1].id;
    await act(async () => {
      api.setPostingText(secondId, "Second");
    });

    let second;
    await act(async () => {
      second = api.submitAll();
    });
    // Two results must never fight over the one preview.
    expect(props.tailorPosting.mock.calls[1][0].openPreview).toBe(false);

    await act(async () => {
      releases.forEach((r) => r());
      await first;
      await second;
    });
  });

  // This is the request in the user's own words: "submit one, press tailor,
  // then submit another while the first is being tailored." Every rule
  // above (enqueueTargets excluding done, per-row locking, the pump/settle
  // machinery, the corrected unguarded addPosting) was proved in isolation;
  // this test is the one that proves they actually compose into that
  // journey, starting from the tab's true initial state -- ONE empty box --
  // rather than from a scenario that already has a spare box waiting.
  it("walks the whole journey end to end: paste one, Tailor, add a second box mid-run, paste, Tailor again -- one pool, one running transition, a tally of two", async () => {
    const releases = [];
    const props = baseProps({
      tailorPosting: vi.fn(
        (opts) => new Promise((resolve) => { releases.push(() => resolve({ ok: true, jobId: opts.syntheticJobId })); }),
      ),
    });
    await mount(props);
    expect(api.entries).toHaveLength(1); // the tab's real starting point

    // Paste into the only box there is, and press Tailor.
    await typePostings(["First posting"]);
    let first;
    await act(async () => {
      first = api.submitAll();
    });
    expect(api.running).toBe(true);
    expect(api.total).toBe(1);
    expect(props.tailorPosting).toHaveBeenCalledTimes(1);
    expect(api.entries[0].status).toBe("processing");

    // The only box is now locked -- pasting a second posting requires a new
    // box, and creating one must be possible WHILE the first is tailoring.
    await act(async () => {
      api.addPosting();
    });
    expect(api.entries).toHaveLength(2);
    const secondId = api.entries[1].id;
    expect(api.entries[1].status).toBe("idle");

    await act(async () => {
      api.setPostingText(secondId, "Second posting");
    });
    expect(api.entries[1].text).toBe("Second posting");

    let second;
    await act(async () => {
      second = api.submitAll();
    });
    // Added to the SAME run: total grows to 2, completed is not reset, and
    // this is still one pool -- exactly two tailorPosting calls total, never
    // a third from a second independent run.
    expect(api.total).toBe(2);
    expect(api.completed).toBe(0);
    expect(api.running).toBe(true);
    expect(props.tailorPosting).toHaveBeenCalledTimes(2);

    const runningSamples = [];

    await act(async () => {
      releases[0](); // the first posting finishes
      await Promise.resolve();
      await Promise.resolve();
    });
    runningSamples.push(api.running);
    expect(api.completed).toBe(1);

    await act(async () => {
      releases[1](); // the second posting finishes
      await first;
      await second;
    });
    runningSamples.push(api.running);

    // running goes false exactly once -- at the very end, never in between.
    expect(runningSamples).toEqual([true, false]);
    expect(api.completed).toBe(2);
    expect(api.running).toBe(false);
    expect(api.lastRun).toEqual({ done: 2, failed: 0 });
    expect(api.entries.map((e) => e.status)).toEqual(["done", "done"]);
    expect(api.entries.map((e) => e.text)).toEqual(["First posting", "Second posting"]);
  });
});
