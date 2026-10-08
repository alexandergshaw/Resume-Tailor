"use client";

import { useCallback, useEffect, useRef } from "react";

// The join between the hooks that DRAFT answers and the example-pool prewarm
// hook (app/hooks/useApplicationProjectPool.js) that can warm a cold pool again.
//
// Every fresh answer carries a Row 1 example value whose status says what the
// pool looked like at question time. A `pending` one means the pool was missing
// or still being built, and the prewarm hook's noteRowOneStatus is what warms it
// once more so the NEXT question shows the example. The producers (live drafts,
// the practice sample answer, room-detected questions) therefore need to call
// noteRowOneStatus -- but each client mounts the prewarm hook AFTER them (the
// live one needs the session log's recorder that only useLiveSession returns;
// the practice one sits beside the other posting-keyed hooks), and a hook's
// result cannot be passed to a hook called earlier in the same render.
//
// So the producers are handed a STABLE relay now, and the client points it at
// the real function once the prewarm hook has produced it:
//
//   const { onRowOneStatus, bindRowOneStatus } = useRowOneStatusRelay();
//   ...producers({ ..., onRowOneStatus })...
//   const { noteRowOneStatus } = useApplicationProjectPool({ ... });
//   useBindRowOneStatus(bindRowOneStatus, noteRowOneStatus);
//
// The relay's identity never changes, so handing it to a producer cannot change
// the identity of anything the producer memoizes. Until it is bound (the first
// render) a report is dropped, which is harmless: no answer can have landed yet.
export function useRowOneStatusRelay() {
  const targetRef = useRef(null);
  const onRowOneStatus = useCallback((applicationId, status) => targetRef.current?.(applicationId, status), []);
  const bindRowOneStatus = useCallback((target) => {
    targetRef.current = target;
  }, []);
  return { onRowOneStatus, bindRowOneStatus };
}

// Points the relay at `noteRowOneStatus`. A hook (an effect) so the write happens
// after commit, never during render.
export function useBindRowOneStatus(bindRowOneStatus, noteRowOneStatus) {
  useEffect(() => {
    bindRowOneStatus(noteRowOneStatus);
  }, [bindRowOneStatus, noteRowOneStatus]);
}
