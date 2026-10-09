"use client";

import { useEffect, useRef } from "react";

// FIRE A WARM-UP ONCE PER ITEM, THE MOMENT THE ITEM IS ON SCREEN.
//
// WHY THE FIRING EFFECT DEPENDS ON THE KEY AND NOTHING ELSE. A store write gives
// the expansion and tech-term apis a new identity (that is the fix that lets a
// settled record reach a consumer reading through context), which re-renders every
// consumer leaf. If this effect depended on the api, on the warm function, or on
// the store version, every write would re-run it and a render would warm in a loop.
// It therefore depends on a stable STRING, the item's resolved store key, which
// changes only when the question, point or request changes: the warm fires once
// per distinct resolvable item, never per re-render.
//
// The latest `warmFn` is read through a ref, updated in an effect rather than
// during render so the pattern is concurrent-safe. That effect is declared first,
// so on the render where the key changes the ref is already fresh when the
// key-gated effect below runs.
//
// `warmKey` null or "" means the item cannot be resolved (no scope, or no answer
// in it holds the item): nothing to warm. Idempotence is defence in depth, not the
// mechanism: even an over-firing effect could issue at most one request per key,
// because the store's loading-record guard and the prefetch queue each dedupe.
//
// General on purpose, not expansion-specific: any expander with a store key can
// plug its leaf in with one call.

/**
 * Call `warmFn()` once for each distinct non-empty `warmKey`.
 */
export function useWarmOnMount(warmKey, warmFn) {
  const fnRef = useRef(warmFn);
  useEffect(() => {
    fnRef.current = warmFn;
  });
  useEffect(() => {
    if (warmKey) fnRef.current?.();
  }, [warmKey]);
}
