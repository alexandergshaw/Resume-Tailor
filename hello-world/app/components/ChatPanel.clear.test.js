// @vitest-environment jsdom
//
// The createRoot + act idiom (no @testing-library/react in this repo) --
// same as app/components/preview/DriveActions.test.js and
// app/components/JobDescriptionTab.test.js.
//
// `Clear` is the one control a stuck user reaches for. Today
// (the header **Clear** button's `onClick` in `ChatPanel.js`) it:
//
//   * renders ONLY when `chatMessages.length > 0`, and
//   * does `setChatMessages([]); setChatError("")` -- leaving the attachment
//     tray, and therefore the multi-megabyte payload, exactly where it was.
//
// Both are wrong for the 413 loop. The bulk-attach path
// (ExperienceTab.js:471 -> addChatAttachments) puts chips in the tray with
// ZERO messages sent, so a user can be holding an unsendable payload with no
// Clear button on screen at all; and even with messages, pressing Clear
// leaves the payload in place so the next send 413s again.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  // MUI's useMediaQuery (via app/hooks/useResponsive) feature-detects
  // matchMedia; jsdom has none. Stub a desktop viewport so the panel renders
  // its floating-desktop branch deterministically.
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
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function baseProps(overrides = {}) {
  return {
    chatPanelRef: { current: null },
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
    chatInput: "",
    setChatInput: vi.fn(),
    sendChatMessage: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(ChatPanel, props));
  });
}

function clearButton() {
  return [...container.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Clear",
  );
}

// A setter may be called with a value or with an updater; resolve either.
function resolvedArg(spy, prev) {
  const arg = spy.mock.calls[0][0];
  return typeof arg === "function" ? arg(prev) : arg;
}

const ATTACHMENT = { name: "offer-letter-scan.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA" };

describe("ChatPanel: when Clear is offered", () => {
  it("ABSENCE CONTROL: no Clear with an empty thread and an empty tray", async () => {
    await render(baseProps());
    expect(clearButton()).toBeUndefined();
  });

  it("offers Clear when there are messages but no attachments (today's behaviour, kept)", async () => {
    await render(baseProps({ chatMessages: [{ role: "user", content: "hi" }] }));
    expect(clearButton()).toBeDefined();
  });

  it("offers Clear when there are attachments but NO messages", async () => {
    // This is the bulk-attach state: chips in the tray, nothing sent yet.
    // Without this, a user handed an unsendable payload has no way out but a
    // page reload.
    await render(baseProps({ chatAttachedFiles: [ATTACHMENT] }));
    expect(clearButton()).toBeDefined();
  });
});

describe("ChatPanel: what Clear clears", () => {
  it("clears the attachment tray as well as the thread and the error", async () => {
    const props = baseProps({
      chatMessages: [{ role: "user", content: "review this", failed: true }],
      chatError: "That was too big to send.",
      chatAttachedFiles: [ATTACHMENT],
    });
    await render(props);

    const button = clearButton();
    expect(button).toBeDefined();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(props.setChatMessages).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatMessages, props.chatMessages)).toEqual([]);

    expect(props.setChatError).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatError, props.chatError)).toBe("");

    // The point of the fix: the payload goes with it.
    expect(props.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatAttachedFiles, props.chatAttachedFiles)).toEqual([]);
  });

  it("clears the tray from the messages-free bulk-attach state too", async () => {
    const props = baseProps({ chatAttachedFiles: [ATTACHMENT] });
    await render(props);

    const button = clearButton();
    expect(button).toBeDefined();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(props.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatAttachedFiles, props.chatAttachedFiles)).toEqual([]);
  });
});

describe("ChatPanel: M5 -- Clear does not strand a stale attachment error", () => {
  it("clears chatAttachError too, when the prop is supplied", async () => {
    const props = baseProps({
      chatAttachedFiles: [ATTACHMENT],
      chatAttachError: "reference.png, portfolio.png and offer-letter.png are too large to attach (max 2.8 MB each).",
      setChatAttachError: vi.fn(),
    });
    await render(props);

    const button = clearButton();
    expect(button).toBeDefined();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(props.setChatAttachError).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatAttachError, props.chatAttachError)).toBe("");
  });

  it("PAIRED POSITIVE CONTROL: Clear still works when setChatAttachError is not passed at all", async () => {
    // Older/other callers may not supply this prop -- Clear must not crash.
    const props = baseProps({ chatAttachedFiles: [ATTACHMENT], chatAttachError: "too big." });
    delete props.setChatAttachError;
    await render(props);

    const button = clearButton();
    expect(button).toBeDefined();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // No throw, and the rest of Clear's job still happened.
    expect(props.setChatAttachedFiles).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPanel: M6 -- Clear revokes every attachment's preview blob URL", () => {
  let originalRevoke;
  beforeEach(() => {
    originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    if (originalRevoke) URL.revokeObjectURL = originalRevoke;
    else delete URL.revokeObjectURL;
  });

  it("revokes each chip's preview URL before emptying the tray", async () => {
    const withPreview1 = { name: "shot-1.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA", previewUrl: "blob:one" };
    const withPreview2 = { name: "shot-2.png", kind: "binary", mimeType: "image/png", dataB64: "BBBB", previewUrl: "blob:two" };
    const noPreview = { name: "resume.pdf", kind: "binary", mimeType: "application/pdf", dataB64: "CCCC", previewUrl: null };
    const props = baseProps({ chatAttachedFiles: [withPreview1, withPreview2, noPreview] });
    await render(props);

    const button = clearButton();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:two");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe("ChatPanel: AC-36 -- Clear is the recommended remedy, so it must not destroy the question", () => {
  // A2's transcript refusal tells the user to press Clear. That advice is only
  // honest if pressing it leaves what they were asking about intact: the
  // composer text is restored there by the refusal itself
  // (lib/chat/chatbot.refusal.test.js, AC-30), and Clear must not then wipe it.
  //
  // AC-36's checkable is "chatInput is non-empty after the refusal AND STILL
  // non-empty after pressing Clear". This is that second half. MUTATION PROOF:
  // add `setChatInput("")` to the Clear handler (`ChatPanel.js`) and
  // this goes red while every other test in this file stays green.
  const QUESTION = "does this bullet land for a senior PM role?";

  function composerValue() {
    const el = container.querySelector("textarea:not([aria-hidden])");
    return el ? el.value : null;
  }

  it("Clear empties the thread, the error and the tray -- and leaves chatInput alone", async () => {
    const props = baseProps({
      chatMessages: [{ role: "user", content: "review this", failed: true }],
      chatError: "That message is too large to send (the platform limit is 4.5 MB total).",
      chatAttachedFiles: [ATTACHMENT],
      chatInput: QUESTION,
    });
    await render(props);
    expect(composerValue()).toBe(QUESTION);

    const button = clearButton();
    expect(button).toBeDefined();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // ABSENCE: the composer setter is never touched...
    expect(props.setChatInput).not.toHaveBeenCalled();
    // ...and the text is still on screen, since ChatPanel holds it in a
    // controlled value that nothing in the Clear handler writes to.
    expect(composerValue()).toBe(QUESTION);

    // PAIRED POSITIVE CONTROLS, so the absence above cannot be satisfied by a
    // Clear button that simply did nothing at all.
    expect(props.setChatMessages).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatMessages, props.chatMessages)).toEqual([]);
    expect(props.setChatError).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatError, props.chatError)).toBe("");
    expect(props.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(resolvedArg(props.setChatAttachedFiles, props.chatAttachedFiles)).toEqual([]);
  });

  it("Send is still reachable and available with the restored text, so Clear -> Send is 2 clicks", async () => {
    // The click-count claim A2 makes for the transcript state is
    // Send(1) -> Clear(2) -> Send(3), with NO retype. That only holds if Send
    // is available off the restored text. AC-31h retired the `disabled`
    // attribute on this control (a disabled control cannot hold focus, which
    // drops a keyboard user to <body>) in favour of `aria-disabled` -- see
    // `const sendUnavailable = chatSending || !chatInput.trim()` in
    // `ChatPanel.js` -- so an empty composer would have left the user
    // retyping the whole question.
    const props = baseProps({
      chatMessages: [{ role: "user", content: "review this", failed: true }],
      chatInput: QUESTION,
    });
    await render(props);

    const send = [...container.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === "Send");
    expect(send).toBeDefined();
    // Real assertion on the live mechanism, not the retired `disabled`
    // attribute: [MEASURED, this repo] a MUI Button given `aria-disabled`
    // and no `disabled` renders the boolean literally, so "available" is
    // `aria-disabled="false"`, never absent.
    expect(send.getAttribute("aria-disabled")).toBe("false");

    await act(async () => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(props.sendChatMessage).toHaveBeenCalledTimes(1);
  });

  it("ABSENCE CONTROL: with an empty composer, Send is aria-disabled -- so the restore is load-bearing", async () => {
    const props = baseProps({
      chatMessages: [{ role: "user", content: "review this", failed: true }],
      chatInput: "",
    });
    await render(props);

    const send = [...container.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === "Send");
    expect(send).toBeDefined();
    // AC-31h retired the `disabled` attribute on Send in favour of
    // `aria-disabled` (a disabled control cannot hold focus, which drops a
    // keyboard user to <body>). Assert the real mechanism...
    expect(send.getAttribute("aria-disabled")).toBe("true");
    // ...and, as a regression guard, that the retired attribute has not come
    // back.
    expect(send.hasAttribute("disabled")).toBe(false);
  });
});
