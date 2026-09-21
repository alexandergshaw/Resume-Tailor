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
  it("exports createPrepActionQueue, and every queue carries exactly the six documented functions", () => {
    const queue = q();
    expect(Object.keys(mod)).toEqual(["createPrepActionQueue"]);
    expect(Object.keys(queue).sort()).toEqual(
      ["dropSeenOutcomes", "enqueue", "getAppState", "markOutcomesSeen", "setSettledHandler", "subscribe"].sort(),
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
