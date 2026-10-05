// @vitest-environment jsdom
//
// N103 Step 9 (4b) -- the CHAT wiring, driven through the REAL ChatPanel. The
// review control is reachable above the composer, works on the EMBEDDED engine
// (key-free, unlike the chat's Gemini-gated features -- AC-5), and reviews the
// NAMED current document (AC-2). The engine is read from the real store
// (localStorage "tailorEngine"), as production does.
//
// RED on HEAD: ChatPanel has no review row and ignores the new chatReviewDocument
// prop, so no /review/i control renders.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let originalFetch;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  try {
    localStorage.setItem("tailorEngine", "embedded");
  } catch {
    /* storage may be unavailable */
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
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
    setChatAttachError: vi.fn(),
    chatInput: "",
    setChatInput: vi.fn(),
    sendChatMessage: vi.fn(),
    onClose: vi.fn(),
    returnFocusRef: { current: null },
    ...overrides,
  };
}

const REVIEW_DOC_B = {
  kind: "applicationReady",
  title: "Acme · Staff Engineer — Resume",
  resultLines: ["Owned the billing rewrite from design to launch.", "Improved conversion by 300% in a quarter."],
  posting: null,
  realMaterial: null,
};

// `\breview` matches "Review..."/"Reviewing..." but NOT "Preview" (R-7).
const reviewButton = () => [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));

async function render(props) {
  await act(async () => root.render(createElement(ChatPanel, props)));
}

describe("ChatPanel -- the review control is reachable & embedded-enabled (AC-5)", () => {
  it("renders a /review/i control, enabled (never `disabled`) on the embedded engine, with no Offline gate on it", async () => {
    await render(baseProps({ chatReviewDocument: REVIEW_DOC_B }));
    const btn = reviewButton();
    expect(btn, "the chat must expose a review control").toBeTruthy();
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("ChatPanel -- reviews the NAMED current document (AC-2)", () => {
  it("one click reviews the selected document and quotes its own planted line and names its subject", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    globalThis.fetch = fetchSpy;
    await render(baseProps({ chatReviewDocument: REVIEW_DOC_B }));
    await act(async () => {
      reviewButton().click();
    });
    const body = container.textContent || "";
    const quoted = [...container.querySelectorAll("[data-quoted]")].map((n) => n.textContent || "");
    expect(quoted.some((t) => t.includes("300%"))).toBe(true);
    expect(body).toContain("Acme · Staff Engineer — Resume");
    // Offline: no network touched.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with NO current document the chat shows a 'nothing to review' state, never a clean verdict", async () => {
    await render(baseProps({ chatReviewDocument: null }));
    const body = container.textContent || "";
    expect(body).toMatch(/nothing to review/i);
    expect(body).not.toMatch(/no issues flagged/i);
  });
});
