"use client";

import { useEffect, useState } from "react";

// The two persisted UI layout preferences that are pure chrome: the widths of
// the Interviewing table's frozen Company/Role columns, and the position of
// the floating AI Help FAB. Both are localStorage-only, owned by nobody else,
// and read by exactly one consumer each (<TrackingTab> and <ChatFab>).
//
// WHY THIS IS ORDER-PRESERVING. page.js calls this hook at the exact source
// position its five effects already occupied, so no useEffect changes index
// relative to any other useEffect in the component -- the only thing that
// moves is three useState calls, whose initial values are constant literals.
// That is safe because NOTHING in page.js referenced companyColWidth,
// roleColWidth or fabPos between their old declaration site and this hook's
// call site -- a whole-file reference census, not a TDZ argument, because a
// read from inside an effect or event-handler closure would run after the
// component body and so would NOT be a TDZ error. See
// app/hooks/useLayoutPrefs.extraction.test.js.
export function useLayoutPrefs() {
  // Width (in px) of the frozen columns on the Interviewing tab. User can drag
  // the right edge of each header to resize; persisted to localStorage.
  const [companyColWidth, setCompanyColWidth] = useState(140);
  const [roleColWidth, setRoleColWidth] = useState(180);
  // Position of the floating AI Help FAB; user can drag it anywhere.
  // Stored as offsets from the right/bottom of the viewport (in px).
  const [fabPos, setFabPos] = useState({ right: 24, bottom: 24 });

  /* eslint-disable react-hooks/set-state-in-effect --
     NOT a new violation, and NOT a rule being weakened: this is a MEASURED
     pre-existing condition that the extraction merely made visible.

     The effect below is byte-identical to what shipped inside app/page.js.
     It lints clean there and errors here, and the reason is not an exemption
     (eslint.config.mjs grants page.js none) -- it is that this rule ships
     with eslint-plugin-react-hooks v7's React Compiler analysis, which bails
     out on a component the size of Home() and so never inspects its ~8
     mount-hydration effects at all. Measured, not assumed: lifting page.js's
     OWN `setActiveSection(saved)` effect (HEAD lines 290-315) verbatim into a
     small probe module reproduced this exact error, while `npx eslint
     app/page.js` is silent. Reported as a finding.

     The rule is also a false positive for this specific shape. The idiomatic
     fix it points at -- a lazy initial value, `useState(() => readPref())` --
     reads localStorage DURING RENDER, which is exactly what a "use client"
     component that Next.js still server-renders must not do. Reading after
     mount is the SSR-safe form, and changing when the read happens would be
     a behaviour change this extraction is not permitted to make.

     Scoped to this block alone (re-enabled immediately after it), never
     file-wide: the other four effects here are genuinely clean and must stay
     linted. */
  // Hydrate UI layout prefs (frozen-column widths + FAB position) once on mount.
  useEffect(() => {
    try {
      const cw = parseInt(localStorage.getItem("interviewCompanyColWidth") || "", 10);
      if (Number.isFinite(cw) && cw >= 80 && cw <= 600) setCompanyColWidth(cw);
      const rw = parseInt(localStorage.getItem("interviewRoleColWidth") || "", 10);
      if (Number.isFinite(rw) && rw >= 80 && rw <= 600) setRoleColWidth(rw);
      const fp = localStorage.getItem("fabPos");
      if (fp) {
        const parsed = JSON.parse(fp);
        if (
          parsed && typeof parsed.right === "number" && typeof parsed.bottom === "number"
        ) {
          // Clamp to the current viewport so a position saved on a larger
          // screen can't strand the FAB off-screen on a small one.
          const maxRight = Math.max(8, window.innerWidth - 80);
          const maxBottom = Math.max(8, window.innerHeight - 48);
          setFabPos({
            right: Math.min(Math.max(8, parsed.right), maxRight),
            bottom: Math.min(Math.max(8, parsed.bottom), maxBottom),
          });
        }
      }
    } catch {}
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    localStorage.setItem("interviewCompanyColWidth", String(companyColWidth));
  }, [companyColWidth]);
  useEffect(() => {
    localStorage.setItem("interviewRoleColWidth", String(roleColWidth));
  }, [roleColWidth]);
  useEffect(() => {
    localStorage.setItem("fabPos", JSON.stringify(fabPos));
  }, [fabPos]);
  // Keep the floating FAB inside the viewport when the window resizes (e.g.
  // rotating a phone or shrinking the window) so it never drifts off-screen.
  useEffect(() => {
    function clampFab() {
      setFabPos((prev) => {
        const maxRight = Math.max(8, window.innerWidth - 80);
        const maxBottom = Math.max(8, window.innerHeight - 48);
        const right = Math.min(Math.max(8, prev.right), maxRight);
        const bottom = Math.min(Math.max(8, prev.bottom), maxBottom);
        return right === prev.right && bottom === prev.bottom ? prev : { right, bottom };
      });
    }
    window.addEventListener("resize", clampFab);
    return () => window.removeEventListener("resize", clampFab);
  }, []);

  // Drag handler shared by both frozen-column resize handles.
  function startColResize(which, event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = which === "company" ? companyColWidth : roleColWidth;
    const setter = which === "company" ? setCompanyColWidth : setRoleColWidth;
    function onMove(e) {
      const delta = e.clientX - startX;
      const next = Math.min(600, Math.max(80, startWidth + delta));
      setter(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return {
    companyColWidth,
    roleColWidth,
    fabPos,
    setFabPos,
    startColResize,
  };
}
