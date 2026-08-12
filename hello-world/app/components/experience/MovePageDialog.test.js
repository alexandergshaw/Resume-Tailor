// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/experience/PageTree.test.js is the precedent.
//
// lib/experience/moveTargets.js already has its own DOM-free test suite
// (lib/experience/moveTargets.test.js) covering the legality rules as pure
// data. What that file cannot see is the WIRING this dialog does with that
// data: whether every returned target actually becomes a clickable, labelled
// row, in the same order, and whether choosing one calls back with the exact
// values moveTargets produced - in particular that "Top level" (`id: null`)
// survives the round trip as the real value `null`, not a stringified or
// dropped one. Two correct, separately-tested halves joined wrong is a
// defect class this codebase has shipped before (see PageTree.test.js).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import MovePageDialog from "./MovePageDialog.js";
import { moveTargets } from "../../../lib/experience/moveTargets.js";

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

async function render(props) {
  await act(async () => {
    root.render(createElement(MovePageDialog, props));
  });
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// MUI's Dialog portals its content onto document.body (Modal's default
// container), which is OUTSIDE the `container` div this test mounts its root
// into - so the dialog markup must be queried from `document`, not
// `container`.
function dialogRoot() {
  return document.querySelector('[role="dialog"]');
}

function listButtons() {
  return [...document.querySelectorAll('[aria-label="Move to"] [role="button"]')];
}

// A five-page tree, deep enough to exercise ordering, depth, and the "Top
// level" / real-destination distinction in one fixture:
//   Root A (r1)
//     Child One (c1)
//       Grandkid (g1)
//     Child Two (c2)
//   Root B (r2)
const PAGES = [
  { id: "r1", parent_id: null, title: "Root A", position: 0, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "c1", parent_id: "r1", title: "Child One", position: 0, created_at: "2026-01-02T00:00:00.000Z" },
  { id: "g1", parent_id: "c1", title: "Grandkid", position: 0, created_at: "2026-01-03T00:00:00.000Z" },
  { id: "c2", parent_id: "r1", title: "Child Two", position: 1, created_at: "2026-01-04T00:00:00.000Z" },
  { id: "r2", parent_id: null, title: "Root B", position: 1, created_at: "2026-01-05T00:00:00.000Z" },
];

const SOLO_PAGE = [{ id: "solo", parent_id: null, title: "Solo Page", position: 0, created_at: "2026-01-01T00:00:00.000Z" }];

describe("MovePageDialog -- destinations", () => {
  it("lists every destination moveTargets returns, in order, each as a real button labelled with the full path", async () => {
    const page = PAGES.find((p) => p.id === "c1");
    const expected = moveTargets(PAGES, "c1");
    // Ground truth for this fixture, pinned so a future change to moveTargets
    // itself is visible here too, not just in its own test file.
    expect(expected.map((t) => t.label)).toEqual(["Top level", "Root A / Child Two", "Root B"]);

    await render({ open: true, pages: PAGES, page, onClose: vi.fn(), onMove: vi.fn() });

    const items = listButtons();
    expect(items).toHaveLength(expected.length);
    expect(items.map((el) => el.textContent.trim())).toEqual(expected.map((t) => t.label));
  });

  it('passes null - not the string "null", not undefined - when "Top level" is chosen', async () => {
    const page = PAGES.find((p) => p.id === "c1");
    const onMove = vi.fn();
    const onClose = vi.fn();
    await render({ open: true, pages: PAGES, page, onClose, onMove });

    const items = listButtons();
    expect(items[0].textContent.trim()).toBe("Top level");
    await click(items[0]);

    expect(onMove).toHaveBeenCalledTimes(1);
    const [movedId, destinationId] = onMove.mock.calls[0];
    expect(movedId).toBe("c1");
    expect(destinationId).toBeNull();
    expect(destinationId).not.toBe("null");
    expect(destinationId).not.toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onMove with the page id and the chosen destination's id for a real destination", async () => {
    const page = PAGES.find((p) => p.id === "c1");
    const onMove = vi.fn();
    await render({ open: true, pages: PAGES, page, onClose: vi.fn(), onMove });

    const items = listButtons();
    expect(items[2].textContent.trim()).toBe("Root B");
    await click(items[2]);

    expect(onMove).toHaveBeenCalledWith("c1", "r2");
  });
});

describe("MovePageDialog -- dialog semantics", () => {
  it("has an accessible name, and Escape closes it", async () => {
    const onClose = vi.fn();
    const page = PAGES.find((p) => p.id === "c1");
    await render({ open: true, pages: PAGES, page, onClose, onMove: vi.fn() });

    const dialog = dialogRoot();
    expect(dialog).not.toBeNull();
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const titleEl = document.getElementById(labelledBy);
    expect(titleEl).not.toBeNull();
    expect(titleEl.textContent).toBe("Move “Child One”");

    await act(async () => {
      dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an explanatory empty state, not an empty dialog, when a page has no legal destinations", async () => {
    const page = SOLO_PAGE[0];
    expect(moveTargets(SOLO_PAGE, "solo")).toEqual([]);

    await render({ open: true, pages: SOLO_PAGE, page, onClose: vi.fn(), onMove: vi.fn() });

    const dialog = dialogRoot();
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("There is nowhere else to move this page.");
    expect(document.querySelectorAll('[aria-label="Move to"]').length).toBe(0);
    expect(listButtons()).toEqual([]);
  });
});
