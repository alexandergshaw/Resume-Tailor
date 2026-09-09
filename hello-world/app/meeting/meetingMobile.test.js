// @vitest-environment jsdom
//
// The mobile-portrait guard for `app/meeting/**` — the last surface in the
// app-wide phone pass, and the only one that had never had one at all (no
// commit under this directory has ever mentioned mobile; `MeetingTranscript.js`
// went further and wrote down a decision NOT to adopt the shared pane contract,
// made when no phone was in view).
//
// WHAT THIS FILE CAN AND CANNOT PROVE — read this before adding a case.
//
// jsdom has NO layout engine. `getBoundingClientRect()` returns zeros, so
// overflow, wrapping, clipping and real touch geometry are NOT measurable here
// and nothing below pretends to measure them. A case that appeared to would be
// worse than no case: it would pass vacuously and defend the defect.
//
// What jsdom DOES do is run a real cascade over emotion's injected CSS, so
// DECLARED and SERIALIZED values are testable — a `minHeight` that resolves to
// "44px" is a fact, even though the button's actual rendered height is not.
// Every style case below therefore reads back computed CSS through
// `app/theme/computedStyleAtWidth.js`'s `atWidth`, which emulates a viewport
// width by rewriting the `min-width` media conditions MUI compiles every
// responsive `sx` value into (jsdom evaluates no media FEATURE on its own, so
// without it NO `sx` rule applies at any width — see that module's header).
//
// The behavioural block at the bottom is different in kind: it asserts which
// branch the auto-follow effect TAKES given stubbed scroll inputs. That is a
// decision, not a geometry, so it is honestly testable. Whether 48px is the
// right stickiness threshold, and whether the newest row is actually visible
// afterwards, are browser checks and are not claimed here.
//
// The 30.75px (`size="small"`) and 36.5px (`size="medium"`) natural MUI button
// heights that make these floors necessary in the first place are arithmetic
// from MUI's own source, recorded in `app/theme/mobileSx.test.js`'s header —
// not something this or any other test in this repo can read back.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx.js";

const hooks = vi.hoisted(() => ({
  session: {
    turns: [],
    interims: {},
    status: "idle",
    error: "",
    warning: "",
    start: vi.fn(),
    stop: vi.fn(),
  },
  insights: {
    insights: [],
    topic: "",
    topicChanged: false,
    status: "idle",
    error: "",
    nudge: vi.fn(),
  },
}));

// Only the two hooks are mocked — they own capture and network. The real
// MeetingTranscript and MeetingInsightList render underneath, deliberately:
// the touch-target sweep below is over the whole running meeting, and mocking
// the views away would hide four of the seven controls it exists to check.
vi.mock("./useMeetingSession.js", () => ({ useMeetingSession: () => hooks.session }));
vi.mock("./useMeetingInsights.js", () => ({ useMeetingInsights: () => hooks.insights }));

import MeetingPanel from "./MeetingPanel.js";
import MeetingTranscript from "./MeetingTranscript.js";
import MeetingInsightList from "./MeetingInsightList.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = 375;
const DESKTOP = 1000;
// The 600-899 tablet band. PHONE_PANE_SX is keyed to `md`, not `sm`, on
// purpose, so a case that only checked 375 and 1000 could not tell a correct
// `md` keying from someone "tidying" it to `sm`.
const TABLET = 700;

let container;
let root;
let originalScrollIntoView;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  hooks.session.turns = [];
  hooks.session.interims = {};
  hooks.session.status = "idle";
  hooks.session.start.mockReset();
  hooks.session.stop.mockReset();
  hooks.insights.insights = [];
  hooks.insights.topic = "";
  hooks.insights.topicChanged = false;
  hooks.insights.error = "";
  hooks.insights.status = "idle";
  hooks.insights.nudge.mockReset();
  // jsdom implements scrollIntoView as a no-op; replaced with a spy so the
  // auto-follow block can see whether it was called at all.
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.restoreAllMocks();
  delete global.fetch;
});

async function render(element) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, element));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(el) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const styleAt = (width, el, prop) => atWidth(width, () => window.getComputedStyle(el)[prop]);

const buttons = () => [...container.querySelectorAll("button")];

function named(re) {
  return buttons().find((b) => re.test(b.getAttribute("aria-label") || b.textContent || ""));
}

function describeButton(b) {
  return `"${b.getAttribute("aria-label") || b.textContent || "(unnamed)"}"`;
}

// The sweep both touch-target cases share. Reported as a LIST of offenders
// rather than one failing assertion per control, so a red run names every
// control that is short rather than only the first.
function shortButtons(width = PHONE) {
  return buttons()
    .map((b) => ({ b, minHeight: styleAt(width, b, "minHeight") }))
    .filter(({ minHeight }) => minHeight !== `${MOBILE_TAP_MIN}px`)
    .map(({ b, minHeight }) => `${describeButton(b)} -> min-height ${minHeight}`);
}

const TURNS = [
  { id: "t1", speaker: "you", text: "Are we still gated on the legacy processor?", at: 1000 },
  { id: "t2", speaker: "them", text: "Only for refunds now.", at: 4000 },
];

const INSIGHT = {
  id: "i1",
  text: "Mention that reconciliation dropped from three days to under an hour.",
  kind: "point",
  source: { kind: "page", pageId: "p-1", pageTitle: "Payments migration" },
};

// ---------------------------------------------------------------------------
// F-02 — every control in the meeting surfaces clears the 44px touch floor.
//
// Seven controls across three files shipped with MUI's mouse-sized defaults:
// `size="small"` is 30.75px and the default `medium` is 36.5px, against the
// 44px MOBILE_TAP_MIN the rest of this app adopted. Swept rather than listed,
// so a control added to any of these files next year is covered on the day it
// is written without this file naming it.
// ---------------------------------------------------------------------------

describe("F-02 — touch targets across app/meeting/**", () => {
  it("[positive control] the sweep actually finds the panel's controls", async () => {
    hooks.session.status = "live";
    hooks.session.turns = TURNS;
    hooks.insights.insights = [INSIGHT];
    await render(createElement(MeetingPanel, { pageId: "p-1", onMeetingSaved: vi.fn() }));
    // Stop, Jump to latest, Find sources, Nudge at minimum — if this drops to
    // zero the two cases below would pass by measuring nothing.
    expect(buttons().length).toBeGreaterThanOrEqual(4);
    expect(named(/stop the meeting/i)).toBeDefined();
    expect(named(/jump to the latest turn/i)).toBeDefined();
    expect(named(/ask for a fresh insight now/i)).toBeDefined();
  });

  it("MeetingPanel: Start clears the floor at 375 and is unchanged at 1000", async () => {
    await render(createElement(MeetingPanel, { pageId: "p-1", onMeetingSaved: vi.fn() }));
    const start = named(/start a meeting/i);
    expect(start, "no Start control rendered").toBeDefined();
    expect(styleAt(PHONE, start, "minHeight")).toBe(`${MOBILE_TAP_MIN}px`);
    // The `sm` branch is the property's own initial value, so nothing above
    // the phone breakpoint changes — the module header's standing rule.
    expect(styleAt(DESKTOP, start, "minHeight")).toBe("auto");
  });

  it("MeetingPanel: every control in a RUNNING meeting clears the floor at 375", async () => {
    hooks.session.status = "live";
    hooks.session.turns = TURNS;
    hooks.insights.insights = [INSIGHT];
    await render(createElement(MeetingPanel, { pageId: "p-1", onMeetingSaved: vi.fn() }));
    expect(shortButtons()).toEqual([]);
  });

  it("MeetingPanel: the save-error Retry clears the floor at 375", async () => {
    // The one control that only exists after a failed save, so it cannot be
    // reached by rendering props alone.
    hooks.session.status = "live";
    hooks.session.turns = TURNS;
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: "Save failed." }) }));
    await render(createElement(MeetingPanel, { pageId: "p-1", onMeetingSaved: vi.fn() }));
    await click(named(/stop the meeting/i));
    const retry = named(/retry saving this meeting/i);
    expect(retry, "no save-error Retry rendered").toBeDefined();
    expect(styleAt(PHONE, retry, "minHeight")).toBe(`${MOBILE_TAP_MIN}px`);
  });

  it("MeetingInsightList: every control clears the floor at 375, in every state at once", async () => {
    // List-level Retry (error), per-card Find sources, per-card Retry
    // (reference error) and Nudge, all on screen together.
    await render(
      createElement(MeetingInsightList, {
        insights: [INSIGHT],
        topic: "Refund SLA",
        topicChanged: true,
        loading: false,
        error: "The insight read failed.",
        onRetry: vi.fn(),
        onNudge: vi.fn(),
        onFindReferences: vi.fn(),
        referencesByInsightId: { i1: { status: "error", error: "Lookup failed.", result: null } },
      }),
    );
    expect(buttons().length).toBeGreaterThanOrEqual(4);
    expect(shortButtons()).toEqual([]);
  });

  it("MeetingTranscript: Jump to latest clears the floor at 375", async () => {
    await render(createElement(MeetingTranscript, { turns: TURNS, interims: {}, source: "tab" }));
    const jump = named(/jump to the latest turn/i);
    expect(jump, "no jump control rendered").toBeDefined();
    expect(styleAt(PHONE, jump, "minHeight")).toBe(`${MOBILE_TAP_MIN}px`);
  });
});

// ---------------------------------------------------------------------------
// F-01 — the transcript must not be a nested touch scroller on a phone.
//
// `maxHeight: 420, overflowY: "auto"` is a 420px scroll-trap inside a page
// scroll, on a screen 812px tall that also carries two consent notices, the
// Stop row and the whole insight list. PHONE_PANE_SX exists for exactly this
// pair of failures (a nested scroller steals the page-scroll swipe; a fixed
// cap outlives the URL bar), and is keyed to `md` so its phone behaviour also
// covers the tablet band.
// ---------------------------------------------------------------------------

describe("F-01 — the transcript pane adopts PHONE_PANE_SX", () => {
  async function pane() {
    await render(createElement(MeetingTranscript, { turns: TURNS, interims: {}, source: "tab" }));
    const el = container.querySelector("[data-transcript-pane]");
    expect(el, "no transcript pane found — it must be findable to be measurable").toBeTruthy();
    return el;
  }

  it("is not its own scroll container at 375: the page is the single scroller", async () => {
    const el = await pane();
    expect(styleAt(PHONE, el, "overflowY")).toBe("visible");
    expect(styleAt(PHONE, el, "maxHeight")).toBe("none");
  });

  it("still is not one at 700 — the contract is keyed to md, not sm", async () => {
    const el = await pane();
    expect(styleAt(TABLET, el, "overflowY")).toBe("visible");
    expect(styleAt(TABLET, el, "maxHeight")).toBe("none");
  });

  it("is a bounded, internally-scrolling pane again at 1000", async () => {
    const el = await pane();
    expect(styleAt(DESKTOP, el, "overflowY")).toBe("auto");
    expect(styleAt(DESKTOP, el, "maxHeight")).toBe("62vh");
    // Corrected from PHONE_PANE_SX's own "340px" (which this file used to
    // inherit unmodified). The owner ruled that floor an unintended desktop
    // regression -- a two-turn transcript was rendering 340px of empty
    // chrome instead of ~60px of content -- so MeetingTranscript.js now
    // overrides `minHeight` back to its own initial value at `md`. This
    // assertion used to read "340px"; leaving it there would pin the exact
    // bug the case right below exists to fix. See that case for why.
    expect(styleAt(DESKTOP, el, "minHeight")).toBe("auto");
  });

  it("does not carry PHONE_PANE_SX's 340px floor at 1000 -- a short transcript stays compact", async () => {
    // TURNS is two short turns -- exactly the shape that exposed the
    // regression: pre-8866be1 this pane was ~60px tall on desktop.
    // PHONE_PANE_SX's own `minHeight: 340` (right for TranscriptView.js's
    // copilot equivalent, which never mounts without content already
    // loaded) turned that into 340px of blank space the moment this file
    // adopted the shared contract wholesale. `maxHeight`/`overflowY` are
    // asserted too, unchanged from the contract, so this case can only fail
    // on the one property the fix actually touches.
    const el = await pane();
    expect(styleAt(DESKTOP, el, "minHeight")).toBe("auto");
    expect(styleAt(DESKTOP, el, "maxHeight")).toBe("62vh");
    expect(styleAt(DESKTOP, el, "overflowY")).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// The regression F-01 would ship on its own.
//
// `TranscriptView.js:55-65` records this by name: the moment PHONE_PANE_SX
// sets `overflowY: visible`, the pane stops being a scroll container, so its
// `onScroll` handler NEVER FIRES and `stickRef` is frozen at its initial
// `true` forever. Auto-follow then fires on every arriving turn regardless of
// where the reader is — so a phone reader who scrolled UP to re-read an
// earlier turn is yanked back to the bottom by the next line of speech. The
// copilot's own transcript needed a separate page-scroll stick
// (`pageStickRef`) for precisely this; spreading PHONE_PANE_SX here without
// one trades a scroll-trap for a scroll-yank.
//
// jsdom evaluates no media feature, so `getComputedStyle(pane).overflowY`
// reads "visible" here for the same reason it does at 375 in a browser: no
// `min-width` rule applies. That makes the phone regime the one these cases
// naturally exercise. It is jsdom's media-blindness rather than a genuine
// 375px emulation — which is why the block ABOVE is what proves a real phone
// gets this regime, and this block only proves what the component does once
// it is in it.
// ---------------------------------------------------------------------------

describe("auto-follow in the page-scroll regime", () => {
  async function renderTurns(turns) {
    await render(createElement(MeetingTranscript, { turns, interims: {}, source: "tab" }));
  }

  // Stubs the page-scroll geometry jsdom has none of, then fires the event the
  // component listens for. This asserts which BRANCH is taken given an input,
  // never a real measurement — see this file's header.
  async function scrollPageTo({ scrollY, scrollHeight = 4000, innerHeight = 812 }) {
    Object.defineProperty(window, "scrollY", { value: scrollY, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: scrollHeight,
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
  }

  it("[positive control] follows a new turn when the reader is at the bottom", async () => {
    await renderTurns([TURNS[0]]);
    Element.prototype.scrollIntoView.mockClear();
    await renderTurns(TURNS);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("does NOT yank a reader who has scrolled the page up to re-read", async () => {
    await renderTurns([TURNS[0]]);
    // Far from the bottom: 4000 - 100 - 812 = 3088px of page left below.
    await scrollPageTo({ scrollY: 100 });
    Element.prototype.scrollIntoView.mockClear();
    await renderTurns(TURNS);
    expect(
      Element.prototype.scrollIntoView,
      "a new turn dragged the page back to the bottom while the reader was reading earlier text",
    ).not.toHaveBeenCalled();
  });

  it("re-arms when the reader presses Jump to latest", async () => {
    await renderTurns([TURNS[0]]);
    await scrollPageTo({ scrollY: 100 });
    await click(named(/jump to the latest turn/i));
    Element.prototype.scrollIntoView.mockClear();
    await renderTurns(TURNS);
    expect(
      Element.prototype.scrollIntoView,
      "Jump to latest did not restore auto-follow in the page-scroll regime",
    ).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F-04 — control rows wrap. WRAP_ROW_SX is this repo's standing contract for
// every row of controls; a row that cannot wrap either overflows (clipped
// silently by `html { overflow-x: hidden }`) or squeezes its items.
// ---------------------------------------------------------------------------

describe("F-04 — control rows wrap", () => {
  it("MeetingPanel's Stop/saving row wraps", async () => {
    hooks.session.status = "live";
    hooks.session.turns = TURNS;
    await render(createElement(MeetingPanel, { pageId: "p-1", onMeetingSaved: vi.fn() }));
    const row = named(/stop the meeting/i).parentElement;
    expect(styleAt(PHONE, row, "flexWrap")).toBe("wrap");
    // WRAP_ROW_SX is not phone-scoped: a row should wrap wherever it does not
    // fit, so this must hold at every width.
    expect(styleAt(DESKTOP, row, "flexWrap")).toBe("wrap");
    expect(styleAt(PHONE, row, "rowGap")).toBe("8px");
  });

  it("MeetingInsightList's reference row wraps — 'Find sources' grows to 'Finding sources…' in place", async () => {
    await render(
      createElement(MeetingInsightList, {
        insights: [INSIGHT],
        topic: "Refund SLA",
        loading: false,
        error: "",
        onFindReferences: vi.fn(),
        referencesByInsightId: { i1: { status: "loading" } },
      }),
    );
    const row = named(/find sources for/i).parentElement;
    expect(styleAt(PHONE, row, "flexWrap")).toBe("wrap");
    expect(styleAt(PHONE, row, "rowGap")).toBe("8px");
  });
});

// ---------------------------------------------------------------------------
// F-09 — long unbroken tokens.
//
// `wordBreak: "break-word"` is NOT equivalent to BREAK_LONG_WORDS_SX's
// `overflowWrap: "anywhere"`: only `anywhere` also feeds intrinsic min-content
// sizing, which is what actually stops a container being forced wider than the
// screen (see mobileSx.js:25-30). With `html { overflow-x: hidden }` the
// resulting overflow is clipped, not scrollable — a dictated URL or a long
// engine slug is DELETED rather than merely awkward.
// ---------------------------------------------------------------------------

describe("F-09 — long tokens break instead of being clipped away", () => {
  const anywhereAt = (el) => styleAt(PHONE, el, "overflowWrap");

  it("MeetingPanel's two consent/engine notices", async () => {
    await render(createElement(MeetingPanel, { pageId: "p-1", onMeetingSaved: vi.fn() }));
    const notices = [...container.querySelectorAll("p")].filter((p) => (p.textContent || "").length > 20);
    expect(notices.length, "no consent/engine notice text found").toBeGreaterThanOrEqual(2);
    for (const p of notices) {
      expect(anywhereAt(p), `notice "${(p.textContent || "").slice(0, 40)}…"`).toBe("anywhere");
    }
  });

  it("MeetingTranscript's turn text and interim text", async () => {
    await render(
      createElement(MeetingTranscript, {
        turns: TURNS,
        interims: { them: "https://example.internal/a-very-long-unbroken-path-nobody-can-wrap" },
        source: "tab",
      }),
    );
    const final = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent || "").includes("legacy processor"),
    );
    const interim = container.querySelector("[data-interim]");
    expect(final, "no final turn text found").toBeTruthy();
    expect(interim, "no interim text found").toBeTruthy();
    expect(anywhereAt(final)).toBe("anywhere");
    expect(anywhereAt(interim)).toBe("anywhere");
  });

  it("MeetingInsightList's insight text and reference titles", async () => {
    await render(
      createElement(MeetingInsightList, {
        insights: [INSIGHT],
        topic: "Refund SLA",
        loading: false,
        error: "",
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          i1: {
            status: "done",
            result: {
              references: [{ title: "Reconciliation-throughput-benchmarks-2026", url: "https://example.com/a", host: "example.com" }],
              dropped: 0,
              grounded: true,
            },
          },
        },
      }),
    );
    const text = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent || "").includes("reconciliation dropped"),
    );
    const reference = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent || "").includes("Reconciliation-throughput"),
    );
    expect(text, "no insight text found").toBeTruthy();
    expect(reference, "no reference title found").toBeTruthy();
    expect(anywhereAt(text)).toBe("anywhere");
    expect(anywhereAt(reference)).toBe("anywhere");
  });
});

// ---------------------------------------------------------------------------
// F-08 — the speaker chip is a flex item in a row with the timestamp. MUI's
// Chip root is `overflow: hidden` + `text-overflow: ellipsis`, so a squeezed
// chip truncates its own label ("PREDI…", the truncation CopilotDashboard.js
// documents). Latent today — the meeting vocabulary is "You"/"Others" — which
// is why this is pinned rather than argued about later.
// ---------------------------------------------------------------------------

describe("F-08 — the speaker chip does not shrink", () => {
  it("keeps its width in the turn's header row", async () => {
    await render(createElement(MeetingTranscript, { turns: TURNS, interims: {}, source: "tab" }));
    const chip = container.querySelector(".MuiChip-root");
    expect(chip, "no speaker chip rendered").toBeTruthy();
    expect(styleAt(PHONE, chip, "flexShrink")).toBe("0");
  });
});
