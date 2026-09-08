// @vitest-environment jsdom
//
// SURFACE F, PART 1 -- THE EXPERIENCE PAGE TREE AND ITS MOVE DIALOG AT 375px.
//
// What is wrong, from the mobile audit (MOBILE-F), and what each block below
// pins once it is fixed:
//
//   F-03  Every per-row action (Add sub-page / Rename / Delete / Move) sits in
//         a container at `opacity: 0; pointerEvents: none`, revealed ONLY by
//         `:hover` and `:focus-within`. Touch has no hover, and
//         `pointer-events: none` at rest means the first tap in the strip
//         passes THROUGH to the row's own onClick. Rename and Delete have no
//         other entry point anywhere in the UI.
//   F-05  Nothing in this file set imports the shared touch contract. Every
//         control here is at its MUI default: `IconButton size="small"` ~30px,
//         `Checkbox size="small"` with `p: 0.5` = 28px, `ListItemButton
//         py: 0.75` ~32px -- all under `MOBILE_TAP_MIN`.
//   F-08  The rename `InputBase` is `fontSize: 13.5`, which triggers iOS
//         Safari's focus zoom. It is the only rename path in the app.
//   F-10  `MovePageDialog` is not `fullScreen` on a phone and its destination
//         indent is `2 + depth * 2` with no cap.
//   DEPTH The tree is an UNBOUNDED drill-down (PageTreeItem recurses on
//         `depth + 1`, nothing bounds nesting). A fixed per-level indent
//         eventually leaves the title column no width at all, and
//         `app/globals.css`'s `html { overflow-x: hidden }` deletes the
//         overflow rather than offering it. The ruling, encoded in
//         lib/experience/treeIndent.js: cap the VISUAL indent on phones and
//         move the depth information onto an explicit `aria-level`, so the
//         semantic depth survives the flattened pixels.
//
// HOW SIZE IS ASSERTED HERE, AND WHAT THAT IS NOT.
// jsdom has NO layout engine: `getBoundingClientRect()` returns zeros, so
// nothing below is a measurement of a laid-out box. What jsdom 29 does have is
// a real cascade over emotion's serialised stylesheets, and
// `app/theme/computedStyleAtWidth.js` emulates a viewport width for it by
// rewriting the `min-width` media conditions MUI compiles every responsive
// `sx` value into. Every size assertion is therefore a read of a DECLARED
// floor (`min-height`) at an emulated 375px -- the machine-checkable half of
// "this control is 44px". A control that clears the floor by some other
// declared route passes too; these do not require a particular constant.
//
// BROWSER-ONLY, named here and deliberately NOT simulated by anything below.
// A green run in this file is not evidence for any of them:
//   MC-F1  at 375x812 with touch emulation, tap a tree row and read
//          `getComputedStyle(row.querySelector('.page-tree-item-actions'))
//          .opacity`. This file proves the DECLARED rule reaches the element;
//          only a browser shows that a tap reaches the button rather than the
//          row underneath it.
//   MC-F2  `getBoundingClientRect().right > window.innerWidth` for the title
//          Typography of the DEEPEST row in a depth-12 tree, before and after
//          the cap. Predicted before: clipped (negative remaining width);
//          required after: fully inside the pane at every depth.
//   MC-F3  focus the rename input on real iOS Safari and read
//          `window.visualViewport.scale`. Predicted > 1.0 before the 16px
//          font-size, 1.0 after. No emulator reproduces this.
//   MC-F4  that the 600px breakpoint crossing itself works -- `matchMedia` is
//          stubbed here, so the `useIsMobile()` branch is chosen by the stub,
//          not measured.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import PageTree from "./PageTree.js";
import MovePageDialog from "./MovePageDialog.js";
import { makeTheme } from "../../theme/index.js";
import { atWidth } from "../../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../../theme/mobileSx.js";

// lib/experience/treeIndent.js keeps its cap private (nothing that ships needs
// the number), so it is spelled out here and pinned to the module's own
// behaviour in lib/experience/treeIndent.test.js.
const PHONE_INDENT_MAX_DEPTH = 3;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = 375;
const DESKTOP = 1000;

let container;
let root;
let phone = true;

beforeEach(() => {
  phone = true;
  // `useIsMobile()` is `breakpoints.down("sm")` -> "@media (max-width:599.95px)".
  // jsdom implements no `matchMedia` at all (probed), so MUI's useMediaQuery
  // falls back to `defaultMatches: false` without this -- which is why every
  // EXISTING test in this directory keeps taking the desktop branch untouched.
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
  vi.restoreAllMocks();
});

async function render(element) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, element));
  });
}

// ------------------------------------------------------------------ measuring

/** "auto"/""/"normal" all mean "no floor declared" -> 0. */
const pxOf = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const styleAt = (node, width, prop) => atWidth(width, () => window.getComputedStyle(node)[prop]);

const name = (node) =>
  node.getAttribute("aria-label") || (node.textContent || "").replace(/\s+/g, " ").trim() || node.tagName;

/** Offenders as `["Rename Depth 4 0px", ...]`, so a failure names every one. */
function undersized(nodes, width, min) {
  return nodes
    .filter((node) => pxOf(styleAt(node, width, "minHeight")) < min)
    .map((node) => `${name(node)} ${styleAt(node, width, "minHeight")}`);
}

// -------------------------------------------------------------------- fixture

/**
 * A single chain `d0 > d1 > ... > d{depth}`, every level expanded. Deliberately
 * a chain rather than a bushy tree: the defect is about DEPTH, and a chain is
 * the shortest fixture that reaches depth 9 with ten rows.
 */
function chain(depth) {
  let node = { id: `d${depth}`, title: `Depth ${depth}`, children: [] };
  for (let d = depth - 1; d >= 0; d -= 1) {
    node = { id: `d${d}`, title: `Depth ${d}`, children: [node] };
  }
  return [node];
}

const chainExpanded = (depth) => new Set(Array.from({ length: depth + 1 }, (_, d) => `d${d}`));

function treeProps(overrides = {}) {
  return {
    tree: chain(9),
    selectedId: null,
    expandedIds: chainExpanded(9),
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onRenameStart: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    onCreateChild: vi.fn(),
    onDeleteRequest: vi.fn(),
    onMoveRequest: vi.fn(),
    onMove: vi.fn(),
    onToggleSelect: vi.fn(),
    ...overrides,
  };
}

const rowFor = (id) => container.querySelector(`[role="treeitem"][data-page-id="${id}"]`);
// The inner row Box -- the element that carries the depth indent, and the
// only scope any per-row query may use. A treeitem <li> CONTAINS its expanded
// descendants, so `rowFor(id).querySelectorAll(...)` sweeps the whole subtree:
// on the depth-9 chain that is 41 buttons, not 4.
const rowBoxFor = (id) => rowFor(id).firstElementChild;
const actionsFor = (id) => rowBoxFor(id).querySelector(".page-tree-item-actions");
const rowControls = (id) => [
  ...rowBoxFor(id).querySelectorAll(".page-tree-item-actions button"),
  rowBoxFor(id).querySelector(".MuiCheckbox-root"),
];

// ============================================================================
// DEPTH -- the unbounded drill-down ruling.
// ============================================================================

describe("the unbounded drill-down: indentation is capped on phones, depth moves onto aria-level", () => {
  it("[control] renders all ten rows of a depth-9 chain", async () => {
    await render(createElement(PageTree, treeProps()));
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(10);
  });

  it("stops growing the indent past the cap at 375, so the title column has a floor at every depth", async () => {
    await render(createElement(PageTree, treeProps()));
    // 0.5 + 3 * 1.5 = 5 spacing units = 40px, and it must not move after that.
    const capped = styleAt(rowBoxFor(`d${PHONE_INDENT_MAX_DEPTH}`), PHONE, "paddingLeft");
    expect(capped).toBe("40px");
    for (const depth of [4, 6, 9]) {
      expect(styleAt(rowBoxFor(`d${depth}`), PHONE, "paddingLeft"), `depth ${depth}`).toBe(capped);
    }
  });

  it("leaves the desktop tree's uncapped indent exactly as it shipped", async () => {
    await render(createElement(PageTree, treeProps()));
    // 0.5 + 9 * 1.5 = 14 spacing units = 112px.
    expect(styleAt(rowBoxFor("d9"), DESKTOP, "paddingLeft")).toBe("112px");
    expect(styleAt(rowBoxFor("d0"), DESKTOP, "paddingLeft")).toBe("4px");
  });

  it("carries the real depth on aria-level, which is what the flattened indent stops saying", async () => {
    await render(createElement(PageTree, treeProps()));
    // 1-based, per the ARIA spec: a root treeitem is level 1.
    for (const depth of [0, 3, 4, 9]) {
      expect(rowFor(`d${depth}`).getAttribute("aria-level"), `depth ${depth}`).toBe(String(depth + 1));
    }
  });
});

// ============================================================================
// F-03 -- the row actions on a surface with no hover.
// ============================================================================

describe("F-03 -- the four row actions are reachable without a hover", () => {
  it("declares them visible and clickable at 375, and hover-only above sm", async () => {
    await render(createElement(PageTree, treeProps()));
    const actions = actionsFor("d0");

    expect(styleAt(actions, PHONE, "opacity")).toBe("1");
    expect(styleAt(actions, PHONE, "pointerEvents")).toBe("auto");

    // The desktop reveal-on-hover behaviour is deliberate and stays. If this
    // reads "1"/"auto" the phone rule was written unscoped.
    expect(styleAt(actions, DESKTOP, "opacity")).toBe("0");
    expect(styleAt(actions, DESKTOP, "pointerEvents")).toBe("none");
  });

  it("gives the actions their own line on a phone rather than competing with the title for width", async () => {
    await render(createElement(PageTree, treeProps()));
    // Four 44px targets cannot share a ~200px row with a title. The row wraps
    // and the action strip takes the full width of the next line; above `sm`
    // it stays inline exactly as it shipped.
    expect(styleAt(rowBoxFor("d0"), PHONE, "flexWrap")).toBe("wrap");
    expect(styleAt(actionsFor("d0"), PHONE, "width")).toBe("100%");
    expect(styleAt(actionsFor("d0"), DESKTOP, "width")).toBe("auto");
  });

  it("[control] all four actions plus the selection checkbox exist on every row", async () => {
    await render(createElement(PageTree, treeProps()));
    expect(rowBoxFor("d0").querySelectorAll(".page-tree-item-actions button")).toHaveLength(4);
    expect(rowBoxFor("d0").querySelector(".MuiCheckbox-root")).not.toBeNull();
    // And on the deepest row too -- a capped indent must not have cost it any.
    expect(rowBoxFor("d9").querySelectorAll(".page-tree-item-actions button")).toHaveLength(4);
  });
});

// ============================================================================
// F-05 -- touch targets on the tree row.
// ============================================================================

describe("F-05 -- every tree-row control meets the 44px floor at 375", () => {
  it("floors the four action buttons and the selection checkbox", async () => {
    await render(createElement(PageTree, treeProps()));
    const targets = rowControls("d0");
    expect(targets).toHaveLength(5);
    expect(undersized(targets, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("leaves all five at their desktop size above sm", async () => {
    await render(createElement(PageTree, treeProps()));
    // "auto" is min-height's own initial value -- the contract's `sm` branch,
    // not a plausible-looking 0.
    for (const node of rowControls("d0")) {
      expect(styleAt(node, DESKTOP, "minHeight"), name(node)).toBe("auto");
    }
  });
});

// ============================================================================
// F-08 -- the rename input's font size.
// ============================================================================

describe("F-08 -- renaming a page does not trigger iOS Safari's focus zoom", () => {
  it("computes 16px on a phone and the original 13.5px above sm", async () => {
    await render(createElement(PageTree, treeProps({ renamingId: "d0" })));
    const input = container.querySelector('input[aria-label="Page title"]');
    expect(input, "the rename input did not render").not.toBeNull();

    // Below 16px, iOS Safari zooms the whole viewport on focus and does not
    // zoom back out. This is the app's ONLY rename path.
    expect(styleAt(input, PHONE, "fontSize")).toBe("16px");
    expect(styleAt(input, DESKTOP, "fontSize")).toBe("13.5px");
  });
});

// ============================================================================
// F-10 -- MovePageDialog: the keyboard/screen-reader route to re-parenting.
// ============================================================================

describe("F-10 -- the move dialog on a phone", () => {
  // Ten rows, d0 the deepest chain, moving d9 so every ancestor is a legal
  // destination and the list actually reaches depth 8.
  const PAGES = Array.from({ length: 10 }, (_, d) => ({
    id: `d${d}`,
    parent_id: d === 0 ? null : `d${d - 1}`,
    title: `Depth ${d}`,
    position: 0,
  }));

  const dialogProps = () => ({
    open: true,
    pages: PAGES,
    page: PAGES[9],
    onClose: vi.fn(),
    onMove: vi.fn(),
  });

  // MUI portals a Dialog onto document.body, not under `container`.
  const destinations = () => [...document.querySelectorAll(".MuiListItemButton-root")];

  it("[control] offers the ancestor chain as destinations, deep ones included", async () => {
    await render(createElement(MovePageDialog, dialogProps()));
    const labels = destinations().map((n) => n.textContent);
    expect(labels).toContain("Depth 0");
    expect(labels.some((l) => /Depth 7/.test(l))).toBe(true);
  });

  it("goes fullScreen on a phone instead of a 311px paper inside a 375px viewport", async () => {
    await render(createElement(MovePageDialog, dialogProps()));
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("stays a small centred dialog above sm", async () => {
    phone = false;
    await render(createElement(MovePageDialog, dialogProps()));
    expect(document.querySelector(".MuiDialog-paperFullScreen")).toBeNull();
  });

  it("caps the destination indent on the same ruling as the tree", async () => {
    await render(createElement(MovePageDialog, dialogProps()));
    const rows = destinations();
    // MOVE_INDENT: 2 + min(depth, 3) * 2 spacing units = 16 + 16*min(d,3) px,
    // so the cap is 64px and the deepest rows must all read it.
    const deep = rows.slice(-3);
    expect(deep.length).toBe(3);
    for (const node of deep) {
      expect(pxOf(styleAt(node, PHONE, "paddingLeft")), node.textContent).toBeLessThanOrEqual(64);
    }
    // Above sm the uncapped indent is unchanged: the deepest row is deeper
    // than the cap would allow.
    expect(pxOf(styleAt(rows[rows.length - 1], DESKTOP, "paddingLeft"))).toBeGreaterThan(64);
  });

  it("floors every destination row at 44px on a phone", async () => {
    await render(createElement(MovePageDialog, dialogProps()));
    expect(undersized(destinations(), PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });
});
