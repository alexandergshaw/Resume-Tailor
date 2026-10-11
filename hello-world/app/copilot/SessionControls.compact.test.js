// @vitest-environment jsdom
//
// N144b M2 — SessionControls' compact (phone-and-live) tuck. The three
// post-session / destructive controls (Copy, Clear, Download session log) and
// their disabled-reason caption move behind ONE reused CollapsibleAid when
// `compact && live`; Stop/Start, the status pill, the clock and Auto-draft
// stay inline in every state, and desktop (compact=false) is byte-identical to
// today. See docs/loop/N144b.plan.r1.md §4 and the ledger L5/L6/L7/L8/L9.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. jsdom has NO layout — getBoundingClientRect
// is zeroes — so nothing here asserts geometry (tap size and footprint are the
// owner/browser pass, plan §10 G3). It mounts the REAL SessionControls and the
// REAL CollapsibleAid, exposes the accessibility DOM, and runs a real CSS
// cascade, so it asserts DECLARED STRUCTURE (which controls are mounted, where,
// behind which native button) and behaviour (a tap toggles, handlers fire).
//
// THE VIEWPORT STUB IS LOAD-BEARING, exactly as in CollapsibleAid.test.js:
// CollapsibleAid reads useIsMobile() internally (@/app/hooks/useResponsive ->
// useMediaQuery(down("sm"))), and jsdom implements no matchMedia, so without
// this stub the disclosure would show its OPEN desktop default and C3 would
// look inconsistent with `compact`. `compact` is SessionControls' OWN switch
// (a prop CopilotClient feeds from the same useIsMobile); the width here is set
// so the embedded CollapsibleAid agrees with it (C9 pins that they are distinct
// inputs by setting compact=true at a DESKTOP width and watching the body open).
//
// Lookups are BY ACCESSIBLE NAME, never by a `button[aria-expanded]` count —
// the generic selector hazard the dashboard suites carry (plan §9.2, L18).
//
// RED on HEAD: SessionControls.js today ignores `compact` and renders the three
// controls inline unconditionally; there is no CollapsibleAid import and no
// "Copy, clear and download" header. C3/C4/C5/C6(tucked)/C8/C9 and the
// import source-scan are therefore red because the tuck does not exist yet.
// C1/C2/C7 and the negative source-bans are REGRESSION GUARDS that pass on
// HEAD (the inline row and node identity already hold) — disclosed as such in
// the notes artifact; their teeth are on the mutants, not on HEAD.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import { makeTheme } from "@/app/theme/index.js";
import { resetAllChoiceStores } from "@/lib/copilot/choiceStore.js";
import SessionControls from "./SessionControls.js";
// N156: a namespace import (never a named import) so a build that has not yet
// added the export does not fail the whole module at link time — it surfaces as
// `undefined` inside the one test that needs it, where it fails as a readable
// assertion, not a load error. Single-sources the arm-window duration from the
// component so the test never hardcodes a bare number (orchestrator ruling).
import * as SessionControlsModule from "./SessionControls.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACTIONS_LABEL = "Copy, clear and download";
const STORE_KEY = "copilot-session-actions";

const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = PHONE;

function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}

window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

// Accessible name with aria-hidden subtrees (the CollapsibleAid ▾/▸ glyph)
// stripped — the precedent helper from CollapsibleAid.test.js.
function accessibleName(el) {
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  return (clone.textContent || "").trim();
}

let container;
let root;

beforeEach(() => {
  resetAllChoiceStores();
  try {
    localStorage.clear();
  } catch {
    /* memory-authoritative anyway */
  }
  viewportWidth = PHONE;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function baseProps(overrides = {}) {
  return {
    live: true,
    stop: vi.fn(),
    onStartSession: vi.fn(),
    status: "live",
    startedAt: 1_000,
    elapsed: 0,
    autoDraft: true,
    setAutoDraft: vi.fn(),
    copyTranscript: vi.fn(),
    clearAll: vi.fn(),
    finals: [{ text: "hi" }],
    questions: [{ id: 1 }],
    downloadLog: vi.fn(),
    sessionLogHasEvents: true,
    ...overrides,
  };
}

async function mount(props, width = viewportWidth) {
  viewportWidth = width;
  await act(async () => {
    root.render(
      createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(SessionControls, props)),
    );
  });
}

const buttons = () => [...container.querySelectorAll("button")];
const byName = (name) => buttons().find((b) => accessibleName(b) === name);
const header = () => byName(ACTIONS_LABEL);
const panelOf = (hdr) => {
  const id = hdr && hdr.getAttribute("aria-controls");
  return id ? container.querySelector(`#${CSS.escape(id)}`) : null;
};
async function click(el) {
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

// ---------------------------------------------------------------------------
// N156 helpers (shared by the two-step-confirm cases below).
// ---------------------------------------------------------------------------
// Find THE Clear control WITHOUT pinning the design-chosen armed label. In the
// idle state it is named "Clear" (AC-6); once armed its accessible name changes
// (e.g. "Confirm clear?"). Every OTHER button in the row has a stable name, so
// "the one action button that is none of those" is the Clear control in either
// state — a label-agnostic lookup that a user's eye performs too (they click
// the same control in the same spot). Asserts uniqueness so an ambiguous match
// fails loudly instead of silently driving the wrong node.
const CLEAR_SIBLINGS = new Set(["Copy", "Download session log", "Stop", "Start session", ACTIONS_LABEL]);
function clearControl() {
  const candidates = buttons().filter((b) => !CLEAR_SIBLINGS.has(accessibleName(b)));
  expect(candidates.length, "exactly one non-sibling action button (the Clear control)").toBe(1);
  return candidates[0];
}

// The persistent polite live region (role=status implies aria-live=polite).
function liveRegion(scope = container) {
  return scope.querySelector('[aria-live="polite"], [role="status"]');
}

// Mount an ENABLED Clear on one of the two surfaces the AC names: desktop
// inline (compact=false) or the compact tuck (compact && live, disclosure
// opened first, exactly as the C-tests drive it). Takes a pre-built props
// object so the caller holds the same clearAll spy it asserts on.
async function mountEnabled(surface, props) {
  if (surface === "inline") {
    await mount({ ...props, compact: false, live: true }, DESKTOP);
  } else {
    await mount({ ...props, compact: true, live: true }, PHONE);
    await click(header());
  }
}

// ---------------------------------------------------------------------------
// C1 — compact=false, live: everything inline, no disclosure. (REGRESSION
// GUARD: green on HEAD; its teeth are the "compact hard-coded true" / "tuck
// regardless of compact" mutants.)
// ---------------------------------------------------------------------------
describe("C1: compact=false keeps the three controls inline (desktop unchanged)", () => {
  it("renders Copy, Clear, Download inline with no CollapsibleAid header", async () => {
    await mount(baseProps({ compact: false }), DESKTOP);
    expect(byName("Copy"), "Copy inline").toBeTruthy();
    expect(byName("Clear"), "Clear inline").toBeTruthy();
    expect(byName("Download session log"), "Download inline").toBeTruthy();
    expect(header(), "no disclosure header when not compact").toBeFalsy();
  });

  it("DOM button order of the row is Stop, Copy, Clear, Download (Auto-draft sits between, as a switch)", async () => {
    await mount(baseProps({ compact: false }), DESKTOP);
    // compareDocumentPosition: each precedes the next. Pins that the inline
    // order is unchanged (reading order == visual order; no CSS reorder).
    // Only the BUTTONS are named here — Auto-draft is a Switch+label, not a
    // button, and lives between Stop and Copy in the row.
    const order = ["Stop", "Copy", "Clear", "Download session log"].map((n) => byName(n));
    for (const el of order) expect(el, "a named control is present inline").toBeTruthy();
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(
        order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${accessibleName(order[i])} precedes ${accessibleName(order[i + 1])}`,
      ).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// C2 — compact=true but NOT live: still fully inline (idle shows everything).
// (REGRESSION GUARD on HEAD; teeth = the "tuck regardless of live" mutant.)
// ---------------------------------------------------------------------------
describe("C2: compact=true, live=false — full inline row, no disclosure", () => {
  it("idle on a phone shows Copy/Clear/Download inline and no header", async () => {
    await mount(baseProps({ compact: true, live: false, status: "idle" }), PHONE);
    expect(byName("Copy")).toBeTruthy();
    expect(byName("Clear")).toBeTruthy();
    expect(byName("Download session log")).toBeTruthy();
    expect(header()).toBeFalsy();
    // The idle button is Start, not Stop (sanity that live=false really took).
    expect(byName("Start session")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// C3 — compact && live at 375: the trio is TUCKED (unmounted), exactly one
// collapsed header, Stop/pill/Auto-draft still inline. RED on HEAD.
// ---------------------------------------------------------------------------
describe("C3: compact && live tucks the trio behind one collapsed header", () => {
  it("Copy/Clear/Download are OUT of the DOM; one header, collapsed; inline controls remain", async () => {
    await mount(baseProps({ compact: true, live: true }), PHONE);
    // The three actions are unmounted (not merely hidden with CSS — the body
    // is absent while collapsed; CollapsibleAid's contract, L9).
    expect(byName("Copy"), "Copy must be tucked away").toBeFalsy();
    expect(byName("Clear"), "Clear must be tucked away").toBeFalsy();
    expect(byName("Download session log"), "Download must be tucked away").toBeFalsy();
    // Exactly one disclosure header, collapsed, with a resolvable panel.
    const hdrs = buttons().filter((b) => accessibleName(b) === ACTIONS_LABEL);
    expect(hdrs).toHaveLength(1);
    expect(hdrs[0].tagName).toBe("BUTTON");
    expect(hdrs[0].getAttribute("type")).toBe("button");
    expect(hdrs[0].getAttribute("aria-expanded")).toBe("false");
    expect(panelOf(hdrs[0]), "aria-controls resolves to a real element").not.toBeNull();
    // The inline controls stay inline — the tuck is only the destructive trio.
    expect(byName("Stop"), "Stop stays inline").toBeTruthy();
    expect(container.querySelector(".MuiSwitch-root"), "Auto-draft switch stays inline").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// C4 — opening the header mounts the trio, in order, inside the panel the
// header names; Download's disabled-reason caption lives in the body. RED.
// ---------------------------------------------------------------------------
describe("C4: opening the disclosure reveals Copy, Clear, Download in order inside its panel", () => {
  it("aria-expanded flips, the trio appears in order, and the caption is inside the body exactly once", async () => {
    await mount(baseProps({ compact: true, live: true, sessionLogHasEvents: false }), PHONE);
    const hdr = header();
    expect(hdr).toBeTruthy();
    await click(hdr);
    expect(header().getAttribute("aria-expanded")).toBe("true");

    const panel = panelOf(header());
    expect(panel, "the panel the header controls").not.toBeNull();
    const inPanelNames = [...panel.querySelectorAll("button")].map((b) => accessibleName(b));
    expect(inPanelNames).toEqual(["Copy", "Clear", "Download session log"]);

    // D6: with no recorded events, Download is disabled and its reason is a
    // VISIBLE caption pointed at by aria-describedby — inside the same body.
    const download = [...panel.querySelectorAll("button")].find((b) => accessibleName(b) === "Download session log");
    expect(download.getAttribute("aria-describedby")).toBe("live-download-log-reason");
    const caption = container.querySelectorAll("#live-download-log-reason");
    expect(caption).toHaveLength(1);
    expect(panel.contains(caption[0]), "the caption is inside the disclosure body").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C5 — the open choice is REMEMBERED under exactly `copilot-session-actions`,
// nothing is written on mount, and a remount reads it back. RED.
// (Kills the key-reuse mutant: a tap would write some OTHER key.)
// ---------------------------------------------------------------------------
describe("C5: remembered open state, under the exact store key, nothing written on mount", () => {
  it("mount writes nothing; a tap writes 'open' to copilot-session-actions; remount stays open", async () => {
    await mount(baseProps({ compact: true, live: true }), PHONE);
    // Nothing on mount.
    expect(localStorage.getItem(STORE_KEY), "a mount must not write the key").toBeNull();
    // No OTHER choice-store key was written either (would catch key reuse at mount).
    const keysAfterMount = Object.keys(localStorage);
    expect(keysAfterMount).not.toContain("copilot-example-projects");

    await click(header());
    expect(header().getAttribute("aria-expanded")).toBe("true");
    // Persisted under THIS key, and only this key (key-reuse mutant dies here).
    expect(localStorage.getItem(STORE_KEY)).toBe("open");
    expect(localStorage.getItem("copilot-example-projects")).toBeNull();

    // Remount at the same width: the stored choice wins.
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(baseProps({ compact: true, live: true }), PHONE);
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// C6 — Clear's disabled rule holds in BOTH placements, and each action's
// handler fires exactly once when clicked. Inline half is a guard; tucked
// half is RED on HEAD.
// ---------------------------------------------------------------------------
describe("C6: Clear disabled iff finals AND questions empty; handlers fire once, inline and tucked", () => {
  it("inline (compact=false): Clear disabled only when both arrays are empty", async () => {
    await mount(baseProps({ compact: false, finals: [], questions: [] }), DESKTOP);
    expect(byName("Clear").disabled).toBe(true);
    await mount(baseProps({ compact: false, finals: [], questions: [{ id: 1 }] }), DESKTOP);
    expect(byName("Clear").disabled).toBe(false);
  });

  it("tucked (compact && live): same Clear rule inside the opened body", async () => {
    await mount(baseProps({ compact: true, live: true, finals: [], questions: [] }), PHONE);
    await click(header());
    expect(byName("Clear").disabled).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    resetAllChoiceStores();
    await mount(baseProps({ compact: true, live: true, finals: [{ text: "x" }], questions: [] }), PHONE);
    await click(header());
    expect(byName("Clear").disabled).toBe(false);
  });

  it("each action calls its own handler once; Clear now takes the two-step confirm (tucked, all enabled)", async () => {
    // N156 BLAST RADIUS: this test used to click "Clear" ONCE and assert
    // clearAll was called once. Design A (inline two-step confirm) makes a
    // single activation ARM, not wipe, so that assertion is now false. It is
    // restated here to the arm+confirm flow, preserving its intent — that a
    // CONFIRMED clear still calls clearAll exactly once — not deleted, not
    // weakened to accept either count. This red on HEAD is expected and correct
    // (see docs/loop/N156.ac.r1.md "Blast radius").
    const props = baseProps({ compact: true, live: true, finals: [{ text: "x" }], questions: [{ id: 1 }], sessionLogHasEvents: true });
    await mount(props, PHONE);
    await click(header());
    await click(byName("Copy"));
    expect(props.copyTranscript).toHaveBeenCalledTimes(1);
    await click(byName("Download session log"));
    expect(props.downloadLog).toHaveBeenCalledTimes(1);
    // Clear: arm (no wipe), then confirm within the window (wipes once).
    await click(clearControl());
    expect(props.clearAll, "arming Clear alone does not wipe").toHaveBeenCalledTimes(0);
    await click(clearControl());
    expect(props.clearAll, "a confirmed Clear wipes exactly once").toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// C7 — the Start/Stop node survives the idle->live flip at xs (WCAG 2.4.3:
// focus must not be dropped to <body>). REGRESSION GUARD (green on HEAD);
// teeth = the "wrap the Stack in a keyed fragment / remount Stop" mutant.
// ---------------------------------------------------------------------------
describe("C7: the Start/Stop button is the SAME node across the idle->live flip at xs", () => {
  it("rerendering live keeps the node and the focus, and the label becomes Stop", async () => {
    await mount(baseProps({ compact: true, live: false, status: "idle" }), PHONE);
    const before = byName("Start session");
    expect(before).toBeTruthy();
    before.focus();
    expect(document.activeElement).toBe(before);

    // Flip ONLY `live` (and the derived status) — same compact, same width.
    await mount(baseProps({ compact: true, live: true, status: "live" }), PHONE);
    const after = buttons()[0];
    expect(after.isSameNode(before), "the first control is the same DOM node after the flip").toBe(true);
    expect(accessibleName(after)).toBe("Stop");
    expect(document.activeElement).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// C8 — DOM order: the inline Stack precedes the disclosure header, and the
// header precedes its body. RED on HEAD (no header). Pins "no reorder".
// ---------------------------------------------------------------------------
describe("C8: the inline row precedes the header, the header precedes its body", () => {
  it("Stop -> header -> (opened) body, in that document order", async () => {
    await mount(baseProps({ compact: true, live: true }), PHONE);
    const stop = byName("Stop");
    const hdr = header();
    expect(stop && hdr).toBeTruthy();
    expect(stop.compareDocumentPosition(hdr) & Node.DOCUMENT_POSITION_FOLLOWING, "Stop precedes the header").toBeTruthy();
    await click(hdr);
    const copy = byName("Copy");
    expect(copy, "Copy is in the opened body").toBeTruthy();
    expect(header().compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING, "header precedes its body").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// C9 — the PROP is the switch, not the width: compact=true at a DESKTOP width
// still tucks (header renders), and CollapsibleAid's own breakpoint default
// then makes the body OPEN. This is what makes CopilotClient's compact={isMobile}
// the thing that keeps desktop inline (F2 M-3). RED on HEAD. */
// ---------------------------------------------------------------------------
describe("C9: compact=true at 1200 renders the header and opens the body (prop, not width)", () => {
  it("the header exists and the trio is inside the open panel at a desktop width", async () => {
    await mount(baseProps({ compact: true, live: true }), DESKTOP);
    const hdr = header();
    expect(hdr, "the tuck is driven by the compact PROP even at 1200").toBeTruthy();
    expect(hdr.getAttribute("aria-expanded")).toBe("true");
    const panel = panelOf(hdr);
    expect([...panel.querySelectorAll("button")].map((b) => accessibleName(b))).toEqual([
      "Copy",
      "Clear",
      "Download session log",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Source scans (comment-stripped). Spelling, not behaviour — paired with the
// DOM cases above. The CollapsibleAid import is RED on HEAD; the bans are
// regression guards.
// ---------------------------------------------------------------------------
describe("source scan: SessionControls wires CollapsibleAid and adds no Collapse/Tooltip/order/aria-label", () => {
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const SRC = () => stripComments(readFileSync(path.resolve(process.cwd(), "app/copilot/SessionControls.js"), "utf8"));

  it("[canary] the source is present and is the component", () => {
    const src = SRC();
    expect(src).toContain("export default function SessionControls");
  });

  it("imports CollapsibleAid and the choice-store primitives (RED on HEAD)", () => {
    const src = SRC();
    expect(src).toMatch(/import\s+CollapsibleAid\s+from\s+["']\.\/CollapsibleAid["']/);
    expect(src).toContain("createChoiceStore");
    expect(src).toContain("copilot-session-actions");
  });

  it("adds no Collapse, no Tooltip, no CSS order, and no aria-label on the header", () => {
    const src = SRC();
    expect(src).not.toMatch(/\bCollapse\b/);
    expect(src).not.toMatch(/\bTooltip\b/);
    expect(src).not.toMatch(/\border:\s*\d/);
    expect(src).not.toMatch(/aria-label/);
  });
});

// ===========================================================================
// N156 — live "Clear" safety fix: inline two-step confirm (Design A).
//
// Failure direction (docs/loop/N156.ac.r1.md): the DANGEROUS error is wiping on
// a single activation (irrecoverable loss); the SAFE error is asking to confirm
// when the user did not strictly need to. Every CORE case below is written so
// the PASSING direction is "one activation does NOT wipe", so any build that
// lets a single activation through — including HEAD's direct onClick={clearAll}
// (SessionControls.js:103), which is exactly the "restore direct onClick"
// mutant — turns it red.
//
// RED-on-HEAD set: N1 (AC-1), N2 (AC-2), N3 (AC-3), N4 (AC-4).
// GUARDS (green on HEAD, teeth on the mutant): N5 (AC-5), N6 (AC-6), N7 (AC-7).
// The Clear control is driven BY RE-ACTIVATING THE SAME on-screen control a
// user would click (clearControl(), label-agnostic) — never by calling a
// handler directly — so these are reachability tests, not handler pokes.
// ===========================================================================

// ---------------------------------------------------------------------------
// N1 (AC-1) [CORE] — one activation of Clear does NOT wipe. Both surfaces.
// RED on HEAD: line 103 wires onClick={clearAll}, so one click calls it once
// (got 1, want 0). This is the safety criterion; the "restore direct onClick"
// mutant is HEAD itself, so the RED-on-HEAD run is that mutant's kill.
// ---------------------------------------------------------------------------
describe("N1 (AC-1): a single activation of Clear does NOT wipe the session", () => {
  for (const surface of ["inline", "tucked"]) {
    it(`one activation → clearAll called 0 times (${surface})`, async () => {
      const props = baseProps({ finals: [{ text: "x" }], questions: [{ id: 1 }] });
      await mountEnabled(surface, props);
      await click(clearControl());
      expect(props.clearAll, "a single activation must not wipe (RED on HEAD: HEAD wipes once)").toHaveBeenCalledTimes(0);
      // Control vs. a vacuous 0: the Clear control is still mounted and
      // reachable after arming (0 because the arm held, not because the
      // control vanished or never mounted).
      expect(clearControl(), "Clear control is still reachable after arming").toBeTruthy();
    });
  }
});

// ---------------------------------------------------------------------------
// N2 (AC-2) [CORE] — a completed confirm wipes EXACTLY once. Both surfaces.
// RED on HEAD: two activations call clearAll twice (no arm gate) → got 2,
// want 1. The single "exactly 1" assertion is its own over/under-fire control:
// it fails for 0 (Clear unreachable) and for 2 (double-fire) alike.
// ---------------------------------------------------------------------------
describe("N2 (AC-2): arm then confirm within the window wipes exactly once", () => {
  for (const surface of ["inline", "tucked"]) {
    it(`arm + confirm → clearAll called exactly 1 time (${surface})`, async () => {
      const props = baseProps({ finals: [{ text: "x" }], questions: [{ id: 1 }] });
      await mountEnabled(surface, props);
      await click(clearControl()); // arm
      await click(clearControl()); // confirm, within the arm window
      expect(
        props.clearAll,
        "arm+confirm wipes exactly once (RED on HEAD: two clicks give 2; also fails 0=unreachable)",
      ).toHaveBeenCalledTimes(1);
    });
  }
});

// ---------------------------------------------------------------------------
// N3 (AC-3) [CORE] — the arm auto-reverts; an expired arm does NOT wipe and
// re-arms on the next activation. RED on HEAD: there is no arm or timer, and
// the first activation already wiped, so "uncalled after the window" is false.
// Concurrency/async rule: proven with fake timers + an executed revert, never
// a same-tick assertion.
// ---------------------------------------------------------------------------
describe("N3 (AC-3): the arm auto-reverts past the named window and re-arms", () => {
  it("advancing past CLEAR_CONFIRM_WINDOW_MS cancels the arm; a later single activation re-arms, no wipe", async () => {
    vi.useFakeTimers();
    try {
      const props = baseProps({ compact: false, finals: [{ text: "x" }], questions: [] });
      await mount(props, DESKTOP);
      expect(accessibleName(clearControl()), "idle name is Clear before arming").toBe("Clear");

      // Arm. RED on HEAD: this first activation already called clearAll once,
      // so the assertion fails here (got 1, want 0) BEFORE any timer math — the
      // test never reaches the (undefined-on-HEAD) window constant.
      await click(clearControl());
      expect(props.clearAll, "arming must not wipe (RED on HEAD)").toHaveBeenCalledTimes(0);

      // Advance past the NAMED, single-sourced window constant.
      const WINDOW = SessionControlsModule.CLEAR_CONFIRM_WINDOW_MS;
      expect(typeof WINDOW, "arm window must be an exported numeric constant the test can advance past").toBe("number");
      await act(async () => {
        vi.advanceTimersByTime(WINDOW + 100);
      });

      // Auto-reverted: idle affordance restored, live region cleared, no wipe.
      expect(accessibleName(clearControl()), "idle name restored after revert").toBe("Clear");
      const region = liveRegion();
      expect(region && region.textContent.trim(), "live region empty after auto-revert").toBeFalsy();
      expect(props.clearAll, "an expired arm never wipes").toHaveBeenCalledTimes(0);

      // A subsequent SINGLE activation RE-ARMS (still no wipe) — the expiry did
      // not leave a latent confirm that a lone click could trip.
      await click(clearControl());
      expect(props.clearAll, "re-arm after expiry does not wipe").toHaveBeenCalledTimes(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// N4 (AC-4) [A11y] — the armed state is announced via a PERSISTENT polite live
// region: present (empty) while idle, the SAME node becomes non-empty when
// armed, empty again after the confirmed wipe. RED on HEAD: no aria-live /
// role=status exists in SessionControls today. Teeth on three mutants — remove
// the region, newly-mount it on arm (copilot-mobile: a remounted region holding
// text is never announced), or leave its armed text empty.
// ---------------------------------------------------------------------------
describe("N4 (AC-4): armed state announced via a persistent polite live region", () => {
  it("region exists idle (empty), SAME node is non-empty when armed, empty after confirm", async () => {
    const props = baseProps({ compact: false, finals: [{ text: "x" }], questions: [] });
    await mount(props, DESKTOP);

    const idleRegion = liveRegion();
    expect(idleRegion, "a persistent polite live region exists while idle (RED on HEAD: none)").toBeTruthy();
    expect(idleRegion.textContent.trim(), "idle region is empty").toBeFalsy();

    // Arm: the SAME node (not a freshly-mounted one) gains the announcement.
    await click(clearControl());
    const armedRegion = liveRegion();
    expect(armedRegion, "region still present when armed").toBeTruthy();
    expect(
      armedRegion.isSameNode(idleRegion),
      "region is PERSISTENT, not remounted on arm (a remounted region holding text is never announced)",
    ).toBe(true);
    expect(armedRegion.textContent.trim(), "armed region announces the pending clear").toBeTruthy();
    // The announcement IS the live region, not a Tooltip/title on the control.
    expect(
      armedRegion.getAttribute("aria-live") === "polite" || armedRegion.getAttribute("role") === "status",
      "announcement is a polite live region",
    ).toBe(true);

    // Confirm wipes; the same region returns to empty.
    await click(clearControl());
    expect(props.clearAll, "confirm wipes once").toHaveBeenCalledTimes(1);
    const afterRegion = liveRegion();
    expect(afterRegion && afterRegion.isSameNode(idleRegion), "same region persists after confirm").toBe(true);
    expect(afterRegion.textContent.trim(), "region empties after the confirmed wipe").toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// N5 (AC-5) [guard — passes HEAD] — Clear is a native <button> with a single
// onClick arm/confirm path; no pointer-only bypass. The "onClick arms, not
// wipes" half is already the teeth in N1. Here: tagName + a mousedown-only
// canary. Teeth on a non-button mutant and on an onMouseDown={clearAll} mutant.
// ---------------------------------------------------------------------------
describe("N5 (AC-5): native button, no pointer-only wipe (guard)", () => {
  it("the Clear control is a native <button type=button> (guard; teeth on a non-button mutant)", async () => {
    const props = baseProps({ compact: false, finals: [{ text: "x" }], questions: [] });
    await mount(props, DESKTOP);
    const btn = clearControl();
    expect(btn.tagName, "native button element").toBe("BUTTON");
    expect(btn.getAttribute("type"), "explicit type=button").toBe("button");
  });

  it("a bare mousedown does not wipe — no pointer-only bypass (guard)", async () => {
    const props = baseProps({ compact: false, finals: [{ text: "x" }], questions: [] });
    await mount(props, DESKTOP);
    await act(async () => clearControl().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(props.clearAll, "mousedown alone must not wipe (teeth on an onMouseDown mutant)").toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// N6 (AC-6) [guard — passes HEAD] — the IDLE accessible name stays exactly
// "Clear" (existing byName("Clear") lookups keep resolving). Teeth on a rename
// mutant and on a mutant that leaves the control permanently showing the armed
// label. Does not catch a WRONG armed label (N4 carries the armed announcement).
// ---------------------------------------------------------------------------
describe("N6 (AC-6): idle accessible name stays exactly 'Clear' (guard)", () => {
  for (const surface of ["inline", "tucked"]) {
    it(`idle control is named exactly "Clear" (${surface})`, async () => {
      const props = baseProps({ finals: [{ text: "x" }], questions: [] });
      await mountEnabled(surface, props);
      expect(accessibleName(clearControl()), "idle control named Clear").toBe("Clear");
      expect(byName("Clear"), "byName('Clear') still resolves to the idle control").toBeTruthy();
    });
  }
});

// ---------------------------------------------------------------------------
// N7 (AC-7) [guard — passes HEAD] — a disabled Clear (nothing to clear) cannot
// arm or wipe. Both surfaces. The disabled flag is the robust guard (jsdom's
// dispatch of events to disabled controls is unreliable); the no-arm and
// no-wipe assertions back it. Teeth on a drop-disable mutant and on a mutant
// that lets a disabled control arm.
// ---------------------------------------------------------------------------
describe("N7 (AC-7): a disabled Clear cannot arm (guard, both surfaces)", () => {
  for (const surface of ["inline", "tucked"]) {
    it(`nothing to clear → Clear disabled and un-armable (${surface})`, async () => {
      const props = baseProps({ finals: [], questions: [] });
      await mountEnabled(surface, props);
      const btn = clearControl();
      expect(btn.disabled, "Clear disabled when nothing to clear").toBe(true);
      await click(btn);
      expect(props.clearAll, "disabled Clear never wipes").toHaveBeenCalledTimes(0);
      expect(accessibleName(clearControl()), "disabled Clear never arms (name stays Clear)").toBe("Clear");
      const region = liveRegion();
      expect(region ? region.textContent.trim() : "", "no armed announcement while disabled").toBeFalsy();
    });
  }
});
