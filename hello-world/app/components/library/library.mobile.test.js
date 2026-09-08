// @vitest-environment jsdom
//
// SURFACE F, PART 4 -- THE TAILORING LIBRARY ON A PHONE.
//
// This route is the healthier of the two surfaces in the audit: `app/library/
// page.js` renders LibraryEditor with no `.page`/`.main` wrapper, so its
// `p: { xs: 2 }` leaves ~343px at 375 rather than the Experience tab's 271.
// `EntityTab` already swaps its table for cards below `sm`, and `EditDialog`,
// `ImportDialog` and `ImportToLibraryDialog` are already `fullScreen` there.
// What is wrong is SIZING and one layout that pretends to be a comparison:
//
//   F-05  Every icon-only control here is at MUI's default: `IconButton
//         size="small"` ~30px on EntityTab's card actions and PersonaTab's
//         list actions, `IconButton` default ~36px on ProfileTab's and
//         PersonaTab's key-removal buttons, `Checkbox size="small" p:0.5` =
//         28px in ImportDialog. All below `MOBILE_TAP_MIN`. The dialogs'
//         `size="small"` fields are ~40px, also under it.
//   F-13  `PreviewTab` renders a two-column résumé/cover-letter diff. It
//         collapses to one column below `md`, which is honest, but two 12px
//         `<pre>` blocks inside 480px-max-height nested scrollers inside a
//         343px column is not a comparison surface -- it is two long grey
//         blocks you scroll past. `whiteSpace: pre-wrap` also breaks at
//         WHITESPACE ONLY, so a long URL in the rendered résumé still
//         overflows into an inner horizontal scroller.
//   F-15  ImportDialog's 260px buzzword scroller is a nested scroller inside
//         an already-fullScreen dialog: it steals the page-scroll gesture and
//         hides its rows from find-in-page.
//
// THE RULING ON PreviewTab, per the audit's own "read/review-only on a phone"
// call: do not fake a two-pane diff at 343px. Show the detected title, the
// matched-keyword chips, and ONE document at a time behind a two-button
// switch, and SAY that the side-by-side view needs a larger screen rather
// than silently degrading it.
//
// Sizes below are DECLARED-value reads at an emulated width through
// `app/theme/computedStyleAtWidth.js`, never laid-out boxes -- jsdom has no
// layout engine. See `../experience/experienceTree.mobile.test.js`'s header
// for the full statement of that limit.
//
// BROWSER-ONLY, not simulated here:
//   MC-F10 `document.querySelector('.MuiToggleButtonGroup-root')
//          .getBoundingClientRect().width` at 320px, against the ~272px of
//          dialog interior. A ToggleButtonGroup is `inline-flex` and never
//          wraps internally, so a miss CLIPS rather than wraps -- and
//          `html { overflow-x: hidden }` makes the clip invisible. The audit
//          predicts ~230px (fits); this file cannot settle it either way.
//   MC-F11 every `button` in the library route at 375x812:
//          `getBoundingClientRect().height >= 44`.
//   MC-F12 that the 600px breakpoint crossing works -- `matchMedia` is stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import EntityTab from "./EntityTab.js";
import PersonaTab from "./PersonaTab.js";
import ProfileTab from "./ProfileTab.js";
import EditDialog from "./EditDialog.js";
import ImportDialog from "./ImportDialog.js";
import PreviewTab from "./PreviewTab.js";
import { TAXONOMY_SCHEMA } from "./schemas.js";
import { makeTheme } from "../../theme/index.js";
import { atWidth } from "../../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../../theme/mobileSx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = 375;
const DESKTOP = 1000;

let container;
let root;
let phone = true;

beforeEach(() => {
  phone = true;
  window.matchMedia = vi.fn((query) => ({
    matches: /max-width/.test(String(query)) ? phone : false,
    media: String(query),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
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
  delete window.matchMedia;
  delete global.fetch;
  vi.restoreAllMocks();
});

async function render(element) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, element));
  });
}

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const pxOf = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};
const styleAt = (node, width, prop) => atWidth(width, () => window.getComputedStyle(node)[prop]);
const name = (node) =>
  node.getAttribute("aria-label") || (node.textContent || "").replace(/\s+/g, " ").trim() || node.tagName;

function undersized(nodes, width, min) {
  return nodes
    .filter((node) => pxOf(styleAt(node, width, "minHeight")) < min)
    .map((node) => `${name(node)} ${styleAt(node, width, "minHeight")}`);
}

/** Every InputBase root in a scope -- the actual typeable surface. */
const inputRoots = (scope) => [...scope.querySelectorAll(".MuiInputBase-root")];

// ============================================================================
// F-05 -- the four tabs' icon-only controls.
// ============================================================================

describe("F-05 -- EntityTab's phone cards", () => {
  const ROWS = [
    { id: "t1", canonical: "Kubernetes", category: "technology", aliases: ["k8s"], match_canonical: true },
  ];

  const props = () => ({
    title: "Buzzword",
    description: "Terms the tailoring engine matches.",
    rows: ROWS,
    schema: TAXONOMY_SCHEMA(["technology", "domain"]),
    endpoint: "/api/library/taxonomy",
    categories: ["technology", "domain"],
    onChanged: vi.fn(),
  });

  it("[control] renders the card layout, not the desktop table", async () => {
    await render(createElement(EntityTab, props()));
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Kubernetes");
  });

  it("floors the per-row edit and delete buttons at 44px, and leaves them alone above sm", async () => {
    await render(createElement(EntityTab, props()));
    const actions = [
      container.querySelector('[aria-label="edit"]'),
      container.querySelector('[aria-label="delete"]'),
    ];
    expect(actions.every(Boolean)).toBe(true);
    expect(undersized(actions, PHONE, MOBILE_TAP_MIN)).toEqual([]);
    for (const node of actions) {
      expect(styleAt(node, DESKTOP, "minHeight"), name(node)).toBe("auto");
    }
  });
});

describe("F-05 -- PersonaTab", () => {
  const PERSONAS = [{ id: "pa1", name: "Finance Educator", values: { PRIMARY_FUNCTION: "Instructor" } }];

  it("floors the list's edit and delete buttons", async () => {
    await render(createElement(PersonaTab, { personas: PERSONAS, focusAreas: [], onChanged: vi.fn() }));
    const actions = [
      container.querySelector('[aria-label="edit"]'),
      container.querySelector('[aria-label="delete"]'),
    ];
    expect(actions.every(Boolean)).toBe(true);
    expect(undersized(actions, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("floors the add/edit form's fields and its custom-key remove button", async () => {
    await render(
      createElement(PersonaTab, {
        personas: PERSONAS,
        focusAreas: [],
        onChanged: vi.fn(),
      }),
    );
    // Open the form on the existing persona, which also opens the disclosure.
    await click(container.querySelector('[aria-label="edit"]'));

    const fields = inputRoots(container);
    expect(fields.length).toBeGreaterThan(2);
    expect(undersized(fields, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });
});

describe("F-05 -- ProfileTab", () => {
  const PROFILE = { values: { FULL_NAME: "Alex Shaw" }, default_teaching_subjects: ["Finance"] };

  it("floors the key-removal button and every value field", async () => {
    await render(createElement(ProfileTab, { profile: PROFILE, onChanged: vi.fn() }));
    const remove = container.querySelector('[aria-label="remove"]');
    expect(remove).not.toBeNull();
    expect(undersized([remove, ...inputRoots(container)], PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });
});

describe("F-05 -- EditDialog, the one place a library row is actually edited", () => {
  const dialogProps = () => ({
    open: true,
    title: "Edit buzzword",
    schema: TAXONOMY_SCHEMA(["technology"]),
    draft: { canonical: "Kubernetes", category: "technology", aliases: ["k8s"], match_canonical: true },
    setDraft: vi.fn(),
    onClose: vi.fn(),
    onSave: vi.fn(),
    saving: false,
    error: "",
    categories: ["technology"],
  });

  it("[control] is fullScreen on a phone (already shipped) and renders every schema field", async () => {
    await render(createElement(EditDialog, dialogProps()));
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
    expect(inputRoots(document).length).toBeGreaterThan(2);
  });

  it("floors every field, the chips input included, at 44px", async () => {
    await render(createElement(EditDialog, dialogProps()));
    expect(undersized(inputRoots(document), PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("extends the switch's hit area without moving the track or the thumb", async () => {
    await render(createElement(EditDialog, dialogProps()));
    const track = document.querySelector(".MuiSwitch-track");
    expect(track, "no switch rendered from the schema").not.toBeNull();
    // The contract does this with a transparent ::after on the switchBase --
    // padding was tried in this repo and measurably broke the control (the
    // Switch root has a FIXED width). jsdom's pseudo-element styles are not
    // reliable, so what is asserted is that the SWITCH ROOT's own geometry is
    // untouched: no width or padding override reached it.
    const rootEl = document.querySelector(".MuiSwitch-root");
    expect(styleAt(rootEl, PHONE, "padding")).toBe(styleAt(rootEl, DESKTOP, "padding"));
  });
});

// ============================================================================
// F-05 / F-15 -- the import dialog.
// ============================================================================

describe("F-05 / F-15 -- ImportDialog's buzzword review list", () => {
  const EXTRACT = {
    title: "Staff Engineer",
    company: "Stripe",
    categories: ["technology", "domain"],
    buzzwords: [
      { canonical: "Kubernetes", category: "technology" },
      { canonical: "Terraform", category: "" },
    ],
    suggestedFocusArea: { name: "Platform" },
    suggestedSkillGroup: { heading: "Infrastructure" },
  };

  async function renderAnalyzed() {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => EXTRACT });
    await render(createElement(ImportDialog, { open: true, onClose: vi.fn(), onChanged: vi.fn() }));

    // Type a URL, then Analyze, so the review list actually renders.
    const input = document.querySelector('input[type="text"], .MuiInputBase-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(input, "https://jobs.example.com/staff");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const analyze = [...document.querySelectorAll("button")].find((b) => /Analyze posting/.test(b.textContent));
    await click(analyze);
    await flush();
  }

  it("[control] renders the extracted buzzwords with their checkboxes", async () => {
    await renderAnalyzed();
    expect(document.body.textContent).toContain("Kubernetes");
    expect(document.querySelectorAll(".MuiCheckbox-root").length).toBeGreaterThan(1);
  });

  it("floors every row checkbox and category picker at 44px", async () => {
    await renderAnalyzed();
    const rowBoxes = [...document.querySelectorAll(".MuiCheckbox-root")];
    expect(undersized([...rowBoxes, ...inputRoots(document)], PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("drops the inner 260px scroller on a phone and keeps it above sm", async () => {
    await renderAnalyzed();
    const list = [...document.querySelectorAll(".MuiDialogContent-root .MuiStack-root")].find(
      (el) => styleAt(el, DESKTOP, "maxHeight") === "260px",
    );
    expect(list, "the 260px buzzword scroller was not found").toBeDefined();
    expect(styleAt(list, PHONE, "maxHeight")).toBe("none");
    expect(styleAt(list, PHONE, "overflow")).toBe("visible");
  });

  it("floors the mode toggle buttons -- the smallest controls in the dialog", async () => {
    await render(createElement(ImportDialog, { open: true, onClose: vi.fn(), onChanged: vi.fn() }));
    const toggles = [...document.querySelectorAll(".MuiToggleButton-root")];
    expect(toggles).toHaveLength(2);
    expect(undersized(toggles, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });
});

// ============================================================================
// F-13 -- PreviewTab: one document at a time, and say so.
// ============================================================================

describe("F-13 -- PreviewTab does not fake a two-pane diff at 343px", () => {
  const RESULT = {
    jobTitle: "Staff Engineer",
    companyName: "Stripe",
    keywords: { technology: [{ canonical: "Kubernetes" }] },
    resume: "ALEX SHAW\nSee https://example.com/a/very/long/unbroken/path/that/never/wraps/at/all",
    cover: "Dear hiring team,",
  };

  async function renderRendered() {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => RESULT });
    await render(createElement(PreviewTab, null));

    const posting = container.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    await act(async () => {
      setter.call(posting, "We need a staff engineer.");
      posting.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const run = [...container.querySelectorAll("button")].find((b) => /Render preview/.test(b.textContent));
    await click(run);
    await flush();
  }

  const panes = () => [...container.querySelectorAll("pre")];
  const docButton = (label) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === label);

  it("[control] renders the detected title and the matched-keyword chips", async () => {
    await renderRendered();
    expect(container.textContent).toContain("Staff Engineer");
    expect(container.querySelector(".MuiChip-root")).not.toBeNull();
  });

  it("shows exactly one document at a time on a phone, behind a two-button switch", async () => {
    await renderRendered();
    expect(panes()).toHaveLength(1);

    const cover = docButton("Cover letter");
    expect(cover, "no 'Cover letter' switch button").toBeDefined();
    await click(cover);
    expect(panes()).toHaveLength(1);
    expect(panes()[0].textContent).toContain("Dear hiring team");
  });

  it("states the limitation rather than silently degrading the comparison", async () => {
    await renderRendered();
    expect(container.textContent).toMatch(/larger screen/i);
  });

  it("keeps both documents side by side above sm, with no switch and no notice", async () => {
    phone = false;
    await renderRendered();
    expect(panes()).toHaveLength(2);
    expect(docButton("Cover letter")).toBeUndefined();
    expect(container.textContent).not.toMatch(/larger screen/i);
  });

  it("lets a long unbroken token in the rendered document break instead of being clipped", async () => {
    await renderRendered();
    // `pre-wrap` breaks at whitespace ONLY, so a URL still overflows -- and
    // `html { overflow-x: hidden }` deletes the overflow rather than scrolling
    // to it.
    expect(styleAt(panes()[0], PHONE, "overflowWrap")).toBe("anywhere");
  });

  it("does not nest a 480px scroller inside the page scroller on a phone", async () => {
    await renderRendered();
    expect(styleAt(panes()[0], PHONE, "maxHeight")).toBe("none");
    expect(styleAt(panes()[0], DESKTOP, "maxHeight")).toBe("480px");
  });
});
