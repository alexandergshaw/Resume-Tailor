// N104 Waves D/E (4b) - the per-job regenerate CONTROLLER (plan step 10 / UX 5.5 /
// UXW-8). The in-flight guard, the atomic replace, the one-level Undo and the
// late-result routing live here, OWNED ABOVE THE STRIP (a module the mount hook
// wraps), because the strip is keyed by job+scope and remounts on a tab switch - a
// component-local ref cannot survive that. RED on HEAD: lib/tailor/regenerateJob.js
// does not exist.
//
// Concurrency cannot be proven synchronously, so every guard here is driven by a
// DEFERRED promise that resolves (or rejects) under test control, after the second
// click / the tab switch has already happened.

import { describe, it, expect, vi } from "vitest";
import { createRegenerateJobs } from "./regenerateJob.js";

// A submit whose settlement the test controls.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const snapshotA = { text: "A-before", ideal: { tag: "A" } };
const snapshotB = { text: "B-before", ideal: { tag: "B" } };

describe("createRegenerateJobs - the in-flight guard (two clicks in one tick start ONE run)", () => {
  it("a second start for a job already running does not call submit again", async () => {
    const d = deferred();
    const submit = vi.fn(() => d.promise);
    const jobs = createRegenerateJobs({ submit });
    const onReplace = vi.fn();

    const p1 = jobs.start("jobA", { request: { r: 1 }, snapshot: snapshotA }, { onReplace });
    expect(jobs.running("jobA")).toBe(true);
    // a synchronous second click while the first is pending
    const p2 = jobs.start("jobA", { request: { r: 1 }, snapshot: snapshotA }, { onReplace });
    expect(submit).toHaveBeenCalledTimes(1);

    d.resolve({ regenerated: { ok: true } });
    await Promise.all([p1, p2]);
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplace).toHaveBeenCalledWith("jobA", expect.objectContaining({ regenerated: { ok: true } }));
    expect(jobs.running("jobA")).toBe(false);
  });
});

describe("createRegenerateJobs - a late result is tagged to its OWN job (never over another)", () => {
  it("each run's onReplace carries the jobId it was started for, whatever resolves first", async () => {
    const dA = deferred();
    const dB = deferred();
    const submit = vi.fn((request) => (request.job === "A" ? dA.promise : dB.promise));
    const jobs = createRegenerateJobs({ submit });
    const onReplace = vi.fn();

    const pA = jobs.start("jobA", { request: { job: "A" }, snapshot: snapshotA }, { onReplace });
    const pB = jobs.start("jobB", { request: { job: "B" }, snapshot: snapshotB }, { onReplace });

    // B finishes first (the user switched to tab B), then the slow A lands.
    dB.resolve({ regenerated: { who: "B" } });
    await pB;
    dA.resolve({ regenerated: { who: "A" } });
    await pA;

    // A's late result must be delivered against jobA, never written onto jobB.
    expect(onReplace).toHaveBeenCalledWith("jobB", expect.objectContaining({ regenerated: { who: "B" } }));
    expect(onReplace).toHaveBeenCalledWith("jobA", expect.objectContaining({ regenerated: { who: "A" } }));
    const aCall = onReplace.mock.calls.find((c) => c[0] === "jobA");
    expect(aCall[1].regenerated.who).toBe("A"); // never B's outcome tagged as A, nor A's onto B
  });
});

describe("createRegenerateJobs - atomic: a failed run applies nothing and arms no Undo", () => {
  it("rejection calls onFail, never onReplace, and undo finds nothing to restore", async () => {
    const d = deferred();
    const submit = vi.fn(() => d.promise);
    const jobs = createRegenerateJobs({ submit });
    const onReplace = vi.fn();
    const onFail = vi.fn();
    const onRestore = vi.fn();

    const p = jobs.start("jobA", { request: {}, snapshot: snapshotA }, { onReplace, onFail });
    d.reject(new Error("engine refused"));
    await p.catch(() => {});

    expect(onReplace).not.toHaveBeenCalled();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(jobs.running("jobA")).toBe(false);
    expect(jobs.undo("jobA", { onRestore })).toBe(false);
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe("createRegenerateJobs - one-level Undo, withdrawn on first use", () => {
  it("restores the pre-run snapshot once; a second undo is a no-op (cannot double-revert)", async () => {
    const d = deferred();
    const submit = vi.fn(() => d.promise);
    const jobs = createRegenerateJobs({ submit });
    const onReplace = vi.fn();
    const onRestore = vi.fn();

    const p = jobs.start("jobA", { request: {}, snapshot: snapshotA }, { onReplace });
    d.resolve({ regenerated: { ok: true } });
    await p;

    expect(jobs.undo("jobA", { onRestore })).toBe(true);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith("jobA", snapshotA);
    // withdrawn: a second activation restores nothing.
    expect(jobs.undo("jobA", { onRestore })).toBe(false);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("a fresh run supersedes the earlier snapshot (Undo restores the latest pre-run text only)", async () => {
    const d1 = deferred();
    const submit = vi.fn(() => d1.promise);
    const jobs = createRegenerateJobs({ submit });
    const onRestore = vi.fn();

    const p1 = jobs.start("jobA", { request: {}, snapshot: snapshotA }, { onReplace: () => {} });
    d1.resolve({ regenerated: {} });
    await p1;

    const d2 = deferred();
    submit.mockImplementationOnce(() => d2.promise);
    const p2 = jobs.start("jobA", { request: {}, snapshot: snapshotB }, { onReplace: () => {} });
    d2.resolve({ regenerated: {} });
    await p2;

    jobs.undo("jobA", { onRestore });
    expect(onRestore).toHaveBeenCalledWith("jobA", snapshotB); // the latest pre-run snapshot, not A
  });
});
