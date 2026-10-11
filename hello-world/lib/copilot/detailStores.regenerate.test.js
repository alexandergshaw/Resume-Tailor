// N155 — the store {force} path and the per-key ISSUE TOKEN, one mirrored edit
// across the three byte-for-byte detail stores (expansionStore, techTermDetailStore,
// projectBulletDetailStore). Parametrised over all three BY DESIGN: the stores are
// mirrors, so a single file run against each row is the strongest guard against
// mirror drift (R9) — if one store's edit differs, only that row fails.
//
// RED on HEAD, for the right reason — each case fails on an ASSERTION, never on a
// missing symbol: begin* EXISTS on HEAD and accepts {retry} only, so a {force:true}
// third-arg option is silently dropped and the dedupe early-return still fires.
//   AC1  : begin*({force:true}) re-issues over a settled done and re-enters loading.
//          On HEAD force is ignored -> the settled record short-circuits -> the
//          fetcher is never re-invoked and the status never returns to loading.
//   AC2  : (LOAD-BEARING) a superseded in-flight terminal write is DROPPED by the
//          issue token. Slow A + fast force B that settles first, A settles last ->
//          the store MUST still hold B. On HEAD force never bypasses the in-flight
//          guard, so B's fetcher is never even called (the first assertion reds);
//          and on any tokenless build A would overwrite B.
//   AC17 : the forced path fetches over a settled/prefetched record (store half of
//          the N153 coexistence), while the NON-forced dedupe stays byte-identical.
//
// The AC2 instrument's own power is proven by a NO-OP control (an ordinary non-forced
// dedupe scenario the token must leave untouched) plus the faithful scratchpad mutant
// recorded in tests.r1.md (a has-force-but-no-token build survives nothing here).

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  beginExpansion,
  getExpansion,
  resetExpansionStore,
} from "./expansionStore.js";
import {
  beginTechTermDetail,
  getTechTermDetail,
  resetTechTermDetailStore,
} from "./techTermDetailStore.js";
import {
  beginProjectBulletDetail,
  getProjectBulletDetail,
  resetProjectBulletDetailStore,
} from "./projectBulletDetailStore.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const FAMILIES = [
  {
    name: "expansionStore",
    begin: beginExpansion,
    get: getExpansion,
    reset: resetExpansionStore,
    result: (marker) => ({ subBullets: [{ text: marker, pageSource: null, source: null }], caption: "", empty: false }),
    content: (record) => record?.subBullets?.[0]?.text ?? "",
  },
  {
    name: "techTermDetailStore",
    begin: beginTechTermDetail,
    get: getTechTermDetail,
    reset: resetTechTermDetailStore,
    result: (marker) => ({ detail: marker, empty: false }),
    content: (record) => record?.detail ?? "",
  },
  {
    name: "projectBulletDetailStore",
    begin: beginProjectBulletDetail,
    get: getProjectBulletDetail,
    reset: resetProjectBulletDetailStore,
    result: (marker) => ({ detail: marker, empty: false }),
    content: (record) => record?.detail ?? "",
  },
];

const KEY = "q::point::app::gemini";
const REQUEST = { applicationId: "app-1", engine: "gemini", userContext: "" };

describe.each(FAMILIES)("$name — the {force} regenerate path (AC1)", (fam) => {
  beforeEach(() => fam.reset());

  it("re-enters loading over a settled done when forced", async () => {
    await fam.begin({ key: KEY, request: REQUEST }, async () => fam.result("A"));
    expect(fam.get(KEY).status).toBe("done");
    expect(fam.content(fam.get(KEY))).toBe("A");

    // A pending fetcher: the only way the status is "loading" after this call is
    // that force RE-ISSUED over the settled record. On HEAD the settled record
    // short-circuits the dedupe guard, so the status is still "done" here.
    fam.begin({ key: KEY, request: REQUEST }, () => new Promise(() => {}), { force: true });
    expect(fam.get(KEY).status).toBe("loading");
  });

  it("re-issues the fetch over a settled done/empty/error and writes the new terminal record (AC1/AC17 forced)", async () => {
    const warm = vi.fn(async () => fam.result("A"));
    await fam.begin({ key: KEY, request: REQUEST }, warm);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(fam.content(fam.get(KEY))).toBe("A");

    const regen = vi.fn(async () => fam.result("B"));
    await fam.begin({ key: KEY, request: REQUEST }, regen, { force: true });
    expect(regen).toHaveBeenCalledTimes(1);
    expect(fam.get(KEY).status).toBe("done");
    expect(fam.content(fam.get(KEY))).toBe("B");
  });

  it("[NO-OP control] the NON-forced dedupe is byte-identical: a settled key issues nothing (AC1 unchanged-half, AC17 guard)", async () => {
    const fetcher = vi.fn(async () => fam.result("A"));
    await fam.begin({ key: KEY, request: REQUEST }, fetcher);
    // No force: a settled record must still short-circuit, exactly as today. A
    // force path that forgot the `!force &&` prefix would re-issue here and red
    // this control, which is what tells a sensitive suite from a brittle one.
    await fam.begin({ key: KEY, request: REQUEST }, fetcher);
    await fam.begin({ key: KEY, request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fam.content(fam.get(KEY))).toBe("A");
  });
});

describe.each(FAMILIES)("$name — the issue token drops a superseded write (AC2, LOAD-BEARING)", (fam) => {
  beforeEach(() => fam.reset());

  it("a slow first issue cannot overwrite a newer forced issue that settled first", async () => {
    let releaseA;
    let releaseB;
    const fetcherA = vi.fn(() => new Promise((resolve) => { releaseA = () => resolve(fam.result("A")); }));
    const fetcherB = vi.fn(() => new Promise((resolve) => { releaseB = () => resolve(fam.result("B")); }));

    // Issue A (an ordinary open/prefetch, no force): writes loading, A in flight.
    fam.begin({ key: KEY, request: REQUEST }, fetcherA);
    expect(fam.get(KEY).status).toBe("loading");

    // Force issue B over the loading record. On HEAD force never bypasses the
    // in-flight guard, so B's fetcher is never called — this assertion reds there,
    // and it is the assertion (not a thrown ReferenceError) that fails.
    fam.begin({ key: KEY, request: REQUEST }, fetcherB, { force: true });
    expect(fetcherB).toHaveBeenCalledTimes(1);

    // B settles FIRST -> the store holds B.
    releaseB();
    await flush();
    expect(fam.content(fam.get(KEY))).toBe("B");

    // A settles LAST. A tokenless build lets this stale write land and the store
    // flips back to A; with the issue token A's terminal write is dropped.
    releaseA();
    await flush();
    expect(fam.content(fam.get(KEY)), "the superseded slow write A must be dropped").toBe("B");
    expect(fam.get(KEY).status).toBe("done");
  });

  it("[control] both requests really raced: each fetcher was invoked exactly once", async () => {
    // Distinguishes the pass above from a build that simply never issued B (which
    // would also leave B absent). If force did not bypass the dedupe, fetcherB is
    // never called and this control reds too — the scenario has genuine two-writer
    // contention, not a single-writer no-op dressed up as one.
    let releaseA;
    let releaseB;
    const fetcherA = vi.fn(() => new Promise((resolve) => { releaseA = () => resolve(fam.result("A")); }));
    const fetcherB = vi.fn(() => new Promise((resolve) => { releaseB = () => resolve(fam.result("B")); }));
    fam.begin({ key: KEY, request: REQUEST }, fetcherA);
    fam.begin({ key: KEY, request: REQUEST }, fetcherB, { force: true });
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
    releaseA();
    releaseB();
    await flush();
  });
});
