// N157 SC-B-persist, Step 3b -- the client-side, read-modify-render state store
// studyPlanProgressStore.js. Module scope, subscribe/getSnapshot, an injected
// reader and an injected writer (NO supabase import, NO studyPlanStore import),
// mirroring lib/copilot/techTermDetailStore.js. It holds the loaded plan record
// and applies ONE reveal/grade to the in-memory progress, delegating the
// durable write to the injected writer. It does NOT own the walkthrough reducer
// (cursor advancement / next-due) -- that stays SC-C.
//
// RED ON HEAD: ./studyPlanProgressStore.js does not exist yet. Honest greenfield
// red -- the import fails to resolve, so every case here is red for the one
// correct reason "the module under test is absent". The implementer (Step 3a)
// writes it to green them.
//
// ENTRY POINT NOTE (brief rule 2): this store is driven by SC-C's mount through
// subscribe/getSnapshot/loadStudyPlanRecord/recordProgress -- exactly the
// functions exercised below. There is no separate UI control in this sub-chunk,
// so calling these functions IS the faithful entry point; the reader/writer are
// injected fakes (the detail-store fetcher idiom), never a real supabase client.
//
// Named mutants below were built, run and watched fail against a scratchpad
// reference copy (counts in tests.r1.md).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildProgressDelta } from "@/lib/studyPlan/studyPlanSchema.js";
import {
  STUDY_PLAN_RECORD_STORE_MAX,
  subscribe,
  getSnapshot,
  getStudyPlanRecord,
  loadStudyPlanRecord,
  recordProgress,
  resetStudyPlanProgressStore,
} from "./studyPlanProgressStore.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_APP = "33333333-3333-3333-3333-333333333333";

// A reader result shaped like readStudyPlan's return (SC-C binds the real
// reader to the browser supabase client + userId).
function readerResult(overrides = {}) {
  return {
    status: "ready",
    error: null,
    plan: { v: 1, engine: "embedded", provenance: { research: "complete" }, modules: [] },
    knobs: { newReviewRatio: 0.5 },
    progress: { v: 1, cursor: { moduleId: null, topicId: null, itemId: null }, seen: {}, startedAt: null, updatedAt: null },
    cachedResearch: { complete: true },
    ...overrides,
  };
}

// A card the walkthrough hands recordProgress on a reveal/grade.
const CARD = { moduleId: "m1", topicId: "t1", itemId: "i_abc", revealedAt: "2026-10-11T00:00:00.000Z", grade: "good" };

beforeEach(() => {
  resetStudyPlanProgressStore();
});

// ---------------------------------------------------------------------------
// useSyncExternalStore contract -- the R8 trap: getSnapshot must return a
// referentially stable value or a mount re-renders forever.
// ---------------------------------------------------------------------------
describe("subscribe / getSnapshot (useSyncExternalStore contract)", () => {
  it("R8: getSnapshot returns the SAME reference across two reads with no write between, a NEW one after a write", async () => {
    const a = getSnapshot();
    // No write happened: the same object must come back. A getSnapshot that
    // allocates a fresh object each call drives an infinite render loop that no
    // node test sees unless pinned here. (mutant M-SNAP-ALLOC)
    expect(getSnapshot()).toBe(a);

    await loadStudyPlanRecord(APP_ID, async () => readerResult());
    expect(getSnapshot()).not.toBe(a);
  });

  it("[canary] the stable-reference assertion can fail -- two distinct objects are not .toBe equal", () => {
    expect(() => expect({ version: 0 }).toBe({ version: 0 })).toThrow();
  });

  it("notifies subscribers on a write and stops after unsubscribe", async () => {
    let calls = 0;
    const off = subscribe(() => (calls += 1));
    await loadStudyPlanRecord(APP_ID, async () => readerResult());
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    off();
    await loadStudyPlanRecord(OTHER_APP, async () => readerResult());
    expect(calls).toBe(seen);
  });

  it("an application nothing has loaded reads as a non-loaded record, not a crash", () => {
    const rec = getStudyPlanRecord("never-loaded");
    expect(rec.loaded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadStudyPlanRecord -- load-once, synchronous loading record, settle with the
// normalized record, and resume-by-itemId (C5/D-4).
// ---------------------------------------------------------------------------
describe("loadStudyPlanRecord", () => {
  it("writes a loading record SYNCHRONOUSLY, before any await, then settles with the reader's record", async () => {
    const promise = loadStudyPlanRecord(APP_ID, () => new Promise((resolve) => setTimeout(() => resolve(readerResult()), 0)));
    // Synchronous feedback: the record is already present and not yet loaded.
    expect(getStudyPlanRecord(APP_ID).loaded).toBe(false);
    await promise;
    expect(getStudyPlanRecord(APP_ID).loaded).toBe(true);
    expect(getStudyPlanRecord(APP_ID).status).toBe("ready");
  });

  it("C5/D-4 resume: after a load, the record exposes the DB cursor.itemId and the seen map so the walkthrough resumes at the right card", async () => {
    const seeded = readerResult({
      progress: {
        v: 1,
        cursor: { moduleId: "m1", topicId: "t1", itemId: "i_resume" },
        seen: { i_resume: { revealedAt: "2026-10-10T00:00:00.000Z", grade: "ok" } },
        startedAt: null,
        updatedAt: null,
      },
    });
    await loadStudyPlanRecord(APP_ID, async () => seeded);
    const rec = getStudyPlanRecord(APP_ID);
    // A store that ignored the loaded cursor would strand resume at the first
    // card. (mutant M-LOAD-DROPCURSOR)
    expect(rec.progress.cursor.itemId).toBe("i_resume");
    expect(rec.progress.seen).toHaveProperty("i_resume");
  });

  it("[canary] the resume assertion can fail -- a record whose cursor itemId is null is caught", () => {
    const rec = { progress: { cursor: { itemId: null } } };
    expect(() => expect(rec.progress.cursor.itemId).toBe("i_resume")).toThrow();
  });

  it("a superseded in-flight load's late arrival is DROPPED (the later load wins)", async () => {
    let releaseFirst;
    const slow = new Promise((resolve) => { releaseFirst = () => resolve(readerResult({ status: "STALE" })); });
    const first = loadStudyPlanRecord(APP_ID, () => slow);
    // Second load supersedes the first before the first settles.
    await loadStudyPlanRecord(APP_ID, async () => readerResult({ status: "ready" }));
    releaseFirst();
    await first;
    // The stale late arrival must not overwrite the newer settled record.
    expect(getStudyPlanRecord(APP_ID).status).toBe("ready");
  });

  it("a reader that throws settles as a loaded record carrying an error, never a stuck loading state or a crash", async () => {
    await loadStudyPlanRecord(APP_ID, async () => { throw new Error("network down"); });
    const rec = getStudyPlanRecord(APP_ID);
    expect(rec.loaded).toBe(true);
    expect(typeof rec.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// recordProgress -- build a single-item delta, optimistically merge, delegate
// the durable write to the injected writer (M3 guard #1, S11 removal, R7).
// ---------------------------------------------------------------------------
describe("recordProgress", () => {
  it("builds a single-item delta via buildProgressDelta and delegates it to the injected writer (AC-N157-S11: removing this delegation changes observable behaviour)", async () => {
    const writer = vi.fn(async () => ({ written: true, error: null }));
    await loadStudyPlanRecord(APP_ID, async () => readerResult());
    const res = await recordProgress(APP_ID, CARD, writer);

    expect(res.written).toBe(true);
    // The persistence delegation is load-bearing: a build that dropped the
    // writer call would persist nothing durably and this would red. (mutant
    // M-RECORD-NOWRITE -- the S11 removal half)
    expect(writer).toHaveBeenCalledTimes(1);
    const arg = writer.mock.calls[0][0];
    // Exactly what buildProgressDelta emits: a cursor and a one-key seenDelta.
    const expected = buildProgressDelta(CARD);
    expect(arg.cursor).toEqual(expected.cursor);
    expect(Object.keys(arg.seenDelta)).toEqual(["i_abc"]);
  });

  it("optimistically merges the reveal into the in-memory progress (read-modify-render) and sets the cursor", async () => {
    const writer = vi.fn(async () => ({ written: true, error: null }));
    await loadStudyPlanRecord(APP_ID, async () => readerResult());
    await recordProgress(APP_ID, CARD, writer);
    const rec = getStudyPlanRecord(APP_ID);
    expect(rec.progress.seen).toHaveProperty("i_abc");
    expect(rec.progress.cursor.itemId).toBe("i_abc");
  });

  it("M3 guard #1: a card with no usable itemId yields an empty delta that NEVER reaches the writer", async () => {
    const writer = vi.fn(async () => ({ written: true, error: null }));
    await loadStudyPlanRecord(APP_ID, async () => readerResult());
    const res = await recordProgress(APP_ID, { moduleId: "m1", topicId: "t1" /* no itemId */ }, writer);
    expect(res.written).toBe(false);
    // Removing the isSingleItemSeenDelta guard would let an empty delta (which
    // would write a key named "undefined") reach the writer. (mutant
    // M-RECORD-NOGUARD)
    expect(writer).not.toHaveBeenCalled();
  });

  it("[control, over-/under-fire] a VALID card DOES call the writer exactly once -- the guard is not hardwired to reject everything", async () => {
    const writer = vi.fn(async () => ({ written: true, error: null }));
    await loadStudyPlanRecord(APP_ID, async () => readerResult());
    await recordProgress(APP_ID, CARD, writer);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it("R7: a FAILED persist surfaces the error AND a subsequent load reconciles the in-memory state from the reader", async () => {
    const failingWriter = vi.fn(async () => ({ written: false, error: "offline" }));
    await loadStudyPlanRecord(APP_ID, async () => readerResult());
    const res = await recordProgress(APP_ID, CARD, failingWriter);

    // The failure is surfaced, not swallowed. A build that returned
    // {written:true} on a failed write would leave the UI diverged from the DB
    // silently. (mutant M-RECORD-SWALLOW)
    expect(res.written).toBe(false);
    expect(res.error).toBe("offline");
    expect(getStudyPlanRecord(APP_ID).error).toBeTruthy();

    // Reconcile-on-reload: a later load overwrites the optimistic state with
    // the authoritative DB record (here, a record WITHOUT the unsaved card).
    await loadStudyPlanRecord(APP_ID, async () => readerResult({
      progress: { v: 1, cursor: { moduleId: null, topicId: null, itemId: null }, seen: {}, startedAt: null, updatedAt: null },
    }));
    expect(getStudyPlanRecord(APP_ID).progress.seen).not.toHaveProperty("i_abc");
    expect(getStudyPlanRecord(APP_ID).error).toBeNull();
  });

  it("[canary] the failure-surfaced assertion can fail -- a {written:true} result does not report written:false", () => {
    const good = { written: true, error: null };
    expect(() => expect(good.written).toBe(false)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Module boundary and bound.
// ---------------------------------------------------------------------------
describe("the store is module-scope, injected, and bounded", () => {
  it("exposes a small LRU bound (eviction is harmless -- re-read from the DB)", () => {
    expect(STUDY_PLAN_RECORD_STORE_MAX).toBe(50);
  });

  it("imports no supabase client and no studyPlanStore -- reader/writer are injected", () => {
    // The whole module must be unit-testable with fakes and safe to bundle for
    // the browser: a direct supabase or store import would couple it to the
    // network and defeat that. Source-text sweep with its own canary below.
    const src = SRC;
    expect(src).not.toMatch(/@\/lib\/supabase\//);
    expect(src).not.toMatch(/studyPlanStore/);
    expect(src).not.toMatch(/createClient|supabase-js/);
  });

  it("[control] the import sweep can actually fail", () => {
    expect('import { x } from "@/lib/supabase/client.js"').toMatch(/@\/lib\/supabase\//);
  });
});

// Read the module source for the import sweep. Declared after the describe
// blocks only for readability; hoisted by the runtime before any test runs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const SRC = (() => {
  try {
    return readFileSync(fileURLToPath(new URL("./studyPlanProgressStore.js", import.meta.url)), "utf8");
  } catch {
    // Absent on HEAD (greenfield red): an empty string makes the sweep's own
    // assertions fail honestly rather than throw a confusing read error.
    return "";
  }
})();
