// @vitest-environment jsdom
//
// Gates the WIRING of the knowledge panel into the Professional Experience
// tab. Written before the wiring exists.
//
// This repo has shipped a fully-tested component its caller never imported:
// every piece-level test passed because each one imports the piece directly,
// and the tab on screen was unchanged. KnowledgePanel.test.js is in exactly
// that position, so this file mounts the real tab and looks for the panel.
//
// THREE PROPERTIES, and the plan's §7 C1 ruling is the reason for all three:
//
//   1. IT MOUNTS FOR THE ROOT SCOPE. The anchor 1c proposed sits between
//      <PageEditor> and <AttachmentPanel>, INSIDE the `selectedPage ? ... : ...`
//      ternary - a branch that does not render at all when nothing is
//      selected. The owner's settled ruling is that scope is root + page
//      subtree, so an anchor inside that branch means the root scope never has
//      a panel. Decisive on its own, and invisible to any test that always
//      selects a page first.
//
//   2. IT MOUNTS EXACTLY ONCE. Two anchors (AC-14.1 offers two) means two hook
//      instances, two auto-generate triggers and two paid model calls for one
//      scope. A count is the only assertion that catches it; "the panel is on
//      screen" passes with two.
//
//   3. ITS SCOPE IS AN EXPLICIT PROP that tracks the tree selection, never
//      inferred inside the panel.
//
// The panel itself is mocked: its own rendering is KnowledgePanel.test.js's
// job, and a failure inside it must never be reported as a failure of this
// tab's wiring. What is asserted here is what the tab HANDS it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./PageEditor", async () => (await import("./experienceTabTestHarness.js")).pageEditorMockModule());
vi.mock("./AttachmentPanel", async () => (await import("./experienceTabTestHarness.js")).attachmentPanelMockModule());
vi.mock("./KnowledgePanel", () => ({
  default: function MockKnowledgePanel({ scopePageId, pages, loading, signedOut, error, onSelectPage }) {
    return createElement("div", {
      "data-testid": "mock-knowledge-panel",
      // `scopePageId` is null for the root scope, and null must be
      // distinguishable from "the prop was never passed" - so the two are
      // written as different strings rather than both collapsing to "".
      "data-scope": scopePageId === null ? "ROOT" : scopePageId === undefined ? "MISSING" : String(scopePageId),
      "data-page-count": String(Array.isArray(pages) ? pages.length : -1),
      "data-loading": String(!!loading),
      "data-signed-out": String(!!signedOut),
      "data-error": String(error ?? "MISSING"),
      "data-has-select": String(typeof onSelectPage === "function"),
    });
  },
}));

import ExperienceTab from "./ExperienceTab.js";
import {
  flush,
  jsonResponse,
  click,
  documentButtons,
  rowActionButton,
  PAGE_ROOT,
  PAGE_CHILD,
  PAGE_SIBLING,
} from "./experienceTabTestHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Under `@vitest-environment jsdom`, import.meta.url is not a file: URL, so
// node:url's fileURLToPath throws at collection time - the KnowledgePanel.test.js
// idiom is used instead.
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = readFileSync(path.join(HERE, "ExperienceTab.js"), "utf8");

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
  delete global.fetch;
});

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(ExperienceTab, { askAiAbout: vi.fn(), addChatAttachments: vi.fn(), ...props }));
  });
  await flush();
}

function panels() {
  return [...container.querySelectorAll('[data-testid="mock-knowledge-panel"]')];
}

function withPages(pages = [PAGE_ROOT, PAGE_CHILD, PAGE_SIBLING]) {
  global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages }));
}

describe("the knowledge panel is mounted once, and for the root scope too", () => {
  it("mounts with NOTHING selected - the root scope, which 1c's anchor would never have rendered", async () => {
    withPages();
    await render();

    expect(panels()).toHaveLength(1);
    expect(panels()[0].getAttribute("data-scope")).toBe("ROOT");
  });

  it("mounts EXACTLY ONCE with a page selected too - not one per anchor", async () => {
    withPages();
    await render();
    await click(container.querySelector('[role="treeitem"][data-page-id="p1"]'));
    await flush();

    expect(panels()).toHaveLength(1);
  });

  it("hands the selected page id through as an explicit scope prop, and follows the selection", async () => {
    withPages();
    await render();
    expect(panels()[0].getAttribute("data-scope")).toBe("ROOT");

    await click(container.querySelector('[role="treeitem"][data-page-id="p1"]'));
    await flush();
    expect(panels()[0].getAttribute("data-scope")).toBe("p1");

    await click(container.querySelector('[role="treeitem"][data-page-id="p3"]'));
    await flush();
    expect(panels()[0].getAttribute("data-scope")).toBe("p3");
  });

  it("goes back to the root scope when the selection is cleared by a delete", async () => {
    withPages([PAGE_ROOT, PAGE_SIBLING]);
    await render();
    await click(container.querySelector('[role="treeitem"][data-page-id="p1"]'));
    await flush();
    expect(panels()[0].getAttribute("data-scope")).toBe("p1");

    const row = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    const deleteBtn = rowActionButton(row, "DeleteIcon");
    expect(deleteBtn).toBeDefined();
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    await click(deleteBtn);
    await flush();
    const confirmBtn = documentButtons().find((b) => b.textContent.trim() === "Delete");
    expect(confirmBtn).toBeDefined();
    await click(confirmBtn);
    await flush();

    expect(panels()).toHaveLength(1);
    expect(panels()[0].getAttribute("data-scope")).toBe("ROOT");
  });

  it("passes the live page list and the tab's own load state straight through", async () => {
    withPages();
    await render();
    const el = panels()[0];

    expect(el.getAttribute("data-page-count")).toBe("3");
    expect(el.getAttribute("data-loading")).toBe("false");
    expect(el.getAttribute("data-signed-out")).toBe("false");
    expect(el.getAttribute("data-error")).toBe("");
    expect(el.getAttribute("data-has-select")).toBe("true");
  });

  it("gives it a way to change the tree selection, so a citation can open its page", async () => {
    withPages();
    await render();
    expect(panels()[0].getAttribute("data-has-select")).toBe("true");
  });

  it("renders it AFTER the attachments panel, so a user whose task is this page is never tabbed through it first", async () => {
    withPages();
    await render();
    await click(container.querySelector('[role="treeitem"][data-page-id="p1"]'));
    await flush();

    const attachments = container.querySelector('[data-testid="mock-attachment-panel"]');
    const panel = panels()[0];
    expect(attachments).not.toBeNull();
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(attachments.compareDocumentPosition(panel) & 4).toBeTruthy();
  });

  it("does NOT render with zero pages - the tab already draws its own empty state and CTA there", async () => {
    withPages([]);
    await render();
    expect(container.textContent).toContain("No project pages yet.");
    expect(panels()).toHaveLength(0);
  });

  it("does not render while loading", async () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    await act(async () => {
      root.render(createElement(ExperienceTab, { askAiAbout: vi.fn(), addChatAttachments: vi.fn() }));
    });
    expect(panels()).toHaveLength(0);
  });

  it("does not render when signed out", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    await render();
    expect(panels()).toHaveLength(0);
  });
});

describe("the wiring's shape, read off the caller's own source", () => {
  it("imports the panel", () => {
    expect(source).toMatch(/import\s+KnowledgePanel\s+from\s+"\.\/KnowledgePanel(\.js)?"/);
  });

  it("renders it in exactly ONE place - a second anchor is a second hook instance and a second paid call", () => {
    expect((source.match(/<KnowledgePanel/g) || []).length).toBe(1);
  });

  it("places it after the selection ternary closes, not inside a branch of it", () => {
    // The mount test above is the real assertion; this pins the anchor so a
    // refactor that moves it INTO the selectedPage branch fails here with the
    // reason rather than only as a mysteriously missing root-scope panel.
    const editor = source.indexOf("<PageEditor");
    const attachments = source.indexOf("<AttachmentPanel");
    const panel = source.indexOf("<KnowledgePanel");
    expect(editor).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(attachments);
    expect(source.indexOf("Select a page, or create one")).toBeLessThan(panel);
  });

  it("does not reach into the panel's data - the panel owns its own hook", () => {
    expect(source).not.toContain("useKnowledgeScope");
    expect(source).not.toContain("/api/experience/knowledge");
  });

  it("keeps the tab under the file-size limit", () => {
    expect(source.split("\n").length).toBeLessThan(1000);
  });
});
