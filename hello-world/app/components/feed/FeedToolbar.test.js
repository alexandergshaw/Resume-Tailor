// @vitest-environment jsdom
//
// The toolbar was extracted from LiveFeedTab.js with no behavioural test of its
// own, and a hand verification immediately found the defect this file now pins:
// the Refresh control is icon-only, wrapped in a <span> so it can show a
// tooltip while disabled, and MUI's Tooltip labels its DIRECT child -- so the
// name landed on the span and the button was announced as nothing at all. The
// same defect was fixed on the posting card, where a test covered it, and
// missed here, where none did.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import FeedToolbar from "./FeedToolbar.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function baseProps(overrides = {}) {
  return {
    refreshing: false,
    onRefresh: vi.fn(),
    hasUpdated: true,
    isStale: false,
    freshnessText: "Updated 30s ago",
    failureCount: 0,
    view: "feed",
    onChangeView: vi.fn(),
    queueCount: 0,
    activeFilterCount: 0,
    advancedOpen: false,
    onToggleAdvanced: vi.fn(),
    currentUser: { id: "u1" },
    onOpenAutofillProfile: vi.fn(),
    ...overrides,
  };
}

function render(props) {
  act(() => {
    root.render(createElement(FeedToolbar, props));
  });
}

// Same model the posting-card test uses: what an assistive technology actually
// resolves, not one technique for supplying it.
function accessibleName(el) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${id}`)?.textContent || "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();

  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  for (const node of [...clone.querySelectorAll("*")]) {
    if (node.style?.display === "none" || node.style?.visibility === "hidden") node.remove();
  }
  const text = (clone.textContent || "").trim();
  return text || (el.getAttribute("title") || "").trim();
}

const controls = () => [...container.querySelectorAll("button, a[href]")];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("FeedToolbar - naming", () => {
  it("gives every control an accessible name, including the icon-only Refresh", () => {
    render(baseProps());
    const found = controls();
    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const el of found) {
      expect(accessibleName(el)).not.toBe("");
    }
  });

  it("names Refresh specifically, and still names it while a refresh is running", () => {
    // Refreshing swaps the icon for a spinner AND disables the button, which
    // is the state the <span> wrapper exists for -- so it is the state most
    // likely to lose the name.
    render(baseProps());
    const refresh = controls().find((el) => /refresh/i.test(accessibleName(el)));
    expect(refresh).toBeTruthy();

    render(baseProps({ refreshing: true }));
    const busy = controls().find((el) => /refresh/i.test(accessibleName(el)));
    expect(busy).toBeTruthy();
    expect(busy.disabled).toBe(true);
  });
});

describe("FeedToolbar - status is legible without colour", () => {
  it("renders the freshness text it is given", () => {
    render(baseProps({ freshnessText: "Feed data may be out of date - last updated 12m ago" }));
    expect(container.textContent).toContain("may be out of date");
  });

  it("keeps each visible control label inside its accessible name", () => {
    // WCAG 2.5.3. MUI's Tooltip stamps its title onto the child as an
    // aria-label, which OVERRIDES the visible text -- so a button reading
    // "Autofill profile" was named "Edit the profile used by Auto Fill and get
    // your bookmarklet", and a voice-control user saying the words they can
    // see could not activate it. A tooltip that explains a control must not
    // replace that control's name; use aria-describedby, or make the name
    // start with the visible label.
    render(baseProps());
    for (const el of controls()) {
      const visible = (el.textContent || "").trim();
      if (!visible) continue; // icon-only controls have no visible label
      expect(accessibleName(el).toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it("never lets a tooltip override the visible text of ANY element, control or not", () => {
    // The generalisation of the WCAG 2.5.3 case above. The earlier version of
    // this file only inspected `button, a[href]`, so the source-error Chip --
    // which is a div, and whose tooltip was overriding its visible "N src
    // errors" label the same way -- was fixed without any test noticing. A
    // tooltip that EXPLAINS something must describe it, never rename it.
    render(baseProps({ failureCount: 4 }));
    const labelled = [...container.querySelectorAll("[aria-label]")];
    expect(labelled.length + container.querySelectorAll("[aria-describedby]").length)
      .toBeGreaterThan(0); // positive control: something here is labelled at all
    for (const el of labelled) {
      const visible = (el.textContent || "").trim();
      if (!visible) continue; // icon-only: nothing visible to contradict
      expect(el.getAttribute("aria-label").toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it("shows the source-error chip only when something actually failed", () => {
    render(baseProps({ failureCount: 0 }));
    expect(container.textContent).not.toMatch(/src errors/);

    // Positive control: without it an implementation that never renders the
    // chip satisfies the assertion above.
    render(baseProps({ failureCount: 4 }));
    expect(container.textContent).toMatch(/4 src errors/);
  });
});

describe("FeedToolbar - behaviour", () => {
  it("reports the queue count and switches view", () => {
    const props = baseProps({ queueCount: 7 });
    render(props);
    expect(container.textContent).toContain("7");

    const queue = controls().find((el) => /queue/i.test(accessibleName(el)));
    act(() => queue.click());
    expect(props.onChangeView).toHaveBeenCalledWith("queue");
  });

  it("hides the autofill profile action when signed out", () => {
    const hasAutofill = () =>
      controls().some((el) => /autofill profile/i.test(el.textContent || ""));

    render(baseProps({ currentUser: null }));
    expect(hasAutofill()).toBe(false);

    // Positive control: without it, a toolbar that never renders the action
    // satisfies the assertion above.
    render(baseProps());
    expect(hasAutofill()).toBe(true);
  });
});
