// @vitest-environment jsdom
//
// ARCH-sticky. CurrentQuestionPanel moved OUT of CopilotDashboard.js and into
// this strip (mounted once per client, above the bounded live wrapper /
// PracticeControls row — see CopilotClient.js/PracticeClient.js's own mount
// sites). CopilotDashboard.render.test.js used to pin this panel's rendered
// content; those assertions move here with it, because after the relocation
// render.test.js never renders this panel at all.
//
// WHAT IS NOT ASSERTED HERE, AND WHY: jsdom has no layout engine, so nothing
// about the cap actually binding, the strip actually sticking, or it
// occluding (or not occluding) anything is checked — those are the manual
// browser checks stickyQuestionGuards.test.js's own header names. This file
// covers the one thing jsdom CAN see: what CurrentQuestionPanel/
// StickyQuestionStrip put on screen for a given set of props.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import StickyQuestionStrip from "./StickyQuestionStrip.js";
import { LIVE_COPY, PRACTICE_COPY } from "@/lib/copilot/dashboardCopy";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Tell me about a time you disagreed with your manager.";

function entry(overrides = {}) {
  return { id: "q1", question: QUESTION, provisional: false, ...overrides };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  // ARCH-sticky §3.4: useStickyTop.js writes two custom properties and a
  // scroll-padding onto document.documentElement and removes them on
  // unmount — asserted directly in useStickyTop.test.js, cleaned up here so
  // one test's DOM state can never leak into the next.
  document.documentElement.style.removeProperty("--sticky-top");
  document.documentElement.style.removeProperty("--sticky-pad");
  document.documentElement.style.scrollPaddingTop = "";
});

async function render(props) {
  await act(async () => {
    root.render(createElement(StickyQuestionStrip, props));
  });
}

function text() {
  return container.textContent || "";
}

function heading() {
  const h3 = container.querySelector("h1,h2,h3,h4,h5,h6");
  return h3 ? { level: Number(h3.tagName.slice(1)), text: h3.textContent.trim() } : null;
}

describe("StickyQuestionStrip: the plain (RealPanel) state", () => {
  it("renders the title at h3 — one level above where it sat inside CopilotDashboard's own h3", async () => {
    // ARCH-sticky §4: the strip has no container heading of its own, so the
    // question's heading rises to h3 (a SIBLING of "Live dashboard", not a
    // child of it) — see copilotHeadingOrder.test.js's G-1 for the
    // client-scoped proof that this sits correctly relative to the rest of
    // the page; this only proves the strip itself asks for h3.
    await render({ questions: [entry()] });
    expect(heading()).toEqual({ level: 3, text: LIVE_COPY.currentQuestionTitle });
    expect(text()).toContain(QUESTION);
  });

  it("falls back to the noQuestion copy when there is nothing to show yet", async () => {
    await render({ questions: [] });
    expect(text()).toContain(LIVE_COPY.noQuestion);
    expect(text()).not.toContain(QUESTION);
  });

  it("merges a partial `copy` object over the live defaults rather than replacing them", async () => {
    // ARCH-sticky §2.7/F10: `dashboardCopy()` merges over a module-local
    // default so a caller supplying only PART of the copy object still gets
    // a complete one — the exact failure mode a residual `{...undefined}`
    // import would silently reproduce.
    await render({ questions: [entry()], copy: { title: "Practice dashboard" } });
    expect(heading()).toEqual({ level: 3, text: LIVE_COPY.currentQuestionTitle });
  });
});

describe("StickyQuestionStrip: the provisional (AccentPanel) state — [R-166]", () => {
  it('a provisional entry gets the accent card and its "Unconfirmed" chip', async () => {
    // This branch describes a REAL detected utterance of unclear speaker —
    // the opposite uncertainty from a guess about the future — and shares
    // the accent wrapper the (now-removed) prediction panels used. Removing
    // that wrapper along with its other callers would silently take this
    // with it, and the candidate's own speech would then be presented as
    // the interviewer's question with nothing to tell them apart.
    await render({ questions: [entry({ provisional: true })] });
    expect(text()).toContain("Unconfirmed");
    expect(text()).toContain(QUESTION);
    expect(text()).toContain("Not confirmed as the interviewer");
  });
});

describe("StickyQuestionStrip: the held (HeldQuestionPanel) state", () => {
  it("shows the badge, the question, and a release control naming the arrival count", async () => {
    await render({
      questions: [entry()],
      pinnedId: "q1",
      held: true,
      newerQuestionCount: 2,
      onReleasePin: () => {},
    });
    expect(text()).toMatch(/held on screen/i);
    expect(text()).toContain(QUESTION);
    const release = [...container.querySelectorAll("button")].find((b) => /release hold/i.test(b.textContent));
    expect(release).toBeTruthy();
    expect(release.textContent).toMatch(/2 newer questions/);
  });

  it("says just \"Release hold\" with no count when nothing newer has arrived", async () => {
    await render({ questions: [entry()], pinnedId: "q1", held: true, newerQuestionCount: 0, onReleasePin: () => {} });
    const release = [...container.querySelectorAll("button")].find((b) => /release hold/i.test(b.textContent));
    expect(release.textContent.trim()).toBe("Release hold");
  });

  it("calls onReleasePin when the release control is clicked", async () => {
    let released = 0;
    await render({
      questions: [entry()],
      pinnedId: "q1",
      held: true,
      newerQuestionCount: 1,
      onReleasePin: () => {
        released += 1;
      },
    });
    const release = [...container.querySelectorAll("button")].find((b) => /release hold/i.test(b.textContent));
    await act(async () => {
      release.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(released).toBe(1);
  });

  it("swaps the caption once the session is no longer live — Defect 3", async () => {
    await render({ questions: [entry()], pinnedId: "q1", held: true, live: true });
    expect(text()).toMatch(/detection and drafting keep running/i);

    await render({ questions: [entry()], pinnedId: "q1", held: true, live: false });
    expect(text()).toMatch(/this session has ended/i);
  });

  it("held is checked before provisional — a held AND provisional entry still gets the warning treatment", async () => {
    await render({ questions: [entry({ provisional: true })], pinnedId: "q1", held: true, newerQuestionCount: 0 });
    expect(text()).toMatch(/held on screen/i);
    expect(text()).not.toContain("Unconfirmed");
  });
});

describe("StickyQuestionStrip: practice mode's own wording", () => {
  it("renders PRACTICE_COPY's noQuestion sentence, not live's", async () => {
    await render({ questions: [], copy: PRACTICE_COPY });
    expect(text()).toContain(PRACTICE_COPY.noQuestion);
    expect(text()).not.toContain(LIVE_COPY.noQuestion);
  });

  it("practice mode never reaches the held branch — it passes no pinnedId/held at all", async () => {
    // PracticeClient.js's own mount site (below) passes only `questions` and
    // `copy` — `held` defaults to `false` here exactly as it used to default
    // on CopilotDashboard, which is what keeps practice byte-identical.
    await render({ questions: [entry()], copy: PRACTICE_COPY });
    expect(text()).not.toMatch(/held on screen/i);
  });
});

describe("both mount predicates — the strip must not pin the no-question fallback over Start, and must not pin a stats row over it either — before a session or after one ends", () => {
  // jsdom's own URL implementation does not round-trip through
  // node:url's fileURLToPath the way it does in this suite's node-
  // environment test files, so this file reads by plain path instead — the
  // same pattern CopilotDashboard.render.test.js (also jsdom) already uses.
  const CLIENT_SOURCE = readFileSync(path.join(process.cwd(), "app/copilot/CopilotClient.js"), "utf8");
  const PRACTICE_SOURCE = readFileSync(
    path.join(process.cwd(), "app/copilot/practice/PracticeClient.js"),
    "utf8",
  );

  // ARCH-stats-in-strip r3 §4.1 Guard A. RESTATED for the new predicate, never
  // deleted: this is the only mechanised statement of the anti-occlusion rule
  // the whole design leans on. The `|| held` disjunct is redundant in
  // production (questionPin.js:70-79 guarantees held implies
  // questions.length > 0) and exists solely so
  // CopilotClient.wiring.test.js:243-257 can reach the held branch with
  // questions === [] (it mocks useLiveSession, and `questions` is this
  // component's own useState([]) rather than a hook field) — see the
  // `mountStrip` declaration's own comment in CopilotClient.js.
  it("live: mountStrip is `questions.length > 0 || held || (live && anyMeasured)` (A1)", () => {
    // A1 is the SHAPE pin and is formatting-brittle by design; A2 below states
    // the same rule independently of formatting. Both are kept: A1 catches a
    // reordered or re-spelled predicate that A2's substring test would let
    // through, A2 survives a Prettier wrap that A1 would not.
    expect(CLIENT_SOURCE).toMatch(
      /const mountStrip = questions\.length > 0 \|\| held \|\| \(live && anyMeasured\);/,
    );
  });

  it("live: whatever mountStrip is, the stats-only disjunct is conjoined with liveness (A2)", () => {
    // MINOR-2: `\s*=\s*` and the null check, because Prettier wrapping the
    // declaration after the `=` makes a `= ` regex return null and `[0]`
    // THROW a TypeError instead of failing as an assertion.
    //
    // The two mutations this catches, and what each ships:
    //   `... || held || anyMeasured`  -> a DEAD session's frozen reading
    //                                    pinned over "Start session"
    //   `... || held || live`         -> copy.noQuestion pinned over
    //                                    SessionSetup the instant Start is hit
    const m = CLIENT_SOURCE.match(/const mountStrip\s*=\s*[^;]*;/);
    expect(m, "mountStrip must be declared in CopilotClient.js").not.toBeNull();
    expect(m[0]).toContain("anyMeasured");
    expect(m[0]).toMatch(/live\s*&&\s*anyMeasured/);
  });

  it("live: anyMeasured is an OR over the two per-reading flags (A3)", () => {
    // §2.6. Never an AND — computeLivePace requires spanSec > 0
    // (livePace.js:179) and computeLiveFillers deliberately does not
    // (:199-208), so an AND erases a real filler-only reading. And never
    // object truthiness: BOTH hooks return an object on every path and
    // useCopilotDashboard.js:37-38 hands those memoized objects straight out,
    // so `!!(pace || fillers)` is a CONSTANT `true` and the strip would mount
    // in every live session with no question at all. Whitespace-tolerant for
    // the same reason A2 is.
    expect(CLIENT_SOURCE).toMatch(
      /const anyMeasured\s*=\s*!!\(\s*pace\?\.measured\s*\|\|\s*fillers\?\.measured\s*\);/,
    );
  });

  it("live: the mount site passes sessionLive={live} and statsOnly (A4 / AC 44)", () => {
    // `statsOnly`'s default of `false` is the BEHAVIOUR-PRESERVING value, not
    // the safe one: omitting it here pins copy.noQuestion
    // (dashboardCopy.js:26) over SessionSetup in render state 3. And
    // `sessionLive` must be the session signal (CopilotClient.js:262), never
    // the strip's existing `live` prop, whose default of `true` would leave
    // the row up after Stop — §2.4 row 5.
    const open = CLIENT_SOURCE.indexOf("<StickyQuestionStrip");
    expect(open, "CopilotClient.js must mount StickyQuestionStrip").toBeGreaterThan(-1);
    const liveMount = CLIENT_SOURCE.slice(open, CLIENT_SOURCE.indexOf("/>", open));
    expect(liveMount).toMatch(/sessionLive=\{live\}/);
    expect(liveMount).toMatch(/statsOnly=/);
  });

  it("live: the strip's mount site is gated on mountStrip, and sits ahead of the bounded wrapper", () => {
    const mountIdx = CLIENT_SOURCE.indexOf("mountStrip ? (");
    const stickyIdx = CLIENT_SOURCE.indexOf("<StickyQuestionStrip", mountIdx);
    const wrapperOpen = CLIENT_SOURCE.indexOf("ref={liveWrapperRef}");
    expect(mountIdx).toBeGreaterThan(-1);
    expect(stickyIdx).toBeGreaterThan(mountIdx);
    expect(stickyIdx).toBeLessThan(wrapperOpen);
  });

  // ARCH-stats-in-strip r3 §4.1 Guard B. The shipped guard pinned the
  // predicate AND the mount site in ONE regex, so a multi-prop mount broke it
  // for a reason unrelated to what it was guarding. Split into the three facts
  // it was conflating. (The comment the shipped guard carried cited
  // PracticeClient.js:319-320 for `if (!currentQuestionText) return [];`,
  // which today sits at :321.)
  it("practice: mountStrip is `dashboardQuestions.length > 0 || (running && anyMeasured)` (B1)", () => {
    // Practice needs the liveness conjunct for the same reason live does:
    // PracticeControls, which holds Start, is ABOVE this mount. Without it, a
    // finished practice session's reading pins over Start.
    expect(PRACTICE_SOURCE).toMatch(
      /const mountStrip = dashboardQuestions\.length > 0 \|\| \(running && anyMeasured\);/,
    );
  });

  it("practice: the mount site is gated on that predicate and on nothing else (B2)", () => {
    // B2 is brittle against two CORRECT reformattings — `{mountStrip ?
    // <Sticky… /> : null}` on one line, and `{mountStrip && (`. Both fail
    // loudly and are trivially fixed; stated here so the next implementer is
    // not surprised by it.
    expect(PRACTICE_SOURCE).toMatch(/\{mountStrip \? \(\s*<StickyQuestionStrip/);
  });

  it("practice: the mount site passes sessionLive={running} and statsOnly (B3 / AC 44)", () => {
    // NOT the strip's existing `live` prop: it defaults to `true`, practice
    // never passes it, and it drives HeldQuestionPanel's caption
    // (pinned at :154-160 above). Reusing it here would make the row survive
    // Stop in practice mode — row 5's harm through the back door. And
    // practice's capture stops BETWEEN answers
    // (usePracticeCaptureSession.js:121, :145), so `running` is also what
    // makes the row disappear between answers, which §2.8 point 3 rules
    // correct: a reading from the answer you just finished is not a CURRENT
    // reading.
    const open = PRACTICE_SOURCE.indexOf("<StickyQuestionStrip");
    expect(open, "PracticeClient.js must mount StickyQuestionStrip").toBeGreaterThan(-1);
    const practiceMount = PRACTICE_SOURCE.slice(open, PRACTICE_SOURCE.indexOf("/>", open));
    expect(practiceMount).toMatch(/sessionLive=\{running\}/);
    expect(practiceMount).toMatch(/statsOnly=/);
  });

  it("practice: the mount site sits after <PracticeControls closes, not before", () => {
    const controlsClose = PRACTICE_SOURCE.indexOf("downloadLogEnabled={sessionLog.hasLog}");
    const stickyIdx = PRACTICE_SOURCE.indexOf("<StickyQuestionStrip");
    expect(controlsClose).toBeGreaterThan(-1);
    expect(stickyIdx).toBeGreaterThan(controlsClose);
  });
});

// ---------------------------------------------------------------------------
// ARCH-stats-in-strip r3 — the speaking-stats row in the sticky strip.
// FAILING TESTS. Everything below this line is RED until the row lands.
//
// THE GEOMETRY HARNESS, AND EXACTLY WHAT IT DOES AND DOES NOT PROVE
// -----------------------------------------------------------------
// `statsHosted` is produced INSIDE useStickyTop (§2.4), so the only way to
// drive it from a component test is to feed the hook the four numbers it
// reads: document.documentElement.clientHeight, the header's rect height,
// the root font size, and the strip's own rect width. All four are stubbed
// below. That makes the PREDICATE'S ARITHMETIC observable in jsdom, and the
// row's presence is then a faithful read-out of it.
//
// It proves NOTHING about layout, and must never be read as if it did:
//
//   * BROWSER-ONLY — that the cap actually binds, that the strip is actually
//     pinned, that it occludes nothing, that the row cannot be scrolled out
//     of view (AC 2), the 56-96px growth and its effect on the bounded live
//     column (AC 42), the reservation's real height (AC 13), height stability
//     across the four stats states (AC 12), "Release hold" staying inside the
//     cap (AC 16), first-line visibility (AC 17), and the width-hysteresis
//     confirmation (AC 39). jsdom returns zeroes for every rect it is not
//     handed, resolves no calc()/rem/dvh, and evaluates no @media. Those are
//     the §1.0 browser harness's job, not this file's.
//   * The stubbed numbers are the DESIGN'S numbers, not the browser's. That
//     375x812@100/r16 really produces stripW 351 and headerH 51 is §1.4's
//     measurement; this file takes it as given and tests what the predicate
//     does WITH it.
//
// jsdom also cannot observe ordering across event dispatches, and
// MouseEvent.detail defaults to 0 (so a bare synthetic click silently models
// a KEYBOARD activation) — neither matters below, because the row carries no
// interactive control at all. That absence is itself part of the design
// (§2.5: no border, no fill, no padding, no controls).
// ---------------------------------------------------------------------------

describe("the stats row: geometry, the truth table, and the two new props", () => {
  const STRIP_SOURCE = readFileSync(
    path.join(process.cwd(), "app/copilot/dashboard/StickyQuestionStrip.js"),
    "utf8",
  );

  // §1.4's own configurations, plus two synthetic tuples AC 6/7 require
  // because the 126-cell grid supplies no discriminator for either bound.
  const HOSTED = { clientHeight: 812, headerH: 51, rootPx: 16, stripW: 351 }; // 375x812@100/r16
  const WIDTH_REFUSED = { clientHeight: 812, headerH: 51, rootPx: 16, stripW: 100 };

  const PACE_MEASURED = { wordsPerMinute: 125.4, paceLabel: "conversational", measured: true };
  const PACE_UNMEASURED = { wordsPerMinute: null, paceLabel: null, measured: false };
  const FILLERS_MEASURED = { fillerCount: 6, fillerRate: 12.5, fillerLabel: "heavy", measured: true };
  const FILLERS_UNMEASURED = { fillerCount: null, fillerRate: null, fillerLabel: null, measured: false };

  // Any of the four possible readings. The row is DETECTED by its content
  // rather than by a testid, because the design reserves no testid — and
  // content is what a user actually gets.
  const STATS_RE = /\bwpm\b|% filler|speed: not measured yet|filler: not measured yet/;

  const ORIGINAL_GBCR = Element.prototype.getBoundingClientRect;
  let header;
  let localContainer;
  let localRoot;

  function applyGeometry({ clientHeight, headerH, rootPx, stripW }) {
    Object.defineProperty(document.documentElement, "clientHeight", {
      value: clientHeight,
      configurable: true,
    });
    document.documentElement.style.fontSize = `${rootPx}px`;
    Element.prototype.getBoundingClientRect = function stubbedRect() {
      const isHeader = this.nodeType === 1 && this.hasAttribute("data-app-header");
      const width = isHeader ? 0 : stripW;
      const height = isHeader ? headerH : 0;
      return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
    };
  }

  async function unmountLocal() {
    if (!localRoot) return;
    const dying = localRoot;
    localRoot = null;
    await act(async () => {
      dying.unmount();
    });
    localContainer.remove();
  }

  // A FRESH root per cell, deliberately: useStickyTop's effect has `[]` deps,
  // so re-rendering an already-mounted strip would never re-run `measure()`
  // and every geometry after the first would be silently ignored — a harness
  // bug that would make this whole block pass for the wrong reason.
  async function mountWith(geometry, props) {
    await unmountLocal();
    applyGeometry(geometry);
    localContainer = document.createElement("div");
    document.body.appendChild(localContainer);
    localRoot = createRoot(localContainer);
    await act(async () => {
      localRoot.render(createElement(StickyQuestionStrip, props));
    });
  }

  function localText() {
    return (localContainer.textContent || "").replace(/\s+/g, " ").trim();
  }

  // The row must be a DIRECT CHILD of the strip's outer sticky box — i.e. a
  // SIBLING of the capped, scrolling box, never a descendant of it (AC 1).
  // Identifying it this way is what makes that structural claim load-bearing:
  // an implementation that renders the row INSIDE the capped box (where it
  // would scroll away with the question, defeating the entire slice) has no
  // outer child that carries a reading without also carrying the question, so
  // every "row present" assertion below goes red.
  function statsRowNode() {
    const outer = localContainer && localContainer.firstElementChild;
    if (!outer) return null;
    return (
      [...outer.children].find((el) => {
        const content = el.textContent || "";
        return STATS_RE.test(content) && !content.includes(QUESTION);
      }) || null
    );
  }

  function hasStatsRow() {
    return statsRowNode() != null;
  }

  beforeEach(() => {
    header = document.createElement("header");
    header.setAttribute("data-app-header", "");
    document.body.appendChild(header);
  });

  afterEach(async () => {
    await unmountLocal();
    Element.prototype.getBoundingClientRect = ORIGINAL_GBCR;
    delete document.documentElement.clientHeight;
    document.documentElement.style.fontSize = "";
    header.remove();
  });

  // -------------------------------------------------------------------------
  // AC 5 / 6 / 7 — the second predicate, driven through the component
  // -------------------------------------------------------------------------

  it("statsHosted follows (clientHeight, headerH, rootPx, stripW) — AC 5, 6, 7", async () => {
    // Read out through the row's presence with the session live and a question
    // present, which is `showStats = sessionLive && statsHosted` with the one
    // free variable being the geometry.
    const TUPLES = [
      // [clientHeight, headerH, rootPx, stripW, expected, why]
      [812, 51, 16, 168, true, "AC 6: exactly at the 10.5rem bound (168px) — catches a threshold set too HIGH (10.75 gives 172 > 168)"],
      [812, 51, 16, 167, false, "AC 6 RED VALUE: 1px under the bound. A threshold typo'd to 10.25 gives 164, so 167 clears the width clause; the share term has 160.14px of slack, so the predicate returns true and this goes red"],
      [812, 51, 16, 351, true, "the ordinary hosted phone — 375x812@100/r16, 21.94rem"],
      [932, 90, 32, 263, false, "the ordinary width refusal — 430x932@150/r32, 8.22rem against a 336px bound"],
      [512, 51, 16, 336, true, "AC 7: the TIGHTEST hosted cell — 720x1024@200/r16, share slack 0.99px"],
      [512, 60, 16, 336, false, "AC 7: share-refused by 0.36px — DROPPING or negating the second `+ 12` makes this true"],
      [375, 51, 16, 643, false, "the ordinary share refusal — 667x375@100/r16, a landscape phone"],
      [200, 51, 16, 336, false, "AC 5: isHostable is false here, so statsHosted must be false too — never sticky for stats but not for the question"],
    ];

    for (const [clientHeight, headerH, rootPx, stripW, expected, why] of TUPLES) {
      await mountWith(
        { clientHeight, headerH, rootPx, stripW },
        {
          questions: [entry()],
          sessionLive: true,
          pace: PACE_MEASURED,
          fillers: FILLERS_MEASURED,
        },
      );
      expect(hasStatsRow(), `(${clientHeight}, ${headerH}, ${rootPx}, ${stripW}) — ${why}`).toBe(expected);
      // The question is unaffected by the row's refusal in every one of these:
      // the cap is not debited and band() is untouched, so a refused cell is
      // today's strip exactly (AC 9).
      expect(localText()).toContain(QUESTION);
    }
  });

  it("GUARD (green before the feature): the AC 6/7 tuples actually discriminate", () => {
    // A criterion whose boundary cell cannot fail is the defect r3's
    // correction B exists to fix, so the discriminating power of the table
    // above is itself asserted — against a LOCAL reference predicate. This is
    // a property of the TABLE, and it is never used to test the shipped
    // implementation; the test above does that.
    const predict = (
      { clientHeight, headerH, rootPx, stripW },
      { minStripRem = 10.5, secondGutter = 12 } = {},
    ) => {
      const floorPx = 64 + 4.25 * rootPx;
      const availPx = clientHeight - headerH;
      const pct = [
        [519, 0.45],
        [699, 0.38],
        [Infinity, 0.3],
      ].find(([max]) => clientHeight <= max)[1];
      const capPx = Math.max(floorPx, pct * availPx);
      if (capPx + 12 > 0.6 * availPx) return false;
      if (stripW < minStripRem * rootPx) return false;
      return capPx + 12 + (4 + 2.51 * rootPx) + secondGutter <= 0.6 * availPx;
    };

    expect(predict({ clientHeight: 812, headerH: 51, rootPx: 16, stripW: 168 })).toBe(true);
    expect(predict({ clientHeight: 812, headerH: 51, rootPx: 16, stripW: 167 })).toBe(false);
    expect(predict({ clientHeight: 512, headerH: 51, rootPx: 16, stripW: 336 })).toBe(true);
    expect(predict({ clientHeight: 512, headerH: 60, rootPx: 16, stripW: 336 })).toBe(false);

    // ...and each mutation flips at least one cell of the table:
    expect(
      predict({ clientHeight: 812, headerH: 51, rootPx: 16, stripW: 167 }, { minStripRem: 10.25 }),
      "a threshold typo'd LOW must flip the red value to true",
    ).toBe(true);
    expect(
      predict({ clientHeight: 812, headerH: 51, rootPx: 16, stripW: 168 }, { minStripRem: 10.75 }),
      "a threshold set HIGH must flip the at-the-bound cell to false",
    ).toBe(false);
    expect(
      predict({ clientHeight: 512, headerH: 60, rootPx: 16, stripW: 336 }, { secondGutter: 0 }),
      "dropping the second `+ 12` must flip the 0.36px-refused cell to true",
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // §2.4 — the render-state truth table, row by row
  // -------------------------------------------------------------------------
  //
  // WHICH ROWS ARE OBSERVABLE HERE. Rows 1, 1', 2, 2', 3, 3', 5 and 6 turn on
  // (S, M, H, statsOnly), all four of which are inputs to THIS component, so
  // they are jsdom-observable and are asserted below. Rows 4, 7 and 8 are
  // "the strip does not mount at all" — that is the two CLIENTS' `mountStrip`
  // predicate, not this component, and it is fenced by A1/A2/A3 and B1/B2
  // above plus AC 19/20's client-level twins. Nothing here can assert them
  // without mounting a client, and a component test that pretended to would be
  // asserting its own fixture.

  it("rows 1 and 1' — question + both readings when hosted; question only when not", async () => {
    const props = {
      questions: [entry()],
      sessionLive: true,
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    };

    await mountWith(HOSTED, props);
    expect(hasStatsRow()).toBe(true);
    expect(localText()).toContain(QUESTION);
    expect(localText()).toContain("125 wpm");
    expect(localText()).toContain("12.5% filler");

    // Row 1' — 35 of 126 configurations. Today's behaviour, exactly.
    await mountWith(WIDTH_REFUSED, props);
    expect(hasStatsRow()).toBe(false);
    expect(localText()).toContain(QUESTION);
    expect(localText()).not.toContain("wpm");
  });

  it("rows 2 and 2' — a live session with nothing measured yet still holds the row", async () => {
    // §2.4: the row's presence does NOT depend on anyMeasured. The reservation
    // is held from the session's first frame, so the eighth word landing
    // (MIN_WORDS_FOR_MEASUREMENT = 8, livePace.js:59) changes text and not
    // layout.
    const props = {
      questions: [entry()],
      sessionLive: true,
      pace: PACE_UNMEASURED,
      fillers: FILLERS_UNMEASURED,
    };

    await mountWith(HOSTED, props);
    expect(hasStatsRow()).toBe(true);
    expect(localText()).toContain("speed: not measured yet");
    expect(localText()).toContain("filler: not measured yet");

    await mountWith(WIDTH_REFUSED, props);
    expect(hasStatsRow()).toBe(false);
    expect(localText()).not.toContain("not measured yet");
  });

  it("row 3 — statsOnly mounts the row with NO question panel and no noQuestion copy", async () => {
    // The ordinary OPENING of a live interview: the interviewer is talking,
    // live records only speaker === "you" (useLiveSession.js:630), so there is
    // a session and there are readings but no question yet. Pinning
    // "No question has been detected yet this session." over SessionSetup here
    // is the harm `statsOnly` exists to prevent.
    await mountWith(HOSTED, {
      questions: [],
      statsOnly: true,
      sessionLive: true,
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    });
    expect(hasStatsRow()).toBe(true);
    expect(localText()).toContain("125 wpm");
    expect(localText()).not.toContain(LIVE_COPY.noQuestion);
    expect(localContainer.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
  });

  it("row 3' — statsOnly with the row NOT hosted renders null, not an empty sticky box (AC 41)", async () => {
    // The fifth render state, reachable in 77 of 126 configurations. Without
    // the early return what mounts is an empty sticky Box carrying only
    // `pb: 1.5` — 12px of canvas — which is near-invisible and still
    // falsifies §1.4's "in the refused configurations the strip renders
    // exactly what it renders today", because HEAD mounts nothing at all here.
    await mountWith(WIDTH_REFUSED, {
      questions: [],
      statsOnly: true,
      sessionLive: true,
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    });
    expect(localContainer.innerHTML).toBe("");

    // AC 41's residual, asserted rather than assumed: the early return cannot
    // precede useStickyTop() (that would be a conditional hook), so the hook
    // still runs one measurement and writes three custom properties. They
    // describe the app header, which genuinely is fixed at zIndex 1100, so
    // they are correct rather than harmful — and all three must still be
    // removed on unmount (useStickyTop.js:140-150).
    expect(document.documentElement.style.scrollPaddingTop).toBe("var(--sticky-pad, 0px)");
    await unmountLocal();
    expect(document.documentElement.style.scrollPaddingTop).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sticky-top")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sticky-pad")).toBe("");
  });

  it("ROW 5 — a question that survives Stop keeps the question and DROPS the row (AC 25)", async () => {
    // THE COMMON POST-STOP SCREEN, and the one the previous revision's suite
    // could not see because it mocked `questions: []` throughout. Interview 1
    // ends; the question survives Stop (shipped behaviour at 93ad8f7); the
    // ticker is torn down so `now` freezes and staleness deliberately cannot
    // intervene (§2.7). A liveness conjunct applied only to the MOUNT
    // predicate reaches row 7 and leaves this row rendering session 1's frozen
    // reading pinned above "Start session" for interview 2 — verbatim the harm
    // the conjunct exists to prevent, minus only the "no question was ever
    // detected" precondition.
    //
    // The control mount is what stops this assertion being vacuous: the SAME
    // fixtures, the SAME geometry, with only `sessionLive` flipped, must show
    // the row. An implementation that renders no row at all fails on the
    // control; an implementation that gates liveness on the mount fails below.
    const shared = {
      questions: [entry()],
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    };

    await mountWith(HOSTED, { ...shared, sessionLive: true });
    expect(hasStatsRow(), "control: the same fixtures with sessionLive true MUST show the row").toBe(true);

    await mountWith(HOSTED, { ...shared, sessionLive: false });
    expect(localText()).toContain(QUESTION);
    expect(hasStatsRow(), "a finished session's reading must not stay pinned").toBe(false);
    for (const fragment of [
      "125 wpm",
      "12.5% filler",
      "speed: not measured yet",
      "filler: not measured yet",
    ]) {
      expect(localText(), `"${fragment}" must not appear after Stop`).not.toContain(fragment);
    }
  });

  it("row 6 — question, session over, nothing measured: byte-identical to today", async () => {
    // Paired with its own control for the same reason row 5 is: an assertion
    // that something is ABSENT passes trivially against a tree where the
    // feature does not exist at all, and a suite full of those is how a
    // regression comes to look green.
    const shared = { questions: [entry()], pace: PACE_UNMEASURED, fillers: FILLERS_UNMEASURED };

    await mountWith(HOSTED, { ...shared, sessionLive: true });
    expect(hasStatsRow(), "control: the same fixtures with sessionLive true MUST show the row").toBe(true);

    await mountWith(HOSTED, { ...shared, sessionLive: false });
    expect(localText()).toContain(QUESTION);
    expect(hasStatsRow()).toBe(false);
    expect(localText()).not.toContain("not measured yet");
  });

  it("AC 40 — the row is rendered iff (sessionLive && statsHosted), over the full 2x2x2 table", async () => {
    // A mount-level liveness conjunct alone scores 4/8 here; gating the row on
    // `anyMeasured` as well scores 7/8 and fails the (live, hosted,
    // anyMeasured=false) cell that AC 43 names.
    for (const sessionLive of [true, false]) {
      for (const hosted of [true, false]) {
        for (const anyMeasured of [true, false]) {
          await mountWith(hosted ? HOSTED : WIDTH_REFUSED, {
            questions: [entry()],
            sessionLive,
            pace: anyMeasured ? PACE_MEASURED : PACE_UNMEASURED,
            fillers: FILLERS_UNMEASURED,
          });
          expect(
            hasStatsRow(),
            `sessionLive=${sessionLive} statsHosted=${hosted} anyMeasured=${anyMeasured}`,
          ).toBe(sessionLive && hosted);
          expect(localText()).toContain(QUESTION);
        }
      }
    }
  });

  it("AC 43 — the first measurement changes the TEXT, never the row's presence or identity", async () => {
    // Gating the row on `anyMeasured` would pop it into existence the moment
    // the eighth word lands, pushing the page down MID-ANSWER — precisely the
    // reflow §1.3's whole reservation argument exists to eliminate. The `toBe`
    // on the element reference is what distinguishes "the row stayed" from
    // "a new row was mounted in its place", which look identical by text.
    const base = {
      questions: [entry()],
      sessionLive: true,
      fillers: FILLERS_UNMEASURED,
    };
    await mountWith(HOSTED, { ...base, pace: PACE_UNMEASURED });
    const before = statsRowNode();
    expect(before, "the row must be present before anything is measured").toBeTruthy();
    expect(localText()).toContain("speed: not measured yet");

    await act(async () => {
      localRoot.render(createElement(StickyQuestionStrip, { ...base, pace: PACE_MEASURED }));
    });
    expect(statsRowNode()).toBe(before);
    expect(localText()).toContain("125 wpm");
  });

  // -------------------------------------------------------------------------
  // AC 1 / AC 3 — placement
  // -------------------------------------------------------------------------

  it("AC 1 / AC 3 — the row is a SIBLING of the capped box, and follows it in DOM order", async () => {
    // The row must sit outside the only scroll container (overflowY: auto is
    // on the INNER box, StickyQuestionStrip.js:78) or it scrolls away with the
    // question, which is the whole slice. Asserted structurally rather than
    // through computed styles: jsdom resolves no cascade worth trusting here,
    // but parent/child is real. (That it then actually STAYS put while the
    // capped box scrolls is AC 2 — browser-only.)
    await mountWith(HOSTED, {
      questions: [entry()],
      sessionLive: true,
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    });
    const outer = localContainer.firstElementChild;
    const row = statsRowNode();
    const capped = [...outer.children].find((el) => (el.textContent || "").includes(QUESTION));
    expect(row, "the row must be a direct child of the sticky outer box").toBeTruthy();
    expect(capped).toBeTruthy();
    expect(row).not.toBe(capped);
    expect(capped.contains(row), "the row must NOT be inside the scrolling capped box").toBe(false);
    expect(row.contains(capped)).toBe(false);
    // §2.1: the question keeps the reading order and the top of the strip.
    // Stats are ambient; the question is primary.
    const following = capped.compareDocumentPosition(row) & window.Node.DOCUMENT_POSITION_FOLLOWING;
    expect(following, "the row must come AFTER the question in DOM order").toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // The two new props and their defaults
  // -------------------------------------------------------------------------

  it("statsOnly and sessionLive are declared props, each defaulting to false", async () => {
    // `sessionLive`'s default is both unchanged behaviour AND the safe value:
    // no session signal, no row. `statsOnly`'s default is unchanged behaviour
    // and is NOT the safe value — forgetting it at a mount site pins
    // copy.noQuestion over SessionSetup / PracticeControls. It is a PROP
    // rather than derived (`statsOnly <=> !Q`) because deriving it would change
    // what this component renders for `questions: []` with no `held`, and
    // three shipped tests do exactly that and assert the noQuestion fallback:
    // :83-87 (live copy), :170-174 (practice copy), and
    // copilotHeadingOrder.test.js's G-1, which reaches the strip through
    // `held: true` with `questions: []` (its own header says so at :23-27) and
    // needs the h3 to exist.
    expect(STRIP_SOURCE).toMatch(/statsOnly\s*=\s*false/);
    expect(STRIP_SOURCE).toMatch(/sessionLive\s*=\s*false/);

    // And behaviourally: omitted, the component still renders the fallback.
    await mountWith(HOSTED, {
      questions: [],
      sessionLive: true,
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    });
    expect(localText(), "statsOnly defaults false — the noQuestion fallback survives").toContain(
      LIVE_COPY.noQuestion,
    );
    expect(hasStatsRow(), "and the row is still governed by sessionLive && statsHosted").toBe(true);
  });

  it("the question panel's condition is !statsOnly, not `pinnedQuestionEntry returned something`", async () => {
    // pinnedQuestionEntry (currentQuestion.js:79-86) returns null for an empty
    // list via latestQuestionEntry (:56-63), and `held: true` with
    // `questions: []` is a real, test-exercised path — CopilotClient.js:520-527
    // explains why the `|| held` disjunct exists at all. Gating the panel on
    // `current` would silently delete the noQuestion fallback in three shipped
    // tests, which is a behaviour change wearing a refactor's clothes.
    await mountWith(HOSTED, {
      questions: [],
      held: true,
      sessionLive: true,
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    });
    expect(localContainer.querySelector("h1,h2,h3,h4,h5,h6")).not.toBeNull();
    expect(hasStatsRow()).toBe(true);
  });

  it("the strip declares no live region and no heading of its own for the row (AC 31)", async () => {
    // The row mounts once per session and its text then changes every second.
    // A live region here re-announces a wpm figure over the interviewer; an
    // aria-label interpolating a reading does the same thing while passing any
    // "no aria-live" grep. And the dashboard's "Your delivery" h4
    // (CopilotDashboard.js:433) does NOT travel with the row: a second h4
    // outside the dashboard's h3 reintroduces exactly the skip
    // copilotHeadingOrder.test.js's G-1 exists to catch.
    await mountWith(HOSTED, {
      questions: [],
      statsOnly: true,
      sessionLive: true,
      pace: PACE_MEASURED,
      fillers: FILLERS_MEASURED,
    });
    expect(localContainer.querySelector("[aria-live]")).toBeNull();
    expect(localContainer.querySelector('[role="status"],[role="alert"],[role="log"]')).toBeNull();
    expect(localContainer.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    for (const labelled of localContainer.querySelectorAll("[aria-label]")) {
      expect(labelled.getAttribute("aria-label")).toBe("Speaking stats");
    }
  });

  // ---------------------------------------------------------------------------
  // MAJOR-1 (post-verification). Every test above (and `mountWith()` itself,
  // by its own comment at its definition) deliberately builds a FRESH root
  // per geometry cell, because useStickyTop's effect used to have `[]` deps
  // and re-rendering an already-mounted strip would never re-run `measure()`.
  // That harness choice is exactly why 44 tests could go green over a broken
  // mechanism: nothing in this file ever changed geometry on a LIVE mount.
  // These two tests reuse ONE root across a geometry change and a real
  // `resize` event — the way a maximize, a rotation or a devtools-close
  // actually happens to a running page — instead of remounting fresh.
  // ---------------------------------------------------------------------------
  describe("MAJOR-1 regression: a live mount must recover once a collapsed strip's geometry becomes hostable again", () => {
    let liveContainer;
    let liveRoot;

    beforeEach(() => {
      liveContainer = document.createElement("div");
      document.body.appendChild(liveContainer);
      liveRoot = createRoot(liveContainer);
    });

    afterEach(async () => {
      await act(async () => {
        liveRoot.unmount();
      });
      liveContainer.remove();
    });

    it("a stats-only mount that collapses to null on a refused geometry comes back once the SAME mount resizes into a hostable one", async () => {
      // Row 3′'s own refused geometry (AC 41): no question, so the strip
      // collapses to `null` the instant it is measured once.
      applyGeometry(WIDTH_REFUSED);
      await act(async () => {
        liveRoot.render(
          createElement(StickyQuestionStrip, {
            questions: [],
            statsOnly: true,
            sessionLive: true,
            pace: PACE_MEASURED,
            fillers: FILLERS_MEASURED,
          }),
        );
      });
      expect(liveContainer.innerHTML, "must start collapsed on a refused geometry (AC 41)").toBe("");

      // The geometry becomes hostable — a maximize, a rotation, closing
      // devtools — and the viewport fires the resize event a real one would.
      applyGeometry(HOSTED);
      await act(async () => {
        window.dispatchEvent(new window.Event("resize"));
      });

      expect(
        liveContainer.textContent || "",
        "the row must come back once the SAME mount resizes into a hostable geometry — MAJOR-1: " +
          "stripRef unmounts on the first collapse, so stripW read 0 forever and statsHosted could never return true",
      ).toMatch(STATS_RE);
      expect(liveContainer.innerHTML).not.toBe("");
    });

    it("control: the identical resize on a mount that never collapsed (a question keeps the ref mounted) also shows the row", async () => {
      // Same fixtures, same geometry change, same resize — with only
      // `statsOnly` false (a question is present) so the ref is NEVER
      // unmounted. This is what proves the test above is measuring the
      // unmounted ref and not something incidental about the resize path
      // itself: an implementation that broke resize handling generally would
      // fail this control too; the pre-fix source failed only the test above.
      applyGeometry(WIDTH_REFUSED);
      await act(async () => {
        liveRoot.render(
          createElement(StickyQuestionStrip, {
            questions: [entry()],
            sessionLive: true,
            pace: PACE_MEASURED,
            fillers: FILLERS_MEASURED,
          }),
        );
      });
      expect(liveContainer.textContent || "").toContain(QUESTION);
      expect(liveContainer.textContent || "", "control must start WITHOUT the row on a refused geometry").not.toMatch(
        STATS_RE,
      );

      applyGeometry(HOSTED);
      await act(async () => {
        window.dispatchEvent(new window.Event("resize"));
      });

      expect(liveContainer.textContent || "", "control: the row must come back — isolates the defect to the unmounted ref").toMatch(
        STATS_RE,
      );
    });
  });
});
