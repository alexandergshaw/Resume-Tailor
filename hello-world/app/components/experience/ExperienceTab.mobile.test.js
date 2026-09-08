// @vitest-environment jsdom
//
// SURFACE F, PART 2 -- THE EXPERIENCE TAB'S MASTER/DETAIL LAYOUT ON A PHONE.
//
// Two findings from the mobile audit (MOBILE-F), which are the same layout
// decision seen from two angles:
//
//   F-04  `direction={{ xs: "column", md: "row" }}` turns master/detail into
//         "the whole tree, then the whole editor". Selecting a row changes an
//         editor hundreds of pixels below the fold, with no scroll-into-view,
//         no announcement, and no way back to the list. With twenty pages the
//         editor starts well past 900px down.
//   F-02  `BulkActionsBar` is rendered BEFORE `TechWatchPanel` and
//         `MeetingPanel`, which are before the tree. The bar only appears once
//         a tree checkbox is ticked. In the stacked phone layout those two
//         panels sit between the checkbox and the bar, so ticking a box makes
//         a bar appear far above the fold: the user taps and observably
//         nothing happens.
//
// THE SHAPE THIS PINS. Below `sm` the tab becomes a SINGLE-PANE ROUTER keyed
// on `selectedId`: the tree when nothing is selected, the page (with an
// explicit "All pages" control) when something is. That is a layout
// reduction, not a capability reduction -- every action stays reachable. At
// `md` and up the shipped two-pane layout is untouched, which the desktop
// block below pins directly.
//
// `KnowledgePanel` is the one thing that must render in BOTH phone states:
// its scope is the root of the knowledge base OR one page, so an anchor
// inside the selected-page branch would mean the root scope never rendered a
// panel at all -- and it must mount EXACTLY ONCE, because a second mount is a
// second auto-generate trigger and a second paid model call for one scope
// (see ExperienceTab.js's own comment on that anchor). Both halves are
// asserted below.
//
// BROWSER-ONLY, not simulated by anything here:
//   MC-F5  with twenty pages at 375x812, `pageEditorRoot
//          .getBoundingClientRect().top`. Predicted > 900px before the router,
//          and within the first viewport after it. jsdom returns zeros for
//          every rect, so no assertion in this file can see it.
//   MC-F6  the rendered distance between a tree checkbox and the bulk bar.
//          This file pins DOM ADJACENCY, which is the thing a test can hold;
//          the pixel gap is a browser read.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./PageEditor", async () => (await import("./experienceTabTestHarness.js")).pageEditorMockModule());
vi.mock("./AttachmentPanel", async () => (await import("./experienceTabTestHarness.js")).attachmentPanelMockModule());

// The three panels that are not what this file is about. Each is replaced by a
// countable marker: TechWatch and Meeting so DOM ORDER around the bulk bar can
// be asserted without their network behaviour, and KnowledgePanel so the
// "exactly one mount" invariant is countable at all.
vi.mock("./KnowledgePanel", () => ({
  default: function MockKnowledgePanel({ scopePageId }) {
    return <div data-testid="mock-knowledge" data-scope={scopePageId || ""} />;
  },
}));
vi.mock("./TechWatchPanel", () => ({
  default: function MockTechWatchPanel() {
    return <div data-testid="mock-techwatch" />;
  },
}));
vi.mock("../../meeting/MeetingPanel", () => ({
  default: function MockMeetingPanel() {
    return <div data-testid="mock-meeting" />;
  },
}));

import ExperienceTab from "./ExperienceTab.js";
import {
  flush,
  jsonResponse,
  click,
  PAGE_ROOT,
  PAGE_SIBLING,
  domHelpers,
  makeRender,
} from "./experienceTabTestHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let phone = true;
const { buttons } = domHelpers(() => container);
const render = makeRender(() => root, ExperienceTab);

beforeEach(() => {
  phone = true;
  // jsdom implements no matchMedia at all, so without this stub MUI's
  // useMediaQuery returns its `defaultMatches: false` -- which is exactly why
  // every EXISTING ExperienceTab test keeps taking the desktop branch.
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
  global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING] }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete global.fetch;
  delete window.matchMedia;
  vi.restoreAllMocks();
});

const tree = () => container.querySelector('[role="tree"]');
const editor = () => container.querySelector('[data-testid="mock-page-editor"]');
const knowledge = () => [...container.querySelectorAll('[data-testid="mock-knowledge"]')];
const bulkBar = () => container.querySelector('[role="region"][aria-label="Bulk actions"]');
const rowFor = (id) => container.querySelector(`[role="treeitem"][data-page-id="${id}"]`);
const backButton = () => buttons().find((b) => /all pages/i.test(b.textContent));

async function open(id) {
  await render();
  await flush();
  await click(rowFor(id));
}

// ============================================================================
// F-04 -- the single-pane router.
// ============================================================================

describe("F-04 -- below sm the tab is a single-pane router, not a stack of both panes", () => {
  it("shows the tree and no editor while nothing is selected", async () => {
    await render();
    await flush();

    expect(tree()).not.toBeNull();
    expect(editor()).toBeNull();
    // Nothing to go back to yet.
    expect(backButton()).toBeUndefined();
  });

  it("swaps the tree out for the page once a row is tapped", async () => {
    await open("p1");

    expect(editor()).not.toBeNull();
    expect(editor().getAttribute("data-page-id")).toBe("p1");
    // The defect being fixed: the tree stayed mounted above the editor, so
    // the editor started hundreds of pixels below the fold with no cue that
    // anything had changed.
    expect(tree()).toBeNull();
  });

  it("offers an explicit way back to the list, which returns to the tree", async () => {
    await open("p1");

    const back = backButton();
    expect(back, "no 'All pages' control on the phone detail pane").toBeDefined();
    await click(back);

    expect(tree()).not.toBeNull();
    expect(editor()).toBeNull();
  });

  it("names the back control accessibly rather than relying on a bare glyph", async () => {
    await open("p1");
    const back = backButton();
    const label = back.getAttribute("aria-label") || back.textContent;
    expect(label.trim().length).toBeGreaterThan(3);
  });
});

describe("F-04 -- creating a page does not leave a stale inline rename behind the router", () => {
  // The interaction the single-pane router introduces, and the reason it is
  // pinned rather than left to be noticed: `handleCreate` opens the new page
  // AND asks the tree for an inline rename. On desktop both happen at once,
  // side by side. On a phone, opening the page UNMOUNTS the tree, so the
  // rename input never renders -- and `renamingId` would still be set when
  // the user pressed "All pages", popping a focused, text-selected input onto
  // a screen they had just navigated to, with the soft keyboard, unasked.
  //
  // The phone rename surface is PageEditor's own Title field, which the new
  // page's editor is already showing.
  it("returns to a plain list, with no rename input, after creating a page", async () => {
    global.fetch = vi.fn(async (url, init) => {
      if (init && init.method === "POST") {
        return jsonResponse(200, { page: { ...PAGE_ROOT, id: "new-1", title: "Untitled page" } });
      }
      return jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING] });
    });
    await render();
    await flush();

    const create = buttons().find((b) => /New top-level page/i.test(b.textContent));
    expect(create, "no create action in the header").toBeDefined();
    await click(create);
    await flush();

    // We are on the detail pane for the new page...
    expect(editor()).not.toBeNull();
    expect(tree()).toBeNull();

    await click(backButton());

    // ...and back on a normal list, not one with a rename input open on it.
    expect(tree()).not.toBeNull();
    // NOT VACUOUS: the new page's row really is in the tree we came back to,
    // so "no rename input" is a statement about that row's state and not
    // about a row that never rendered.
    expect(rowFor("new-1"), "the created page is missing from the tree").not.toBeNull();
    expect(container.querySelector('input[aria-label="Page title"]')).toBeNull();
  });

  it("[control] the tree DOES render an inline rename when one is genuinely open", async () => {
    // The falsifier for the assertion above: if this cannot find a rename
    // input either, the selector is wrong and the test above proves nothing.
    // Desktop, where create keeps both panes mounted and the inline rename is
    // the intended surface.
    phone = false;
    global.fetch = vi.fn(async (url, init) => {
      if (init && init.method === "POST") {
        return jsonResponse(200, { page: { ...PAGE_ROOT, id: "new-1", title: "Untitled page" } });
      }
      return jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING] });
    });
    await render();
    await flush();

    await click(buttons().find((b) => /New top-level page/i.test(b.textContent)));
    await flush();

    expect(container.querySelector('input[aria-label="Page title"]')).not.toBeNull();
  });
});

describe("F-04 -- the knowledge panel mounts exactly once, in both phone states", () => {
  it("renders it at root scope while the tree is showing", async () => {
    await render();
    await flush();

    expect(knowledge()).toHaveLength(1);
    expect(knowledge()[0].getAttribute("data-scope")).toBe("");
  });

  it("renders exactly one, scoped to the page, once a page is open", async () => {
    await open("p1");

    // Two mounts would be two auto-generate triggers and two paid model calls
    // for one scope -- see ExperienceTab.js's own comment on this anchor.
    expect(knowledge()).toHaveLength(1);
    expect(knowledge()[0].getAttribute("data-scope")).toBe("p1");
  });
});

describe("F-04 -- the two-pane desktop layout is untouched", () => {
  it("keeps the tree AND the editor mounted together above sm, with no back control", async () => {
    phone = false;
    await open("p1");

    expect(tree()).not.toBeNull();
    expect(editor()).not.toBeNull();
    expect(backButton()).toBeUndefined();
    expect(knowledge()).toHaveLength(1);
  });
});

// ============================================================================
// F-02 -- where the bulk bar appears relative to the checkbox that summons it.
// ============================================================================

describe("F-02 -- the bulk actions bar appears next to the checkboxes that summon it", () => {
  async function tickFirstCheckbox() {
    await render();
    await flush();
    const box = container.querySelector('input[aria-label="Select Root Page"]');
    expect(box, "no bulk-selection checkbox on the tree row").not.toBeNull();
    await click(box);
  }

  it("[control] the bar is absent until something is checked", async () => {
    await render();
    await flush();
    expect(bulkBar()).toBeNull();
  });

  it("renders it immediately before the tree on a phone, not above two unrelated panels", async () => {
    await tickFirstCheckbox();
    const bar = bulkBar();
    expect(bar, "the bulk bar did not appear").not.toBeNull();

    // The defect: TechWatchPanel and MeetingPanel sat BETWEEN the checkbox and
    // the bar in the single-column layout. Adjacency is the part a test can
    // hold; the pixel gap is MC-F6.
    expect(bar.nextElementSibling, "the bar is not adjacent to the tree pane").not.toBeNull();
    expect(bar.nextElementSibling.querySelector('[role="tree"]')).not.toBeNull();

    // ...and still ahead of every tree row in DOM/tab order, which is the
    // property ExperienceTab.js's own comment on this element asks for.
    const rows = [...container.querySelectorAll('[role="treeitem"]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Node.DOCUMENT_POSITION_FOLLOWING === 4
      expect(bar.compareDocumentPosition(row) & 4, "a tree row precedes the bulk bar").toBe(4);
    }
  });

  it("keeps its shipped position above the two panels on desktop", async () => {
    phone = false;
    await tickFirstCheckbox();
    const bar = bulkBar();
    expect(bar).not.toBeNull();

    const techwatch = container.querySelector('[data-testid="mock-techwatch"]');
    const meeting = container.querySelector('[data-testid="mock-meeting"]');
    expect(bar.compareDocumentPosition(techwatch) & 4).toBe(4);
    expect(bar.compareDocumentPosition(meeting) & 4).toBe(4);
  });
});
