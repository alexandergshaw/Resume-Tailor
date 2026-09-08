// @vitest-environment jsdom
//
// ARCH-sticky §3.4/C-1. useStickyTop's own runtime contract: null-until-
// measured, null-when-unhostable, the two custom properties it is the ONLY
// writer of, and that it survives jsdom having no ResizeObserver at all
// (the same guard useLiveColumnHeight.js's own effect needs, for the same
// reason — CopilotClient.wiring.test.js mounts the real client, unmocked,
// and is the first jsdom surface to execute this hook).
//
// band()'s emitted CSS strings and the "reads clientHeight, never
// innerHeight" source-level guard live in stickyQuestionGuards.test.js
// (G-5) and are not repeated here. This file is the runtime behaviour: what
// the hook actually DOES given a header of a given height on a viewport of
// a given height — the two numbers the hosting predicate is a function of.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useStickyTop } from "./useStickyTop.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let header;

// jsdom's own getBoundingClientRect/clientHeight are always zero — there is
// no layout engine — so both are stubbed directly, the same way a hook that
// reads real geometry has to be tested without one.
function setViewport(clientHeight) {
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
}

function mountHeader(height) {
  header = document.createElement("header");
  header.setAttribute("data-app-header", "");
  header.getBoundingClientRect = () => ({ height, top: 0, bottom: height, left: 0, right: 0, width: 0 });
  document.body.appendChild(header);
}

function Probe() {
  const { stripRef, stickyTop } = useStickyTop();
  return createElement("div", { ref: stripRef, "data-testid": "probe" }, String(stickyTop));
}

async function render() {
  await act(async () => {
    root.render(createElement(Probe));
  });
}

function stickyTopText() {
  return container.querySelector('[data-testid="probe"]').textContent;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  header = null;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  header?.remove();
  document.documentElement.style.removeProperty("--sticky-top");
  document.documentElement.style.removeProperty("--sticky-pad");
  document.documentElement.style.scrollPaddingTop = "";
});

describe("useStickyTop: no measurement yet", () => {
  it("returns null and writes neither custom property when there is no [data-app-header] in the document", async () => {
    await render();
    expect(stickyTopText()).toBe("null");
    expect(document.documentElement.style.getPropertyValue("--sticky-top")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sticky-pad")).toBe("");
  });

  it("queries the attribute, not the tag name — a plain <header> with no attribute is invisible to it", async () => {
    const plain = document.createElement("header");
    document.body.appendChild(plain);
    await render();
    expect(stickyTopText()).toBe("null");
    plain.remove();
  });
});

describe("useStickyTop: this environment has no ResizeObserver at all", () => {
  it("is a precondition of every test in this file, not assumed", () => {
    expect(typeof ResizeObserver).toBe("undefined");
  });
});

describe("useStickyTop: the hosting predicate, both sides of its threshold", () => {
  it("returns the header's own height when the viewport can comfortably host the strip", async () => {
    setViewport(900); // a roomy desktop window
    mountHeader(61); // AppHeader's one-row height at root 16 (§1.2)
    await render();
    expect(stickyTopText()).toBe("61");
    expect(document.documentElement.style.getPropertyValue("--sticky-top")).toBe("61px");
    // stripRef.current has zero height in jsdom (no layout), so --sticky-pad
    // is headerH + 0 — the same identity useStickyTop.js's own comment
    // states for the maximum-occlusion figure.
    expect(document.documentElement.style.getPropertyValue("--sticky-pad")).toBe("61px");
    expect(document.documentElement.style.scrollPaddingTop).toBe("var(--sticky-pad, 0px)");
  });

  it("returns null — static, uncapped — when the header alone leaves no room to host the strip", async () => {
    // avail = 100 - 61 = 39px; the floor alone (132px at root 16) plus the
    // 12px gutter is 144px, far past 60% of a 39px budget. This is
    // §2.2's hosting predicate refusing to turn a short viewport entirely
    // behind a pinned box.
    setViewport(100);
    mountHeader(61);
    await render();
    expect(stickyTopText()).toBe("null");
    // The cap's own --sticky-top is still published (the CSS `calc()` needs
    // it regardless of whether THIS strip ends up sticky), but nothing was
    // ever rendered with `position: sticky` for this measurement — StickyQuestionStrip.js
    // is the one that reads `stickyTop == null` to skip the cap entirely.
    expect(document.documentElement.style.getPropertyValue("--sticky-top")).toBe("61px");
  });

  it("flips back to hostable when the viewport grows past the threshold — no stale state left behind", async () => {
    setViewport(100);
    mountHeader(61);
    await render();
    expect(stickyTopText()).toBe("null");

    setViewport(900);
    await act(async () => {
      window.dispatchEvent(new window.Event("resize"));
    });
    expect(stickyTopText()).toBe("61");
  });
});

describe("useStickyTop: cleanup on unmount", () => {
  it("removes both custom properties and clears scroll-padding", async () => {
    // A dedicated, LOCAL root — unmounted inside this test, deliberately, so
    // this file's shared `afterEach` unmounting the shared root afterward
    // does not double-unmount the same tree.
    const localContainer = document.createElement("div");
    document.body.appendChild(localContainer);
    const localRoot = createRoot(localContainer);

    setViewport(900);
    mountHeader(61);
    await act(async () => {
      localRoot.render(createElement(Probe));
    });
    expect(document.documentElement.style.getPropertyValue("--sticky-top")).toBe("61px");

    await act(async () => {
      localRoot.unmount();
    });
    localContainer.remove();
    expect(document.documentElement.style.getPropertyValue("--sticky-top")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sticky-pad")).toBe("");
    expect(document.documentElement.style.scrollPaddingTop).toBe("");
  });
});
