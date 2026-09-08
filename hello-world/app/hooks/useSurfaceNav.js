"use client";

// PHASE 1 of AC-back-button-r2 -- the in-app navigation stack (r2 §4-§6).
//
// The app writes zero browser history entries (r2 §1), so "back" has to be a
// real, explicit stack of surfaces the user actually visited rather than a
// history mirror. This module owns that stack. It never touches the History
// API: no pushState/replaceState, no popstate listener, no history.back --
// that parity is Phase 2, priced and NOT approved (r2 §8).
//
// The descriptor is restricted to the two pieces of surface state
// app/page.js itself declares -- mainTab and activeSection (r2 §4). Four
// other candidate fields (CopilotClient's mode, LibraryEditor's tab,
// LiveFeedTab's view, ExperienceTab's selectedId) live inside components
// page.js conditionally renders, so a mainTab change unmounts them and their
// own useState re-initialises on the way back. Naming one of those here
// would let the back button promise a restore it cannot deliver.
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const SURFACE_FIELDS = ["mainTab", "activeSection"];

function sameSurface(a, b) {
  return SURFACE_FIELDS.every((field) => a[field] === b[field]);
}

const SurfaceNavContext = createContext(null);

/**
 * Mounted once, above <AppHeader/> (app/components/Providers.js), so the
 * header's back control and app/page.js's surface state -- siblings in the
 * tree -- share one stack instead of two.
 */
export function SurfaceNavProvider({ children }) {
  const [stack, setStack] = useState([]);
  const [current, setCurrent] = useState(null);
  const [defaultSurface, setDefaultSurface] = useState(null);

  // Bookkeeping for `navigate`, kept in refs and mutated only inside
  // callbacks below (never during render): a synchronous second call in the
  // same gesture -- StatusBar.goToCard's `setMainTab(...); setActiveSection(...);`
  // shape -- must read what the FIRST call just applied, not the render
  // closure that produced both calls (r2 §6.1's "read from a ref" rule).
  const liveRef = useRef(null);
  const pushedRef = useRef(false);
  const hasDefaultRef = useRef(false);
  const settersRef = useRef(null);

  const applyState = useCallback((descriptor) => {
    const setters = settersRef.current;
    if (!setters) return;
    setters.setMainTab(descriptor.mainTab);
    setters.setActiveSection(descriptor.activeSection);
  }, []);

  // Called from useSurfaceNav's layout effect on every render of the surface
  // owner (app/page.js). Refreshes what `navigate` reads and resets the
  // per-gesture push flag so the NEXT gesture starts clean. Rehydration
  // (page.js:291/:303's raw setter calls) lands here too and must NOT push
  // (AC-19) -- it isn't a navigate() call, so it never does.
  const registerHost = useCallback((descriptor, setters) => {
    settersRef.current = setters;
    liveRef.current = descriptor;
    pushedRef.current = false;
    if (!hasDefaultRef.current) {
      hasDefaultRef.current = true;
      setDefaultSurface(descriptor);
    }
    setCurrent(descriptor);
  }, []);

  const navigate = useCallback(
    (partial) => {
      const base = liveRef.current;
      if (!base) return;
      const merged = { ...base, ...partial };
      if (sameSurface(merged, base)) return; // no self-entries (AC-3)
      if (!pushedRef.current) {
        setStack((prev) => [...prev, base]);
        pushedRef.current = true;
      }
      liveRef.current = merged;
      applyState(merged);
    },
    [applyState],
  );

  const goBack = useCallback(() => {
    if (stack.length === 0) return;
    const top = stack[stack.length - 1];
    liveRef.current = top;
    applyState(top);
    setStack((prev) => prev.slice(0, -1));
  }, [stack, applyState]);

  const value = useMemo(
    () => ({ stack, current, defaultSurface, navigate, goBack, registerHost }),
    [stack, current, defaultSurface, navigate, goBack, registerHost],
  );

  return <SurfaceNavContext.Provider value={value}>{children}</SurfaceNavContext.Provider>;
}

/**
 * app/page.js's consumer. Registers the current descriptor and the raw
 * setters with the provider on every render, and returns the routed
 * setters every other surface mutation (NavTabs, StatusBar.goToCard,
 * useDuplicateApplyCheck's onOpenApplications, ...) must call instead of the
 * raw ones (r2 §6.2, enforced by app/navigation/surfaceStack.sweep.test.js).
 */
export function useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection }) {
  const ctx = useContext(SurfaceNavContext);
  if (!ctx) {
    throw new Error("useSurfaceNav must be used beneath a SurfaceNavProvider");
  }
  const { registerHost, navigate } = ctx;

  useLayoutEffect(() => {
    registerHost({ mainTab, activeSection }, { setMainTab, setActiveSection });
  }, [registerHost, mainTab, setMainTab, activeSection, setActiveSection]);

  const goMainTab = useCallback((value) => navigate({ mainTab: value }), [navigate]);
  const goSection = useCallback((value) => navigate({ activeSection: value }), [navigate]);

  return useMemo(() => ({ navigate, goMainTab, goSection }), [navigate, goMainTab, goSection]);
}

/**
 * Internal consumer for app/components/BackButton.js: the stack, the live
 * descriptor and the app's very first-registered surface (the "home" a back
 * button falls back to once the stack is spent), plus the two actions the
 * control itself can trigger.
 */
export function useSurfaceStack() {
  const ctx = useContext(SurfaceNavContext);
  if (!ctx) {
    throw new Error("useSurfaceStack must be used beneath a SurfaceNavProvider");
  }
  const { stack, current, defaultSurface, navigate, goBack } = ctx;
  return { stack, current, defaultSurface, navigate, goBack };
}
