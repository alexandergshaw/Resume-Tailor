// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/JobDescriptionTab.test.js and app/components/experience/
// PageTree.test.js are the precedents for rendering a whole component here.
//
// This is the tab SHELL: loading/signed-out/empty states, the breadcrumb ->
// selection wiring between ExperienceTab and its real useExperiencePages
// hook, and an accessible-name audit of every button it renders. PageEditor
// and AttachmentPanel are contract stubs owned by other chunks (chunks 3 and
// 4), so they are mocked out here - a failure inside either of them must
// never be reported as a failure of this tab. PageTree is left real: its own
// wiring is PageTree.test.js's job, but ExperienceTab's breadcrumb-click ->
// selection behaviour can only be observed by going through the real tree.
//
// The Ask AI wiring (its own Supabase download path and fixtures) lives in
// the sibling ExperienceTab.askAi.test.js. Both files share their fixtures
// and helpers (PAGE_ROOT/PAGE_CHILD/PAGE_SIBLING, flush/click/jsonResponse,
// the PageEditor/AttachmentPanel mock bodies, etc.) via
// ./experienceTabTestHarness.js so the two files can never drift onto
// different assumptions about the same fixtures.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./PageEditor", async () => (await import("./experienceTabTestHarness.js")).pageEditorMockModule());
vi.mock("./AttachmentPanel", async () => (await import("./experienceTabTestHarness.js")).attachmentPanelMockModule());

import ExperienceTab from "./ExperienceTab.js";
import {
  flush,
  jsonResponse,
  pendingFetch,
  click,
  PAGE_ROOT,
  PAGE_CHILD,
  PAGE_SIBLING,
  withoutZwsp,
  documentButtons,
  rowActionButton,
  domHelpers,
  makeRender,
} from "./experienceTabTestHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
const { buttons, liveRegion } = domHelpers(() => container);
const render = makeRender(() => root, ExperienceTab);

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
  delete global.fetch;
});

describe("ExperienceTab -- loading state", () => {
  it("shows a progress indicator and renders no tree while loading", async () => {
    global.fetch = pendingFetch();
    await render();

    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.textContent).not.toContain("No project pages yet.");
  });
});

describe("ExperienceTab -- signed out vs. empty (401 vs. zero pages)", () => {
  it("renders the signed-out message as an Alert on a 401, and not the empty-pages state", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    await render();
    await flush();

    const alert = container.querySelector(".MuiAlert-root");
    expect(alert).not.toBeNull();
    expect(alert.className).toMatch(/MuiAlert-colorInfo/);
    expect(container.textContent).toContain("Please sign in to manage your professional experience.");
    // The failure mode this guards against: a signed-out user seeing the same
    // "no pages yet" empty state a real, signed-in, empty account would see -
    // which reads as "you have no work saved" instead of "you are not signed in".
    expect(container.textContent).not.toContain("No project pages yet.");
    expect(container.querySelector('[role="tree"]')).toBeNull();
  });

  it("renders the empty-pages state on zero pages, with no sign-in alert", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [] }));
    await render();
    await flush();

    expect(container.querySelector(".MuiAlert-root")).toBeNull();
    expect(container.textContent).toContain("No project pages yet.");
    expect(container.textContent).not.toContain("Please sign in");
  });
});

describe("ExperienceTab -- zero-page empty state offers a single create action", () => {
  it("shows exactly one create-ish button, with the header's New page button suppressed", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [] }));
    await render();
    await flush();

    const createButtons = buttons().filter((b) => /create|new page/i.test(b.textContent));
    expect(createButtons).toHaveLength(1);
    expect(createButtons[0].textContent).toContain("Create your first project page");
  });
});

describe("ExperienceTab -- breadcrumbs for the selected page", () => {
  it("renders breadcrumbs as buttons, and clicking one selects that page", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_CHILD] }));
    await render();
    await flush();

    // p2 is nested under p1 and starts collapsed - expand p1 first via its
    // chevron (the row's first child Box) so p2's treeitem actually exists.
    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    expect(rootItem).not.toBeNull();
    const chevron = rootItem.firstElementChild.firstElementChild;
    await click(chevron);

    const childItem = container.querySelector('[role="treeitem"][data-page-id="p2"]');
    expect(childItem).not.toBeNull();
    await click(childItem);

    expect(container.querySelector('[data-testid="mock-page-editor"]').getAttribute("data-page-id")).toBe("p2");

    const crumbButtons = buttons().filter((b) => b.textContent === "Root Page" || b.textContent === "Child Page");
    expect(crumbButtons.map((b) => b.textContent)).toEqual(["Root Page", "Child Page"]);

    const rootCrumb = crumbButtons.find((b) => b.textContent === "Root Page");
    await click(rootCrumb);

    expect(container.querySelector('[data-testid="mock-page-editor"]').getAttribute("data-page-id")).toBe("p1");
  });
});

describe("ExperienceTab -- every button has an accessible name", () => {
  it("names every rendered button, including page-tree row hover actions", async () => {
    // This repo has shipped five buttons all named "Preview documents" before
    // (JobDescriptionTab) - this walks every button ExperienceTab renders
    // (header, tree rows, breadcrumbs) and asserts none is nameless.
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_CHILD] }));
    await render();
    await flush();

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const chevron = rootItem.firstElementChild.firstElementChild;
    await click(chevron);
    await click(container.querySelector('[role="treeitem"][data-page-id="p2"]'));

    const rendered = buttons();
    expect(rendered.length).toBeGreaterThan(0);
    const nameless = rendered.filter((b) => {
      const name = (b.getAttribute("aria-label") || b.textContent || "").trim();
      return name.length === 0;
    });
    expect(nameless).toEqual([]);
  });
});

describe("ExperienceTab -- a combined title+body save issues exactly one PATCH", () => {
  it("sends a single PATCH request for a save carrying both title and body, and the cached row ends up holding both", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT] }));
      }
      if (options.method === "PATCH") {
        return Promise.resolve(jsonResponse(200, { page: { ...PAGE_ROOT, ...JSON.parse(options.body) } }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await render();
    await flush();

    await click(container.querySelector('[role="treeitem"][data-page-id="p1"]'));

    const patchCallsBefore = global.fetch.mock.calls.filter(([, o]) => o && o.method === "PATCH");
    expect(patchCallsBefore).toHaveLength(0);

    const saveBtn = container.querySelector('[data-testid="mock-page-editor-save"]');
    expect(saveBtn).not.toBeNull();
    await click(saveBtn);
    await flush();

    // The assertion the D2 defect is about: exactly ONE request, not the two
    // independent (renamePage + updatePageBody) requests ExperienceTab used
    // to fire for a single save carrying both fields.
    const patchCalls = global.fetch.mock.calls.filter(([, o]) => o && o.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(patchCalls[0][1].body)).toEqual({ title: "New Title", body: "New body" });

    // The cached row must hold BOTH the new title and the new body - proof
    // that no second, stale-bodied reply ever landed on top of this one.
    const editor = container.querySelector('[data-testid="mock-page-editor"]');
    expect(editor.textContent).toContain("New Title");
    expect(editor.getAttribute("data-page-body")).toBe("New body");
  });
});

describe("ExperienceTab -- the header's create button always creates at the top level (D1)", () => {
  it("posts parent_id: null even with a page selected, and names itself accordingly", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT] }));
      }
      if (options.method === "POST") {
        const sent = JSON.parse(options.body);
        return Promise.resolve(
          jsonResponse(200, {
            page: {
              id: "new1",
              parent_id: sent.parent_id,
              title: sent.title,
              body: "",
              position: 1,
              archived_at: null,
              created_at: "2026-01-04T00:00:00.000Z",
              updated_at: "2026-01-04T00:00:00.000Z",
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await render();
    await flush();

    // Select the only existing page first - the exact condition that used
    // to make the header button silently create a CHILD of whatever was
    // selected instead of a second top-level page.
    await click(container.querySelector('[role="treeitem"][data-page-id="p1"]'));

    const createBtn = buttons().find((b) => /new top-level page/i.test(b.textContent));
    expect(createBtn).toBeDefined();
    await click(createBtn);
    await flush();

    const postCalls = global.fetch.mock.calls.filter(([, o]) => o && o.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(postCalls[0][1].body)).toMatchObject({ parent_id: null });
  });
});

describe("ExperienceTab -- focus after delete (D2)", () => {
  it("moves focus to the next remaining sibling row when other pages survive the delete", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING] }));
      }
      if (options.method === "DELETE") {
        return Promise.resolve(jsonResponse(200, {}));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await render();
    await flush();

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const deleteBtn = rowActionButton(rootItem, "DeleteIcon");
    expect(deleteBtn).toBeDefined();
    await click(deleteBtn);
    await flush();

    const confirmBtn = documentButtons().find((b) => b.textContent.trim() === "Delete");
    expect(confirmBtn).toBeDefined();
    await click(confirmBtn);
    await flush();

    expect(container.querySelector('[role="treeitem"][data-page-id="p1"]')).toBeNull();
    const survivorItem = container.querySelector('[role="treeitem"][data-page-id="p3"]');
    expect(survivorItem).not.toBeNull();
    expect(document.activeElement).toBe(survivorItem);

    // D5: the deletion is also announced.
    expect(withoutZwsp(liveRegion().textContent)).toContain('Deleted "Root Page"');
  });

  it("moves focus to the empty-state create button when the delete empties the whole tree", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT] }));
      }
      if (options.method === "DELETE") {
        return Promise.resolve(jsonResponse(200, {}));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await render();
    await flush();

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const deleteBtn = rowActionButton(rootItem, "DeleteIcon");
    expect(deleteBtn).toBeDefined();
    await click(deleteBtn);
    await flush();

    const confirmBtn = documentButtons().find((b) => b.textContent.trim() === "Delete");
    await click(confirmBtn);
    await flush();

    expect(container.textContent).toContain("No project pages yet.");
    const createBtn = buttons().find((b) => b.textContent.trim() === "Create your first project page");
    expect(createBtn).toBeDefined();
    expect(document.activeElement).toBe(createBtn);
  });
});

describe("ExperienceTab -- a move into a collapsed parent expands it and focuses the moved row (D2 + D3)", () => {
  it("expands the destination row and moves focus to the moved page's new location", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING] }));
      }
      if (url === "/api/experience/move") {
        const body = JSON.parse(options.body);
        return Promise.resolve(
          jsonResponse(200, {
            pages: [PAGE_ROOT, { ...PAGE_SIBLING, parent_id: body.newParentId, position: 0 }],
          }),
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await render();
    await flush();

    // p1 has no children yet - a leaf row carries no aria-expanded at all.
    const rootItemBefore = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    expect(rootItemBefore.getAttribute("aria-expanded")).toBeNull();

    const siblingItem = container.querySelector('[role="treeitem"][data-page-id="p3"]');
    // Move's IconButton, unlike Add/Rename/Delete, sets its own aria-label
    // directly (it is the keyboard/screen-reader route to re-parenting, so
    // it needs a real accessible name of its own - see PageTreeItem.js).
    const moveBtn = [...siblingItem.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Move Sibling Page",
    );
    expect(moveBtn).toBeDefined();
    await click(moveBtn);
    await flush();

    // MovePageDialog's target rows are ListItemButtons (role="button", not
    // necessarily a literal <button> tag) inside the "Move to" list - see
    // MovePageDialog.test.js's own identical query.
    const dialogTargetBtn = [...document.querySelectorAll('[aria-label="Move to"] [role="button"]')].find(
      (b) => b.textContent.trim() === "Root Page",
    );
    expect(dialogTargetBtn).toBeDefined();
    await click(dialogTargetBtn);
    await flush();

    const rootItemAfter = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    expect(rootItemAfter.getAttribute("aria-expanded")).toBe("true");

    const movedItem = container.querySelector('[role="treeitem"][data-page-id="p3"]');
    expect(movedItem).not.toBeNull();
    expect(document.activeElement).toBe(movedItem);

    // D5: the move is also announced.
    expect(withoutZwsp(liveRegion().textContent)).toContain('Moved "Sibling Page"');
  });
});

describe("ExperienceTab -- a live region announces page create and rename (D5)", () => {
  it("announces a newly-created page from the empty state", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [] }));
      }
      if (options.method === "POST") {
        return Promise.resolve(
          jsonResponse(200, {
            page: {
              id: "new1",
              parent_id: null,
              title: "Untitled page",
              body: "",
              position: 0,
              archived_at: null,
              created_at: "2026-01-05T00:00:00.000Z",
              updated_at: "2026-01-05T00:00:00.000Z",
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await render();
    await flush();

    expect(liveRegion()).not.toBeNull();
    expect(withoutZwsp(liveRegion().textContent)).toBe("");

    const createBtn = buttons().find((b) => b.textContent.trim() === "Create your first project page");
    await click(createBtn);
    await flush();

    expect(withoutZwsp(liveRegion().textContent)).toContain('Created "Untitled page"');
  });

  it("announces a committed sidebar rename", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT] }));
      }
      if (options.method === "PATCH") {
        const sent = JSON.parse(options.body);
        return Promise.resolve(jsonResponse(200, { page: { ...PAGE_ROOT, ...sent } }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await render();
    await flush();

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const renameBtn = rowActionButton(rootItem, "EditIcon");
    expect(renameBtn).toBeDefined();
    await click(renameBtn);
    await flush();

    const input = container.querySelector('[aria-label="Page title"]');
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(input, "Renamed Root");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();

    expect(withoutZwsp(liveRegion().textContent)).toContain('Renamed to "Renamed Root"');
  });
});

// Chunk 8: checkbox selection and the bulk actions bar. PageTree.test.js
// already proves the checkbox wiring in isolation (accessible names,
// roving tabindex, aria-selected independence) and BulkActionsBar.test.js
// already proves the bar's own dialogs in isolation - what can only be
// observed here, through the REAL tree and the REAL useExperiencePages
// hook together, is the end-to-end path: checking boxes actually shows the
// bar, and a bulk action actually reaches the network the right number of
// times for an overlapping (parent + its own child) selection.
describe("ExperienceTab -- bulk selection and the bulk actions bar (chunk 8)", () => {
  function checkboxFor(id) {
    return container.querySelector(`[role="treeitem"][data-page-id="${id}"] input[type="checkbox"]`);
  }

  it("shows the labelled bulk actions bar and announces the count once a row is checked", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING] }));
    await render();
    await flush();

    expect(container.querySelector('[role="region"][aria-label="Bulk actions"]')).toBeNull();

    await act(async () => {
      checkboxFor("p1").click();
    });

    const region = container.querySelector('[role="region"][aria-label="Bulk actions"]');
    expect(region).not.toBeNull();
    expect(region.textContent).toContain("1 selected");
    expect(withoutZwsp(liveRegion().textContent)).toContain("1 page selected");
  });

  it("re-announces the count even when it repeats non-consecutively (3 -> 2 -> 3)", async () => {
    const PAGE_THIRD = {
      ...PAGE_SIBLING,
      id: "p4",
      title: "Third Page",
      position: 2,
      created_at: "2026-01-04T00:00:00.000Z",
    };
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING, PAGE_THIRD] }));
    await render();
    await flush();

    // 1 selected -> 2 -> 3 -> 2 -> 3 again. Every step in this sequence is a
    // SEPARATE, genuinely observable commit - the defect this guards
    // against (React bailing out of a setState whose value is
    // Object.is-unchanged) would show up as some CONSECUTIVE pair in this
    // sequence rendering identical raw text, most plausibly right at the
    // "-> 3 again" step this test is named for.
    const snapshots = [];
    for (const id of ["p1", "p3", "p4", "p4", "p4"]) {
      await act(async () => {
        checkboxFor(id).click();
      });
      snapshots.push(liveRegion().textContent);
    }
    const [afterOne, afterTwo, afterThreeFirst, afterTwoAgain, afterThreeSecond] = snapshots;

    expect(withoutZwsp(afterOne)).toContain("1 page selected");
    expect(withoutZwsp(afterTwo)).toContain("2 pages selected");
    expect(withoutZwsp(afterThreeFirst)).toContain("3 pages selected");
    expect(withoutZwsp(afterTwoAgain)).toContain("2 pages selected");
    expect(withoutZwsp(afterThreeSecond)).toContain("3 pages selected");

    // No two CONSECUTIVE snapshots are byte-for-byte identical - proof that
    // every single toggle produced its own distinguishable DOM commit,
    // including the final "-> 3 again" transition immediately off the back
    // of "2 selected".
    for (let i = 1; i < snapshots.length; i += 1) {
      expect(snapshots[i]).not.toBe(snapshots[i - 1]);
    }
  });

  it("Escape clears the whole selection and hides the bar", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_SIBLING] }));
    await render();
    await flush();

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    await act(async () => {
      checkboxFor("p1").click();
    });
    expect(container.querySelector('[role="region"][aria-label="Bulk actions"]')).not.toBeNull();

    await act(async () => {
      rootItem.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('[role="region"][aria-label="Bulk actions"]')).toBeNull();
  });

  it("bulk delete issues one DELETE per selection ROOT, not per selected descendant, and announces the root count", async () => {
    // p1 and its own child p2 are BOTH checked - deleting p1 already
    // cascades p2 away server-side, so a second DELETE for p2 must never be
    // sent (it would 404 against a row that is already gone).
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_CHILD, PAGE_SIBLING] }));
      }
      if (options.method === "DELETE") {
        return Promise.resolve(jsonResponse(200, {}));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    await render();
    await flush();

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const chevron = rootItem.firstElementChild.firstElementChild;
    await click(chevron);
    expect(container.querySelector('[role="treeitem"][data-page-id="p2"]')).not.toBeNull();

    await act(async () => {
      checkboxFor("p1").click();
    });
    await act(async () => {
      checkboxFor("p2").click();
    });

    const deleteSelectedBtn = buttons().find((b) => b.textContent.trim() === "Delete selected");
    expect(deleteSelectedBtn).toBeDefined();
    await click(deleteSelectedBtn);
    await flush();

    const confirmBtn = documentButtons().find((b) => b.textContent.trim() === "Delete");
    expect(confirmBtn).toBeDefined();
    await click(confirmBtn);
    await flush();

    const deleteCalls = global.fetch.mock.calls.filter(([, o]) => o && o.method === "DELETE");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toBe("/api/experience/pages/p1");

    expect(container.querySelector('[role="treeitem"][data-page-id="p1"]')).toBeNull();
    expect(container.querySelector('[role="treeitem"][data-page-id="p3"]')).not.toBeNull();
    expect(withoutZwsp(liveRegion().textContent)).toContain("Deleted 1 page");
  });

  it("bulk move issues one move per selection ROOT, moving it (and its still-checked child along with it) to the chosen destination", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_CHILD, PAGE_SIBLING] }));
      }
      if (url === "/api/experience/move") {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_CHILD, PAGE_SIBLING] }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    await render();
    await flush();

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const chevron = rootItem.firstElementChild.firstElementChild;
    await click(chevron);

    await act(async () => {
      checkboxFor("p1").click();
    });
    await act(async () => {
      checkboxFor("p2").click();
    });

    const moveSelectedBtn = buttons().find((b) => b.textContent.trim() === "Move selected");
    expect(moveSelectedBtn).toBeDefined();
    expect(moveSelectedBtn.getAttribute("aria-disabled")).toBeNull();
    await click(moveSelectedBtn);
    await flush();

    const dialogTarget = [...document.querySelectorAll('[aria-label="Move to"] [role="button"]')].find(
      (b) => b.textContent.trim() === "Sibling Page",
    );
    expect(dialogTarget).toBeDefined();
    await click(dialogTarget);
    await flush();

    const moveCalls = global.fetch.mock.calls.filter(([u]) => u === "/api/experience/move");
    expect(moveCalls).toHaveLength(1);
    expect(JSON.parse(moveCalls[0][1].body)).toMatchObject({ id: "p1", newParentId: "p3" });
  });
});

// Chunk 9's wiring gap: BulkActionsBar's Research report action calls its
// `onPagesChanged` prop after a batch finishes so the new child page it just
// created server-side shows up in the tree without the user navigating away
// - but `onPagesChanged` is called through `?.()` (genuinely optional, so
// BulkActionsBar itself never breaks without it). That optionality is
// exactly what let a missing/wrong wire-up stay invisible before: eslint,
// BulkActionsBar's own tests (which pass a mock), and even `npm run build`
// all stay green whether this prop is wired to useExperiencePages' `reload`,
// to nothing, or to some other function entirely. Only an assertion on the
// OBSERVABLE result - a second GET actually happening and the new page
// actually reaching the DOM - can tell those apart, which is what this test
// asserts instead of asserting a prop was merely passed.
describe("ExperienceTab -- research report refetches the page list (chunk 9)", () => {
  it("issues a second GET /api/experience after a research report completes, and the new child page reaches the tree", async () => {
    const PAGE_REPORT = {
      id: "r1",
      parent_id: "p1",
      title: "Research: Root Page (2026-08-12)",
      body: "# What this project appears to be\n\n...",
      position: 1,
      archived_at: null,
      created_at: "2026-08-12T00:00:00.000Z",
      updated_at: "2026-08-12T00:00:00.000Z",
    };

    let getCount = 0;
    global.fetch = vi.fn((url, options) => {
      const method = options?.method || "GET";
      // The tab also renders TechWatchPanel, which loads its own briefing on
      // mount. Answer it with an empty briefing and, crucially, do NOT let it
      // reach `getCount`: this test is about how many times the PAGE LIST is
      // re-fetched, which is what its name says and what the research-reload
      // defect was about. Counting every GET in the subtree would make the
      // assertion break whenever any unrelated component gains a request,
      // and it silently handed the briefing endpoint a pages payload.
      if (String(url).startsWith("/api/techwatch")) {
        return Promise.resolve(
          jsonResponse(200, {
            generatedAt: "2026-08-12T00:00:00.000Z",
            windowHours: 24,
            items: [],
            lifecycle: [],
            watchlist: { entries: [], usedDefaults: true, truncated: false },
            sources: [],
          }),
        );
      }
      if (method === "GET") {
        getCount += 1;
        const pages = getCount === 1 ? [PAGE_ROOT, PAGE_CHILD] : [PAGE_ROOT, PAGE_CHILD, PAGE_REPORT];
        return Promise.resolve(jsonResponse(200, { pages }));
      }
      if (url === "/api/experience/research" && method === "POST") {
        return Promise.resolve(jsonResponse(200, { page: PAGE_REPORT }));
      }
      throw new Error(`Unexpected fetch call: ${url} (${method})`);
    });

    await render();
    await flush();

    // p2 starts collapsed under p1 - expand it first (same precondition the
    // breadcrumb and chunk-8 tests above use) so p1 is already a member of
    // expandedIds by the time the reload lands. Without that, the new
    // sibling page landing in `pages` would still be invisible - it would
    // exist in the fetched data but render nothing, which would make this
    // test indistinguishable from the defect it exists to catch.
    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const chevron = rootItem.firstElementChild.firstElementChild;
    await click(chevron);
    expect(container.querySelector('[role="treeitem"][data-page-id="p2"]')).not.toBeNull();

    await act(async () => {
      rootItem.querySelector('input[type="checkbox"]').click();
    });

    const researchBtn = buttons().find((b) => b.textContent.trim() === "Research report");
    expect(researchBtn).toBeDefined();
    expect(researchBtn.getAttribute("aria-disabled")).toBeNull();
    await click(researchBtn);
    await flush();

    expect(getCount).toBe(2);
    expect(container.querySelector('[role="treeitem"][data-page-id="r1"]')).not.toBeNull();
    expect(container.textContent).toContain("Research: Root Page (2026-08-12)");
  });
});

