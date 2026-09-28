"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PLACEMENT, PLACEMENTS } from "@/lib/document/coverLetterWeave";

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

export function useCoverFactPlacement() {
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT);

  useEffect(() => {
    fetch("/api/user-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const stored = data?.prefs?.coverFactPlacement;
        if (validId(stored)) setPlacement(stored);
      })
      .catch(() => {
        /* best-effort seed -- stays at DEFAULT_PLACEMENT on failure */
      });

    function onPlacementEvent(e) {
      if (validId(e?.detail)) setPlacement(e.detail);
    }
    window.addEventListener(PLACEMENT_EVENT, onPlacementEvent);
    return () => window.removeEventListener(PLACEMENT_EVENT, onPlacementEvent);
  }, []);

  // Writer half (AC-A3): PUTs the chosen id, then broadcasts it so every
  // other mounted consumer (this session's page.js read included) picks it
  // up immediately -- no per-application re-entry, and no eager re-plan of
  // any letter already written (AC-A4: this only changes what a FUTURE
  // insertion resolves to; nothing here touches an existing entry's lines).
  const setStoredPlacement = useCallback((value) => {
    if (!validId(value)) return;
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
