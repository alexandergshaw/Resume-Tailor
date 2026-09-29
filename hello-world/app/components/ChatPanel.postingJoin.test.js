// @vitest-environment jsdom
//
// N65 step 3 — the JOIN (criterion #5): the posting descriptor must survive the
// real chatPinnedContext path from askAiAbout into the ChatPanel affordance and
// out to the estimate request.
//
// The shipped ChatPanel.salaryEstimate.test.js proves the button renders from a
// HAND-BUILT `{ posting }` fixture. That is exactly the "test the join with a
// hand-built fixture of what you think it wants" hazard: it cannot catch
// askAiAbout writing a DIFFERENT shape than ChatPanel reads. This test closes
// the seam by feeding the object the REAL chatbot.js askAiAbout produces into
// the REAL ChatPanel — no hand-built pinned context.
//
// RED on HEAD: askAiAbout (chatbot.js) forwards no `posting`, so the object it
// writes has none, so ChatPanel renders no "Estimate salary" button and the
// click can never happen.
//
// The two held hops the render cannot exercise — useChat's state and page.js's
// prop pass — are covered by the verbatim-pass-through source guards at the end
// (the remedy for "a harness that wires the component differently from
// production": assert the real call site passes the value).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";
import { createChatHandlers } from "@/lib/chat/chatbot.js";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POSTING = { title: "Senior Platform Engineer", company: "Acme", location: "Remote (US)", salaryStated: false };

const WITHHELD = {
  status: "insufficient_sources",
  reason: "no_sources",
  range: null,
  basisKind: "none",
  sourceCount: 0,
  citations: [],
  searched: true,
  truncated: false,
};

let container;
let root;
let originalFetch;

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
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Runs the REAL askAiAbout and returns the pinned-context object it wrote.
function pinnedContextFrom(arg) {
  let pinned = null;
  const deps = {
    setChatPinnedContext: (v) => {
      pinned = v;
    },
    setChatError: vi.fn(),
    setChatInput: vi.fn(),
    setChatOpen: vi.fn(),
    chatInputRef: { current: null },
  };
  createChatHandlers(deps).askAiAbout(arg);
  return pinned;
}

function accessibleName(node) {
  if (!node) return "";
  return (node.getAttribute("aria-label") || (node.textContent || "").trim() || node.getAttribute("title") || "").trim();
}

function estimateButton() {
  return Array.from(container.querySelectorAll('button, [role="button"]')).find((n) => /estimate salary/i.test(accessibleName(n)));
}

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

async function render(props) {
  await act(async () => {
    root.render(createElement(ChatPanel, props));
  });
}

describe("posting survives askAiAbout -> pinned context -> ChatPanel (#5 join)", () => {
  it("the object askAiAbout writes makes ChatPanel offer 'Estimate salary', and one click POSTs that posting", async () => {
    const pinned = pinnedContextFrom({ label: "Senior Platform Engineer · Acme", content: "the JD", posting: POSTING });
    // RED on HEAD: askAiAbout forwards no posting, so this guard fails first and
    // names the break precisely (rather than only the missing button below).
    expect(pinned.posting, "askAiAbout did not carry the posting into the pinned context").toBeTruthy();

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ salaryEstimate: WITHHELD }) });
    globalThis.fetch = fetchSpy;

    await render(baseProps({ chatPinnedContext: pinned }));
    const btn = estimateButton();
    expect(btn, "the real pinned-context object did not light the 'Estimate salary' affordance").toBeTruthy();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/salary-estimate");
    // The posting the user pinned reached the request unchanged — the whole point.
    expect(JSON.parse(init.body)).toMatchObject({ title: "Senior Platform Engineer", company: "Acme" });
  });

  it("CONTROL: a non-posting subject (no posting arg) lights NO affordance", async () => {
    // Distinguishes the join from a build that shows the button unconditionally.
    const pinned = pinnedContextFrom({ label: "My resume", content: "resume text" });
    await render(baseProps({ chatPinnedContext: pinned }));
    expect(estimateButton()).toBeFalsy();
  });
});

// The two held hops the render above cannot exercise (useChat state, page.js
// prop). These are GREEN today; they guard against a future edit to a held file
// that strips the posting in transit — the failure mode a component render can
// never see because it starts downstream of both.
describe("held pass-through is verbatim (guards, green today)", () => {
  const readSrc = (rel) => stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

  it("useChat stores chatPinnedContext as raw useState (no field-stripping reconstruction)", () => {
    const src = readSrc("../hooks/useChat.js");
    // A raw useState pair keeps whatever object askAiAbout wrote, posting and
    // all. Canary: the exact setter name must be the one askAiAbout calls.
    expect(src).toMatch(/const\s*\[\s*chatPinnedContext\s*,\s*setChatPinnedContext\s*\]\s*=\s*useState\(/);
  });

  it("page.js passes chatPinnedContext WHOLE to ChatPanel", () => {
    const src = readSrc("../page.js");
    // The whole object crosses the boundary; a reconstruction here is the exact
    // "prop enumerated by hand drops the new field" hazard.
    expect(src).toMatch(/chatPinnedContext=\{\s*chat\.chatPinnedContext\s*\}/);
  });
});
