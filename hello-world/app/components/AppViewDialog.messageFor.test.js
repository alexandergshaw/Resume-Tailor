// @vitest-environment jsdom
//
// `messageFor` (design-structure.r1.md §6 item 5, plan.r1.md §2's function
// table) -- the pure mapping from a `usePrepGeneration` result to the
// transient message `PrepPackPanel` shows for an outcome that leaves no
// trace in the persisted pack row (disabled/refused/error). A normal
// terminal status (ready/partial/failed/unavailable) needs no message of
// its own and is never routed through this function (AppViewDialog.js's own
// `handleGenerateNow` wiring refetches instead, per the plan's §1 step 7
// code sketch) -- so this file's job is only the five non-refetch branches
// plus the total-function fallback, never the six persisted `status`
// values PrepPackPanel.test.js already covers.
//
// ASSUMPTION, FLAGGED: `messageFor` is not named as exported anywhere in
// the plan/design docs beyond its own code sketch; this file assumes it IS
// exported from AppViewDialog.js (mirroring `saveTrustedNames`'s own
// existing export, which exists for exactly this reason -- so a test can
// call it directly rather than mounting the whole dialog's prop tree).
//
// RED ON HEAD: `AppViewDialog.js` exports only `default` and
// `saveTrustedNames` today (confirmed by direct read) -- `messageFor` does
// not exist as a binding at all, so every case below fails at import
// resolution / "messageFor is not a function".
//
// AC-N29.7's own bar governs the five real-outcome cases: each must be
// textually DISTINCT from every other, and distinct from the persisted
// `COPY.failed` string ("The last generation attempt failed...",
// PrepPackPanel.js:61) -- asserted directly below, not merely "is a
// non-empty string".

import { describe, it, expect, vi, afterEach } from "vitest";
import { messageFor, fetchPrep } from "./AppViewDialog.js";

const FAILED_BANNER_TEXT = "The last generation attempt failed. This may be temporary — try again when you're ready.";

describe("messageFor -- total function, never throws, never returns undefined", () => {
  it("disabled (GATE 1, kill switch)", () => {
    const text = messageFor({ status: "disabled" });
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe(FAILED_BANNER_TEXT);
  });

  it("refused / in-flight (GATE 9's 409, a genuinely running generation)", () => {
    const text = messageFor({ status: "refused", reason: "in-flight" });
    expect(text.toLowerCase()).toMatch(/already|running|in progress|generat/);
    expect(text).not.toBe(FAILED_BANNER_TEXT);
  });

  it("refused / error (GATE 9's 409, the claim RPC itself errored)", () => {
    const text = messageFor({ status: "refused", reason: "error" });
    expect(text).not.toBe(FAILED_BANNER_TEXT);
  });

  it("refused / an unrecognized reason (documentation case: N41 makes 'attempts-spent' unreachable, but this must not throw if it somehow arrives)", () => {
    const text = messageFor({ status: "refused", reason: "attempts-spent" });
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("a network/parse error carries the hook's own error string", () => {
    const text = messageFor({ error: "Could not start generation.", networkError: true });
    expect(text).toBe("Could not start generation.");
  });

  it("the generic fallback for a shape with none of status/error", () => {
    const text = messageFor({});
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("[AC-N29.7] every one of the five outcome-shapes above renders VISIBLY DISTINCT text from every other", () => {
    const shapes = [
      { status: "disabled" },
      { status: "refused", reason: "in-flight" },
      { status: "refused", reason: "error" },
      { error: "Could not start generation.", networkError: true },
      {},
    ];
    const texts = shapes.map((s) => messageFor(s));
    expect(new Set(texts).size).toBe(texts.length);
  });
});

// `fetchPrep` (plan.r1.md §1 step 7 item 1 / §2's function table) --
// extracted from the mount effect's body so it is callable from two sites
// (mount/reopen, and the post-generation refetch, AppViewDialog.prepReopenRefetch.test.js
// and AppViewDialog.prepGenerate.reachability.test.js already exercise it
// INDIRECTLY through a full dialog mount). This describe block is the
// direct-call unit coverage the plan's own §3.1 item 7 asks for,
// "analogous to the existing saveTrustedNames coverage in
// AppViewDialog.wiring.test.js".
//
// GENUINE AMBIGUITY, FLAGGED (not resolved by the plan): `fetchPrep`
// closes over `setPrepById` in the plan's own code sketch (design-structure.r1.md
// §3.2), which is a value that lives INSIDE the component, unlike
// `saveTrustedNames` (a module-level function with no such closure). For
// this file to call it directly, the implementer must either (a) export a
// version that accepts the setter as a parameter -- `fetchPrep(applicationId,
// setPrepById)`, the shape assumed below -- or (b) keep it a closure-only
// helper, in which case this describe block fails at import resolution
// while the two full-mount test files named above still exercise the same
// code path. I could not resolve this from the plan/design docs alone;
// recorded here as a question for whoever finalizes the implementation,
// per this repo's own "record it as a question rather than inventing a
// contract" rule.
describe("fetchPrep -- direct-call coverage (ASSUMED signature: (applicationId, setPrepById))", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues exactly one GET to /api/interview-prep?applicationId=<id> and calls setPrepById with an updater merging the parsed body under that id", async () => {
    const responseBody = { pack: null, status: "ready" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => responseBody }));
    const setPrepById = vi.fn();

    await fetchPrep("app-1", setPrepById);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/interview-prep?applicationId=app-1");
    expect(setPrepById).toHaveBeenCalledTimes(1);
    const updater = setPrepById.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    expect(updater({ "app-0": "keep-me" })).toEqual({ "app-0": "keep-me", "app-1": responseBody });
  });

  it("URL-encodes the applicationId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({}) }));
    const setPrepById = vi.fn();
    await fetchPrep("app 1/2", setPrepById);
    expect(fetch.mock.calls[0][0]).toBe(`/api/interview-prep?applicationId=${encodeURIComponent("app 1/2")}`);
  });

  it("on a fetch rejection, resolves (never throws) and calls setPrepById with an error shape for that id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const setPrepById = vi.fn();

    await fetchPrep("app-1", setPrepById); // must not throw / reject

    expect(setPrepById).toHaveBeenCalledTimes(1);
    const updater = setPrepById.mock.calls[0][0];
    const result = updater({});
    expect(typeof result["app-1"].error).toBe("string");
  });

  // N50 fix round 5 (verify.r5.md B-1): the blocker's own root cause --
  // `drain()` (prepActionQueue.js) awaits the settled handler, which awaits
  // this function, and a bare `fetch` with no bound of its own left that
  // await unresolved for as long as the underlying request never answered
  // (a stalled connection, an edge function that accepted and hung). Bounded
  // the same way `send` already is: an AbortController paired with a timer.
  it("N50 fix round 5 (verify.r5.md B-1) -- a fetch that never settles on its own is bounded, not awaited forever", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(
        (url, init) =>
          new Promise((resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );
      vi.stubGlobal("fetch", f);
      const setPrepById = vi.fn();
      const settled = vi.fn();
      fetchPrep("app-1", setPrepById, { timeoutMs: 5000 }).then(settled);

      await vi.advanceTimersByTimeAsync(4000);
      expect(settled, "must not resolve before its own bound").not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);
      expect(settled, "must resolve once its own bound elapses, even though the underlying fetch never settled on its own").toHaveBeenCalledTimes(1);
      expect(setPrepById).toHaveBeenCalledTimes(1);
      const updater = setPrepById.mock.calls[0][0];
      expect(typeof updater({})["app-1"].error).toBe("string");
    } finally {
      vi.useRealTimers();
    }
  });

  it("[positive control] a fetch that settles well before its bound is unaffected", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ status: "ready" }) }));
      const setPrepById = vi.fn();
      const data = await fetchPrep("app-1", setPrepById, { timeoutMs: 5000 });
      expect(data).toEqual({ status: "ready" });
      await vi.advanceTimersByTimeAsync(6000); // the bound must never fire twice / throw after settling
    } finally {
      vi.useRealTimers();
    }
  });
});
