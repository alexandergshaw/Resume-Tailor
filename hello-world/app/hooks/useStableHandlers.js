import { useMemo } from "react";
import { useLatestRef } from "./useLatestRef";

// One function of fixed identity per name in `names`, each forwarding to the
// LATEST `handlers[name]`. This is what lets a React.memo child take a handler
// prop without being re-rendered every time its parent is: app/page.js builds
// most of the tracking handlers inline (or inside hooks that return fresh
// closures every render), so passing them straight down hands each memoized
// card a new prop on every page render and the memo never skips.
//
// `names` MUST be a module-scope constant (its identity is a dependency). A
// forwarder reads `latest.current` when CALLED, not when created, so it always
// runs the handler from the most recent committed render -- the same function
// a plain prop would have run.
//
// Use it for event-time handlers only. The ref is refreshed in an effect (see
// useLatestRef), so a function the child calls DURING RENDER would see the
// previous render's version; pass those straight through instead.
export function useStableHandlers(handlers, names) {
  const latest = useLatestRef(handlers);
  return useMemo(() => {
    const stable = {};
    for (const name of names) {
      stable[name] = (...args) => latest.current[name](...args);
    }
    return stable;
  }, [latest, names]);
}
