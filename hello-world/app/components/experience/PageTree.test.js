// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/JobDescriptionTab.test.js is the precedent for rendering a
// whole component here.
//
// These acceptance criteria ARE the markup and cannot be extracted into a pure
// function: which element carries aria-expanded, how many nodes are in the tab
// order, whether arrow keys actually move DOM focus. The keyboard DECISIONS
// live in lib/experience/treeNav.js and are unit-tested there without a DOM;
// what this file tests is the WIRING between that module and the rendered tree,
// which is invisible to both sets of pure tests by construction. Two correct,
// separately-tested halves joined wrong is a defect this codebase has shipped
// before.
//
// The pattern being implemented is the W3C APG tree view:
// https://www.w3.org/WAI/ARIA/apg/patterns/treeview/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PageTree from "./PageTree.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});

const node = (id, title, children = []) => ({ id, title, children });

// alpha            expanded
//   a1             collapsed, has a child
//     a1x          hidden while a1 is collapsed
//   a2             leaf
// beta             top-level leaf
const TREE = [
  node("alpha", "Alpha", [node("a1", "A1", [node("a1x", "A1x")]), node("a2", "A2")]),
  node("beta", "Beta"),
];

function baseProps(overrides) {
  return {
    tree: TREE,
    selectedId: null,
    expandedIds: new Set(["alpha"]),
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(PageTree, props));
  });
}

const items = () => [...container.querySelectorAll('[role="treeitem"]')];
const itemFor = (id) => container.querySelector(`[role="treeitem"][data-page-id="${id}"]`);

// `cancelable: true` matters: without it preventDefault is a no-op and
// `defaultPrevented` reads false no matter what the component does, so the
// keyboard-trap test below would pass against any implementation.
async function press(el, key) {
  const evt = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    el.dispatchEvent(evt);
  });
  return evt;
}

describe("tree structure", () => {
  it("uses the tree roles and labels the tree itself", async () => {
    await render(baseProps());
    const tree = container.querySelector('[role="tree"]');
    expect(tree).not.toBeNull();
    expect(tree.getAttribute("aria-label")).toBeTruthy();
    expect(container.querySelectorAll('[role="group"]').length).toBeGreaterThan(0);
    expect(items().map((el) => el.getAttribute("data-page-id"))).toEqual([
      "alpha",
      "a1",
      "a2",
      "beta",
    ]);
  });

  it("gives every node an accessible name that is its own title", async () => {
    // aria-label rather than name-from-contents: a parent treeitem CONTAINS its
    // children's group, so a name computed from contents would read out the
    // whole subtree. Five nodes all announcing "Alpha A1 A2" is the failure this
    // prevents.
    await render(baseProps());
    expect(items().map((el) => el.getAttribute("aria-label"))).toEqual([
      "Alpha",
      "A1",
      "A2",
      "Beta",
    ]);
  });

  it("puts aria-expanded on parents ONLY, never on a leaf", async () => {
    await render(baseProps());
    expect(itemFor("alpha").getAttribute("aria-expanded")).toBe("true");
    expect(itemFor("a1").getAttribute("aria-expanded")).toBe("false");
    // A leaf carrying aria-expanded="false" is announced as a collapsed parent
    // that never opens. The attribute must be ABSENT, not false.
    expect(itemFor("a2").hasAttribute("aria-expanded")).toBe(false);
    expect(itemFor("beta").hasAttribute("aria-expanded")).toBe(false);
  });

  it("does not render the children of a collapsed node", async () => {
    await render(baseProps());
    expect(itemFor("a1x")).toBeNull();
    // Positive control: the same node appears once a1 is expanded, so this is
    // about collapse and not about the component failing to nest at all.
    await render(baseProps({ expandedIds: new Set(["alpha", "a1"]) }));
    expect(itemFor("a1x")).not.toBeNull();
  });
});

describe("roving tabindex", () => {
  it("keeps exactly one node in the tab order", async () => {
    await render(baseProps({ selectedId: "a2" }));
    const zero = items().filter((el) => el.getAttribute("tabindex") === "0");
    expect(zero).toHaveLength(1);
    expect(zero[0].getAttribute("data-page-id")).toBe("a2");
    expect(
      items()
        .filter((el) => el.getAttribute("data-page-id") !== "a2")
        .map((el) => el.getAttribute("tabindex")),
    ).toEqual(["-1", "-1", "-1"]);
  });

  it("falls back to the first node when nothing is selected", async () => {
    await render(baseProps({ selectedId: null }));
    const zero = items().filter((el) => el.getAttribute("tabindex") === "0");
    expect(zero).toHaveLength(1);
    expect(zero[0].getAttribute("data-page-id")).toBe("alpha");
  });

  it("marks the selected node, and only that node, as selected", async () => {
    await render(baseProps({ selectedId: "a2" }));
    expect(items().map((el) => el.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
  });
});

describe("keyboard wiring", () => {
  it("moves real DOM focus down and up the visible nodes", async () => {
    await render(baseProps({ selectedId: "alpha" }));
    const start = itemFor("alpha");
    start.focus();
    expect(document.activeElement).toBe(start);

    await press(start, "ArrowDown");
    expect(document.activeElement).toBe(itemFor("a1"));

    await press(document.activeElement, "ArrowDown");
    expect(document.activeElement).toBe(itemFor("a2"));

    await press(document.activeElement, "ArrowUp");
    expect(document.activeElement).toBe(itemFor("a1"));
  });

  it("skips the hidden children of a collapsed node when moving down", async () => {
    await render(baseProps({ selectedId: "a1" }));
    const a1 = itemFor("a1");
    a1.focus();
    await press(a1, "ArrowDown");
    // a1x exists in the data but is collapsed away, so the next stop is a2.
    expect(document.activeElement).toBe(itemFor("a2"));
  });

  it("expands a closed parent with ArrowRight instead of selecting it", async () => {
    const props = baseProps({ selectedId: "a1" });
    await render(props);
    const a1 = itemFor("a1");
    a1.focus();
    await press(a1, "ArrowRight");
    expect(props.onToggle).toHaveBeenCalledWith("a1");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("descends into an already-open parent with ArrowRight rather than toggling it", async () => {
    const props = baseProps({ selectedId: "alpha" });
    await render(props);
    const alpha = itemFor("alpha");
    alpha.focus();
    await press(alpha, "ArrowRight");
    expect(document.activeElement).toBe(itemFor("a1"));
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("goes to the parent with ArrowLeft from a leaf", async () => {
    const props = baseProps({ selectedId: "a2" });
    await render(props);
    const a2 = itemFor("a2");
    a2.focus();
    await press(a2, "ArrowLeft");
    expect(document.activeElement).toBe(itemFor("alpha"));
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("selects the focused node on Enter and on Space", async () => {
    const props = baseProps({ selectedId: "a2" });
    await render(props);
    const a2 = itemFor("a2");
    a2.focus();
    await press(a2, "Enter");
    expect(props.onSelect).toHaveBeenCalledWith("a2");

    props.onSelect.mockClear();
    await press(itemFor("a2"), " ");
    expect(props.onSelect).toHaveBeenCalledWith("a2");
  });

  it("consumes the keys it owns and leaves Tab alone", async () => {
    // A tree that calls preventDefault on Tab is a keyboard trap - focus can
    // never leave it. jsdom will not move focus on a synthetic Tab either way,
    // so the only way to see the difference is defaultPrevented.
    const props = baseProps({ selectedId: "a1" });
    await render(props);
    const a1 = itemFor("a1");
    a1.focus();

    expect((await press(a1, "ArrowDown")).defaultPrevented).toBe(true);
    expect((await press(document.activeElement, "Tab")).defaultPrevented).toBe(false);
    expect((await press(document.activeElement, "Escape")).defaultPrevented).toBe(false);
  });
});

describe("row action buttons", () => {
  // Add sub-page, Rename, Delete and Move are all reachable by mouse
  // (visible on hover) but must ALSO track the tree's own roving tabindex,
  // exactly like the treeitem rows themselves - only the row currently
  // holding the roving tabindex exposes its four actions to Tab; every other
  // row's actions carry tabindex -1. A hardcoded -1 on any one of them is a
  // mouse-only control, invisible to a keyboard user no matter how the tree
  // itself is focused.
  //
  // `.firstElementChild` scopes the query to THIS row's own row-content div,
  // not the whole treeitem subtree - a parent's <li> structurally CONTAINS
  // its nested role="group" children, so an unscoped querySelectorAll would
  // also pick up every descendant row's buttons.
  //
  // NOTE: this test used to assert the actions track `selectedId`. That was
  // the bug (D1, round three of it): arrowing through the tree moves real
  // DOM focus without ever touching `selectedId` (only Enter/Space/click do
  // that), so a roving tabindex keyed off `selectedId` leaves every tab stop
  // sitting before the actually-focused row in DOM order - Tab from the
  // focused row exits the tree entirely, and that row's own four actions are
  // unreachable by keyboard. The W3C APG rule is "tabindex follows focus",
  // not selection, so this test now drives focus with an arrow key - away
  // from the selected row - and asserts the actions follow FOCUS.
  it("puts the four row actions in the tab order only for the row holding the roving tabindex, following focus rather than selection", async () => {
    const props = baseProps({ selectedId: "alpha" });
    await render(props);
    const alpha = itemFor("alpha");
    alpha.focus();
    // One ArrowDown moves DOM focus onto a1 without changing selection at
    // all - `props.onSelect` is never called by an arrow key.
    await press(alpha, "ArrowDown");
    expect(document.activeElement).toBe(itemFor("a1"));
    expect(props.onSelect).not.toHaveBeenCalled();

    const rowButtons = (id) => [...itemFor(id).firstElementChild.querySelectorAll("button")];

    const focusedButtons = rowButtons("a1");
    expect(focusedButtons).toHaveLength(4);
    expect(focusedButtons.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "0", "0", "0"]);

    // "alpha" is still `selectedId` - under the bug, ITS actions (not a1's)
    // would be the ones carrying tabindex 0.
    for (const id of ["alpha", "a2", "beta"]) {
      const buttons = rowButtons(id);
      expect(buttons).toHaveLength(4);
      expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "-1", "-1", "-1"]);
    }
  });

  it("still falls back to selectedId's actions before any keyboard focus has moved", async () => {
    // Nothing has been focused via the tree's own key handling yet, so the
    // roving tabindex has nothing to "follow" - it should track selection,
    // same as before this fix, until the user actually presses a key.
    await render(baseProps({ selectedId: "a2" }));
    const rowButtons = (id) => [...itemFor(id).firstElementChild.querySelectorAll("button")];
    expect(rowButtons("a2").map((b) => b.getAttribute("tabindex"))).toEqual(["0", "0", "0", "0"]);
  });

  // D2: the actions box used to be hidden with `visibility: hidden`, which
  // removes content from the accessibility tree entirely - a screen-reader
  // user browsing with a virtual cursor would find zero row actions anywhere
  // in the tree, on every row including the selected one. jsdom does not
  // compute `visibility` the way a browser does, so this does not read
  // computed style; it reads the actual CSS text MUI/emotion injected into
  // <style> tags, which is the real mechanism regardless of what jsdom's
  // layout engine can or can't compute.
  it("hides the actions box with a mechanism that keeps it in the accessibility tree, not visibility:hidden", async () => {
    await render(baseProps({ selectedId: "a2" }));
    const actionsBox = itemFor("a2").querySelector(".page-tree-item-actions");
    expect(actionsBox).not.toBeNull();

    const cssText = [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("\n");

    // The box's OWN generated class carries its resting (unrevealed) style.
    const ownClass = [...actionsBox.classList].find((c) => c.startsWith("css-") && !c.includes("Mui"));
    expect(ownClass).toBeTruthy();
    const restRuleMatch = new RegExp(`\\.${ownClass}\\{([^}]*)\\}`).exec(cssText);
    expect(restRuleMatch).not.toBeNull();
    const restRule = restRuleMatch[1];
    expect(restRule).not.toMatch(/visibility\s*:\s*hidden/);
    expect(restRule).toMatch(/opacity\s*:\s*0/);

    // The hover/focus-within reveal rules must still exist and target this
    // same class by name, restoring full visibility for sighted mouse and
    // keyboard users.
    expect(cssText).toMatch(/:hover \.page-tree-item-actions\{[^}]*opacity:1/);
    expect(cssText).toMatch(/:focus-within \.page-tree-item-actions\{[^}]*opacity:1/);
  });

  // D3: "Add sub-page" and "Rename" used to be passed to Tooltip verbatim,
  // so every row in the tree announced the identical name for those two
  // buttons - a screen reader's element list showed N indistinguishable
  // "Rename" buttons. Delete and Move already interpolated the title; this
  // asserts all four now do, by checking the names are distinct across rows
  // (a set of N buttons must produce a set of N distinct names), not merely
  // non-empty.
  it("gives every row's action buttons a distinct accessible name that identifies the page", async () => {
    await render(baseProps({ selectedId: "a2" }));
    const allButtons = items().flatMap((row) => [...row.firstElementChild.querySelectorAll("button")]);
    expect(allButtons).toHaveLength(16); // 4 rows x 4 actions
    const names = allButtons.map((b) => b.getAttribute("aria-label"));
    expect(names.every((n) => !!n && n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("inline rename focus (D4)", () => {
  // Both Enter (commit) and Escape (cancel) used to clear `renamingId`
  // without ever restoring focus, unmounting the input mid-keystroke and
  // stranding `document.activeElement` on `document.body`. APG requires
  // Escape on an inline edit to return focus to the treeitem it came from,
  // so cancelling must not be punished harder than committing.
  it("returns focus to the row after committing a rename with Enter", async () => {
    await render(baseProps({ selectedId: "a2", renamingId: "a2" }));
    const input = container.querySelector('[aria-label="Page title"]');
    expect(input).not.toBeNull();
    input.focus();
    expect(document.activeElement).toBe(input);

    await press(input, "Enter");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(itemFor("a2"));
  });

  it("returns focus to the row after cancelling a rename with Escape", async () => {
    await render(baseProps({ selectedId: "a2", renamingId: "a2" }));
    const input = container.querySelector('[aria-label="Page title"]');
    expect(input).not.toBeNull();
    input.focus();
    expect(document.activeElement).toBe(input);

    await press(input, "Escape");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(itemFor("a2"));
  });
});

// Chunk 8: a checkbox per row for bulk selection, kept deliberately separate
// from `selectedId`/aria-selected (which page is open in the editor) and
// from the tree's own roving tabindex model (which row is the Tab stop).
describe("bulk-selection checkboxes", () => {
  const checkboxFor = (id) => itemFor(id).querySelector('input[type="checkbox"]');

  it("gives every row's checkbox a distinct accessible name naming the page", async () => {
    await render(baseProps({ selectedId: "a2" }));
    const boxes = items().map((el) => el.querySelector('input[type="checkbox"]'));
    expect(boxes.every(Boolean)).toBe(true);
    const names = boxes.map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Select Alpha", "Select A1", "Select A2", "Select Beta"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("checks only the rows named in selectedPageIds, independently of aria-selected", async () => {
    // a2 is the SELECTED (viewed) page; a1 is the CHECKED (bulk-selection)
    // page. If either idea leaked into the other, one of these two
    // assertions would flip.
    await render(baseProps({ selectedId: "a2", selectedPageIds: new Set(["a1"]) }));
    expect(checkboxFor("a1").checked).toBe(true);
    expect(checkboxFor("a2").checked).toBe(false);
    expect(itemFor("a1").getAttribute("aria-selected")).toBe("false");
    expect(itemFor("a2").getAttribute("aria-selected")).toBe("true");
  });

  it("does not implicitly check a parent's children", async () => {
    // alpha has two children (a1, a2); checking alpha alone must not also
    // show a1/a2 as checked - the parent component owns exactly what
    // `selectedPageIds` contains, and this row must render precisely that.
    await render(baseProps({ selectedId: "a2", selectedPageIds: new Set(["alpha"]) }));
    expect(checkboxFor("alpha").checked).toBe(true);
    expect(checkboxFor("a1").checked).toBe(false);
    expect(checkboxFor("a2").checked).toBe(false);
  });

  it("reports which row was toggled without touching page selection", async () => {
    const props = baseProps({ selectedId: "a2", onToggleSelect: vi.fn() });
    await render(props);
    await act(async () => {
      checkboxFor("a1").click();
    });
    expect(props.onToggleSelect).toHaveBeenCalledWith("a1");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("follows the roving tabindex, exactly like the four row action buttons", async () => {
    const props = baseProps({ selectedId: "alpha" });
    await render(props);
    const alpha = itemFor("alpha");
    alpha.focus();
    await press(alpha, "ArrowDown");
    expect(document.activeElement).toBe(itemFor("a1"));

    expect(checkboxFor("a1").getAttribute("tabindex")).toBe("0");
    for (const id of ["alpha", "a2", "beta"]) {
      expect(checkboxFor(id).getAttribute("tabindex")).toBe("-1");
    }
  });

  it("never makes every row's checkbox a tab stop at once", async () => {
    await render(baseProps({ selectedId: "a2" }));
    const zero = items()
      .map((el) => el.querySelector('input[type="checkbox"]'))
      .filter((b) => b.getAttribute("tabindex") === "0");
    expect(zero).toHaveLength(1);
  });

  it("clears the whole selection on Escape from a focused row", async () => {
    const props = baseProps({ selectedId: "a1", onClearSelection: vi.fn() });
    await render(props);
    const a1 = itemFor("a1");
    a1.focus();
    await press(a1, "Escape");
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("also clears on Escape when focus is on a row's own checkbox", async () => {
    const props = baseProps({ selectedId: "a1", onClearSelection: vi.fn() });
    await render(props);
    checkboxFor("a1").focus();
    await press(checkboxFor("a1"), "Escape");
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });
});
