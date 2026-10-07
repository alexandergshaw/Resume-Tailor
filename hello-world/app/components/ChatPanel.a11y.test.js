// @vitest-environment jsdom
//
// N123 step-4b (TDD hand-off) -- the chat-modal overhaul A11Y pins:
// describedby wiring (T15), the H3 subject-naming equality (T16), the A11Y-1
// contrast token swaps (T17), and declared touch-target heights (T7).
//
// createRoot + act idiom; the voice preference + engine are read from the store
// (useAnswerAsMe / useEngine), so each case SEEDS localStorage the way the real
// controls write it and mounts the real ChatPanel -- it never calls a setter.
//
// RED vs GREEN at HEAD (disclosed; standing rule 1):
//   RED at HEAD:
//     T15-ON  -- on the AI engine with the voice preference ON, the switch has
//                NO aria-describedby today (it is set only when embedded); the
//                overhaul (R-2) moves the "in your voice" indication into a
//                hidden describedby node.
//     T17     -- the embedded note is --text-muted today (wants --text-secondary)
//                and the Context label + Estimate salary are --accent today
//                (want --accent-hover). Goes green at plan Step 5 (separable);
//                this file reds until then.
//     T7      -- the composer Send + attach carry no declared min-height today.
//   GREEN at HEAD -- regression guards that must stay green through the split:
//     T15-embedded -- the embedded note (id=chat-answer-as-me-note) is referenced
//                     by the switch's aria-describedby.
//     T16          -- the chat Review control's aria-describedby text equals the
//                     visible Context label (H3; the SILENT R5 risk, no other
//                     HEAD guard).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENGINE_KEY = "tailorEngine";
const ANSWER_AS_ME_KEY = "chatAnswerAsMe";
const NOTE_ID = "chat-answer-as-me-note";

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  }
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
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

const DOC = {
  kind: "applicationReady",
  scope: "resume",
  title: "Acme - Staff Engineer - Resume",
  resultLines: ["Owned the billing rewrite from design to launch."],
  posting: null,
  realMaterial: null,
};

async function render(props) {
  await act(async () => root.render(createElement(ChatPanel, props)));
}

const reviewButton = () => [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));
const closeButton = () => container.querySelector('[aria-label="Close"]');
const sendButton = () => [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Send");
const attachControl = () => container.querySelector('input[type="file"]')?.closest("label, button") ?? null;
function answerSwitch() {
  return [...container.querySelectorAll('input[type="checkbox"]')].find((el) => /answer as me/i.test((el.closest("label")?.textContent || "")));
}

// aria-describedby -> the concatenated text of the referenced node(s).
function describedbyText(el) {
  const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
}
function describedbyNodes(el) {
  const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)).filter(Boolean);
}

function emittedCssFor(el) {
  const cssClass = [...el.classList].find((c) => c.startsWith("css-"));
  if (!cssClass) return "";
  return [...document.styleSheets]
    .flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
    .filter((rule) => rule.selectorText && rule.selectorText.includes(cssClass))
    .map((rule) => rule.cssText)
    .join(" ");
}

describe("N123 T15 -- the Answer-as-me describedby wiring", () => {
  it("GUARD (embedded): the visible note (id=chat-answer-as-me-note) is referenced by the switch", async () => {
    window.localStorage.setItem(ENGINE_KEY, "embedded");
    await render(baseProps());
    const sw = answerSwitch();
    expect(sw, "no Answer-as-me switch").toBeTruthy();
    const note = document.getElementById(NOTE_ID);
    expect(note, "the embedded note is missing").not.toBeNull();
    expect((note.textContent || "")).toMatch(/applies to the AI engine|ai engine/i);
    expect((sw.getAttribute("aria-describedby") || "").split(/\s+/)).toContain(NOTE_ID);
  });

  it("ON (AI engine, voice ON): the switch's aria-describedby resolves to non-empty text, outside any live region", async () => {
    window.localStorage.setItem(ENGINE_KEY, "gemini");
    window.localStorage.setItem(ANSWER_AS_ME_KEY, "true");
    await render(baseProps());
    const sw = answerSwitch();
    expect(sw, "no Answer-as-me switch").toBeTruthy();
    expect(sw.checked, "CONTROL: the switch is actually ON for this case").toBe(true);

    // RED at HEAD: not-embedded => the switch has no aria-describedby at all.
    const text = describedbyText(sw);
    expect(text, "ON state exposes no programmatic description (R-2 hidden describedby is unbuilt)").not.toBe("");
    expect(text).toMatch(/voice/i);

    // The description must not sit in a live region, or toggling the switch
    // would speak through an announcer (the switch's own checked state is the
    // announcement -- no live region).
    for (const node of describedbyNodes(sw)) {
      expect(node.closest('[role="status"], [role="alert"], [aria-live]'), "the voice description is inside a live region").toBeNull();
    }
  });

  it("CONTROL (AI engine, voice OFF): no voice description is wired", async () => {
    window.localStorage.setItem(ENGINE_KEY, "gemini");
    window.localStorage.setItem(ANSWER_AS_ME_KEY, "false");
    await render(baseProps());
    const sw = answerSwitch();
    expect(sw.checked).toBe(false);
    expect(describedbyText(sw)).toBe("");
  });
});

describe("N123 T16 (H3, SILENT R5 guard) -- the review subject is named before the click", () => {
  it("the Review control's aria-describedby text equals the visible Context label", async () => {
    window.localStorage.setItem(ENGINE_KEY, "gemini");
    const label = "Acme - Staff Engineer - Resume";
    await render(baseProps({
      chatReviewDocument: { ...DOC, title: label },
      chatPinnedContext: { label, content: "a posting" },
    }));
    const review = reviewButton();
    expect(review, "no Review control").toBeTruthy();
    const described = describedbyText(review);
    expect(described, "the Review control has no resolvable aria-describedby").not.toBe("");
    // The same subject string the Context bar shows (selectReviewDocument.js:92
    // sets title = pinnedContext.label), so the user knows what a click reviews.
    expect(described).toBe(label);
    // POSITIVE CONTROL: that label really is on screen in the Context bar.
    expect(container.textContent).toContain(label);
  });
});

describe("N123 T17 (A11Y-1, plan Step 5) -- contrast token swaps", () => {
  it("the embedded note uses --text-secondary, not --text-muted", async () => {
    window.localStorage.setItem(ENGINE_KEY, "embedded");
    await render(baseProps());
    const note = document.getElementById(NOTE_ID);
    expect(note, "no embedded note").not.toBeNull();
    const css = emittedCssFor(note);
    expect(css, "CANARY: emittedCssFor read no rules for the note").not.toBe("");
    // RED at HEAD: the note is --text-muted (4.15:1 light, under 4.5).
    expect(css, "embedded note is not --text-secondary").toMatch(/color:\s*var\(--text-secondary\)/);
    expect(css).not.toMatch(/color:\s*var\(--text-muted\)/);
  });

  it("the Context 'CONTEXT' label uses --accent-hover", async () => {
    window.localStorage.setItem(ENGINE_KEY, "gemini");
    await render(baseProps({ chatPinnedContext: { label: "Acme - Staff Engineer", content: "a posting" } }));
    const contextLabel = [...container.querySelectorAll("*")].find((el) => (el.textContent || "").trim() === "Context" && el.children.length === 0);
    expect(contextLabel, "no CONTEXT label").toBeTruthy();
    const css = emittedCssFor(contextLabel);
    expect(css, "CANARY: emittedCssFor read no rules for the CONTEXT label").not.toBe("");
    // RED at HEAD: --accent (4.36:1 dark, under 4.5).
    expect(css, "CONTEXT label is not --accent-hover").toMatch(/color:\s*var\(--accent-hover\)/);
  });

  it("the Estimate salary control uses --accent-hover", async () => {
    window.localStorage.setItem(ENGINE_KEY, "gemini");
    await render(baseProps({ chatPinnedContext: { label: "Acme - Staff Engineer", content: "a posting", posting: { salaryStated: false } } }));
    const estimate = [...container.querySelectorAll("button")].find((b) => /estimate salary/i.test((b.textContent || "")));
    expect(estimate, "no Estimate salary control -- the posting has no stated salary so it should show").toBeTruthy();
    const css = emittedCssFor(estimate);
    expect(css, "CANARY: emittedCssFor read no rules for Estimate salary").not.toBe("");
    expect(css, "Estimate salary is not --accent-hover").toMatch(/color:\s*var\(--accent-hover\)/);
  });
});

describe("N123 T7 -- declared touch-target heights (the atWidth cascade harness, DECLARED values not layout)", () => {
  it("CANARY: atWidth resolves responsive min-height -- the Close button is 44px at 375 and not 44px at 1280", async () => {
    // Close already carries TOUCH_ICON_SX (minHeight {xs:44, sm:"auto"}). If
    // this canary did not discriminate, every RED below would be a harness
    // artifact rather than a real absence.
    await render(baseProps());
    const close = closeButton();
    expect(close, "no Close button").not.toBeNull();
    const at375 = atWidth(375, () => getComputedStyle(close).minHeight);
    const at1280 = atWidth(1280, () => getComputedStyle(close).minHeight);
    expect(at375, "atWidth did not read the phone min-height -- the harness is blind").toBe("44px");
    expect(at1280).not.toBe("44px");
  });

  it("Send declares min-height 44 at 375 and 40 at 1280", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));
    const send = sendButton();
    expect(send, "no Send button").toBeTruthy();
    // RED at HEAD: Send carries no min-height, so both reads are "auto"/0.
    expect(atWidth(375, () => getComputedStyle(send).minHeight), "Send is under the 44px phone tap target").toBe("44px");
    expect(atWidth(1280, () => getComputedStyle(send).minHeight), "Send is not the unified 40px at desktop").toBe("40px");
  });

  it("the attach control declares min-height 44 at 375 and 40 at 1280", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));
    const attach = attachControl();
    expect(attach, "no attach control").not.toBeNull();
    expect(atWidth(375, () => getComputedStyle(attach).minHeight), "attach is under the 44px phone tap target").toBe("44px");
    expect(atWidth(1280, () => getComputedStyle(attach).minHeight), "attach is not the unified 40px at desktop").toBe("40px");
  });
});
