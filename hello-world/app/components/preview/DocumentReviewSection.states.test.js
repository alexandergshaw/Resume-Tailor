// @vitest-environment jsdom
//
// N103 Step 6 (implementer additions) -- the states and inputs of the review
// control that the landed section tests do not reach, driven through the REAL
// button with the chokepoint mocked so each case controls what it returns:
//   * no document -> an honest "nothing to review" caption, no control to press;
//   * a covered tab says so on activation and runs NO review (no second verdict);
//   * a chokepoint that rejects shows the failed state, announced as an alert;
//   * a completed review is announced through the host's seam, and a `busy` host
//     (a chat send in flight) neither starts a review nor drops the control;
//   * the real resume is read on activation and handed to the chokepoint as LINES
//     (a hypothetical never loads it, and a failed read still runs the review);
//   * after the text changes the SAME document's result stays as a stale to-do list,
//     while a different document never shows another's result;
//   * a review that resolves after the section unmounted is discarded.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/review/runDocumentReview.js", () => ({ runDocumentReview: vi.fn() }));

import DocumentReviewSection from "./DocumentReviewSection.js";
import { runDocumentReview } from "@/lib/review/runDocumentReview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  runDocumentReview.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// `\breview` matches "Review..."/"Reviewing..."/"Review again" but NOT "Preview".
const reviewButton = () => [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));
const text = () => container.textContent || "";

const reviewed = (excerpt, over = {}) => ({
  status: "reviewed",
  draftKind: "applicationReady",
  title: "Doc A",
  flags: [{ category: "unverifiable-metric", spanId: "s1", draftKind: "applicationReady", message: "m", excerpt }],
  unresolvedQualifications: [],
  verdictKind: "partial",
  missingChecks: [],
  checkedChecks: ["missing-keyword", "vague-unsupported", "repetition", "unverifiable-metric"],
  engineMode: "mechanical-only",
  lineCount: 1,
  inputs: { posting: true, realMaterial: true },
  ...over,
});

const reqA = { kind: "applicationReady", title: "Doc A", resultLines: ["Alpha line one about shipping."] };

async function render(props) {
  await act(async () => root.render(createElement(DocumentReviewSection, props)));
}
async function click() {
  await act(async () => {
    reviewButton().click();
  });
}

describe("no document", () => {
  it("shows the nothing-to-review caption and offers no control", async () => {
    await render({ surface: "chat", request: null });
    expect(text()).toMatch(/nothing to review/i);
    expect(reviewButton()).toBeUndefined();
  });
});

describe("covered", () => {
  it("activating says the review above covers this text and runs NO review", async () => {
    const announce = vi.fn();
    await render({ surface: "modal", request: reqA, covered: true, announce });
    await click();
    expect(runDocumentReview).not.toHaveBeenCalled();
    expect(text()).toMatch(/already covers this text/i);
    expect(container.querySelectorAll("[data-quoted]").length).toBe(0);
    expect(announce).toHaveBeenCalledWith({ polite: expect.stringMatching(/already covers/i) });
  });

  it("the covered note is dropped once the text moves on (it would claim coverage nothing gives)", async () => {
    await render({ surface: "modal", request: reqA, covered: true });
    await click();
    await render({ surface: "modal", request: { ...reqA, resultLines: ["Alpha line one, edited."] }, covered: true });
    expect(text()).not.toMatch(/already covers this text/i);
  });
});

describe("failure and announcement", () => {
  it("a rejecting chokepoint shows the failed state and announces an alert that persists", async () => {
    runDocumentReview.mockRejectedValue(new Error("boom"));
    const announce = vi.fn();
    await render({ surface: "modal", request: reqA, announce });
    await click();
    expect(text()).toMatch(/could not run, so nothing was checked/i);
    expect(announce).toHaveBeenCalledWith({ alert: expect.stringMatching(/could not run/i), persist: true });
    // The control is still there, and now offers another try.
    expect(reviewButton().textContent).toMatch(/review again/i);
  });

  it("a completed review is announced politely through the host's seam, as a cue and not the findings", async () => {
    runDocumentReview.mockResolvedValue(reviewed("ALPHA_EXCERPT"));
    const announce = vi.fn();
    await render({ surface: "modal", request: reqA, announce });
    await click();
    expect(announce).toHaveBeenCalledTimes(1);
    const arg = announce.mock.calls[0][0];
    expect(arg.polite).toMatch(/review finished/i);
    expect(arg.polite).not.toContain("ALPHA_EXCERPT");
    expect(arg.alert).toBeUndefined();
  });

  it("a busy host (a chat send in flight) starts no review, and the control stays focusable", async () => {
    await render({ surface: "chat", request: reqA, busy: true });
    await click();
    expect(runDocumentReview).not.toHaveBeenCalled();
    expect(reviewButton().hasAttribute("disabled")).toBe(false);
    expect(reviewButton().getAttribute("aria-disabled")).toBe("true");
  });
});

describe("the real resume is read on activation", () => {
  it("hands the loaded lines to the chokepoint as realMaterialLines", async () => {
    runDocumentReview.mockResolvedValue(reviewed("x"));
    const loadRealMaterialLines = vi.fn().mockResolvedValue(["VP of Platform, Acme (2018-2023)"]);
    await render({ surface: "modal", request: reqA, loadRealMaterialLines });
    expect(loadRealMaterialLines).not.toHaveBeenCalled();
    await click();
    expect(loadRealMaterialLines).toHaveBeenCalledTimes(1);
    expect(runDocumentReview.mock.calls[0][0].realMaterialLines).toEqual(["VP of Platform, Acme (2018-2023)"]);
  });

  it("a hypothetical never loads the real resume", async () => {
    runDocumentReview.mockResolvedValue(reviewed("x", { draftKind: "hypothetical" }));
    const loadRealMaterialLines = vi.fn().mockResolvedValue(["anything"]);
    await render({ surface: "modal", request: { ...reqA, kind: "hypothetical" }, loadRealMaterialLines });
    await click();
    expect(loadRealMaterialLines).not.toHaveBeenCalled();
    expect(runDocumentReview.mock.calls[0][0].realMaterialLines).toBeUndefined();
  });

  it("a failed read still runs the review, without the material", async () => {
    runDocumentReview.mockResolvedValue(reviewed("x"));
    const loadRealMaterialLines = vi.fn().mockRejectedValue(new Error("unreadable"));
    await render({ surface: "modal", request: reqA, loadRealMaterialLines });
    await click();
    expect(runDocumentReview).toHaveBeenCalledTimes(1);
    expect(runDocumentReview.mock.calls[0][0].realMaterialLines).toBeUndefined();
  });
});

describe("a result belongs to the document and text it ran on", () => {
  it("after the text changes the SAME document keeps its result as stale, with the stale note and 'Review again'", async () => {
    runDocumentReview.mockResolvedValue(reviewed("ALPHA_EXCERPT"));
    await render({ surface: "modal", request: reqA });
    await click();
    expect(text()).toContain("ALPHA_EXCERPT");
    await render({ surface: "modal", request: { ...reqA, resultLines: ["Alpha line one, edited."] } });
    expect(text()).toContain("ALPHA_EXCERPT");
    expect(text()).toMatch(/edited this document since this review ran/i);
    expect(reviewButton().textContent).toMatch(/review again/i);
  });

  it("a DIFFERENT document never shows the earlier document's result", async () => {
    runDocumentReview.mockResolvedValue(reviewed("ALPHA_EXCERPT"));
    await render({ surface: "modal", request: reqA });
    await click();
    await render({ surface: "modal", request: { kind: "applicationReady", title: "Doc B", resultLines: ["Bravo line."] } });
    expect(text()).not.toContain("ALPHA_EXCERPT");
    expect(reviewButton().textContent).toMatch(/review document/i);
  });

  it("a review that resolves after the section unmounted is discarded (no announcement, no throw)", async () => {
    let resolveLate;
    runDocumentReview.mockImplementation(() => new Promise((res) => { resolveLate = res; }));
    const announce = vi.fn();
    await render({ surface: "modal", request: reqA, announce });
    await click();
    await act(async () => root.render(createElement("div")));
    await act(async () => resolveLate(reviewed("LATE_EXCERPT")));
    expect(announce).not.toHaveBeenCalled();
    expect(text()).not.toContain("LATE_EXCERPT");
  });
});
