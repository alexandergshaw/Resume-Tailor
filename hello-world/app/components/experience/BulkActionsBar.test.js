// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// PageTree.test.js and ExperienceTab.test.js are the precedents for
// rendering a whole component here.
//
// BulkActionsBar cannot literally reuse DeletePageDialog/MovePageDialog -
// both hard-code a single `page` prop and are outside this chunk's editable
// files - so it rebuilds their SHAPE (same FormDialog primitive and message
// cadence for delete; the same Dialog/List/ListItemButton layout for move)
// driven by lib/experience/bulkSelection.js's bulk-aware helpers instead of
// the single-page ones. These tests exercise that wiring directly, the same
// way PageTree.test.js exercises treeNav's wiring rather than re-testing
// treeNav's own pure logic.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import BulkActionsBar from "./BulkActionsBar.js";

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

function row(id, parentId, title) {
  return { id, user_id: "u1", parent_id: parentId, title, body: "", position: 0, archived_at: null, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" };
}

// Alpha
//   Boeing
//     Boeing detail
//   Ceiling
// Zulu
//   Zulu child
const PAGES = [
  row("n1", null, "Alpha"),
  row("n2", "n1", "Boeing"),
  row("n4", "n2", "Boeing detail"),
  row("n3", "n1", "Ceiling"),
  row("n7", null, "Zulu"),
  row("n8", "n7", "Zulu child"),
];

function baseProps(overrides) {
  return {
    pages: PAGES,
    selectedIds: new Set(),
    onDeleteSelected: vi.fn().mockResolvedValue({ ok: true }),
    onMoveSelected: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(BulkActionsBar, props));
  });
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function documentButtons() {
  return [...document.querySelectorAll("button")];
}

function findButton(text) {
  return documentButtons().find((b) => b.textContent.trim() === text);
}

describe("visibility", () => {
  it("renders nothing when the selection is empty", async () => {
    await render(baseProps());
    expect(container.querySelector('[role="region"]')).toBeNull();
    expect(document.querySelector('[role="region"][aria-label="Bulk actions"]')).toBeNull();
  });

  it("renders a labelled region with the count once something is checked", async () => {
    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region.getAttribute("aria-label")).toBe("Bulk actions");
    expect(region.textContent).toContain("1 selected");
  });

  it("reachable in the tab order ahead of any tree row - not nested inside a role=tree", async () => {
    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    expect(container.querySelector('[role="tree"] [role="region"]')).toBeNull();
  });
});

describe("delete selected", () => {
  it("names the deduplicated total in the confirmation, not a naive sum of selected + descendants", async () => {
    // Alpha (n1) and its own child Boeing (n2) selected together: selected=2,
    // descendants=2 (Boeing detail + Ceiling), total=4 - a naive sum would
    // read 2 selected + 4 descendants(of n1 alone) = 6, over-stating the
    // blast radius.
    await render(baseProps({ selectedIds: new Set(["n1", "n2"]) }));
    await click(findButton("Delete selected"));
    expect(document.body.textContent).toContain("Delete 4 pages? This cannot be undone.");
    expect(document.body.textContent).not.toContain("6 pages");
  });

  it("calls onDeleteSelected with every checked id", async () => {
    const onDeleteSelected = vi.fn().mockResolvedValue({ ok: true });
    await render(baseProps({ selectedIds: new Set(["n3"]), onDeleteSelected }));
    await click(findButton("Delete selected"));
    expect(document.body.textContent).toContain("Delete 1 page? This cannot be undone.");

    // MUI's Dialog keeps its node mounted through its own exit transition
    // (real CSS-driven milliseconds, not something this test's act() calls
    // advance), so asserting `[role="dialog"]` vanishes synchronously would
    // be asserting an implementation timing detail, not behaviour -
    // ExperienceTab.test.js's own move/delete tests never do that either;
    // they assert the SIDE EFFECT (here, the exact ids handed to the
    // caller) instead, which is what this test does above.
    await click(findButton("Delete"));
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(onDeleteSelected).toHaveBeenCalledWith(["n3"]);
  });

  it("keeps the dialog open and surfaces the reason when the delete fails", async () => {
    const onDeleteSelected = vi.fn().mockResolvedValue({ ok: false, error: "2 of 2 pages could not be deleted." });
    await render(baseProps({ selectedIds: new Set(["n1", "n7"]), onDeleteSelected }));
    await click(findButton("Delete selected"));
    await click(findButton("Delete"));

    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("2 of 2 pages could not be deleted.");
  });
});

describe("move selected", () => {
  it("disables Move with a stated reason when no destination fits every selected page", async () => {
    const onMoveSelected = vi.fn();
    const all = new Set(PAGES.map((p) => p.id));
    await render(baseProps({ selectedIds: all, onMoveSelected }));

    const moveBtn = findButton("Move selected");
    expect(moveBtn).toBeDefined();
    expect(moveBtn.getAttribute("aria-disabled")).toBe("true");
    // B3-style: aria-disabled, never the native `disabled` attribute, so a
    // keyboard user can still reach (and hear) the explanation.
    expect(moveBtn.disabled).toBe(false);
    const describedBy = moveBtn.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy).textContent).toContain("No destination fits every selected page.");

    await click(moveBtn);
    expect(container.querySelector('[aria-label="Move to"]')).toBeNull();
    expect(onMoveSelected).not.toHaveBeenCalled();
  });

  it("lists legal destinations and moves on the first click", async () => {
    const onMoveSelected = vi.fn();
    await render(baseProps({ selectedIds: new Set(["n3"]), onMoveSelected }));

    const moveBtn = findButton("Move selected");
    expect(moveBtn.getAttribute("aria-disabled")).toBeNull();
    await click(moveBtn);

    const zuluTarget = [...document.querySelectorAll('[aria-label="Move to"] [role="button"]')].find(
      (b) => b.textContent.trim() === "Zulu",
    );
    expect(zuluTarget).toBeDefined();
    await click(zuluTarget);

    // Fire-and-close, same as MovePageDialog's own choose(): the move is
    // requested with no spinner and no await, one click after the picker
    // opens - the same click cost the single-page Move flow already has.
    expect(onMoveSelected).toHaveBeenCalledTimes(1);
    expect(onMoveSelected).toHaveBeenCalledWith(["n3"], "n7");
  });
});

describe("Research report and PowerPoint seams", () => {
  it("are visible, named, and disabled with a stated reason rather than silently absent", async () => {
    await render(baseProps({ selectedIds: new Set(["n1"]) }));
    for (const label of ["Research report", "PowerPoint"]) {
      const btn = findButton(label);
      expect(btn).toBeDefined();
      expect(btn.getAttribute("aria-disabled")).toBe("true");
      expect(btn.disabled).toBe(false);
      const describedBy = btn.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy).textContent.length).toBeGreaterThan(0);
    }
  });
});
