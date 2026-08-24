// @vitest-environment jsdom
//
// Does the Professional Experience view actually MOUNT the meeting copilot,
// and can a finished meeting reach the page tree?
//
// A sibling file rather than more blocks in ExperienceTab.test.js, following
// the precedent that file's own siblings already set — and it shares their
// fixtures through experienceTabTestHarness.js rather than copying them.
//
// Two properties, and neither is testable from inside MeetingPanel:
//
//  1. ANTI-INERT. MeetingPanel could be perfect and fully tested and simply
//     never rendered. Every one of its own tests would still pass, because
//     they import it directly. This repo has shipped exactly that.
//
//  2. THE REFRESH SEAM. The page list lives in `useExperiencePages`, whose
//     hook instance is owned by ExperienceTab. MeetingPanel creates a page
//     entirely server-side and cannot update that list — the same shape as
//     BulkActionsBar's research reports, where this repo already shipped an
//     action whose result the tree never learned about. So the callback is
//     the whole mechanism, and this file is what proves it is connected.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

// The mock FACTORIES are deliberately not imported here: a `vi.mock` factory
// is hoisted above every import in this file, so it cannot close over one.
// Each factory below reaches the harness through its own dynamic import
// instead, which is why only the plain fixtures and helpers are named here.
import {
  flush,
  jsonResponse,
  click,
  PAGE_ROOT,
  PAGE_CHILD,
  makeRender,
} from "./experienceTabTestHarness.js";

vi.mock("./PageEditor", async () => (await import("./experienceTabTestHarness.js")).pageEditorMockModule());
vi.mock("./AttachmentPanel", async () => (await import("./experienceTabTestHarness.js")).attachmentPanelMockModule());

// Records what the tab hands the panel, and lets a test fire the saved
// callback as a real meeting would.
const panel = vi.hoisted(() => ({ props: [] }));
vi.mock("../../meeting/MeetingPanel", () => ({
  default: function MockMeetingPanel(props) {
    panel.props.push(props);
    return createElement("div", { "data-testid": "mock-meeting-panel", "data-page-id": props.pageId || "" });
  },
}));

import ExperienceTab from "./ExperienceTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let render;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render = makeRender(() => root, ExperienceTab);
  panel.props.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete global.fetch;
});

// Counts GET /api/experience calls so a reload is observable.
function installFetch({ pages = [PAGE_ROOT, PAGE_CHILD], onSave } = {}) {
  const listCalls = [];
  global.fetch = vi.fn((url, options = {}) => {
    const method = (options && options.method) || "GET";
    if (url === "/api/experience" && method === "GET") {
      listCalls.push(url);
      return Promise.resolve(jsonResponse(200, { pages }));
    }
    if (String(url).startsWith("/api/experience/attachments")) {
      return Promise.resolve(jsonResponse(200, { attachments: [] }));
    }
    if (url === "/api/meeting/save" && onSave) return Promise.resolve(onSave());
    return Promise.resolve(jsonResponse(200, {}));
  });
  return { listCalls };
}

describe("the meeting copilot is actually on the Experience view", () => {
  it("renders it", async () => {
    installFetch();
    await render({ askAiAbout: vi.fn(), addChatAttachments: vi.fn() });
    await flush();

    expect(container.querySelector('[data-testid="mock-meeting-panel"]')).not.toBeNull();
    expect(panel.props.length).toBeGreaterThan(0);
  });

  it("gives it a way to tell the tab a meeting was saved", async () => {
    // A prop wired to `undefined` is valid React and fails silently at the
    // one moment it matters - when a meeting ends and the page it produced
    // has nowhere to be announced.
    installFetch();
    await render({ askAiAbout: vi.fn(), addChatAttachments: vi.fn() });
    await flush();

    expect(typeof panel.props.at(-1).onMeetingSaved).toBe("function");
  });

  it("tells it which page the user has open, so the meeting starts with a default context", async () => {
    // The open page is the one relevance signal that is not a guess, and it
    // is what lets a meeting start in one click instead of asking.
    const { listCalls } = installFetch();
    await render({ askAiAbout: vi.fn(), addChatAttachments: vi.fn() });
    await flush();
    expect(listCalls.length).toBeGreaterThan(0);

    const rootItem = container.querySelector('[role="treeitem"][data-page-id="p1"]');
    await click(rootItem);
    await flush();

    expect(panel.props.at(-1).pageId).toBe("p1");
  });
});

describe("a saved meeting reaches the page tree", () => {
  it("reloads the list when the panel reports a saved meeting", async () => {
    // THE SEAM. Without this the meeting page exists in the database and is
    // invisible until a manual refresh - the exact failure this repo already
    // shipped once with research reports.
    const { listCalls } = installFetch();
    await render({ askAiAbout: vi.fn(), addChatAttachments: vi.fn() });
    await flush();

    const before = listCalls.length;
    const savedPage = { ...PAGE_ROOT, id: "m1", title: "Payments migration — Meeting notes (2026-03-04)" };

    await act(async () => {
      panel.props.at(-1).onMeetingSaved(savedPage);
    });
    await flush();

    expect(listCalls.length).toBeGreaterThan(before);
  });

  it("does not throw when the panel reports a save with no page", async () => {
    // Defensive: the callback is hard-called by the panel, so a shape it did
    // not expect must not take the whole tab down mid-meeting.
    installFetch();
    await render({ askAiAbout: vi.fn(), addChatAttachments: vi.fn() });
    await flush();

    await act(async () => {
      expect(() => panel.props.at(-1).onMeetingSaved(undefined)).not.toThrow();
    });
  });
});
