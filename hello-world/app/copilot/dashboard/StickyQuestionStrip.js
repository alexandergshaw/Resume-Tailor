"use client";

import Box from "@mui/material/Box";
import { pinnedQuestionEntry } from "@/lib/copilot/currentQuestion";
import { dashboardCopy } from "@/lib/copilot/dashboardCopy";
import CurrentQuestionPanel from "./CurrentQuestionPanel";
import { band, useStickyTop } from "../useStickyTop";

// ARCH-sticky §2.1/§3.3/§3.5. "The question is always visible wherever I am
// on the page" — CurrentQuestionPanel used to render INSIDE
// CopilotDashboard.js's own grid, which only stays on screen for as long as
// the dashboard itself does. It now mounts ONCE PER CLIENT, in this sticky
// strip, as a SIBLING of the bounded live wrapper (live) / PracticeControls
// row (practice) — above both, so a `position: sticky` strip can occlude
// only what follows it, never the controls that start a session. Nothing
// renders the question twice: CopilotDashboard.js no longer calls
// CurrentQuestionPanel at all.
//
// Everything CopilotDashboard.js used to supply this panel BY DEFAULT — the
// `{...LIVE_COPY, ...copy}` merge, the `held`/`newerCount`/`live` fallbacks
// (practice passes none of the four), and the `h3` that made the panel's own
// `h4` legal — moves here, deliberately, rather than being re-derived ad
// hoc: a panel that silently loses a default renders an honest-looking WRONG
// answer rather than failing. `headingLevel="h3"` is the load-bearing one —
// dropping it reintroduces an h2->h4 skip that copilotHeadingOrder.test.js's
// G-1 guard exists to catch (mutation H-1).
export default function StickyQuestionStrip({
  questions,
  pinnedId,
  copy,
  held = false,
  newerQuestionCount: newerCount = 0,
  onReleasePin,
  live = true,
}) {
  const { stripRef, stickyTop } = useStickyTop();
  // Same call, same lib/ import CopilotDashboard.js used to make for this
  // panel — one decision, one place, unmoved by the relocation.
  const current = pinnedQuestionEntry(questions, pinnedId);
  const text = dashboardCopy(copy);

  return (
    // outer: sticky, opaque, owns the gutter. No cap, no overflow — the
    // gutter must not scroll with the capped content below, and must not be
    // inside the cap either (ARCH-sticky §3.3).
    <Box
      ref={stripRef}
      sx={{
        position: stickyTop == null ? "static" : "sticky",
        top: stickyTop == null ? undefined : `${stickyTop}px`,
        // Above ordinary page content, far below AppHeader's zIndex: 1100
        // (AppHeader.js) — a strip painted OVER the header would hide the
        // engine picker and settings control while scrolled, a WCAG 2.2 SC
        // 2.4.11 (Focus Not Obscured) failure for a keyboard user tabbing
        // into them.
        zIndex: 2,
        // Opaque, or page content scrolls visibly THROUGH the strip.
        bgcolor: "var(--bg-canvas)",
        pb: 1.5, // the 12px the dashboard grid's own `gap: 1.5` used to supply
      }}
    >
      {/* inner: the cap and the only scroll container — and ONLY when
          hosted. `stickyTop == null` means either "not measured yet" or
          "this viewport cannot host a strip" (useStickyTop.js's hosting
          predicate); in both cases the right answer is the same: no
          stickiness AND no cap. A capped-but-static strip would be the
          worst of both — an internal scroller with none of the benefit —
          and this also removes any first-paint hazard where a cap applied
          one frame after mount would shrink a tall panel and jump the
          page. */}
      <Box
        sx={
          stickyTop == null
            ? { minHeight: 0 }
            : {
                ...band("vh"),
                "@supports (height: 1dvh)": band("dvh"),
                overflowY: "auto",
                // overflow-y: auto alone computes overflow-x to auto too,
                // and a classic Windows scrollbar would eat the question's
                // width exactly when it is long enough to be capped.
                // Nothing can overflow horizontally anyway —
                // BREAK_LONG_WORDS_SX is on every question render inside
                // CurrentQuestionPanel.js.
                overflowX: "hidden",
                minHeight: 0,
              }
        }
      >
        <CurrentQuestionPanel
          current={current}
          copy={text}
          held={held}
          newerCount={newerCount}
          onReleasePin={onReleasePin}
          live={live}
          headingLevel="h3"
        />
      </Box>
    </Box>
  );
}
