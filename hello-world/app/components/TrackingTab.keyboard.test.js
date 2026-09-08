// @vitest-environment jsdom
//
// AC-K-B2 and AC-K-B4: TWO ACTIONS IN THE TRACKING TAB WITH NO KEYBOARD ROUTE.
//
// K-B2 -- "Download tailored .docx" is keyboard-dead ON DESKTOP.
// ------------------------------------------------------------
// `TrackingTab.js:699-750` renders the table cell's download affordance as a
// hand-rolled `<span role="button" tabIndex={0} onClick={...} draggable>` with
// NO key handler -- `grep -c onKey app/components/TrackingTab.js` returns 0 for
// the whole file. It is not a ButtonBase, so it gets none of MUI's synthesized
// Enter/Space activation either. Tab lands on it, a screen reader announces
// "button", and Enter and Space do nothing.
//
// The inversion is what makes this a blocker rather than a nuisance: the CARD
// branch, rendered only BELOW 900px, uses a real `<Button>Download</Button>`
// (`:368-381`). The action works on a phone and is dead on the laptop the owner
// actually works on. There is no second route at >=900px: `AppViewDialog.js`
// offers Previous/Next/Add-communication/Close and no download, and StatusBar's
// Download MenuItem applies to session chips, not saved application rows.
// `StatusBar.js:305-352` is the same hand-rolled shape WITH a correct
// Enter/Space handler -- the two were written from one template and only one
// kept the keys.
//
// K-B4 -- sorting is unreachable below 900px, INCLUDING ON A DESKTOP.
// ------------------------------------------------------------------
// All four `TableSortLabel`s (`:426, :464, :491, :504`) live inside the
// `<TableHead>` at `:409-520`, which the `isCompact` ternary at `:263` replaces
// wholesale with the card list. `isCompact` is `useIsTablet()`, i.e.
// `theme.breakpoints.down("md")` = **below 900px** (`app/hooks/useResponsive.js:20-23`)
// -- a half-screen split or a laptop with devtools open, not just phones.
// `interviewSort.field` starts `null` (`page.js:208`) and the comparator returns
// 0 for null, so the card list renders in raw fetch order with no control of any
// kind. "Show me what I applied to longest ago" is impossible under 900px.
//
// HOW THE SORT ASSERTION IS WRITTEN (deliberately implementation-agnostic)
// -----------------------------------------------------------------------
// The test does not care whether the fix drives `toggleInterviewSort(field)`
// (the existing 3-state cycle: asc -> desc -> cleared) or a new
// `setInterviewSort` prop. It records every call to BOTH in order, replays them
// through the real reducer from `page.js:1657-1663`, and asserts the RESULTING
// SORT STATE. Any control that genuinely reaches the sort passes; a control that
// merely looks like one does not.
//
//   MANUAL / BROWSER-ONLY (not asserted here, and not claimed):
//     * Real Enter/Space on the download control. jsdom does not implement a
//       native button's default activation behaviour, so a synthetic
//       `keydown{key:"Enter"}` produces no click even on a correct <button>.
//       The machine-checkable proxy is "it IS a native <button>, and a click
//       runs the download"; the browser supplies the key-to-click half.
//     * That the focus ring is visible on the download control inside a sticky,
//       overflowing `<TableCell>` -- jsdom has no layout engine.
//     * The actual 900px breakpoint crossing (matchMedia is mocked here).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import TrackingTab from "./TrackingTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let compact = false;

beforeEach(() => {
  compact = false;
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

function accessibleName(node) {
  if (!node) return "";
  const labelled = node.getAttribute("aria-labelledby");
  if (labelled) {
    const target = document.getElementById(labelled);
    if (target) return (target.textContent || "").trim();
  }
  const byId = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null;
  return (
    node.getAttribute("aria-label")
    || (byId ? (byId.textContent || "").trim() : "")
    || (node.textContent || "").trim()
    || node.getAttribute("title")
    || ""
  ).trim();
}

const APP = {
  id: "app-1",
  status: "applied",
  applied_at: "2026-01-05T00:00:00.000Z",
  application_url: null,
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

// The real reducer from app/page.js:1657-1663. Replaying calls through it is
// what lets this file accept either wiring.
function toggleReducer(prev, field) {
  if (prev.field !== field) return { field, dir: "asc" };
  if (prev.dir === "asc") return { field, dir: "desc" };
  return { field: null, dir: "asc" };
}

function makeSortSpies() {
  const calls = [];
  return {
    calls,
    toggleInterviewSort: vi.fn((field) => calls.push({ kind: "toggle", field })),
    setInterviewSort: vi.fn((value) => calls.push({ kind: "set", value })),
    resolve(start = { field: null, dir: "asc" }) {
      return calls.reduce((state, call) => {
        if (call.kind === "toggle") return toggleReducer(state, call.field);
        return typeof call.value === "function" ? call.value(state) : call.value;
      }, start);
    },
  };
}

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    applicationLoading: false,
    applicationError: "",
    applicationData: [APP],
    visibleApplicationData: [APP],
    applicationStages: {},
    interviewSearch: "",
    setInterviewSearch: vi.fn(),
    interviewSort: { field: null, dir: "asc" },
    companyColWidth: 140,
    roleColWidth: 180,
    resumeFile: { name: "base-resume.docx" },
    openAddApplicationDialog: vi.fn(),
    toggleInterviewSort: vi.fn(),
    setInterviewSort: vi.fn(),
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
    addCommunicationDialog: { open: false, body: "", files: [], kind: "email", subject: "", direction: "outbound", occurred_at: "" },
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
    root.render(createElement(TrackingTab, props));
  });
  return container;
}

function downloadControls() {
  return Array.from(container.querySelectorAll('button, [role="button"], a[href]')).filter((node) =>
    /download/i.test(accessibleName(node))
  );
}

describe("K-B2 -- the tailored .docx download is keyboard-operable on desktop", () => {
  it("renders the download affordance as a real <button>, not a hand-rolled role=button span", async () => {
    compact = false;
    await render(baseProps());
    const controls = downloadControls();
    expect(controls.length, "no control named 'download' in the desktop table").toBeGreaterThan(0);
    for (const node of controls) {
      // A native <button> is the only shape that gets BOTH Enter and Space from
      // the browser with no hand-written key handler. See the header for why
      // the real key press is a manual check and this is the proxy.
      expect(node.tagName, `download control rendered as <${node.tagName.toLowerCase()}>`).toBe("BUTTON");
      expect(node.classList.contains("MuiButtonBase-root"), "opts out of the app-wide focus ring").toBe(true);
    }
  });

  it("GUARD (passes before the fix): activating the control still runs the download", async () => {
    // The mouse half already works; this pins that swapping the element does
    // not lose the action. A regression guard, not a falsifier of the blocker.
    compact = false;
    const props = baseProps();
    await render(props);
    const control = downloadControls()[0];
    expect(control).toBeTruthy();
    await act(async () => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(props.downloadDocxFiles).toHaveBeenCalledTimes(1);
    const arg = props.downloadDocxFiles.mock.calls[0][0];
    expect(arg.company).toBe("Stripe");
    expect(arg.docxPath).toBe("resumes/app-1.docx");
  });

  it("GUARD (passes before the fix): the drag-to-upload affordance survives", async () => {
    // Dragging the tailored file straight into an ATS upload field is the
    // reason the span exists. The fix must ADD a keyboard route, not remove the
    // pointer one -- MUI's button roots keep `draggable`/`onDragStart` fine.
    compact = false;
    await render(baseProps());
    const control = downloadControls()[0];
    expect(control).toBeTruthy();
    const draggableHost = control.closest("[draggable='true']") || control;
    expect(draggableHost.getAttribute("draggable")).toBe("true");
  });

  it("stays disabled-but-explained when there is no .docx source resume", async () => {
    // The current span signals "not allowed" only through `cursor` and
    // `opacity` -- neither reaches a keyboard or screen-reader user.
    compact = false;
    const props = baseProps({ isDocxResume: () => false });
    await render(props);
    const controls = downloadControls();
    for (const node of controls) {
      const off = node.disabled === true || node.getAttribute("aria-disabled") === "true";
      expect(off, "unavailable download exposes no programmatic disabled state").toBe(true);
    }
    if (controls[0] && controls[0].getAttribute("aria-disabled") === "true") {
      await act(async () => {
        controls[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(props.downloadDocxFiles).not.toHaveBeenCalled();
    }
  });

  it("keeps the unavailable download reachable by keyboard (aria-disabled, not the disabled attribute)", async () => {
    // MAJOR 4: `disabled` sets `tabindex="-1"`, which removes the control
    // from the tab order -- a keyboard or screen-reader user can then never
    // reach the aria-label/tooltip explaining WHY the download is
    // unavailable. ChatPanel.js's Send button states this repo's rule in
    // writing: use `aria-disabled` and keep the control focusable. This is
    // the half of AC-K2.4 the `off` check above cannot distinguish, since it
    // accepts either attribute.
    compact = false;
    const props = baseProps({ isDocxResume: () => false });
    await render(props);
    const controls = downloadControls();
    expect(controls.length).toBeGreaterThan(0);
    for (const node of controls) {
      expect(node.disabled, "the disabled ATTRIBUTE removes the control from the tab order").toBe(false);
      expect(node.getAttribute("tabindex"), "unavailable download is unreachable by keyboard").not.toBe("-1");
    }
  });

  it("GUARD (passes before the fix): the card branch keeps its real Download button", async () => {
    // Below 900px the download already works. This guard exists so the fix
    // cannot "unify" the two branches by dragging the broken shape downwards.
    compact = true;
    const props = baseProps();
    await render(props);
    const control = downloadControls()[0];
    expect(control).toBeTruthy();
    expect(control.tagName).toBe("BUTTON");
    await act(async () => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(props.downloadDocxFiles).toHaveBeenCalledTimes(1);
  });
});

describe("K-B4 -- sorting is reachable below the md breakpoint", () => {
  function sortControls() {
    return Array.from(
      container.querySelectorAll('select, button, [role="button"], [role="combobox"]')
    ).filter((node) => /sort|order by/i.test(accessibleName(node)));
  }

  it("offers a sort control at all in the compact (card) layout", async () => {
    compact = true;
    await render(baseProps());
    expect(
      sortControls().length,
      "the card layout renders no control named 'sort' -- the list is frozen in fetch order"
    ).toBeGreaterThan(0);
  });

  it("exposes every column the desktop table can sort by", async () => {
    compact = true;
    await render(baseProps());
    const control = sortControls().find((n) => n.tagName === "SELECT") || sortControls()[0];
    expect(control).toBeTruthy();
    const text = (control.tagName === "SELECT" ? control : container).textContent || "";
    const values = control.tagName === "SELECT"
      ? Array.from(control.options).map((o) => `${o.value} ${o.textContent}`).join(" ")
      : text;
    for (const label of [/company/i, /role|title/i, /status/i, /applied/i]) {
      expect(values, `no way to sort by ${label}`).toMatch(label);
    }
  });

  it("actually drives the sort state when used", async () => {
    compact = true;
    const spies = makeSortSpies();
    const control = await render(
      baseProps({
        toggleInterviewSort: spies.toggleInterviewSort,
        setInterviewSort: spies.setInterviewSort,
      })
    ).then(() => sortControls().find((n) => n.tagName === "SELECT") || sortControls()[0]);
    expect(control).toBeTruthy();

    if (control.tagName === "SELECT") {
      const option = Array.from(control.options).find((o) => /applied/i.test(`${o.value} ${o.textContent}`));
      expect(option, "no 'applied' option").toBeTruthy();
      await act(async () => {
        control.value = option.value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
    } else {
      const byField = sortControls().find((n) => /applied/i.test(accessibleName(n)));
      expect(byField).toBeTruthy();
      await act(async () => {
        byField.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }

    expect(spies.calls.length, "the sort control reached no sort setter").toBeGreaterThan(0);
    expect(spies.resolve().field).toBe("applied_at");
  });

  it("keeps the 'Sort by' label from overlapping its own value", async () => {
    // MAJOR 3: MUI computes InputLabel's `shrink` from `isFilled(value)`; at
    // rest the control's value is "" (Default order), which is not "filled",
    // so without `inputLabel: { shrink: true }` the label renders INSIDE the
    // field, on top of the native <select>'s always-visible "Default order"
    // text. This is the exact trap MicPicker.js:125-138 documents ("a native
    // select has no genuinely blank state for the label to sit on top of")
    // and works around with that same slotProp. `data-shrink` is the
    // machine-checkable proxy MicPicker.test.js already uses for this --
    // jsdom has no layout engine, so nothing here can measure actual pixel
    // overlap.
    compact = true;
    await render(baseProps());
    const label = Array.from(container.querySelectorAll("label")).find((l) => /sort by/i.test(l.textContent || ""));
    expect(label, "no 'Sort by' label rendered").toBeTruthy();
    expect(label.getAttribute("data-shrink"), "the label is sitting on top of the value").toBe("true");
  });

  it("resets the sort back to fetch order when 'Default order' is chosen again", async () => {
    // MAJOR 2: SORT_FIELD_OPTIONS[0] ({ value: "", label: "Default order" })
    // used to render, be selectable, and reach no setter at all -- once a
    // user sorted in the compact layout there was no route back to fetch
    // order, unlike the desktop 3-state cycle's third click. Assert on the
    // resulting sort state via the real reducer, not on the call, so a
    // setter call that doesn't actually clear the sort still fails this.
    compact = true;
    const spies = makeSortSpies();
    const control = await render(
      baseProps({
        interviewSort: { field: "company", dir: "asc" },
        toggleInterviewSort: spies.toggleInterviewSort,
        setInterviewSort: spies.setInterviewSort,
      })
    ).then(() => sortControls().find((n) => n.tagName === "SELECT") || sortControls()[0]);
    expect(control).toBeTruthy();

    await act(async () => {
      control.value = "";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(spies.calls.length, "'Default order' is a dead option: reached no sort setter").toBeGreaterThan(0);
    expect(spies.resolve({ field: "company", dir: "asc" })).toEqual({ field: null, dir: "asc" });
  });

  it("keeps the sort control in the keyboard tab order and inside the focus-ring system", async () => {
    compact = true;
    await render(baseProps());
    const control = sortControls().find((n) => n.tagName === "SELECT") || sortControls()[0];
    expect(control).toBeTruthy();
    expect(control.getAttribute("tabindex")).not.toBe("-1");
    expect(control.disabled === true).toBe(false);
    // Native <select> gets the UA focus ring; anything else in this app must be
    // a ButtonBase so app/theme/index.js's `.Mui-focusVisible` rule reaches it.
    const ok = control.tagName === "SELECT" || control.classList.contains("MuiButtonBase-root");
    expect(ok, "sort control is neither a native <select> nor a MUI ButtonBase").toBe(true);
  });

  it("GUARD (passes before the fix): the desktop table keeps its four column sorters", async () => {
    compact = false;
    const spies = makeSortSpies();
    await render(baseProps({ toggleInterviewSort: spies.toggleInterviewSort }));
    const headers = Array.from(container.querySelectorAll(".MuiTableSortLabel-root"));
    expect(headers).toHaveLength(4);
    await act(async () => {
      headers[3].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(spies.toggleInterviewSort).toHaveBeenCalled();
  });
});
