// @vitest-environment jsdom
//
// N113 part 6 -- how the chat announces a review's outcome, by severity.
//
// The preview modal announces a review that could not run as an assertive alert that
// persists (the user must act: try again) and every other outcome politely. The chat
// used to funnel BOTH through its polite progress cue, so a failure sat in the polite
// queue behind whatever was being read. The chat now has the same two channels:
//
//   * a failed review      -> an always-mounted role="alert" region, no auto-clear;
//   * a finished / empty / covered review, and the send cues ("Sending...", "Reply
//     ready") -> the existing polite role="status" progress region, unchanged.
//
// Neither carries the findings (cues only), and neither sits inside the aria-busy
// turn list, which would silence it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/review/runDocumentReview.js", () => ({ runDocumentReview: vi.fn() }));

import { runDocumentReview } from "@/lib/review/runDocumentReview.js";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

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
  runDocumentReview.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
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
  title: "Acme - Staff Engineer - Resume",
  resultLines: ["Owned the billing rewrite from design to launch."],
  posting: null,
  realMaterial: null,
};

const reviewedOutcome = {
  status: "reviewed",
  draftKind: "applicationReady",
  title: DOC.title,
  flags: [{ category: "unverifiable-metric", spanId: "s1", draftKind: "applicationReady", message: "m", excerpt: "FINDING_EXCERPT" }],
  unresolvedQualifications: [],
  verdictKind: "partial",
  missingChecks: [],
  checkedChecks: ["repetition"],
  engineMode: "mechanical-only",
  lineCount: 1,
  inputs: { posting: true, realMaterial: true },
};

const reviewButton = () => [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));
const progressRegion = () => container.querySelector('[data-chat-status="progress"]');
// The chat's review alert: the one role="alert" node in the panel.
const alertRegions = () => [...container.querySelectorAll('[role="alert"]')];
const alertRegion = () => alertRegions()[0] ?? null;

async function render(props) {
  await act(async () => root.render(createElement(ChatPanel, props)));
}
async function runReview() {
  await act(async () => {
    reviewButton().click();
  });
}

describe("a failed review is announced assertively", () => {
  it("mounts an always-present, empty role=alert region before any review, visible to assistive tech", async () => {
    await render(baseProps({ chatReviewDocument: DOC }));
    const region = alertRegion();
    expect(region, "no assertive region exists to receive a failure").not.toBeNull();
    expect(alertRegions()).toHaveLength(1);
    expect(region.textContent).toBe("");
    // Hiding it would pull it out of the accessibility tree and silence it.
    expect(region.hasAttribute("hidden")).toBe(false);
    expect(region.getAttribute("aria-hidden")).toBeNull();
    expect(region.style.display).not.toBe("none");
    expect(region.style.visibility).not.toBe("hidden");
    // Assertive, never downgraded to polite.
    expect(region.getAttribute("aria-live")).not.toBe("polite");
  });

  it("a failure lands in the alert region, not in the polite progress cue", async () => {
    runDocumentReview.mockRejectedValue(new Error("boom"));
    await render(baseProps({ chatReviewDocument: DOC }));
    const region = alertRegion();
    await runReview();
    expect(alertRegion()).toBe(region);
    expect(region.textContent).toMatch(/could not run/i);
    expect(progressRegion().textContent).toBe("");
    // The polite channel keeps its polite semantics.
    expect(progressRegion().getAttribute("role")).toBe("status");
    expect(progressRegion().getAttribute("aria-live")).toBe("polite");
  });

  it("the failure persists (it carries an instruction to act on) and does not self-clear", async () => {
    vi.useFakeTimers();
    runDocumentReview.mockRejectedValue(new Error("boom"));
    await render(baseProps({ chatReviewDocument: DOC }));
    await runReview();
    expect(alertRegion().textContent).toMatch(/could not run/i);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(alertRegion().textContent).toMatch(/could not run/i);
  });

  it("is not inside the aria-busy turn list, which would suppress it", async () => {
    await render(baseProps({ chatReviewDocument: DOC, chatSending: true }));
    expect(container.querySelector('[aria-busy="true"]'), "CONTROL: the busy wrapper exists while sending").not.toBeNull();
    expect(alertRegion().closest('[aria-busy="true"]')).toBeNull();
  });
});

describe("a review that does not fail stays polite", () => {
  it("a finished review is a short polite cue, never the findings, and leaves the alert empty", async () => {
    runDocumentReview.mockResolvedValue(reviewedOutcome);
    await render(baseProps({ chatReviewDocument: DOC }));
    await runReview();
    const cue = progressRegion();
    expect(cue.textContent).toMatch(/review finished/i);
    expect(cue.textContent).not.toContain("FINDING_EXCERPT");
    expect(cue.getAttribute("role")).toBe("status");
    expect(cue.getAttribute("aria-live")).toBe("polite");
    expect(alertRegion().textContent).toBe("");
  });

  it("an empty document is announced politely too", async () => {
    runDocumentReview.mockResolvedValue({ status: "empty" });
    await render(baseProps({ chatReviewDocument: DOC }));
    await runReview();
    expect(progressRegion().textContent).toMatch(/nothing to review/i);
    expect(alertRegion().textContent).toBe("");
  });

  it("a success after a failure clears the stale alert", async () => {
    runDocumentReview.mockRejectedValueOnce(new Error("boom"));
    runDocumentReview.mockResolvedValue(reviewedOutcome);
    await render(baseProps({ chatReviewDocument: DOC }));
    await runReview();
    expect(alertRegion().textContent).toMatch(/could not run/i);
    await runReview();
    expect(alertRegion().textContent).toBe("");
    expect(progressRegion().textContent).toMatch(/review finished/i);
  });

  it("the send cues are unchanged: Sending... and Reply ready stay in the polite region, and raise no alert", async () => {
    await render(baseProps({ chatReviewDocument: DOC, chatProgress: "sending" }));
    expect(progressRegion().textContent).toBe("Sending…");
    expect(progressRegion().getAttribute("aria-live")).toBe("polite");
    expect(alertRegion().textContent).toBe("");
    await render(baseProps({ chatReviewDocument: DOC, chatProgress: "ready" }));
    expect(progressRegion().textContent).toBe("Reply ready");
    expect(alertRegion().textContent).toBe("");
  });
});
