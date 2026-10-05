// @vitest-environment jsdom
//
// N103 Step 6 (4b) -- the shared review control + orchestration leaf, driven the
// way a user drives it: the REAL button is clicked, which runs the REAL chokepoint
// over the REAL reviewer (no mock of runDocumentReview here). This pins:
//   * AC-4/AC-5 reachability: a control named /review/i, enabled, one activation.
//   * AC-6: a planted defect becomes a real flag quoting the planted line, and the
//     quote tracks the text (differential) -- so the control is not inert/canned.
//   * AC-5 engine: enabled on embedded, no "Offline" gate.
//   * AC-10: an empty document yields "nothing to review", zero rows, no clean copy.
//
// Contract assumed by this test (the 4b hand-off fixes it):
//   <DocumentReviewSection surface="modal" request={request} engine="embedded" />
//   request = { kind, title, resultLines?|text?, posting?, realMaterial? }
//
// RED on HEAD: the component does not exist. Satisfiability proven against the
// scratchpad reference. The spam / late-result properties live in the companion
// DocumentReviewSection.async.test.js (they need a deferred chokepoint).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentReviewSection from "./DocumentReviewSection.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let originalFetch;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
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

// `\breview` matches "Review..."/"Reviewing..." but NOT "Preview" (R-7).
const reviewButton = () => [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));

async function render(props) {
  await act(async () => root.render(createElement(DocumentReviewSection, props)));
}
async function clickReview() {
  const btn = reviewButton();
  expect(btn, "a /review/i control must be reachable").toBeTruthy();
  await act(async () => {
    btn.click();
  });
}

describe("DocumentReviewSection -- reachable, one action, embedded-enabled (AC-4/AC-5)", () => {
  it("renders a /review/i button that is enabled (never `disabled`) on the embedded engine with no Offline gate", async () => {
    await render({ surface: "modal", engine: "embedded", request: { kind: "applicationReady", title: "Resume", resultLines: ["Shipped the new onboarding flow end to end."] } });
    const btn = reviewButton();
    expect(btn).toBeTruthy();
    expect(btn.hasAttribute("disabled")).toBe(false);
    // The review is key-free, so it must not wear the chat's "Offline" unavailable reason.
    expect(document.body.textContent || "").not.toMatch(/offline/i);
  });
});

describe("DocumentReviewSection -- runs the real reviewer over the real document (AC-6)", () => {
  it("one click turns a planted unbaselined metric into a flag that QUOTES the planted line", async () => {
    await render({ surface: "modal", engine: "embedded", request: { kind: "applicationReady", title: "Resume", resultLines: ["Improved performance by 300% across the org."] } });
    // Inert-button control: nothing is shown before the click.
    expect((container.textContent || "")).not.toContain("Improved performance by 300%");
    await clickReview();
    const quoted = [...container.querySelectorAll("[data-quoted]")].map((n) => n.textContent || "");
    expect(quoted.some((t) => t.includes("Improved performance by 300% across the org."))).toBe(true);
  });

  it("DIFFERENTIAL: the quoted line tracks the document text (findings are not canned)", async () => {
    await render({ surface: "modal", engine: "embedded", request: { kind: "applicationReady", title: "Resume", resultLines: ["Boosted signups by 700% last year."] } });
    await clickReview();
    const quoted = [...container.querySelectorAll("[data-quoted]")].map((n) => n.textContent || "");
    expect(quoted.some((t) => t.includes("700%"))).toBe(true);
    expect(quoted.some((t) => t.includes("300%"))).toBe(false);
  });

  it("the review touches no network (offline, no key -- AC-9)", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    globalThis.fetch = fetchSpy;
    await render({ surface: "modal", engine: "embedded", request: { kind: "applicationReady", title: "Resume", resultLines: ["Improved performance by 300%."] } });
    await clickReview();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("DocumentReviewSection -- empty fails closed (AC-10)", () => {
  it("an empty document yields a 'nothing to review' state: no flags, no clean copy, no throw", async () => {
    await render({ surface: "modal", engine: "embedded", request: { kind: "applicationReady", title: "Resume", text: "   " } });
    await clickReview();
    const body = container.textContent || "";
    expect(body).toMatch(/nothing to review/i);
    expect(body).not.toMatch(/no issues flagged/i);
    expect(container.querySelectorAll("[data-quoted]").length).toBe(0);
  });
});
