"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_ROLE, normalizeRole } from "@/lib/copilot/roleRegisters";

// AC-Q0.4/AC-Q9 - which professional register the "Speak as" drill rehearses,
// persisted in localStorage under its own key so it survives across visits
// the same way practice mode's interview type does. This is a straight copy
// of app/copilot/useInterviewType.js's external-store shape (a real
// `useSyncExternalStore` store, not a mount effect that calls setState): the
// server snapshot below equals DEFAULT_ROLE, so hydration never flashes or
// mismatches, and there's no separate effect synchronously writing state
// afterward for react-hooks/set-state-in-effect to flag.
const ROLE_STORAGE_KEY = "copilot-speak-as-role";

const roleListeners = new Set();

// BUG (adversarial review): the in-memory value was never actually the
// source of truth the old comment on `writeRole` below claimed it was.
// `writeRole` caught a `setItem` failure and moved on; `readRole` then read
// the SAME storage right back on the very next render (triggered by the
// `roleListeners` notification `writeRole` fires unconditionally) and, if
// storage throws on every access - Safari private browsing, cookies
// disabled, a full quota - got the same failure AGAIN, landing on
// `DEFAULT_ROLE` every time. The picker looked frozen on "People manager"
// with no error anywhere on screen, because from the store's point of view
// nothing ever actually changed.
//
// `memoryRole` is the real fix: it is the value `readRole` returns whenever
// storage itself is unreachable, not a value manufactured from nothing - it
// is set on every SUCCESSFUL read or write, so it always reflects the most
// recent role this tab actually knows about, storage or no storage. A
// normal (non-throwing) environment still reads storage fresh on every
// call, so `localStorage.clear()` between test cases keeps resetting this
// store exactly as before - `memoryRole` only ever substitutes for a read
// that itself failed, it never shadows a working one.
let memoryRole = DEFAULT_ROLE;

// A stored value that isn't a known role - a role retired from the
// registry, hand-edited storage, a stale build - reads back as the default
// rather than being passed through unchecked, exactly like
// app/copilot/useInterviewType.js's store normalizes an unrecognized
// stored value back to its default.
function readRole() {
  if (typeof window === "undefined") return memoryRole;
  try {
    memoryRole = normalizeRole(window.localStorage.getItem(ROLE_STORAGE_KEY));
    return memoryRole;
  } catch {
    return memoryRole;
  }
}

function getServerRoleSnapshot() {
  return DEFAULT_ROLE;
}

function subscribeRole(callback) {
  roleListeners.add(callback);
  return () => roleListeners.delete(callback);
}

function writeRole(value) {
  const normalized = normalizeRole(value);
  memoryRole = normalized;
  try {
    window.localStorage.setItem(ROLE_STORAGE_KEY, normalized);
  } catch {
    // Quota exceeded / private browsing / blocked storage: `memoryRole`
    // above already holds the new value, and `readRole` returns exactly
    // that on the next call (see its own `catch`) rather than falling back
    // to the default - so the choice genuinely does still apply for the
    // rest of this tab via the listener notification below. It just won't
    // survive a reload.
  }
  roleListeners.forEach((cb) => cb());
}

export function useRoleChoice() {
  const role = useSyncExternalStore(subscribeRole, readRole, getServerRoleSnapshot);

  const setRole = useCallback((value) => {
    writeRole(value);
  }, []);

  return { role, setRole };
}
