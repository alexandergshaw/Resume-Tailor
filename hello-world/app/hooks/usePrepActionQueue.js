"use client";

// N50/N53: the React binding for lib/interviewPrep/prepActionQueue.js. The
// queue itself is created ONCE per browser session, at module scope -- never
// per hook instance, never per dialog mount -- so an action a candidate
// accepted while one dialog instance was open keeps draining even after a
// main-tab switch unmounts that instance (AC-N50.15(e)); a remounted dialog
// then sees the SAME outstanding work rather than a fresh, empty queue that
// would let a second request through underneath it (plan.r2.md section 3.1).
//
// `usePrepActionQueue` is this module's ONLY export, and `AppViewDialog.js`
// is its ONLY importer. The singleton and the empty snapshot are deliberately
// NOT exported, and this file adds no test-reset hook: either would move
// lib/sourceScan/exportReachability.sweep.test.js's pinned counts, and a
// reset export is also the one thing that would let a test hide a real
// cross-test leak instead of using a fresh application id (this repo's own
// hygiene rule for a module-scope store).
//
// M2 (N50 fix round 1): `packCache` is the dialog's own "last known ready
// pack" per application, kept HERE rather than inside
// lib/interviewPrep/prepActionQueue.js -- that module's own surface (its
// seven functions, its frozen `{active, queued, outcomes}` state shape) is
// pinned by app/hooks/prepActionQueue.contract.test.js, and this cache is no
// part of that contract. It is a plain Map at the SAME module scope as `queue` above,
// so it survives exactly what the queue survives: a dialog close, and a
// main-tab remount. A read of it happens at render time, immediately after
// whatever state change (a GET response landing, or a remount's own mount
// effect) already triggers the render that needs it -- so, unlike `queue`,
// it needs no subscription of its own to be seen.

import { useSyncExternalStore } from "react";
import { createPrepActionQueue } from "@/lib/interviewPrep/prepActionQueue";

const packCache = new Map();

function cacheReadyPack(applicationId, snapshot) {
  if (!applicationId || !snapshot) return;
  packCache.set(applicationId, snapshot);
}

function getCachedPack(applicationId) {
  if (!applicationId) return null;
  return packCache.get(applicationId) || null;
}

const queue = createPrepActionQueue();
// `useSyncExternalStore` requires a `getServerSnapshot` even though this
// component is "use client" -- omitting it throws during any server-rendered
// pass. The shared frozen empty state is exactly what a server render would
// see: no application has ever enqueued anything there.
const getServerSnapshot = () => queue.getAppState(null);

/** `applicationId` may be `null` (no row selected): `getAppState` returns the
 *  same shared empty state for `null` as for an id this queue has never
 *  seen, so a hook mounted before a row is chosen never throws and never
 *  churns. */
export function usePrepActionQueue(applicationId) {
  const state = useSyncExternalStore(queue.subscribe, () => queue.getAppState(applicationId), getServerSnapshot);
  return {
    state,
    enqueue: queue.enqueue,
    setSettledHandler: queue.setSettledHandler,
    markOutcomesSeen: queue.markOutcomesSeen,
    dropSeenOutcomes: queue.dropSeenOutcomes,
    // N50 fix round 5 (verify.r5.md M-1/M-2): forwarded straight through,
    // same discipline as every other queue method above.
    retireStaleTimedOut: queue.retireStaleTimedOut,
    cacheReadyPack,
    cachedPack: getCachedPack(applicationId),
  };
}
