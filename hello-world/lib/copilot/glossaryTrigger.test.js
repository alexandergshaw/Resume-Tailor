// The one thing that makes the position glossary happen at all.
//
// Everything else shipped and green: the table, the harvest, the cron worker,
// the read route, the hover. But nothing ever ENQUEUED a posting, so the worker
// found no work, the table stayed empty, and every hover had nothing to show.
// This module is that missing edge, and these cases are about the three ways it
// could be built wrong rather than about it working at all:
//
//   1. AWAITABLE. If it returned a promise, a caller would eventually `await`
//      it, and applying to a job would then block on -- or fail because of -- a
//      glossary harvest. `answerCodeLanguage.js:62-63` states the discipline
//      this repo already uses: "a void start is what makes an `await` on this
//      path unwritable". So `undefined`, always.
//   2. THROWING. Applying must complete unchanged with the network down.
//   3. UNBOUNDED. A blank id must not become a POST that the route then has to
//      reject -- the caller's own rate allowance is spent either way.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startPositionGlossary, shouldStartBackfill } from "./glossaryTrigger.js";
import { RESEARCH_FLOOR } from "./glossaryConstants.js";

const ENDPOINT = "/api/copilot/glossary";

describe("startPositionGlossary", () => {
  let calls;
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", (url, init) => {
      calls.push([url, init]);
      return Promise.resolve({ ok: true, status: 202 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns undefined, so `await` on this path is unwritable", () => {
    // Not "returns a resolved promise" -- undefined. A promise would be
    // awaitable, and the first caller to await it makes applying depend on a
    // model harvest.
    expect(startPositionGlossary({ positionId: "pos-1" })).toBeUndefined();
  });

  it("posts the position id to the shipped route", () => {
    startPositionGlossary({ positionId: "pos-1" });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ positionId: "pos-1" });
  });

  it("accepts an application id instead, because one seam has only that", () => {
    // The Edit-application dialog knows the application row, not the posting.
    // The route resolves either key server-side.
    startPositionGlossary({ applicationId: "app-9" });
    expect(JSON.parse(calls[0][1].body)).toEqual({ applicationId: "app-9" });
  });

  it("prefers the position id when both are supplied", () => {
    // Fewer server-side lookups, and the position is what the row is keyed on.
    startPositionGlossary({ positionId: "pos-1", applicationId: "app-9" });
    expect(JSON.parse(calls[0][1].body)).toEqual({ positionId: "pos-1" });
  });

  it("sets keepalive, so the request survives the navigation that often follows applying", () => {
    startPositionGlossary({ positionId: "pos-1" });
    expect(calls[0][1].keepalive).toBe(true);
  });

  it("sends nothing at all when neither key is usable", () => {
    for (const args of [{}, { positionId: "" }, { positionId: null }, { applicationId: "   " }]) {
      startPositionGlossary(args);
    }
    expect(calls, "a blank id must not become a request the route has to refuse").toHaveLength(0);
  });

  it("survives a rejected fetch without throwing or leaving an unhandled rejection", async () => {
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    expect(() => startPositionGlossary({ positionId: "pos-1" })).not.toThrow();
    // Give the rejection a full turn to surface if nothing caught it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled, "an uncaught rejection here would surface as a console error while applying").toEqual([]);
  });

  it("survives fetch throwing synchronously", () => {
    // Not the same path as a rejected promise: some environments throw before
    // a promise exists at all, and a try/catch around only `.catch()` misses it.
    vi.stubGlobal("fetch", () => {
      throw new Error("no network stack");
    });
    expect(() => startPositionGlossary({ positionId: "pos-1" })).not.toThrow();
  });

  it("survives fetch being absent entirely", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => startPositionGlossary({ positionId: "pos-1" })).not.toThrow();
  });
});

// The lazy backstop, and the one place in this feature where the SPEC IS WRONG.
//
// The trigger above fires only on a NEW apply, so every posting applied to
// before it shipped would have stayed dark forever. This predicate is what
// covers them: opening one in the copilot enqueues it. Lazy rather than a bulk
// backfill was the owner's explicit choice -- spend then follows the postings
// actually opened, not every application ever filed.
//
// WHY THESE CASES AND NOT THE SPEC'S. AC-T5 also asks it to fire for a row that
// is "`ready`/`partial` with truncated_reason = 'model'". Measured against the
// shipped route, that branch cannot cause any work:
//
//   - `truncated_reason` is read by NO enqueue gate. Not one of the twelve.
//   - A COMPLETED row carrying a truncation is either `ready` -- refused by gate
//     8, `already-ready`, which `force` does not lift either -- or `partial`
//     above the floor, refused by gate 10.
//   - A `partial` row BELOW the floor already fires, truncated or not.
//
// So the branch is unreachable where it is distinct, and redundant where it is
// reachable. That would be merely useless if a refused POST were free. It is
// not: GENERATION_RATE_LIMIT is 4 per hour per user and the route's limiter runs
// BEFORE it reads the body, so four opened `ready` postings would 429 the fifth
// -- and the fifth is the never-researched one this whole feature exists for. A
// backstop that spends its budget being refused is worse than no backstop.
describe("shouldStartBackfill", () => {
  const complete = { research_cursor: 4, research_total: 4 };

  it("fires when there is no row at all — the never-attempted case", () => {
    expect(shouldStartBackfill(null)).toBe(true);
    expect(shouldStartBackfill(undefined)).toBe(true);
  });

  it("NEVER fires while the cursor is still advancing, whatever else is true", () => {
    // The single most important case, and it mirrors gate 9 exactly. A backstop
    // that re-harvested a row mid-research would roll the term list out from
    // under the worker's cursor. Asserted against rows that would otherwise
    // satisfy every other branch, including one sitting at 0%.
    expect(shouldStartBackfill({ status: "partial", research_cursor: 1, research_total: 4 })).toBe(false);
    expect(
      shouldStartBackfill({ status: "ready", truncated_reason: "model", research_cursor: 3, research_total: 4 }),
    ).toBe(false);
    expect(
      shouldStartBackfill({
        status: "partial",
        research_cursor: 0,
        research_total: 4,
        researched_count: 0,
        recalled_count: 100,
      }),
    ).toBe(false);
  });

  it("fires for a complete `partial` row below the research floor, not above it", () => {
    const below = { ...complete, status: "partial", researched_count: 2, recalled_count: 8 }; // 0.20
    const above = { ...complete, status: "partial", researched_count: 8, recalled_count: 2 }; // 0.80
    expect(RESEARCH_FLOOR).toBe(0.5); // [instrument] the boundary these two straddle
    expect(shouldStartBackfill(below)).toBe(true);
    expect(shouldStartBackfill(above)).toBe(false);
  });

  it("treats exactly-at-the-floor as good enough, matching gate 10's `>=`", () => {
    // A strict `<` and a `<=` differ on precisely one row, so pin which. The
    // route refuses at `ratio >= RESEARCH_FLOOR`; disagreeing here would spend a
    // token of a four-per-hour budget to be told so.
    expect(shouldStartBackfill({ ...complete, status: "partial", researched_count: 5, recalled_count: 5 })).toBe(false);
  });

  it("fires for a complete `partial` row that graded nothing at all", () => {
    // graded === 0 is a divide-by-zero, which the route resolves to ratio 0 --
    // below the floor. Same answer here, reached the same way.
    expect(shouldStartBackfill({ ...complete, status: "partial" })).toBe(true);
  });

  it("does not fire for `ready`, and a truncation does not change that", () => {
    // Gate 8 refuses every `ready` row on the same posting text. This is half of
    // the unreachable spec branch, asserted so it stays deleted.
    expect(shouldStartBackfill({ ...complete, status: "ready", researched_count: 10, recalled_count: 0 })).toBe(false);
    expect(shouldStartBackfill({ ...complete, status: "ready", truncated_reason: "model" })).toBe(false);
  });

  it("does not fire for an above-floor `partial` the model cut short", () => {
    // The other half: gate 10 refuses it.
    expect(
      shouldStartBackfill({
        ...complete,
        status: "partial",
        truncated_reason: "model",
        researched_count: 9,
        recalled_count: 1,
      }),
    ).toBe(false);
  });

  it("does not fire for statuses the backstop does not own", () => {
    // `failed` carries its own attempt budget and a visible Retry; `unavailable`
    // means the posting has no description text to research at all; `quotes-only`
    // is the keyless engine's honest output, and on a deployment with no key
    // re-enqueuing it spends the hourly budget to rewrite the same row.
    for (const status of ["failed", "unavailable", "quotes-only"]) {
      expect(shouldStartBackfill({ ...complete, status }), status).toBe(false);
    }
  });

  it("[control] the floor arithmetic is real, not a constant false", () => {
    // Every negative case above would also pass against `() => false`. This is
    // the one that makes them mean something.
    expect(shouldStartBackfill({ ...complete, status: "partial", researched_count: 1, recalled_count: 9 })).toBe(true);
  });
});
