"use client";

import { useCallback, useEffect, useState } from "react";
import { PLACEMENTS } from "@/lib/document/coverLetterWeave";

// N62 Capability A: the one per-user default placement for auto-inserted
// cover-letter facts, shared by every consumer that needs it. GETs
// /api/user-prefs on mount (the durable source, via app/api/user-prefs/route.js's
// coverFactPlacement allowlist key) and listens for a same-tab
// PLACEMENT_EVENT so a change made through the settings control (setPlacement
// below) reaches page.js's own read of the value in-session, without prop-
// drilling across the layout/page boundary -- Redis remains the source that
// survives a reload; the event is purely in-session propagation.
const PLACEMENT_EVENT = "cover-fact-placement-change";

function validId(value) {
  return typeof value === "string" && PLACEMENTS.some((p) => p.id === value);
}

// N82: "" is the distinct no-preference state ("let the app decide"), not a
// synonym for DEFAULT_PLACEMENT -- it must remain settable and readable
// alongside a concrete id so the falsy value keeps flowing through every
// consumer's `defaultPlacement || DEFAULT_PLACEMENT` fallback untouched.
function settable(value) {
  return value === "" || validId(value);
}

export function useCoverFactPlacement() {
  // Starts at "" (no preference), NOT DEFAULT_PLACEMENT: a fresh user, or one
  // who has never pinned a placement, must be able to tell "no preference"
  // apart from "pinned to the default id" once the setting is read back.
  const [placement, setPlacement] = useState("");

  useEffect(() => {
    fetch("/api/user-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const stored = data?.prefs?.coverFactPlacement;
        if (settable(stored)) setPlacement(stored);
      })
      .catch(() => {
        /* best-effort seed -- stays at "" (no preference) on failure */
      });

    function onPlacementEvent(e) {
      if (settable(e?.detail)) setPlacement(e.detail);
    }
    window.addEventListener(PLACEMENT_EVENT, onPlacementEvent);
    return () => window.removeEventListener(PLACEMENT_EVENT, onPlacementEvent);
  }, []);

  // Writer half (AC-A3): PUTs the chosen id (or "" for no-preference), then
  // broadcasts it so every other mounted consumer (this session's page.js
  // read included) picks it up immediately -- no per-application re-entry,
  // and no eager re-plan of any letter already written (AC-A4: this only
  // changes what a FUTURE insertion resolves to; nothing here touches an
  // existing entry's lines).
  const setStoredPlacement = useCallback((value) => {
    if (!settable(value)) return;
    setPlacement(value);
    window.dispatchEvent(new CustomEvent(PLACEMENT_EVENT, { detail: value }));
    fetch("/api/user-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: { coverFactPlacement: value } }),
    }).catch(() => {
      /* best-effort write -- local state already reflects the choice */
    });
  }, []);

  return { placement, setPlacement: setStoredPlacement };
}
