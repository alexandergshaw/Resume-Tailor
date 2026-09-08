// @vitest-environment jsdom
//
// AC-K-B1 (half 2 of 2): THE AI HELP PANEL MUST BE DISMISSIBLE BY KEYBOARD.
//
// THE DEFECT THIS FILE FALSIFIES
// ------------------------------
// The chat panel is `position: fixed; zIndex: 1100` (`ChatPanel.js:78-88`) and
// covers the bottom-right of every page. Its ONLY two dismissal routes today
// are both mouse-only:
//
//   1. the AI Help Fab, which has no `onClick` at all (see
//      `ChatFab.keyboard.test.js`); and
//   2. `app/hooks/useChat.js:144-158`, a `document.addEventListener("mousedown", ...)`
//      outside-click handler -- `mousedown`, not `keydown`.
//
// `ChatPanel.js` renders NO close control (its header at `:127-197` holds only
// the title, the "Offline - no AI" chip and a conditional "Clear") and handles
// NO Escape (the file's single `onKeyDown`, at `:551`, is the composer's
// Enter-to-send). So a keyboard user who opens the panel through one of the
// "Ask AI" buttons (`TrackingTab.js:767`, `page.js:1218` -> `chatbot.js`
// `askAiAbout`) is left with a fixed overlay they cannot dismiss for the rest
// of the session. This is the single worst finding in the keyboard audit.
//
// REQUIRED PROP CONTRACT ADDED BY THE FIX
//
//   onClose: () => void          // hoisted from useChat's setChatOpen(false)
//   returnFocusRef: React.Ref    // the AI Help launcher, so focus is not lost
//
// `returnFocusRef` exists because dismissing the panel UNMOUNTS the control the
// user just activated. This repo has already shipped that defect once
// (StatusBar's Remove/Ignore dropping focus to <body>); `ExperienceTab.js:294-309`
// and `AttachmentPanel.retryFocus.test.js` are the in-repo pattern for doing it
// right. Focus must land on the launcher, never on <body>.
//
//   MANUAL / BROWSER-ONLY (not asserted here, and not claimed):
//     * The close control's focus ring is visible and not clipped by the
//       panel's `overflow: hidden` (`ChatPanel.js:87`) -- jsdom has no layout.
//     * A real Escape key press (jsdom dispatches the event; only a browser
//       proves the key produces it).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let launcher;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  // Stands in for the AI Help launcher that lives outside the panel.
  launcher = document.createElement("button");
  launcher.textContent = "AI Help";
  document.body.appendChild(launcher);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  launcher.remove();
  vi.restoreAllMocks();
});

function accessibleName(node) {
  if (!node) return "";
  const labelled = node.getAttribute("aria-labelledby");
  if (labelled) {
    const target = document.getElementById(labelled);
    if (target) return (target.textContent || "").trim();
  }
  return (
    node.getAttribute("aria-label")
    || (node.textContent || "").trim()
    || node.getAttribute("title")
    || ""
  ).trim();
}

function closeControl() {
  return Array.from(container.querySelectorAll('button, [role="button"]')).find((node) =>
    /^close\b|close ai help|close the chat|dismiss/i.test(accessibleName(node))
  );
}

const panelRef = { current: null };

function baseProps(overrides = {}) {
  return {
    chatPanelRef: panelRef,
    chatScrollRef: { current: null },
    chatInputRef: { current: null },
    chatDragActive: false,
    setChatDragActive: vi.fn(),
    addChatAttachments: vi.fn(),
    fabPos: { bottom: 24, right: 24 },
    chatSize: { width: 380, height: 520 },
    startChatResize: vi.fn(),
    chatMessages: [],
    setChatMessages: vi.fn(),
    chatError: "",
    setChatError: vi.fn(),
    chatPinnedContext: null,
    setChatPinnedContext: vi.fn(),
    chatSending: false,
    chatCopiedIndex: null,
    setChatCopiedIndex: vi.fn(),
    resendUserMessage: vi.fn(),
    chatAttachedFiles: [],
    setChatAttachedFiles: vi.fn(),
    chatAttachError: "",
    setChatAttachError: vi.fn(),
    chatInput: "",
    setChatInput: vi.fn(),
    sendChatMessage: vi.fn(),
    onClose: vi.fn(),
    returnFocusRef: { current: launcher },
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(ChatPanel, props));
  });
  return container;
}

describe("ChatPanel -- a keyboard user can dismiss the AI Help overlay", () => {
  it("renders a close control with an accessible name", async () => {
    await render(baseProps());
    const close = closeControl();
    expect(close, "the panel renders no control named 'Close'").toBeTruthy();
    // Native <button>: Enter AND Space come from the browser for free, and no
    // hand-rolled key handler can get them wrong.
    expect(close.tagName).toBe("BUTTON");
    expect(close.classList.contains("MuiButtonBase-root"), "opts out of the app-wide focus ring").toBe(true);
  });

  it("closes when the close control is activated", async () => {
    const props = baseProps();
    await render(props);
    const close = closeControl();
    expect(close).toBeTruthy();
    await act(async () => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the launcher rather than dropping it on <body>", async () => {
    // Activating the close control destroys the control itself. Without an
    // explicit restore, focus falls to <body> and the user loses their place in
    // a ~200-stop page.
    const props = baseProps();
    await render(props);
    const close = closeControl();
    expect(close).toBeTruthy();
    close.focus();
    await act(async () => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(launcher);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("closes on Escape pressed anywhere inside the panel", async () => {
    const props = baseProps();
    const el = await render(props);
    const panel = panelRef.current || el.firstElementChild;
    expect(panel, "chatPanelRef was never attached").toBeTruthy();
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape while focus is in the message composer", async () => {
    // The composer already owns Enter (`ChatPanel.js:551`). Escape must still
    // reach the panel from inside it -- this is where a keyboard user actually
    // is when they want out.
    const props = baseProps({ chatInput: "half a question" });
    const el = await render(props);
    const composer = el.querySelector("textarea");
    expect(composer, "no composer rendered").toBeTruthy();
    await act(async () => {
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the launcher after an Escape dismissal too", async () => {
    const props = baseProps();
    const el = await render(props);
    const panel = panelRef.current || el.firstElementChild;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(launcher);
  });

  it("GUARD (passes before the fix): the Clear control is untouched", async () => {
    // Passes today. Present so a fix that adds a close button by replacing the
    // header wholesale cannot silently drop the thread reset -- Clear is the
    // only way out of an unsendable bulk-attach payload.
    await render(baseProps({ chatMessages: [{ role: "user", content: "hi" }] }));
    const clear = Array.from(container.querySelectorAll("button")).find((n) =>
      /^clear$/i.test(accessibleName(n))
    );
    expect(clear).toBeTruthy();
  });
});
