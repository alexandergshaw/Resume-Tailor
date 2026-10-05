// @vitest-environment jsdom
//
// N113 part 2 -- the review strip's Hide / Show results toggle (N103 UX 3 and 6.3).
//
// On an Ideal job two bands can share a short viewport, so the strip's header
// carries one pressure valve: a button that hides the result. The properties:
//   * one control, shown by default: a result is expanded the moment it arrives, and
//     a fresh review (including Review again) always shows it;
//   * a native button whose visible text IS its name ("Hide results" / "Show
//     results"), with aria-expanded and an aria-controls that resolves to a node
//     that is still in the document when hidden; the caret is aria-hidden;
//   * keyboard-operable, and focus stays on it (it never unmounts under the user);
//   * nothing is remembered: no storage is written, and a fresh mount starts shown;
//   * the modal's strip only: the chat card has no collapse (UX 3: the panel's own
//     turn list scrolls);
//   * hiding changes what is seen, not what was computed: the result node and its
//     content survive a hide and a show.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentReviewSection from "./DocumentReviewSection.js";

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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const RESUME = { kind: "applicationReady", scope: "resume", title: "Resume", resultLines: ["Improved checkout throughput by 300% across the org."] };

const buttons = () => [...container.querySelectorAll("button")];
// `\breview` matches "Review resume"/"Reviewing..."/"Review again" but not "Hide results".
const reviewButton = () => buttons().find((b) => /\breview/i.test((b.textContent || "").trim()));
const toggle = () => buttons().find((b) => /^(hide|show) results$/i.test((b.textContent || "").trim()));
const regionOf = (button) => document.getElementById(button.getAttribute("aria-controls"));
const isHidden = (el) => el.hasAttribute("hidden") && getComputedStyle(el).display === "none";

async function render(props) {
  await act(async () => root.render(createElement(DocumentReviewSection, props)));
}
async function click(button) {
  await act(async () => {
    button.click();
  });
}
async function reviewed(props = {}) {
  await render({ surface: "modal", request: RESUME, ...props });
  await click(reviewButton());
}

describe("the toggle exists only where there is a result to hide", () => {
  it("is absent before a review has run", async () => {
    await render({ surface: "modal", request: RESUME });
    expect(toggle()).toBeUndefined();
  });

  it("appears with the result, and the result is SHOWN by default", async () => {
    await reviewed();
    const button = toggle();
    expect(button, "a result with no way to hide it").toBeTruthy();
    expect(button.textContent.trim()).toBe("Hide results");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const region = regionOf(button);
    expect(region, "aria-controls must resolve to a node").toBeTruthy();
    expect(isHidden(region)).toBe(false);
    expect(region.textContent).toContain("Improved checkout throughput by 300%");
  });

  it("is offered for a regenerate report alone, and hides it", async () => {
    const report = createElement("div", { "data-testid": "report" }, "What regenerating changed");
    await render({ surface: "modal", request: RESUME, regenerateReport: report });
    const button = toggle();
    expect(button).toBeTruthy();
    await click(button);
    expect(isHidden(regionOf(toggle()))).toBe(true);
  });

  it("is not on the chat card (the panel's own turn list scrolls)", async () => {
    await reviewed({ surface: "chat" });
    expect(container.textContent).toContain("Improved checkout throughput by 300%");
    expect(toggle()).toBeUndefined();
  });
});

describe("hide and show", () => {
  it("one activation hides, the name and aria-expanded follow, and a second shows again", async () => {
    await reviewed();
    await click(toggle());
    const hidden = toggle();
    expect(hidden.textContent.trim()).toBe("Show results");
    expect(hidden.getAttribute("aria-expanded")).toBe("false");
    expect(isHidden(regionOf(hidden))).toBe(true);

    await click(hidden);
    const shown = toggle();
    expect(shown.textContent.trim()).toBe("Hide results");
    expect(shown.getAttribute("aria-expanded")).toBe("true");
    expect(isHidden(regionOf(shown))).toBe(false);
  });

  it("hiding keeps the same result node and its content (nothing is recomputed or lost)", async () => {
    await reviewed();
    const before = regionOf(toggle());
    await click(toggle());
    await click(toggle());
    const after = regionOf(toggle());
    expect(after).toBe(before);
    expect(after.textContent).toContain("Improved checkout throughput by 300%");
    expect(after.querySelectorAll("[data-quoted]").length).toBeGreaterThan(0);
  });

  it("the review control itself is never hidden, and is still the one that reads Review again", async () => {
    await reviewed();
    await click(toggle());
    expect(reviewButton()).toBeTruthy();
    expect(reviewButton().textContent).toMatch(/review again/i);
    expect(reviewButton().closest("[hidden]")).toBeNull();
  });

  it("a fresh review shows a hidden result again (the user just asked for it)", async () => {
    await reviewed();
    await click(toggle());
    expect(isHidden(regionOf(toggle()))).toBe(true);
    await click(reviewButton());
    const button = toggle();
    expect(button.textContent.trim()).toBe("Hide results");
    expect(isHidden(regionOf(button))).toBe(false);
  });
});

describe("accessibility and keyboard", () => {
  it("is a native, focusable, enabled button typed `button`, named by its visible text alone", async () => {
    await reviewed();
    const button = toggle();
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.tabIndex).not.toBe(-1);
    // No aria-label / aria-labelledby that could drift from the visible text
    // (label-in-name), and no Tooltip wrapper stealing the name.
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.hasAttribute("aria-labelledby")).toBe(false);
    expect(button.hasAttribute("title")).toBe(false);
  });

  it("the caret is decorative: every svg inside it is aria-hidden", async () => {
    await reviewed();
    const icons = [...toggle().querySelectorAll("svg")];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps focus on the toggle through a hide and a show", async () => {
    await reviewed();
    toggle().focus();
    await click(toggle());
    expect(document.activeElement).toBe(toggle());
    await click(toggle());
    expect(document.activeElement).toBe(toggle());
    expect(document.activeElement.tagName).toBe("BUTTON");
  });

  it("sits after the review control and before the result, in reading order", async () => {
    await reviewed();
    const review = reviewButton();
    const button = toggle();
    const region = regionOf(button);
    expect(review.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The control is not inside the region it hides.
    expect(region.contains(button)).toBe(false);
  });

  it("adds no live region: the result it controls carries no status, alert or aria-live", async () => {
    await reviewed();
    const region = regionOf(toggle());
    expect(region.querySelectorAll('[role="status"], [role="alert"], [aria-live]')).toHaveLength(0);
    expect(toggle().closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });
});

describe("nothing is remembered", () => {
  it("writes no storage when toggling, and a fresh mount starts shown", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await reviewed();
    await click(toggle());
    expect(isHidden(regionOf(toggle()))).toBe(true);
    expect(setItem).not.toHaveBeenCalled();

    // Close and reopen the strip: a new mount, a new review.
    await act(async () => root.render(createElement("div")));
    await render({ surface: "modal", request: RESUME });
    await click(reviewButton());
    const button = toggle();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(isHidden(regionOf(button))).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
