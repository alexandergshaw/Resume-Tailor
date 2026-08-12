import { describe, it, expect } from "vitest";
import {
  enqueueTargets,
  createQueueState,
  enqueue,
  startNext,
  finish,
  isIdle,
} from "./rollingQueue.js";

// The manual tab's rolling tailor queue: paste a posting, press Tailor, and
// keep pasting while it works.
//
// Today useManualPostings is deliberately single-run, because
// runWithConcurrency is a BATCH primitive - it takes a fixed array and resolves
// when that array drains, so there is no way to hand it more work mid-flight.
// Every guard in that hook exists to protect a batch that cannot grow. This
// module is the replacement: a reducer over queue state, so the rules can be
// asserted without React, without timers, and without the network.
//
// runWithConcurrency itself is NOT changed. app/page.js and other callers use
// it correctly for genuinely fixed batches, and rewriting a shared primitive to
// serve one caller would put all of them in the blast radius.

function entry(id, text, status = "idle") {
  return Object.freeze({
    id,
    text,
    status,
    error: "",
    warning: "",
    jobId: null,
    jobTitle: "",
    company: "",
  });
}

const ids = (list) => list.map((e) => e.id);

describe("enqueueTargets", () => {
  it("submits postings that have text and have not run", () => {
    const entries = [entry("a", "one"), entry("b", "two")];
    expect(ids(enqueueTargets(entries))).toEqual(["a", "b"]);
  });

  it("skips blank and whitespace-only postings", () => {
    expect(ids(enqueueTargets([entry("a", ""), entry("b", "   \n\t "), entry("c", "real")]))).toEqual(
      ["c"],
    );
  });

  it("skips postings already queued or in flight", () => {
    // The re-entrancy guard, moved from "is anything running" to "is THIS entry
    // already going". A double-click must not submit the same posting twice.
    const entries = [
      entry("a", "one", "pending"),
      entry("b", "two", "processing"),
      entry("c", "three"),
    ];
    expect(ids(enqueueTargets(entries))).toEqual(["c"]);
  });

  it("skips postings that already succeeded", () => {
    // The one deliberate behaviour change. submittableEntries returns every
    // non-blank posting, so under the old batch model a second press re-ran
    // work that had already succeeded. With a rolling queue that means adding a
    // third posting and pressing Tailor re-tailors the two that are done -
    // two wasted model calls, and their results replaced.
    const entries = [entry("a", "one", "done"), entry("b", "two")];
    expect(ids(enqueueTargets(entries))).toEqual(["b"]);
  });

  it("does re-submit a posting that failed", () => {
    // Positive control for the rule above: "already run" must mean succeeded,
    // not merely attempted, or a failure could never be retried by pressing
    // Tailor again.
    expect(ids(enqueueTargets([entry("a", "one", "error")]))).toEqual(["a"]);
  });

  it("returns nothing when there is nothing new to submit", () => {
    // What the button's disabled state is derived from.
    expect(enqueueTargets([entry("a", "one", "done"), entry("b", "")])).toEqual([]);
    expect(enqueueTargets([])).toEqual([]);
  });
});

describe("the queue reducer", () => {
  it("starts empty and idle", () => {
    const s = createQueueState();
    expect(s).toEqual({ pending: [], inFlight: [], total: 0, completed: 0 });
    expect(isIdle(s)).toBe(true);
  });

  it("counts what it accepts, and refuses duplicates", () => {
    let s = enqueue(createQueueState(), ["a", "b"]);
    expect(s.pending).toEqual(["a", "b"]);
    expect(s.total).toBe(2);

    // Enqueuing something already waiting must not inflate the total - the
    // progress readout would then never reach its own target.
    s = enqueue(s, ["b", "c"]);
    expect(s.pending).toEqual(["a", "b", "c"]);
    expect(s.total).toBe(3);
  });

  it("never runs more than the limit at once, across submissions", () => {
    // The cap is on the whole active period, not per press. Two submissions of
    // two must not produce four simultaneous model calls.
    let s = enqueue(createQueueState(), ["a", "b"]);
    let started;
    ({ state: s, started } = startNext(s, 3));
    expect(started).toEqual(["a", "b"]);

    s = enqueue(s, ["c", "d"]);
    ({ state: s, started } = startNext(s, 3));
    expect(started).toEqual(["c"]);
    expect(s.inFlight).toEqual(["a", "b", "c"]);
    expect(s.pending).toEqual(["d"]);
  });

  it("starts the next item as each one finishes", () => {
    let s = enqueue(createQueueState(), ["a", "b", "c", "d"]);
    let started;
    ({ state: s, started } = startNext(s, 2));
    expect(started).toEqual(["a", "b"]);

    s = finish(s, "a");
    expect(s.completed).toBe(1);
    expect(s.inFlight).toEqual(["b"]);

    ({ state: s, started } = startNext(s, 2));
    expect(started).toEqual(["c"]);
  });

  it("is not idle while work is in flight with nothing pending", () => {
    // The drain race: checking only `pending` ends the period early, sets the
    // final tally mid-flight, and flips the UI back to idle while workers are
    // still writing results.
    let s = enqueue(createQueueState(), ["a"]);
    ({ state: s } = startNext(s, 3));
    expect(s.pending).toEqual([]);
    expect(isIdle(s)).toBe(false);

    s = finish(s, "a");
    expect(isIdle(s)).toBe(true);
  });

  it("is not idle while items are pending with nothing in flight", () => {
    const s = enqueue(createQueueState(), ["a"]);
    expect(s.inFlight).toEqual([]);
    expect(isIdle(s)).toBe(false);
  });

  it("resets its counters when a new period begins after draining", () => {
    let s = enqueue(createQueueState(), ["a"]);
    ({ state: s } = startNext(s, 3));
    s = finish(s, "a");
    expect(isIdle(s)).toBe(true);
    expect({ total: s.total, completed: s.completed }).toEqual({ total: 1, completed: 1 });

    // A press after the queue has drained starts a fresh period - the progress
    // readout must not say "1 of 2" for what the user sees as a new run.
    s = enqueue(s, ["b"]);
    expect({ total: s.total, completed: s.completed }).toEqual({ total: 1, completed: 0 });
  });

  it("keeps counting within a period rather than resetting mid-run", () => {
    // The inverse of the test above, and the one that matters for the actual
    // request: submitting while work is in flight extends the run.
    let s = enqueue(createQueueState(), ["a"]);
    ({ state: s } = startNext(s, 3));
    s = enqueue(s, ["b"]);
    expect({ total: s.total, completed: s.completed }).toEqual({ total: 2, completed: 0 });
    expect(isIdle(s)).toBe(false);
  });

  it("does not mutate the state it was given", () => {
    const first = createQueueState();
    const second = enqueue(first, ["a"]);
    expect(first).toEqual({ pending: [], inFlight: [], total: 0, completed: 0 });
    expect(second).not.toBe(first);

    const { state: third } = startNext(second, 3);
    expect(second.inFlight).toEqual([]);
    expect(third.inFlight).toEqual(["a"]);
  });

  it("ignores a finish for something it is not running", () => {
    // A late result from a previous period must not inflate `completed` past
    // `total` and leave the progress readout reading "3 of 2".
    let s = enqueue(createQueueState(), ["a"]);
    ({ state: s } = startNext(s, 3));
    s = finish(s, "ghost");
    expect(s.completed).toBe(0);
    expect(s.inFlight).toEqual(["a"]);
  });
});
