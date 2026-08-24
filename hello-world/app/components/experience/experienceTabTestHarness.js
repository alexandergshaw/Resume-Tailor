// Shared fixtures and helpers for ExperienceTab.test.js (the tab shell) and
// ExperienceTab.askAi.test.js (the Ask AI wiring). This is a plain module,
// not a `.test.js` itself - it exists so the two test files stay tested
// against the SAME fixtures rather than two copies that can drift apart
// (this repo has already been bitten by that once).
//
// `vi.mock` calls and `vi.hoisted` are hoisted above imports, so the CALLS
// to `vi.mock` themselves stay in each test file - only the mock factory
// BODIES live here (`pageEditorMockModule` / `attachmentPanelMockModule`),
// since `vi.mock` factories cannot close over an imported function.
import { vi } from "vitest";
import { createElement, act } from "react";

// Several empty async act() calls, per app/copilot/useCopilotDashboard.wiring.test.js's
// own `flush` helper: each drives React's act-queue forward one tick, which is
// what lets the mocked fetch's resolution and the setState that follows it
// actually settle and commit before the next assertion runs.
export async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

export function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

export function pendingFetch() {
  return vi.fn(() => new Promise(() => {}));
}

export async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

export const PAGE_ROOT = {
  id: "p1",
  parent_id: null,
  title: "Root Page",
  body: "",
  position: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

export const PAGE_CHILD = {
  id: "p2",
  parent_id: "p1",
  title: "Child Page",
  body: "",
  position: 0,
  archived_at: null,
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

export const PAGE_SIBLING = {
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
export const ZWSP = String.fromCodePoint(0x200b);
export function withoutZwsp(text) {
  return text.replace(new RegExp(ZWSP, "g"), "");
}

// MUI Dialog (and FormDialog/MovePageDialog, both built on it) portals its
// content onto document.body rather than nesting it under `container` - see
// MovePageDialog.test.js's own identical comment. Anything queried AFTER a
// dialog opens has to search `document`, not `container`.
export function documentButtons() {
  return [...document.querySelectorAll("button")];
}

// The row hover-actions (Add sub-page / Rename / Delete) carry their name
// only via their wrapping Tooltip's `title`, not an aria-label on the
// button itself (unlike Move, which sets aria-label directly) - found
// instead through the icon's own MUI-assigned `data-testid`.
export function rowActionButton(row, iconTestId) {
  return [...row.querySelectorAll("button")].find((b) => {
    const svg = b.querySelector("svg");
    return svg && svg.getAttribute("data-testid") === iconTestId;
  });
}

// `buttons` and `liveRegion` close over the per-file `container`, which is
// reassigned in each file's own `beforeEach` - so this takes a GETTER, not
// the container itself, and each test file builds its own bound copies:
//   const { buttons, liveRegion } = domHelpers(() => container);
export function domHelpers(getContainer) {
  return {
    buttons: () => [...getContainer().querySelectorAll("button")],
    liveRegion: () => getContainer().querySelector('[role="status"]'),
  };
}

// `render` closes over the per-file `root`, which is likewise reassigned in
// each file's own `beforeEach`:
//   const render = makeRender(() => root, ExperienceTab);
export function makeRender(getRoot, Component) {
  return async function render(props) {
    await act(async () => {
      getRoot().render(createElement(Component, props));
    });
  };
}

export function pageEditorMockModule() {
  return {
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
  };
}

export function attachmentPanelMockModule() {
  return {
    default: function MockAttachmentPanel({ pageId }) {
      return createElement("div", { "data-testid": "mock-attachment-panel", "data-page-id": pageId || "" });
    },
  };
}
