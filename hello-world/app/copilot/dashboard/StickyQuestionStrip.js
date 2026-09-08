"use client";

import Box from "@mui/material/Box";
import { pinnedQuestionEntry } from "@/lib/copilot/currentQuestion";
import { dashboardCopy } from "@/lib/copilot/dashboardCopy";
import CurrentQuestionPanel from "./CurrentQuestionPanel";
import StatsRow from "./StatsRow";
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
//
// ARCH-stats-in-strip r3 §2.1/§2.4. The speaking-stats row (StatsRow.js) now
// mounts here too, OUTSIDE the capped/scrolling box below (never inside it —
// it must not be able to scroll away with the question) and the cap is NOT
// debited for it: `band()` above is untouched, so the question's capped box
// is byte-identical to what shipped before this row existed in every hosted
// configuration. The row travels with the SESSION (`sessionLive`), never
// with the question and never with whether anything is actually measured
// yet — see `showStats` below for the full reasoning, which the design's
// truth table (§2.4) enumerates over (session live, question reason, any
// reading measured, row hosted).
export default function StickyQuestionStrip({
  questions,
  pinnedId,
  copy,
  held = false,
  newerQuestionCount: newerCount = 0,
  onReleasePin,
  live = true,
  // ARCH-stats-in-strip r3: the two readings, handed straight to StatsRow
  // below — this component makes no measurability decision of its own about
  // either one (StatsRow gates each on its own `measured` flag).
  pace,
  fillers,
  // The SESSION signal — CopilotClient's `live` (from its own `status`) or
  // PracticeClient's `running` — deliberately NOT this component's existing
  // `live` prop above, whose default of `true` drives HeldQuestionPanel's
  // caption and would leave the row rendered after Stop if reused here
  // (§2.4). Defaults `false`: no session signal, no row — both the
  // unchanged behaviour for every caller that predates this prop and the
  // SAFE value for a caller that forgets to pass it.
  sessionLive = false,
  // Whether this mount has no question to show at all (the caller's own Q
  // reason — `questions.length > 0 || held` in live, `dashboardQuestions.
  // length > 0` in practice — came back false). A PROP rather than derived
  // from `current`, on purpose: deriving it would silently change what this
  // component renders for `questions: []` with no `held`, and three shipped
  // tests assert the `noQuestion` fallback for exactly that input (this
  // file's own test suite, `:83-87` and `:170-174`, plus
  // copilotHeadingOrder.test.js's G-1). Defaults `false` — unchanged
  // behaviour, but NOT the safe value at a mount site: omitting it there
  // pins `copy.noQuestion` over SessionSetup/PracticeControls the moment a
  // live session with no question yet reaches this strip (AC 20/44).
  statsOnly = false,
}) {
  const { stripRef, stickyTop, statsHosted, measured } = useStickyTop();
  // ARCH-stats-in-strip r3 §2.4: the row's own visibility rule, and the
  // correction the whole revision turns on. Gating liveness on the MOUNT
  // alone (in the two clients) only reaches the state where no question was
  // EVER detected this session — the common case is a question that
  // survives Stop (shipped behaviour), which still mounts the strip through
  // the question disjunct, so the row needs its OWN liveness gate here, not
  // one borrowed from the mount. Never gated on `pace`/`fillers` being
  // measured (AC 43) — the reservation is held from the session's first
  // frame so an eighth word landing mid-answer changes text, never layout.
  const showStats = sessionLive && statsHosted;
  // ARCH-stats-in-strip r3 §2.4 row 3′ — the fifth render state. A
  // stats-only mount whose row is not hosted has nothing left to render: no
  // question (statsOnly), no row (!showStats). Gated on `measured`, not on
  // `showStats` alone: `statsHosted` starts `false` on every fresh mount,
  // indistinguishable from "confirmed not hosted" until useStickyTop has
  // actually read the strip's own rect — and that rect can only be read
  // through the very Box this early return would remove. Bailing out before
  // the first real measurement would unmount the ref permanently, freezing
  // a genuinely hostable geometry at its unmeasured default forever. So the
  // FIRST render (unmeasured) renders an empty, ref-bearing Box instead of
  // nothing — invisible to any test, since `act()` settles the follow-up
  // render this same measurement triggers before an assertion ever runs —
  // and only once `measured` is true does an unhosted geometry actually
  // collapse to `null`. useStickyTop() above has already run (a hook cannot
  // be conditional), so even the collapsed render leaves that measurement's
  // three custom-property writes behind — they describe the app header,
  // which genuinely is fixed, so they are correct rather than harmful, and
  // are still removed on unmount like any other render (useStickyTop.js's
  // own cleanup, unchanged).
  //
  // POST-VERIFICATION MAJOR-1 FIX. The paragraph above explains why the
  // FIRST collapse is safe; on its own it does not explain why a LATER one
  // is too. Once this line has returned `null` once, the Box below is
  // unmounted and `stripRef.current` goes to null for good UNLESS something
  // re-measures — a resize into a hostable geometry used to have no way
  // back in. `useStickyTop.js`'s `measure()` now treats "the ref I would
  // read a rect from is null" as "no evidence either way", never as
  // "confirmed unhostable", and resets `measured` to `false` instead of
  // reconfirming `statsHosted: false` on a fabricated zero-width rect. That
  // reset re-enters this exact branch on the very next render: `measured`
  // is `false` again, so this early return does not fire, the ref-bearing
  // Box below remounts, and `useStickyTop.js`'s own re-probe effect hands
  // `measure()` a REAL rect the moment that happens — before the browser
  // paints, because the whole handoff runs through `useLayoutEffect` rather
  // than `useEffect`. A window resize or the header's own ResizeObserver
  // firing while collapsed is what starts that cycle, and both stay
  // registered for the life of the mount whether or not the strip is
  // currently collapsed, so a resize, a maximize, a rotation, or the header
  // itself changing height can all bring the row back — none of them can
  // get stuck the way the pre-fix version could.
  if (statsOnly && measured && !showStats) return null;

  // Same call, same lib/ import CopilotDashboard.js used to make for this
  // panel — one decision, one place, unmoved by the relocation.
  const current = pinnedQuestionEntry(questions, pinnedId);
  const text = dashboardCopy(copy);

  return (
    // outer: sticky, opaque, owns the gutter. No cap, no overflow — the
    // gutter must not scroll with the capped content below, and must not be
    // inside the cap either (ARCH-sticky §3.3). ARCH-stats-in-strip r3: the
    // row below is a DIRECT CHILD here too, a SIBLING of the capped box, for
    // the identical reason.
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
          page.
          ARCH-stats-in-strip r3 §2.4: gated on `!statsOnly`, not on whether
          `current` resolved to something — pinnedQuestionEntry falls back
          to a non-null "no question" shape for an empty list, and
          `held: true` with `questions: []` is a real, test-exercised path
          (CopilotClient.js explains why the `|| held` mount disjunct exists
          at all), so gating on `current` would silently delete the
          `noQuestion` fallback three shipped tests assert. */}
      {!statsOnly ? (
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
      ) : null}
      {/* ARCH-stats-in-strip r3 §2.1: OUTSIDE the cap, below the capped
          question box, still inside this sticky outer box — never inside
          the scroll container above, so it can never be scrolled out of
          view (AC 2), and the cap itself is never debited for it (`band()`
          is untouched). */}
      {showStats ? <StatsRow pace={pace} fillers={fillers} /> : null}
    </Box>
  );
}
