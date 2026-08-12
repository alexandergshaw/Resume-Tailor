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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./PageEditor", () => ({
  // `onChange` is exposed through a real button (rather than called eagerly
  // at render time) so a test can trigger it on demand, the same way the
  // real PageEditor's autosave calls it once - not while rendering. The
  // patch this sends always carries BOTH title and body, mirroring
  // PageEditor's actual performSave, which always sends `{...latestRef}` in
  // full - this is the D2 defect's wiring test: ExperienceTab must turn
  // that ONE patch into exactly ONE PATCH request, not two.
  //
  // `onAskAi` is exposed the same way, through its own on-demand button -
  // mirroring the REAL PageEditor's own Ask AI button, which hands
  // `{ title, body }` (the current on-screen text) to its `onAskAi` prop,
  // never the raw `page` prop.
  default: function MockPageEditor({ page, onChange, onAskAi }) {
    return createElement(
      "div",
      { "data-testid": "mock-page-editor", "data-page-id": page ? page.id : "", "data-page-body": page ? page.body : "" },
      page ? page.title : "",
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "mock-page-editor-save",
          onClick: () => onChange({ title: "New Title", body: "New body" }),
        },
        "Trigger save",
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "mock-page-editor-ask-ai",
          onClick: () => onAskAi({ title: page.title, body: page.body }),
        },
        "Trigger ask ai",
      ),
    );
  },
}));

vi.mock("./AttachmentPanel", () => ({
  default: function MockAttachmentPanel({ pageId }) {
    return createElement("div", { "data-testid": "mock-attachment-panel", "data-page-id": pageId || "" });
  },
}));

// The Ask AI wiring downloads readable attachments straight from Supabase
// Storage (mirrors lib/supabase/materials.js's own downloadMaterialBlob) -
// `downloadMock` is `vi.hoisted` so the `vi.mock` factory below (which is
// itself hoisted above this file's own imports) can close over it, and each
// test configures its own return value per storage path.
const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ download: downloadMock }),
    },
  }),
}));

import ExperienceTab from "./ExperienceTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  downloadMock.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete global.fetch;
});

// Several empty async act() calls, per app/copilot/useCopilotDashboard.wiring.test.js's
// own `flush` helper: each drives React's act-queue forward one tick, which is
// what lets the mocked fetch's resolution and the setState that follows it
// actually settle and commit before the next assertion runs.
async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function render(props) {
  await act(async () => {
    root.render(createElement(ExperienceTab, props));
  });
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function pendingFetch() {
  return vi.fn(() => new Promise(() => {}));
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const PAGE_ROOT = {
  id: "p1",
  parent_id: null,
  title: "Root Page",
  body: "",
  position: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const PAGE_CHILD = {
  id: "p2",
  parent_id: "p1",
  title: "Child Page",
  body: "",
  position: 0,
  archived_at: null,
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const PAGE_SIBLING = {
  id: "p3",
  parent_id: null,
  title: "Sibling Page",
  body: "",
  position: 1,
  archived_at: null,
  created_at: "2026-01-03T00:00:00.000Z",
  updated_at: "2026-01-03T00:00:00.000Z",
};

// Built explicitly rather than typed as a literal character in source, for
// the same reason PageEditor.js and ExperienceTab.js itself do this: an
// invisible unicode character embedded directly in a source file is easy to
// lose or mis-copy.
const ZWSP = String.fromCodePoint(0x200b);
function withoutZwsp(text) {
  return text.replace(new RegExp(ZWSP, "g"), "");
}

function liveRegion() {
  return container.querySelector('[role="status"]');
}

// MUI Dialog (and FormDialog/MovePageDialog, both built on it) portals its
// content onto document.body rather than nesting it under `container` - see
// MovePageDialog.test.js's own identical comment. Anything queried AFTER a
// dialog opens has to search `document`, not `container`.
function documentButtons() {
  return [...document.querySelectorAll("button")];
}

// The row hover-actions (Add sub-page / Rename / Delete) carry their name
// only via their wrapping Tooltip's `title`, not an aria-label on the
// button itself (unlike Move, which sets aria-label directly) - found
// instead through the icon's own MUI-assigned `data-testid`.
function rowActionButton(row, iconTestId) {
  return [...row.querySelectorAll("button")].find((b) => {
    const svg = b.querySelector("svg");
    return svg && svg.getAttribute("data-testid") === iconTestId;
  });
}

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

// The Ask AI feature: pressing it on a project page pins the whole page -
// body, breadcrumb, child pages, and an inventory of its attachments - as
// chat context, then downloads and attaches whatever attachments the chat
// can actually read (text/image/pdf - never video, see
// lib/experience/pageContext.js and app/api/chat/route.js for why). This
// exercises the REAL wiring end to end: the real useExperiencePages hook,
// the real GET /api/experience/attachments fetch, the real
// lib/experience/pageContext.buildPageContext, and the real download path -
// only PageEditor and AttachmentPanel are mocked (their own contracts are
// covered by their own test files).
describe("ExperienceTab -- Ask AI", () => {
  const PAGE_WITH_BODY = {
    ...PAGE_CHILD,
    body: "We migrated payments off the legacy processor.",
  };
  const PAGE_GRANDCHILD = {
    id: "p2c",
    parent_id: "p2",
    title: "Grandchild Page",
    body: "",
    position: 0,
    archived_at: null,
    created_at: "2026-01-02T12:00:00.000Z",
    updated_at: "2026-01-02T12:00:00.000Z",
  };

  const ATTACHMENTS = [
    {
      id: "a1",
      name: "topology.png",
      mime: "image/png",
      kind: "image",
      bytes: 100,
      storage_path: "u1/experience/p2/a1-topology.png",
      notes: "before the migration",
      transcript: "",
    },
    {
      id: "a2",
      name: "spec.pdf",
      mime: "application/pdf",
      kind: "pdf",
      bytes: 200,
      storage_path: "u1/experience/p2/a2-spec.pdf",
      notes: "",
      transcript: "",
    },
    {
      id: "a3",
      name: "notes.txt",
      mime: "text/plain",
      kind: "text",
      bytes: 50,
      storage_path: "u1/experience/p2/a3-notes.txt",
      notes: "read me first",
      transcript: "",
    },
    {
      id: "a4",
      name: "demo.mp4",
      mime: "video/mp4",
      kind: "video",
      bytes: 900,
      storage_path: "u1/experience/p2/a4-demo.mp4",
      notes: "",
      transcript: "",
    },
  ];

  function mockFetchWithAttachments() {
    return vi.fn((url) => {
      if (url === "/api/experience") {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_WITH_BODY, PAGE_GRANDCHILD] }));
      }
      if (url.startsWith("/api/experience/attachments")) {
        expect(url).toBe(`/api/experience/attachments?pageId=${PAGE_WITH_BODY.id}`);
        return Promise.resolve(jsonResponse(200, { attachments: ATTACHMENTS }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
  }

  async function selectChildPage() {
    // p2 sits under p1, collapsed by default - expand p1 first (same
    // precondition every other test in this file that reaches a nested row
    // uses), then select p2 itself.
    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const chevron = rootItem.firstElementChild.firstElementChild;
    await click(chevron);
    await click(container.querySelector('[role="treeitem"][data-page-id="p2"]'));
  }

  it("pins the body, breadcrumb, child page and attachment inventory, and attaches only the downloadable files", async () => {
    global.fetch = mockFetchWithAttachments();
    downloadMock.mockImplementation(async (path) => {
      const found = ATTACHMENTS.find((a) => a.storage_path === path);
      return { data: new Blob(["bytes"], { type: found?.mime || "application/octet-stream" }), error: null };
    });

    const askAiAbout = vi.fn();
    const addChatAttachments = vi.fn();
    await render({ askAiAbout, addChatAttachments });
    await flush();

    await selectChildPage();

    const askAiBtn = container.querySelector('[data-testid="mock-page-editor-ask-ai"]');
    expect(askAiBtn).not.toBeNull();
    await click(askAiBtn);
    await flush();

    expect(askAiAbout).toHaveBeenCalledTimes(1);
    const pinned = askAiAbout.mock.calls[0][0];
    expect(pinned.label).toContain("Child Page");
    expect(pinned.content).toContain("We migrated payments off the legacy processor.");
    expect(pinned.content).toContain("Root Page / Child Page");
    expect(pinned.content).toContain("Grandchild Page");
    expect(pinned.content).toContain("topology.png");
    expect(pinned.content).toContain("before the migration");
    expect(pinned.content).toContain("spec.pdf");
    expect(pinned.content).toContain("notes.txt");
    expect(pinned.content).toContain("read me first");
    expect(pinned.content).toContain("demo.mp4");
    // The video has no notes and no transcript - pageContext.js's own
    // contract says so in plain words rather than a bare filename that
    // would read as though the model watched it.
    expect(pinned.content.toLowerCase()).toMatch(/no transcript|not transcribed|no notes/);
    // Never the storage path or a signed URL.
    expect(pinned.content).not.toContain("u1/experience");

    expect(addChatAttachments).toHaveBeenCalledTimes(1);
    const attachedFiles = addChatAttachments.mock.calls[0][0];
    expect(attachedFiles.map((f) => f.name).sort()).toEqual(["notes.txt", "spec.pdf", "topology.png"]);

    // The video's bytes are never downloaded at all.
    const downloadedPaths = downloadMock.mock.calls.map(([path]) => path);
    expect(downloadedPaths).not.toContain("u1/experience/p2/a4-demo.mp4");
    expect(downloadedPaths.sort()).toEqual(
      ["u1/experience/p2/a1-topology.png", "u1/experience/p2/a2-spec.pdf", "u1/experience/p2/a3-notes.txt"].sort(),
    );
  });

  it("still pins the page (title, body, breadcrumb) when the attachments fetch fails, and does not call addChatAttachments", async () => {
    global.fetch = vi.fn((url) => {
      if (url === "/api/experience") {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_ROOT, PAGE_WITH_BODY] }));
      }
      if (url.startsWith("/api/experience/attachments")) {
        return Promise.resolve(jsonResponse(500, { error: "boom" }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const askAiAbout = vi.fn();
    const addChatAttachments = vi.fn();
    await render({ askAiAbout, addChatAttachments });
    await flush();

    await selectChildPage();

    const askAiBtn = container.querySelector('[data-testid="mock-page-editor-ask-ai"]');
    await click(askAiBtn);
    await flush();

    expect(askAiAbout).toHaveBeenCalledTimes(1);
    const pinned = askAiAbout.mock.calls[0][0];
    expect(pinned.content).toContain("We migrated payments off the legacy processor.");
    expect(pinned.content).toContain("Root Page / Child Page");

    expect(addChatAttachments).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
