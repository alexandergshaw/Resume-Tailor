// @vitest-environment jsdom
//
// AC-T: THE TRACKING CARD LAYOUT'S TOUCH TARGETS AND TEXT WRAPPING.
//
// Scope. Below 900px `TrackingTab.js` replaces the ten-column table with a
// stacked card list (`isCompact = useIsTablet()`, the ternary at the top of
// the render). That branch is CORRECT and stays -- nothing here asks for it to
// become a scrolling table, and one guard below pins the branch itself. What
// is wrong inside it is target SIZE and text OVERFLOW:
//
//   AC-T1  the eight card action buttons (JD / Resume / Download / Comms /
//          Posting / Ask AI / Edit / Delete) are `size="small"` with no height
//          override -- MUI `sizeSmall` is 13px x 1.75 line-height plus 3-4px
//          of vertical padding, i.e. ~30.75px, against this repo's own
//          `MOBILE_TAP_MIN = 44` (app/theme/mobileSx.js).
//   AC-T2  `renderDigestCell`'s controls carry `p: 0, fontSize: 11`, which
//          computes to ~19.25px -- BELOW WCAG 2.5.8 AA's 24px floor, not just
//          below 44 -- on the research-recovery path ("Retry"), and this cell
//          renders inside the phone card.
//   AC-T3  the 24px stage chip is the ONLY route to the stage-edit dialog on
//          a phone.
//   AC-T4  Delete sits 4px (`gap: 0.5`) from Edit, both undersized.
//   AC-T5  company and title render in bare Boxes with no `overflowWrap`, and
//          `app/globals.css` sets `html { overflow-x: hidden }`, so a long
//          unbroken value is DELETED rather than scrollable.
//
// HOW THESE ARE ASSERTED, AND WHY IT IS NOT A PIXEL MEASUREMENT.
// jsdom has no layout engine: it cannot lay a box out and report its height.
// What it CAN do -- and what `app/theme/computedStyleAtWidth.js` exists for --
// is run its real cascade over emotion's serialised stylesheets at an emulated
// width, so a DECLARED `min-height` reaches the element or it does not. Every
// size assertion below therefore reads the computed `min-height` (or
// `min-width`) at 375px and requires it to be at least MOBILE_TAP_MIN. That is
// the machine-checkable half of "the control is 44px": the shared contract
// `TOUCH_TARGET_SX` puts a 44px floor under a box whose natural height is
// ~30.75px, and a floor that is actually in the cascade is exactly what these
// read back. A control that clears the floor by some other declared route
// passes too -- these do not require a particular constant, only the contract's
// effect (see also `app/theme/mobileSx.test.js`, which owns the contract).
//
// MANUAL / BROWSER-ONLY -- named here, and deliberately NOT simulated by any
// assertion in this file. A green run here is not evidence for any of them:
//   MC-T1  `[data-app-id] button, [data-app-id] a[href], [data-app-id]
//          [role="button"]` at 375x812 in a real browser:
//          `getBoundingClientRect().height >= 44` for every one. Predicted
//          BEFORE the fix: 19.25 (Retry / Researching…), 27.25 (Research),
//          30.75 (the eight action buttons), 24 (stage chips).
//   MC-T2  the RENDERED distance between the Edit and Delete buttons'
//          bounding boxes: `delete.getBoundingClientRect().left -
//          edit.getBoundingClientRect().right`. Predicted 4px before the fix,
//          required >= 8px after. `gap` is a declared value this file can
//          read; the resulting geometry is not.
//   MC-T3  seed a 45-character space-free company name and read
//          `card.getBoundingClientRect().right -
//          titleEl.getBoundingClientRect().right`. NEGATIVE means the text is
//          being clipped invisibly by `html { overflow-x: hidden }`. AC-T5
//          asserts the declared property that prevents it; only the browser
//          can show the clipping.
//   MC-T4  that the 900px breakpoint crossing itself works -- `matchMedia` is
//          mocked here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import TrackingTab from "./TrackingTab.js";
import { makeTheme } from "../theme/index.js";
import { atWidth } from "../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../theme/mobileSx.js";

// WCAG 2.5.8 AA's absolute floor. Named separately from MOBILE_TAP_MIN
// because the two say different things: 24 is the standard's minimum, 44 is
// this repo's own bar, and a control below 24 is a conformance failure rather
// than a comfort one.
const WCAG_MIN = 24;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let compact = true;

beforeEach(() => {
  compact = true;
  // `useIsTablet()` is breakpoints.down("md") -> "@media (max-width:899.95px)".
  window.matchMedia = vi.fn((query) => ({
    matches: /max-width/.test(String(query)) ? compact : false,
    media: String(query),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ fixtures

const APP = {
  id: "app-1",
  status: "applied",
  applied_at: "2026-01-05T00:00:00.000Z",
  application_url: "https://boards.example.com/stripe/frontend",
  positions: {
    id: "pos-1",
    company: "Stripe",
    title: "Frontend Engineer",
    url: null,
    description: "Build payment surfaces.",
  },
  generated_resumes: {
    content: "Alex Shaw\nFrontend Engineer",
    content_lines: ["Alex Shaw", "Frontend Engineer"],
    docx_path: "resumes/app-1.docx",
  },
};

const STAGE = {
  id: "stage-1",
  stage_name: "Phone screen",
  stage_type: "phone_screen",
  outcome: "pending",
  scheduled_at: null,
  duration_minutes: null,
  interviewer_names: [],
  notes: "",
};

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    applicationLoading: false,
    applicationError: "",
    applicationData: [APP],
    visibleApplicationData: [APP],
    applicationStages: { "app-1": [STAGE] },
    interviewSearch: "",
    setInterviewSearch: vi.fn(),
    interviewSort: { field: null, dir: "asc" },
    setInterviewSort: vi.fn(),
    companyColWidth: 140,
    roleColWidth: 180,
    resumeFile: { name: "base-resume.docx" },
    openAddApplicationDialog: vi.fn(),
    toggleInterviewSort: vi.fn(),
    sortLabelSx: () => ({}),
    startColResize: vi.fn(),
    askAiAbout: vi.fn(),
    buildApplicationContextString: () => "context",
    buildStageContextString: () => "stage context",
    openCommsInAppDialog: vi.fn(),
    openAddCommunicationDialog: vi.fn(),
    openEditApplicationDialog: vi.fn(),
    handleDeleteApplication: vi.fn(),
    setAppDialog: vi.fn(),
    setStageError: vi.fn(),
    setStageDialog: vi.fn(),
    isDocxResume: () => true,
    downloadDocxFiles: vi.fn(async () => ""),
    getDownloadFileNameForTitle: () => "Stripe - Frontend Engineer.docx",
    stageDialog: { open: false },
    stageError: "",
    stageSaving: false,
    handleSaveStage: vi.fn(),
    communicationsDialog: { open: false, items: [] },
    setCommunicationsDialog: vi.fn(),
    addCommunicationDialog: {
      open: false,
      body: "",
      files: [],
      kind: "email",
      subject: "",
      direction: "outbound",
      occurred_at: "",
    },
    setAddCommunicationDialog: vi.fn(),
    communicationError: "",
    setCommunicationError: vi.fn(),
    communicationSaving: false,
    handleSaveCommunication: vi.fn(),
    editAppDialog: { open: false },
    setEditAppDialog: vi.fn(),
    editAppSaving: false,
    editAppError: "",
    editAppResumeFile: null,
    setEditAppResumeFile: vi.fn(),
    handleSaveEditApplication: vi.fn(),
    addAppDialog: { open: false },
    setAddAppDialog: vi.fn(),
    addAppSaving: false,
    addAppError: "",
    addAppResumeFile: null,
    setAddAppResumeFile: vi.fn(),
    handleSaveAddApplication: vi.fn(),
    appDialog: { open: false, rowIndex: -1, kind: "" },
    loadCommunicationsForApp: vi.fn(),
    highlightedAppId: null,
    emailClassificationsByAppId: {},
    digestsById: {},
    researchingIds: new Set(),
    researchOne: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(TrackingTab, props)
      )
    );
  });
}

// -------------------------------------------------------------- measurement

const card = () => container.querySelector("[data-app-id]");

/** Every interactive thing inside the phone card, in document order. */
function cardControls(scope = card()) {
  return [
    ...new Set(
      Array.from(scope.querySelectorAll('button, a[href], [role="button"]'))
    ),
  ];
}

const name = (node) => (node.textContent || "").replace(/\s+/g, " ").trim();

/** "auto" / "" / "normal" all mean "no floor declared" -> 0. */
const pxOf = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The declared vertical floor on `node` at an emulated viewport `width`.
 * See the header: this is a serialised-cascade read, never a laid-out box.
 */
function floorAt(node, width) {
  return atWidth(width, () => pxOf(window.getComputedStyle(node).minHeight));
}

/** Offenders as `["Delete 0px", ...]`, so a failure names every one at once. */
function undersized(nodes, width, min) {
  return nodes
    .filter((node) => floorAt(node, width) < min)
    .map((node) => `${name(node) || node.tagName} ${floorAt(node, width)}px`);
}

// ============================================================================
// AC-T1 -- the eight card action buttons.
// ============================================================================

describe("AC-T1 -- every card action button meets the 44px touch floor at 375px", () => {
  // Named individually rather than swept, because the audit names exactly
  // these eight and a sweep would hide which one regressed.
  const ACTIONS = [/^JD$/, /^Resume$/, /^Download$/, /^Comms$/, /^Posting/, /^Ask AI$/, /^Edit$/, /^Delete$/];

  it("[control] renders all eight actions in the compact card layout", async () => {
    await render(baseProps());
    const found = cardControls().map(name);
    for (const re of ACTIONS) {
      expect(found.some((n) => re.test(n)), `no card control matching ${re}`).toBe(true);
    }
  });

  it("declares a >= 44px floor on each of the eight", async () => {
    await render(baseProps());
    const targets = cardControls().filter((node) => ACTIONS.some((re) => re.test(name(node))));
    expect(undersized(targets, 375, MOBILE_TAP_MIN)).toEqual([]);
  });
});

// ============================================================================
// AC-T2 -- renderDigestCell, all four states, inside the card.
// ============================================================================

describe("AC-T2 -- the research cell's controls meet the touch floor in the card", () => {
  const DIGEST_MD = "Stripe processes payments for millions of businesses.";

  async function renderDigest(digest, researching = false) {
    await render(
      baseProps({
        digestsById: digest ? { "app-1": digest } : {},
        researchingIds: researching ? new Set(["app-1"]) : new Set(),
      })
    );
    // Everything in the card that is not one of the eight action buttons and
    // not a stage chip: i.e. the digest cell's own controls.
    const ACTIONS = /^(JD|Resume|Download|Comms|Posting|Ask AI|Edit|Delete)/;
    return cardControls().filter(
      (node) => !ACTIONS.test(name(node)) && !node.classList.contains("MuiChip-root")
    );
  }

  it("state: never researched -- the 'Research' button", async () => {
    const controls = await renderDigest(null);
    expect(controls.map(name)).toContain("Research");
    expect(undersized(controls, 375, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("state: researching -- the 'Researching…' control", async () => {
    const controls = await renderDigest(null, true);
    expect(controls.map(name).join(" ")).toMatch(/Researching/);
    expect(undersized(controls, 375, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("state: failed -- 'Retry' and the stale-summary control", async () => {
    // The recovery path. `Retry` is the smallest control on this surface
    // (`p: 0, fontSize: 11` -> ~19.25px) and it is the ONLY way back from a
    // failed research run on a phone.
    const controls = await renderDigest({
      application_id: "app-1",
      status: "failed",
      markdown: DIGEST_MD,
      error: "model timeout",
    });
    expect(controls.map(name)).toContain("Retry");
    expect(undersized(controls, 375, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("state: failed -- 'Retry' clears WCAG 2.5.8 AA's 24px floor, which is a conformance line, not a comfort one", async () => {
    // Stated separately from the 44px case on purpose: 19.25px is not merely
    // "smaller than we would like", it fails the success criterion outright.
    const controls = await renderDigest({
      application_id: "app-1",
      status: "failed",
      markdown: DIGEST_MD,
      error: "model timeout",
    });
    const retry = controls.find((node) => name(node) === "Retry");
    expect(retry, "no Retry control in the failed state").toBeTruthy();
    expect(floorAt(retry, 375)).toBeGreaterThanOrEqual(WCAG_MIN);
  });

  it("state: researched -- the summary control that opens the research panel", async () => {
    const controls = await renderDigest({
      application_id: "app-1",
      status: "ready",
      markdown: DIGEST_MD,
    });
    expect(controls.length, "no control opens the research panel").toBeGreaterThan(0);
    expect(undersized(controls, 375, MOBILE_TAP_MIN)).toEqual([]);
  });
});

// ============================================================================
// AC-T3 -- the stage-edit route.
// ============================================================================

describe("AC-T3 -- the phone's route into the stage dialog is a real touch target", () => {
  /**
   * Implementation-agnostic: whichever control actually reaches
   * `setStageDialog` is the route, whether that stays a Chip, becomes a list
   * row, or becomes a button. Each candidate is measured in a FRESH render
   * before being clicked, so no click can perturb a later measurement.
   */
  async function stageRoutes() {
    await render(baseProps());
    const total = cardControls().length;
    const routes = [];
    for (let i = 0; i < total; i += 1) {
      const props = baseProps();
      await render(props);
      const node = cardControls()[i];
      if (!node) continue;
      const height = floorAt(node, 375);
      await act(async () => {
        node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      if (props.setStageDialog.mock.calls.length > 0) {
        routes.push({ label: name(node) || node.tagName, height });
      }
    }
    return routes;
  }

  it("[control] there IS a route into the stage dialog from the card", async () => {
    const routes = await stageRoutes();
    expect(routes.length, "no control in the card opens the stage dialog").toBeGreaterThan(0);
  });

  it("every stage-dialog route declares a >= 44px floor at 375px", async () => {
    const routes = await stageRoutes();
    expect(
      routes.filter((r) => r.height < MOBILE_TAP_MIN).map((r) => `${r.label} ${r.height}px`)
    ).toEqual([]);
  });

  it("GUARD (passes before the fix): the stage route is inside the focus-ring system", async () => {
    // app/theme/index.js ships one `.Mui-focusVisible` rule on
    // `MuiButtonBase`. Anything that is not a ButtonBase or a native control
    // has NO focus indicator at all, so a fix that swaps the Chip for a
    // hand-rolled div would be a keyboard regression dressed as a touch fix.
    await render(baseProps());
    const chip = card().querySelector(".MuiChip-root");
    expect(chip, "no stage chip rendered").toBeTruthy();
    const ok =
      chip.classList.contains("MuiButtonBase-root") ||
      ["BUTTON", "A", "SELECT", "INPUT"].includes(chip.tagName);
    expect(ok, "the stage route has no focus indicator").toBe(true);
  });
});

// ============================================================================
// AC-T4 -- Delete's separation from Edit.
// ============================================================================

describe("AC-T4 -- the destructive action is separated from the benign one beside it", () => {
  it("Delete is either pushed to its own end of the row or sits at >= 8px of declared gap", async () => {
    // A `window.confirm` in `useApplicationDialogs.js` softens the cost of a
    // mis-tap, but the confirm is not a target-size remedy: 2.5.8's spacing
    // allowance is about the geometry, and 4px of gap between two ~30px
    // controls is a mis-tap in the thumb zone either way.
    //
    // Two shapes satisfy this and the test accepts both, because which one is
    // right is the implementer's call: `ml: "auto"` (Delete pushed to the far
    // edge) or a row gap raised to >= 8px. jsdom reports the `gap` SHORTHAND
    // as declared -- `columnGap` reads "normal" because jsdom does not expand
    // the shorthand -- so both are read here.
    await render(baseProps());
    const del = cardControls().find((node) => name(node) === "Delete");
    expect(del, "no Delete control").toBeTruthy();

    const measured = atWidth(375, () => {
      const own = window.getComputedStyle(del);
      const row = window.getComputedStyle(del.parentElement);
      return {
        marginLeft: own.marginLeft,
        gap: Math.max(pxOf(row.gap), pxOf(row.columnGap)),
      };
    });

    const separated = measured.marginLeft === "auto" || measured.gap >= 8;
    expect(
      separated,
      `Delete has margin-left ${measured.marginLeft} and a row gap of ${measured.gap}px`
    ).toBe(true);
  });
});

// ============================================================================
// AC-T5 -- company and title cannot be clipped out of existence.
// ============================================================================

describe("AC-T5 -- a long unbroken company or title breaks instead of being clipped", () => {
  const LONG = "Nordwestdeutscheunternehmensberatungsgesellschaft";

  it("company and title declare overflow-wrap: anywhere", async () => {
    await render(
      baseProps({
        applicationData: [{ ...APP, positions: { ...APP.positions, company: LONG, title: `${LONG}-Engineer` } }],
        visibleApplicationData: [{ ...APP, positions: { ...APP.positions, company: LONG, title: `${LONG}-Engineer` } }],
      })
    );
    const boxes = Array.from(card().querySelectorAll("div")).filter((node) =>
      (node.textContent || "").trim().startsWith(LONG) && node.children.length === 0
    );
    expect(boxes.length, "neither company nor title rendered as its own box").toBe(2);

    const wraps = atWidth(375, () =>
      boxes.map((node) => window.getComputedStyle(node).overflowWrap)
    );
    expect(wraps).toEqual(["anywhere", "anywhere"]);
  });

  it("the wrapping is not phone-only -- a narrow card at any width clips the same way", async () => {
    // BREAK_LONG_WORDS_SX is deliberately NOT breakpoint-scoped (see
    // app/theme/mobileSx.js's header): `html { overflow-x: hidden }` applies
    // at every width, so a token that overflows its box is deleted at every
    // width. This pins that the fix is not keyed to `xs`.
    await render(
      baseProps({
        applicationData: [{ ...APP, positions: { ...APP.positions, company: LONG } }],
        visibleApplicationData: [{ ...APP, positions: { ...APP.positions, company: LONG } }],
      })
    );
    const box = Array.from(card().querySelectorAll("div")).find(
      (node) => (node.textContent || "").trim() === LONG && node.children.length === 0
    );
    expect(box).toBeTruthy();
    expect(atWidth(1000, () => window.getComputedStyle(box).overflowWrap)).toBe("anywhere");
  });
});

// ============================================================================
// GUARDS -- green before the fix. Each says what it is protecting.
// ============================================================================

describe("GUARDS (all pass before the fix)", () => {
  it("the compact sort control shipped in 93ad8f7 is present and already meets the field contract", async () => {
    // CONFIRMS THE AUDIT'S D-1 IS ALREADY CLOSED. Do not rebuild it. A native
    // <select> inside a TextField carrying TOUCH_FIELD_SX +
    // TOUCH_NATIVE_SELECT_SX: the InputBase root AND the select itself both
    // reach 44px on a phone, and both fall back to their real initial values
    // above `sm`.
    await render(baseProps());
    const select = container.querySelector("select");
    expect(select, "the compact layout has no sort control").toBeTruthy();
    expect(floorAt(select, 375)).toBe(MOBILE_TAP_MIN);
    expect(atWidth(1000, () => window.getComputedStyle(select).minHeight)).toBe("auto");
  });

  it("below md the card list renders and the ten-column table does not", async () => {
    // CONFIRMS THE AUDIT'S "cards already shipped" ruling. Do not rebuild the
    // table as cards, and do not add horizontal scroll.
    //
    // Split across two cases on purpose: MUI's `useMediaQuery` subscribes to
    // its MediaQueryList once via `useSyncExternalStore` and only re-reads on
    // that list's own change event, so flipping the mock BETWEEN two renders
    // of the same root reports the first width forever. Each width therefore
    // gets its own mount, from `beforeEach`'s fresh mock.
    compact = true;
    await render(baseProps());
    expect(container.querySelector("[data-app-id]")).toBeTruthy();
    expect(container.querySelector("table"), "the ten-column table rendered below 900px").toBeNull();
  });

  it("at and above md the table renders with its four column sorters", async () => {
    compact = false;
    await render(baseProps());
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll(".MuiTableSortLabel-root")).toHaveLength(4);
  });

  it("the desktop table's own controls gain no phone-only floor at 1000px", async () => {
    // The contract's `sm: "auto"` branch is what makes adopting it free above
    // the phone breakpoint. If a fix reaches for a bare `minHeight: 44`
    // instead, the dense table grows and this reds.
    compact = false;
    await render(baseProps());
    const rowControls = Array.from(
      container.querySelectorAll('table button, table a[href], table [role="button"]')
    );
    expect(rowControls.length).toBeGreaterThan(0);
    const grown = rowControls
      .filter((node) => floorAt(node, 1000) >= MOBILE_TAP_MIN)
      .map((node) => `${name(node)} ${floorAt(node, 1000)}px`);
    expect(grown).toEqual([]);
  });

  it("the card actions still do what they did -- Edit, Delete and Ask AI reach their handlers", async () => {
    // A target-size fix must not swap an element for one that loses the
    // click. Cheap, and it is the half a computed-style read cannot see.
    const props = baseProps();
    await render(props);
    for (const [label, spy] of [
      ["Edit", props.openEditApplicationDialog],
      ["Delete", props.handleDeleteApplication],
      ["Ask AI", props.askAiAbout],
    ]) {
      const node = cardControls().find((n) => name(n) === label);
      expect(node, `no ${label} control`).toBeTruthy();
      await act(async () => {
        node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(spy, `${label} reached no handler`).toHaveBeenCalled();
    }
  });
});
