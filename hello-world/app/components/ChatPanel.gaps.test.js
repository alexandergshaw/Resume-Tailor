// @vitest-environment jsdom
//
// createRoot + act idiom (no @testing-library/react in this repo) -- as in
// app/components/preview/DriveActions.test.js.
//
// Everything else in this change is tested one link short of the point. The
// chain is:
//
//     readChatResponse(413)  ->  setChatError(msg)  ->  the user reads it
//
// and without this file the last link is untested: deleting the `chatError`
// renderer (ChatPanel.js:329-333), the `chatAttachError` renderer (:362-366),
// or the attachment chips (:346-361) leaves every other test in this change
// green while the user sees nothing at all. So the first test here does not
// invent a message -- it runs the REAL classifier and renders its REAL output,
// which is the only way the whole chain is pinned end to end.
//
// The last test is a NEW requirement, not a regression guard: marking a turn
// `failed` and re-using its slot means the user's failed message is silently
// REPLACED by their next send. Without a visible cue that is a defect we would
// be introducing, so `failed` must be observable in the thread and the Resend
// control must stay reachable on it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";
import * as chatbot from "@/lib/chat/chatbot";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

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

// The panel renders no portal (no MUI Dialog/Popper here), so the container's
// own text is the whole of what a user can read.
function screenText() {
  return container.textContent || "";
}

// A 413 exactly as the platform sends it: plain text, no content-type.
function response413() {
  return {
    ok: false,
    status: 413,
    headers: { get: () => null },
    text: async () => "Request Entity Too Large",
    json: async () => {
      throw new SyntaxError("Unexpected token 'R', \"Request En\"... is not valid JSON");
    },
  };
}

describe("ChatPanel: the classified failure actually reaches the screen", () => {
  it("renders the real readChatResponse output for a 413", async () => {
    const result = await chatbot.readChatResponse(response413());
    expect(result.ok).toBe(false);

    await render(baseProps({
      chatMessages: [{ role: "user", content: "review my resume", failed: true }],
      chatError: result.error,
    }));

    const text = screenText();
    // The whole classified message is on screen, not swallowed.
    expect(text).toContain(result.error);
    // ...and it is the actionable one, not the SyntaxError.
    expect(text).toMatch(/too (big|large)/i);
    expect(text).toMatch(/4\.5\s*MB/i);
    expect(text).not.toMatch(/Unexpected token/);
    expect(text).not.toMatch(/is not valid JSON/);
  });

  it("renders the attach refusal, naming every file a bulk add rejected", async () => {
    const refusal =
      "offer-letter-scan.png, portfolio-page-1.png and portfolio-page-2.png are too large to attach (max 2.8 MB each).";
    await render(baseProps({ chatAttachError: refusal }));

    const text = screenText();
    expect(text).toContain("offer-letter-scan.png");
    expect(text).toContain("portfolio-page-1.png");
    expect(text).toContain("portfolio-page-2.png");
  });

  it("renders one chip per attachment in the tray", async () => {
    await render(baseProps({
      chatAttachedFiles: [
        { name: "resume.pdf", kind: "binary", mimeType: "application/pdf", dataB64: "AAAA" },
        { name: "cover-letter.docx", kind: "text", content: "Dear hiring manager" },
      ],
    }));

    const text = screenText();
    expect(text).toContain("resume.pdf");
    expect(text).toContain("cover-letter.docx");
    expect(container.querySelectorAll(".MuiChip-root").length).toBeGreaterThanOrEqual(2);
  });

  it("ABSENCE CONTROL: with no error and an empty tray, none of that markup is present", async () => {
    await render(baseProps());

    const text = screenText();
    expect(text).not.toMatch(/too (big|large)/i);
    expect(text).not.toContain("resume.pdf");
    expect(container.querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });
});

describe("ChatPanel: a failed turn is visible as failed", () => {
  // Everything a user could perceive about one turn: its text, plus any
  // accessible name a cue might carry instead of visible text.
  function perceivableText(el) {
    const bits = [el.textContent || ""];
    for (const node of el.querySelectorAll("[aria-label],[title]")) {
      bits.push(node.getAttribute("aria-label") || "", node.getAttribute("title") || "");
    }
    return bits.join(" ");
  }

  function turnsMarked(value) {
    return [...container.querySelectorAll(`[data-chat-turn="${value}"]`)];
  }

  const THREAD = [
    { role: "user", content: "how do I phrase this" },
    { role: "assistant", content: "Try leading with the outcome." },
    { role: "user", content: "please review my resume", failed: true },
  ];

  it("marks the failed turn distinctly from the sent one", async () => {
    await render(baseProps({ chatMessages: THREAD }));

    const failed = turnsMarked("failed");
    const sent = turnsMarked("sent");

    // Exactly one of each, and each wraps only its own turn -- a single outer
    // wrapper carrying the attribute would fail the cross-checks below.
    expect(failed).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(failed[0].textContent).toContain("please review my resume");
    expect(failed[0].textContent).not.toContain("how do I phrase this");
    expect(sent[0].textContent).toContain("how do I phrase this");
    expect(sent[0].textContent).not.toContain("please review my resume");
  });

  it("tells the user, in words, that the failed turn was not sent", async () => {
    // A data attribute is invisible. The whole point of the requirement is
    // that the user can see which message did not go -- otherwise the slot
    // re-use replaces it with no cue at all.
    await render(baseProps({ chatMessages: THREAD }));

    const failed = turnsMarked("failed")[0];
    expect(failed).toBeDefined();
    expect(perceivableText(failed)).toMatch(/(not sent|didn'?t send|failed to send|couldn'?t send|not delivered)/i);
  });

  it("keeps Resend reachable on the failed turn", async () => {
    const props = baseProps({ chatMessages: THREAD });
    await render(props);

    const failed = turnsMarked("failed")[0];
    expect(failed).toBeDefined();
    const resend = [...failed.querySelectorAll("button")].find((b) =>
      /resend/i.test(b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || ""),
    );
    expect(resend).toBeDefined();

    await act(async () => {
      resend.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(props.resendUserMessage).toHaveBeenCalledWith(2);
  });
});

describe("ChatPanel: M6 -- deleting one chip revokes only that chip's preview URL", () => {
  let originalRevoke;
  beforeEach(() => {
    originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    if (originalRevoke) URL.revokeObjectURL = originalRevoke;
    else delete URL.revokeObjectURL;
  });

  it("revokes the deleted chip's blob URL and leaves the others alone", async () => {
    const keep = { name: "shot-keep.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA", previewUrl: "blob:keep" };
    const remove = { name: "shot-remove.png", kind: "binary", mimeType: "image/png", dataB64: "BBBB", previewUrl: "blob:remove" };
    const props = baseProps({ chatAttachedFiles: [keep, remove] });
    await render(props);

    const deleteIcons = container.querySelectorAll(".MuiChip-deleteIcon");
    expect(deleteIcons.length).toBe(2);

    await act(async () => {
      deleteIcons[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:remove");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:keep");
    expect(props.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    // A setter may be called with a value or an updater function.
    const arg = props.setChatAttachedFiles.mock.calls[0][0];
    const result = typeof arg === "function" ? arg(props.chatAttachedFiles) : arg;
    expect(result).toEqual([keep]);
  });
});

describe("ChatPanel: m8 -- the failed-turn cue is perceivable, not just visible", () => {
  const THREAD_ONE_FAILED = [{ role: "user", content: "please review my resume", failed: true }];

  it("carries role=\"status\" so a screen reader announces it without the user having to look", async () => {
    await render(baseProps({ chatMessages: THREAD_ONE_FAILED }));

    const status = container.querySelector('[role="status"]');
    expect(status).toBeDefined();
    expect(status).not.toBeNull();
    expect((status.textContent || "")).toMatch(/not sent/i);
  });

  it("is no smaller than the other error text in the panel (chatError, 0.85rem)", async () => {
    // Same technique as app/components/preview/DriveResultRegion.test.js's
    // `cssRuleTextFor`: read the actual CSS text emotion (MUI's `sx` engine)
    // emitted for this element's own generated class, rather than trusting
    // jsdom's `getComputedStyle` (which does not reliably resolve the
    // cascade here).
    await render(baseProps({ chatMessages: THREAD_ONE_FAILED, chatError: "Something went wrong." }));

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    const cssClass = [...status.classList].find((c) => c.startsWith("css-"));
    expect(cssClass).toBeDefined();
    const ruleText = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .filter((rule) => rule.selectorText && rule.selectorText.includes(cssClass))
      .map((rule) => rule.cssText)
      .join(" ");

    // Previously 11px -- the smallest text in the whole panel.
    expect(ruleText).not.toMatch(/font-size:\s*11px/);
    expect(ruleText).toMatch(/font-size:\s*0\.85rem/);
  });
});
