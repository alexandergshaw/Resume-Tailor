"use client";

import { useEffect, useRef, useState } from "react";

// Step 3/AC-X1: split out of CopilotClient.js purely to keep that file under
// this project's 1000-line cap (the same reason useLiveSession.js,
// useSessionLogRecorder.js and TranscriptDisclosure.js were themselves split
// out of it — see CopilotClient.js's own module doc). Owns the bounded live
// column's ref, its measured height, and the effect that keeps that height
// in sync.
//
// Step 3 (half-window dual-screen fix; R-142): measures the wrapper's real
// distance from the viewport top instead of predicting it — a prediction
// goes stale the moment anything above it changes, and no test here can
// catch that (no jsdom). `dvh` (falls back to `vh`) stops a mobile URL bar
// pushing the column below the fold; a `resize` listener plus a
// ResizeObserver on `document.body` catch height changes above.
//
// `measure` (the caller's `live && !isMobile`) gates whether this even runs
// — CopilotClient decides when the column needs bounding at all; this hook
// only owns HOW it measures once told to.
export function useLiveColumnHeight(measure) {
  const liveWrapperRef = useRef(null); // Step 3: the bounded session column
  const [liveHeight, setLiveHeight] = useState(null); // Step 3: measured; null => "auto" pre-measurement/SSR

  useEffect(() => {
    const el = liveWrapperRef.current;
    if (!measure || !el) return undefined;
    const runMeasure = () => {
      const dvh = typeof CSS !== "undefined" && CSS.supports?.("height", "1dvh");
      // Trap: getBoundingClientRect().top is viewport-relative, and the ResizeObserver above can fire at any scroll position (an Alert appearing, history expanding, ...); + scrollY converts it to the wrapper's document-relative, scroll-invariant offset instead, which is what this calc actually needs — so no separate scroll listener is warranted either.
      setLiveHeight(`calc(100${dvh ? "dvh" : "vh"} - ${el.getBoundingClientRect().top + window.scrollY}px)`);
    };
    runMeasure();
    window.addEventListener("resize", runMeasure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(runMeasure) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", runMeasure);
      ro?.disconnect();
    };
  }, [measure]);

  return { liveWrapperRef, liveHeight };
}
