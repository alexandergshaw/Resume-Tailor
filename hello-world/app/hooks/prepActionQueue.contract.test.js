// ---------------------------------------------------------------------------
// N50 (N53) TDD RED hand-off -- the action queue's UNIT CONTRACT (plan.r2.md
// section 3.2, U-1..U-11). The pure store `createPrepActionQueue` from
// lib/interviewPrep/prepActionQueue.js, which app/hooks/usePrepActionQueue.js
// wraps as ONE module-scope instance per browser session.
// ---------------------------------------------------------------------------
//
// WHY THIS FILE LIVES IN app/hooks/ AND NOT BESIDE THE MODULE: the 4b seat's
// allowed files this round exclude lib/interviewPrep/ (another agent is
// editing it). The store exists only to back usePrepActionQueue, so its
// contract sits with the hook. Nothing about the test depends on the location.
//
// WHY THE MODULE IS LOADED WITH A DYNAMIC import() INSIDE beforeAll (the
// repo's own precedent, lib/sourceScan/migrationDivergence.test.js): a static
// import of a module that does not exist yet fails the whole FILE with zero
// tests reported, which is neither red nor green. Here every case calls q(),
// which re-throws the import error, so on HEAD each case FAILS individually
// with "Cannot find module ... prepActionQueue". The specifier is a static
// string, so lib/sourceScan's resolver sees an ordinary edge -- nothing is
// hidden from any sweep.
//
// RED ON HEAD: every case (the module does not exist). That is the only red
// reason here; the reference build in the 4b report turns all of them green.
//
// CONCURRENCY IS PROVEN WITH DELAYED PROMISES, never same-tick: every "the
// next send waits" claim holds a real deferred open, asserts, then releases.
// Every held deferred is released before its case ends.

import { describe, it, expect, beforeAll, vi } from "vitest";
// m-2 (N50 fix round 4, verify4.md): PREP_LEASE_MS, unlike
// PREP_ROUTE_MAX_DURATION_S below, is a REAL import, not a literal --
// verify4.md measured that the stated reason for keeping it a literal was
// false FOR THIS constant: `lib/interviewPrep/prepStore.js:73` already
// imports it in production, so it was never on ORPHAN_EXPORTS to begin
// with, and re-measuring here (this round) confirms importing it leaves
// lib/sourceScan green. Importing it also lets the assertion below track
// the real value if it ever changes, rather than silently pinning a copy
// that has drifted from it.
import { PREP_LEASE_MS } from "@/lib/interviewPrep/prepConstants.js";

// B-1/m-5 (N50 fix round 3): PREP_ROUTE_MAX_DURATION_S (prepConstants.js) is
// a LITERAL below, deliberately NOT imported. Measured: importing it here
// moves lib/sourceScan/exportReachability.sweep.test.js's own pinned counts
// -- that export sat on ORPHAN_EXPORTS as a genuine ZERO-reference export
// (prepActionQueue.js's own header already explains why route.js and this
// module both restate it as a literal rather than importing it), and a
// `.test.js` importer moves it out of that bucket into TEST_REFERENCED,
// which the ledger's hand-maintained list does not expect (exportGraph.js's
// own "a `.test.js` file is not a caller" is about PRODUCTION reachability,
// not about whether an export leaves the zero-reference orphan bucket).
// lib/sourceScan is out of scope for this round, so the ledger cannot be
// updated to match -- an earlier round hit this exact conflict and reverted
// to a literal for the same reason. 120 is today's real value
// (prepConstants.js); if it changes there, this must be updated by hand.
const PREP_ROUTE_MAX_DURATION_S = 120;

let mod = null;
let modError = null;
beforeAll(async () => {
  try {
    mod = await import("@/lib/interviewPrep/prepActionQueue");
  } catch (err) {
    modError = err;
  }
});
function q() {
  if (modError) throw modError;
  return mod.createPrepActionQueue();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function settle(n = 6) {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
}

describe("the module's surface", () => {
  it("exports createPrepActionQueue, and every queue carries exactly the seven documented functions", () => {
    // N50 fix round 5 (verify.r5.md M-1/M-2): retireStaleTimedOut joins the
    // six the module already carried.
    const queue = q();
    expect(Object.keys(mod)).toEqual(["createPrepActionQueue"]);
    expect(Object.keys(queue).sort()).toEqual(
      ["dropSeenOutcomes", "enqueue", "getAppState", "markOutcomesSeen", "retireStaleTimedOut", "setSettledHandler", "subscribe"].sort(),
    );
  });
});

describe("U-10 -- an idle application's first action is SENT synchronously, inside enqueue", () => {
  it("send runs before enqueue returns, and the entry is active; a second target is queued, not sent", () => {
    const queue = q();
    let sentA = false;
    const r = queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => ((sentA = true), new Promise(() => {})) });
    expect(sentA).toBe(true);
    expect(r).toEqual({ accepted: true, state: "active", seq: expect.any(Number) });
    const sendB = vi.fn(() => Promise.resolve({ status: "ready" }));
    const r2 = queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: sendB });
    expect(r2).toEqual({ accepted: true, state: "queued", seq: expect.any(Number) });
    expect(r2.seq).toBeGreaterThan(r.seq);
    expect(sendB).not.toHaveBeenCalled();
    const s = queue.getAppState("a1");
    expect(s.active).toEqual({ seq: r.seq, applicationId: "a1", target: "aboutYou", kind: "generate", revision: null });
    expect(s.queued.map((e) => e.target)).toEqual(["whyRole"]);
  });
});

describe("U-1 / U-2 -- FIFO, and the next send waits for BOTH the settle and the settled handler", () => {
  it("U-1: three actions on one application are sent one at a time, in click order", async () => {
    const queue = q();
    const d = [deferred(), deferred(), deferred()];
    const order = [];
    const targets = ["aboutYou", "pack", "stages"];
    targets.forEach((target, i) =>
      queue.enqueue({ applicationId: "a1", target, kind: "generate", send: () => (order.push(target), d[i].promise) }),
    );
    expect(order).toEqual(["aboutYou"]);
    d[0].resolve({ status: "ready" });
    await settle();
    expect(order).toEqual(["aboutYou", "pack"]);
    d[1].resolve({ status: "ready" });
    await settle();
    expect(order).toEqual(["aboutYou", "pack", "stages"]);
    d[2].resolve({ status: "ready" });
    await settle();
    expect(queue.getAppState("a1").active).toBe(null);
  });

  it("U-2: while the settled handler is still running, the entry stays ACTIVE and the next send has NOT been issued", async () => {
    const queue = q();
    const handlerGate = deferred();
    const handler = vi.fn(() => handlerGate.promise);
    queue.setSettledHandler(handler);
    const a = deferred();
    const sendB = vi.fn(() => Promise.resolve({ status: "ready" }));
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => a.promise });
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: sendB });
    a.resolve({ status: "ready", section: "aboutYou" });
    await settle();
    try {
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ applicationId: "a1", target: "aboutYou", kind: "generate" });
      expect(handler.mock.calls[0][1]).toEqual({ status: "ready", section: "aboutYou" });
      expect(queue.getAppState("a1").active?.target, "in progress must span the refetch").toBe("aboutYou");
      expect(sendB).not.toHaveBeenCalled();
      expect(queue.getAppState("a1").outcomes.aboutYou, "the outcome is recorded only after the handler").toBeUndefined();
    } finally {
      handlerGate.resolve();
      await settle();
    }
    expect(sendB).toHaveBeenCalledTimes(1);
    expect(queue.getAppState("a1").outcomes.aboutYou).toEqual({ kind: "generate", revision: null, result: { status: "ready", section: "aboutYou" }, seen: false });
  });
});

describe("U-3 -- one (application, target) at a time: duplicates are refused and cost nothing", () => {
  it("a duplicate while ACTIVE and while QUEUED is refused without calling its send; the same target is accepted again after it settles", async () => {
    const queue = q();
    const a = deferred();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => a.promise });
    queue.enqueue({ applicationId: "a1", target: "stages", kind: "restore", revision: 3, send: () => Promise.resolve({ status: "restored" }) });
    const before = queue.getAppState("a1");
    const dupSend = vi.fn();
    expect(queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: dupSend })).toEqual({ accepted: false, reason: "duplicate" });
    expect(queue.enqueue({ applicationId: "a1", target: "stages", kind: "generate", send: dupSend })).toEqual({ accepted: false, reason: "duplicate" });
    expect(dupSend).not.toHaveBeenCalled();
    expect(queue.getAppState("a1")).toBe(before);
    a.resolve({ status: "ready" });
    await settle();
    const again = vi.fn(() => Promise.resolve({ status: "ready" }));
    expect(queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: again }).accepted).toBe(true);
    await settle();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("invalid input is refused with no state change and no notification", () => {
    const queue = q();
    const listener = vi.fn();
    queue.subscribe(listener);
    const before = queue.getAppState("a1");
    const send = vi.fn();
    expect(queue.enqueue({ target: "aboutYou", kind: "generate", send })).toEqual({ accepted: false, reason: "invalid" });
    expect(queue.enqueue({ applicationId: "a1", kind: "generate", send })).toEqual({ accepted: false, reason: "invalid" });
    expect(queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: "not a function" })).toEqual({ accepted: false, reason: "invalid" });
    expect(send).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(queue.getAppState("a1")).toBe(before);
  });
});

describe("U-4 -- applications are independent", () => {
  it("a held action on one application never delays another application's action", () => {
    const queue = q();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
    const sendOther = vi.fn(() => new Promise(() => {}));
    const r = queue.enqueue({ applicationId: "a2", target: "aboutYou", kind: "generate", send: sendOther });
    expect(r.state).toBe("active");
    expect(sendOther).toHaveBeenCalledTimes(1);
    expect(queue.getAppState("a2").queued).toEqual([]);
  });
});

describe("U-5 / U-6 -- a failure never stalls the queue", () => {
  const CASES = [
    ["a rejected send", () => Promise.reject(new Error("boom")), { error: "boom", networkError: true }],
    ["a send that throws synchronously", () => { throw new Error("kaboom"); }, { error: "kaboom", networkError: true }],
    ["a send resolving to a non-object", () => Promise.resolve(undefined), { error: "Request failed.", networkError: true }],
  ];
  for (const [label, send, expected] of CASES) {
    it(`U-5: ${label} is normalised to an error outcome and the next action is still sent`, async () => {
      const queue = q();
      const next = vi.fn(() => Promise.resolve({ status: "ready" }));
      const a = deferred();
      queue.enqueue({ applicationId: "a1", target: "pack", kind: "generate", send: () => a.promise });
      queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "restore", revision: 2, send });
      queue.enqueue({ applicationId: "a1", target: "stages", kind: "generate", send: next });
      a.resolve({ status: "ready" });
      await settle(10);
      expect(queue.getAppState("a1").outcomes.whyRole).toEqual({ kind: "restore", revision: 2, result: expected, seen: false });
      expect(next).toHaveBeenCalledTimes(1);
    });
  }

  for (const [label, handler] of [
    ["throws synchronously", () => { throw new Error("handler blew up"); }],
    ["rejects", () => Promise.reject(new Error("handler rejected"))],
  ]) {
    it(`U-6: a settled handler that ${label} does not stop the queue, and the outcome is still recorded`, async () => {
      const queue = q();
      queue.setSettledHandler(handler);
      const next = vi.fn(() => Promise.resolve({ status: "ready" }));
      queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => Promise.resolve({ status: "refused", reason: "error" }) });
      queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: next });
      await settle(10);
      expect(next).toHaveBeenCalledTimes(1);
      expect(queue.getAppState("a1").outcomes.aboutYou.result).toEqual({ status: "refused", reason: "error" });
    });
  }
});

describe("U-7 -- the outcome clearing rules", () => {
  async function withOutcomes() {
    const queue = q();
    for (const target of ["aboutYou", "whyRole"]) {
      queue.enqueue({ applicationId: "a1", target, kind: "generate", send: () => Promise.resolve({ status: "refused", reason: "error" }) });
      await settle();
    }
    expect(Object.keys(queue.getAppState("a1").outcomes).sort()).toEqual(["aboutYou", "whyRole"]);
    return queue;
  }

  it("a new action on a section clears THAT section's outcome, and only that one", async () => {
    const queue = await withOutcomes();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
    expect(Object.keys(queue.getAppState("a1").outcomes)).toEqual(["whyRole"]);
  });

  it("a whole-pack action clears EVERY outcome of that application, and no other application's", async () => {
    const queue = await withOutcomes();
    queue.enqueue({ applicationId: "a2", target: "stages", kind: "generate", send: () => Promise.resolve({ status: "disabled" }) });
    await settle();
    queue.enqueue({ applicationId: "a1", target: "pack", kind: "generate", send: () => new Promise(() => {}) });
    expect(queue.getAppState("a1").outcomes).toEqual({});
    expect(Object.keys(queue.getAppState("a2").outcomes)).toEqual(["stages"]);
  });
});

describe("U-8 -- snapshots are referentially stable (useSyncExternalStore loops otherwise)", () => {
  it("the same reference until that application's state changes; null and unknown ids share one frozen empty state", async () => {
    const queue = q();
    const empty = queue.getAppState(null);
    expect(empty).toEqual({ active: null, queued: [], outcomes: {} });
    expect(Object.isFrozen(empty)).toBe(true);
    expect(queue.getAppState("never-seen")).toBe(empty);
    expect(queue.getAppState(null)).toBe(empty);
    const a = deferred();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => a.promise });
    const s1 = queue.getAppState("a1");
    expect(queue.getAppState("a1")).toBe(s1);
    queue.enqueue({ applicationId: "a2", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
    expect(queue.getAppState("a1"), "another application's change must not churn this snapshot").toBe(s1);
    a.resolve({ status: "ready" });
    await settle();
    expect(queue.getAppState("a1")).not.toBe(s1);
  });

  it("listeners are notified on every change and stop after unsubscribing", async () => {
    const queue = q();
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => Promise.resolve({ status: "ready" }) });
    expect(listener).toHaveBeenCalled();
    await settle();
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    unsubscribe();
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: () => Promise.resolve({ status: "ready" }) });
    await settle();
    expect(listener.mock.calls.length).toBe(calls);
  });
});

describe("U-9 -- the settled handler: latest registration wins; a stale unregister is inert", () => {
  it("unregistering a replaced handler leaves the current one in place; unregistering the current one clears it", async () => {
    const queue = q();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const off1 = queue.setSettledHandler(h1);
    const off2 = queue.setSettledHandler(h2);
    off1();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => Promise.resolve({ status: "ready" }) });
    await settle();
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
    off2();
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: () => Promise.resolve({ status: "ready" }) });
    await settle();
    expect(h2).toHaveBeenCalledTimes(1);
  });
});

describe("m1 (N50 fix round 1) -- a send that never settles times out, so the queue moves on", () => {
  it("a hung send settles as a failed, honest outcome once the timeout elapses, and the next queued entry is sent", async () => {
    const queue = mod.createPrepActionQueue({ timeoutMs: 5 });
    const next = vi.fn(() => Promise.resolve({ status: "ready" }));
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: next });
    await settle(10);
    const outcome = queue.getAppState("a1").outcomes.aboutYou;
    expect(outcome, "the hung action never recorded an outcome").toBeTruthy();
    expect(outcome.result.networkError).toBe(true);
    expect(typeof outcome.result.error).toBe("string");
    expect(outcome.result.error.length).toBeGreaterThan(0);
    expect(next, "the next queued entry must still be sent").toHaveBeenCalledTimes(1);
    expect(queue.getAppState("a1").active).toBe(null);
  });

  it("[positive control] a bare createPrepActionQueue() call keeps the default -- no early timeout inside this test's own window", async () => {
    const queue = q();
    let sentA = false;
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => ((sentA = true), new Promise(() => {})) });
    await settle(10);
    expect(sentA).toBe(true);
    expect(queue.getAppState("a1").outcomes.aboutYou, "no timeout should have fired yet at the default duration").toBeUndefined();
  });

  it("m-b (N50 fix round 2) -- the default clears the route's own maxDuration (120s), never a bare 60s or 120s", async () => {
    // PREP_ROUTE_MAX_DURATION_S (prepConstants.js) is 120 today. A default at
    // or below that abandons a legitimate 60-120s generation and lets the
    // next queued entry POST into a claim that is still live server-side --
    // a guaranteed 409 that has already spent a rate-limit token. Fake
    // timers, not a small injected timeoutMs, because this is pinning the
    // BARE createPrepActionQueue() default itself.
    vi.useFakeTimers();
    try {
      const queue = q();
      queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(PREP_ROUTE_MAX_DURATION_S * 1000 + 10_000);
      expect(
        queue.getAppState("a1").outcomes.aboutYou,
        "timed out at or before the route's own 120s deadline -- no margin for transit",
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("B-1 (N50 fix round 3, verify.r3.md) -- the default must clear the server's own claim LEASE (PREP_LEASE_MS), not merely the route's maxDuration", async () => {
    // m-b (above) only pinned the margin against the ROUTE's own function
    // budget (120s). The constant that actually decides what a post-timeout
    // refetch can observe is the server's own claim LEASE (150s today): a
    // generation can still be mid-flight, holding its claim, well after
    // 120s. At the OLD 135s default (120s route maxDuration + 15s margin),
    // the timeout fired before the lease could have cleared, so the refetch
    // it schedules was guaranteed, by arithmetic, to land on a row the
    // database's own CHECK constraint
    // (interview_prep_packs_running_has_no_content) forces to be `running`
    // and empty -- this is B-1, the blocker verify.r3.md raised. This test
    // fails on that old default: at PREP_LEASE_MS (150s) it would already
    // have timed out.
    vi.useFakeTimers();
    try {
      const queue = q();
      queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(PREP_LEASE_MS);
      expect(
        queue.getAppState("a1").outcomes.aboutYou,
        "timed out at or before the server's own lease -- the refetch it schedules can only read a still-live, empty-pack claim",
      ).toBeUndefined();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(queue.getAppState("a1").outcomes.aboutYou, "the default must still eventually fire").toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("U-11 (M5) -- outcome lifetime bookkeeping: seen, then dropped", () => {
  async function queueWithTwoOutcomes() {
    const queue = q();
    const a = deferred();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => Promise.resolve({ status: "disabled" }) });
    await settle();
    queue.enqueue({ applicationId: "a1", target: "stages", kind: "restore", revision: 4, send: () => Promise.resolve({ status: "conflict" }) });
    await settle();
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: () => a.promise });
    return { queue, a };
  }

  it("a settled outcome starts unseen; markOutcomesSeen marks every outcome seen and notifies ONCE; a repeat call is a no-op with no notification", async () => {
    const { queue, a } = await queueWithTwoOutcomes();
    const s0 = queue.getAppState("a1");
    expect(Object.values(s0.outcomes).map((o) => o.seen)).toEqual([false, false]);
    const listener = vi.fn();
    queue.subscribe(listener);
    queue.markOutcomesSeen("a1");
    expect(listener).toHaveBeenCalledTimes(1);
    const s1 = queue.getAppState("a1");
    expect(Object.values(s1.outcomes).every((o) => o.seen === true)).toBe(true);
    expect(s1.active).toBe(s0.active);
    expect(s1.queued).toEqual(s0.queued);
    queue.markOutcomesSeen("a1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(queue.getAppState("a1")).toBe(s1);
    a.resolve({ status: "ready" });
    await settle();
  });

  it("dropSeenOutcomes removes ONLY seen outcomes, keeps an outcome that settled afterwards, and with none seen changes nothing", async () => {
    const { queue, a } = await queueWithTwoOutcomes();
    const listener = vi.fn();
    queue.subscribe(listener);
    const before = queue.getAppState("a1");
    queue.dropSeenOutcomes("a1");
    expect(listener).not.toHaveBeenCalled();
    expect(queue.getAppState("a1")).toBe(before);
    queue.markOutcomesSeen("a1");
    a.resolve({ status: "refused", reason: "error" });
    await settle();
    expect(queue.getAppState("a1").outcomes.whyRole.seen).toBe(false);
    queue.dropSeenOutcomes("a1");
    expect(Object.keys(queue.getAppState("a1").outcomes)).toEqual(["whyRole"]);
    expect(queue.getAppState("a1").active).toBe(null);
  });

  it("neither bookkeeping call touches active or queued entries", async () => {
    const queue = q();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => Promise.resolve({ status: "disabled" }) });
    await settle();
    queue.markOutcomesSeen("a1");
    const held = deferred();
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: () => held.promise });
    queue.enqueue({ applicationId: "a1", target: "stages", kind: "generate", send: () => Promise.resolve({ status: "ready" }) });
    const before = queue.getAppState("a1");
    queue.dropSeenOutcomes("a1");
    const after = queue.getAppState("a1");
    expect(after.active).toBe(before.active);
    expect(after.queued).toEqual(before.queued);
    expect(after.outcomes).toEqual({});
    held.resolve({ status: "ready" });
    await settle();
  });
});

describe("B-1 (N50 fix round 4, verify4.md) -- a timedOut outcome survives dropSeenOutcomes; only a fresh action on that target clears it", () => {
  // verify4.md's blocker: three ordinary paths (close+reopen, a bare
  // remount, and a retry) each rediscovered the SAME dead end -- a `timedOut`
  // outcome, once seen, was dropped by the very next fresh open, so the
  // cache/retry state B-1's round 3 fix restored never survived past the
  // first render. The fix (prepActionQueue.js's own dropSeenOutcomes) is a
  // pure queue-level change, so it is proven here at the unit level, not
  // only through the dialog.
  async function queueWithTimedOutOutcome() {
    const queue = mod.createPrepActionQueue({ timeoutMs: 5 });
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
    await settle(10);
    const outcome = queue.getAppState("a1").outcomes.aboutYou;
    expect(outcome?.result?.timedOut, "precondition: the send actually timed out").toBe(true);
    return queue;
  }

  it("a SEEN timedOut outcome survives dropSeenOutcomes -- a close+reopen or a bare remount must not erase it", async () => {
    const queue = await queueWithTimedOutOutcome();
    queue.markOutcomesSeen("a1");
    expect(queue.getAppState("a1").outcomes.aboutYou.seen).toBe(true);
    queue.dropSeenOutcomes("a1");
    expect(
      queue.getAppState("a1").outcomes.aboutYou,
      "a timedOut outcome must survive dropSeenOutcomes once seen",
    ).toBeTruthy();
    expect(queue.getAppState("a1").outcomes.aboutYou.result.timedOut).toBe(true);
  });

  it("dropSeenOutcomes still drops an ordinary SEEN outcome alongside a surviving timedOut one", async () => {
    const queue = await queueWithTimedOutOutcome();
    queue.enqueue({
      applicationId: "a1",
      target: "whyRole",
      kind: "generate",
      send: () => Promise.resolve({ status: "refused", reason: "error" }),
    });
    await settle();
    queue.markOutcomesSeen("a1");
    queue.dropSeenOutcomes("a1");
    expect(Object.keys(queue.getAppState("a1").outcomes)).toEqual(["aboutYou"]);
  });

  it("only a FRESH action on that exact target clears a timedOut outcome -- never merely seeing or dropping it", async () => {
    const queue = await queueWithTimedOutOutcome();
    queue.markOutcomesSeen("a1");
    queue.dropSeenOutcomes("a1");
    expect(queue.getAppState("a1").outcomes.aboutYou, "precondition: it survived").toBeTruthy();
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
    expect(
      queue.getAppState("a1").outcomes.aboutYou,
      "a fresh action on the SAME target must still clear its old outcome",
    ).toBeUndefined();
  });
});

describe("N50 fix round 5 (verify.r5.md M-1/M-2) -- retireStaleTimedOut", () => {
  async function queueWithTimedOutOutcome() {
    const queue = mod.createPrepActionQueue({ timeoutMs: 5 });
    queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
    await settle(10);
    const outcome = queue.getAppState("a1").outcomes.aboutYou;
    expect(outcome?.result?.timedOut, "precondition: the send actually timed out").toBe(true);
    expect(typeof outcome.settledAt, "precondition: the outcome is stamped with when it settled").toBe("number");
    return queue;
  }

  it("stillRunning=false (a fresher GET already proved the claim is over) retires it immediately, seen or not", async () => {
    const queue = await queueWithTimedOutOutcome();
    queue.retireStaleTimedOut("a1", false);
    expect(queue.getAppState("a1").outcomes.aboutYou, "a settled claim must not keep the timedOut outcome alive").toBeUndefined();
  });

  it("stillRunning=true and not yet aged out leaves the outcome alone", async () => {
    const queue = await queueWithTimedOutOutcome();
    queue.retireStaleTimedOut("a1", true);
    expect(queue.getAppState("a1").outcomes.aboutYou, "a still-plausibly-live claim must survive").toBeTruthy();
  });

  it("stillRunning=true but aged past the bounded lifetime retires it -- the 'an hour later, a different run' case", async () => {
    vi.useFakeTimers();
    try {
      const queue = mod.createPrepActionQueue({ timeoutMs: 5 });
      queue.enqueue({ applicationId: "a1", target: "aboutYou", kind: "generate", send: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(10);
      expect(queue.getAppState("a1").outcomes.aboutYou?.result?.timedOut, "precondition: timed out").toBe(true);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      queue.retireStaleTimedOut("a1", true);
      expect(
        queue.getAppState("a1").outcomes.aboutYou,
        "an outcome this old must not still be read as the same claim",
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a non-timedOut outcome untouched either way, and is a no-op (no notification) when nothing is stale", async () => {
    const queue = q();
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: () => Promise.resolve({ status: "refused", reason: "error" }) });
    await settle();
    const listener = vi.fn();
    queue.subscribe(listener);
    const before = queue.getAppState("a1");
    queue.retireStaleTimedOut("a1", false);
    expect(listener).not.toHaveBeenCalled();
    expect(queue.getAppState("a1")).toBe(before);
    expect(queue.getAppState("a1").outcomes.whyRole).toBeTruthy();
  });

  it("retires ONLY the stale entries, leaving a fresher timedOut outcome (on a different target) alone", async () => {
    const queue = await queueWithTimedOutOutcome();
    queue.enqueue({ applicationId: "a1", target: "whyRole", kind: "generate", send: () => Promise.resolve({ status: "refused", reason: "error" }) });
    await settle();
    queue.retireStaleTimedOut("a1", false);
    expect(queue.getAppState("a1").outcomes.aboutYou).toBeUndefined();
    expect(queue.getAppState("a1").outcomes.whyRole, "an ordinary outcome must survive a timedOut-only retirement").toBeTruthy();
  });
});
