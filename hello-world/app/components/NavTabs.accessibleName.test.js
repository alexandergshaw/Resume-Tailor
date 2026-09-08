// @vitest-environment jsdom
//
// Keyboard-navigation pass finding: NavTabs (a thin wrapper around MUI's
// <Tabs>) rendered its tab strip with no accessible name at all. MUI's
// <Tabs> already sets role="tablist" on its own (confirmed by reading
// node_modules/@mui/material/Tabs/Tabs.js -- the root spreads `role:
// "tablist"` and forwards an `aria-label` prop straight onto that same
// element), so the missing piece was never a role, only a NAME.
//
// RULING ON <nav> (not applied here -- see NavTabs.js's own comment for the
// full reasoning): every caller reaches this through
// app/hooks/useSurfaceNav.js's goMainTab/goSection, which only flip React
// state -- no route, no URL, no document ever changes. That is the
// WAI-ARIA APG tabs pattern, not page-to-page navigation, so this file does
// NOT assert a `<nav>` ancestor; asserting one would pin an incorrect fix.
//
// Why a name matters concretely: app/page.js mounts a "main"-sized NavTabs
// and, once "Manual Applying" is selected, a "section"-sized NavTabs AT THE
// SAME TIME. Two unnamed (or identically named) tablists on one page are
// indistinguishable to a screen-reader user scanning by role -- the third
// case below exercises exactly that, using each render's OWN computed name
// rather than two hard-coded literals, so it cannot pass by coincidence.
//
// jsdom performs no layout (getBoundingClientRect is all zeros here) and
// real sequential-focus traversal is not observable in it. Nothing below
// depends on either: every assertion reads static attributes/DOM structure
// off the mounted markup.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import NavTabs from "./NavTabs.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(NavTabs, props));
  });
}

// Same idiom as app/components/JobDescriptionTab.test.js's `accessibleName`
// helper: follow the accname computation's own precedence (aria-label, then
// aria-labelledby resolved against the mounted DOM) instead of trusting a
// single attribute's bare presence.
function accessibleName(el, scope) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = (scope || container).querySelector(`#${CSS.escape(labelledBy)}`);
    if (target) return target.textContent.trim();
  }
  return "";
}

const mainTabs = [
  { value: "applying", label: "Materials" },
  { value: "feed", label: "Auto Applying" },
];

const sectionTabs = [
  { value: "url", label: "Posting URL" },
  { value: "manual", label: "Job Description" },
];

const tablist = () => container.querySelector('[role="tablist"]');

function mountFresh(props) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRoot(el);
  return { el, r };
}

async function unmountFresh({ el, r }) {
  await act(async () => {
    r.unmount();
  });
  el.remove();
}

describe("NavTabs' tablist has a real, computed accessible name", () => {
  it("names the 'main'-sized tab strip", async () => {
    await render({ value: "applying", onChange: () => {}, tabs: mainTabs, size: "main" });
    const el = tablist();
    expect(el, "[instrument] no [role='tablist'] rendered at all -- MUI's Tabs no longer exposes that role").not.toBeNull();
    expect(
      accessibleName(el),
      "the tablist must carry a real accessible name (computed via aria-label/aria-labelledby), not merely SOME attribute's bare presence",
    ).toBe("Main tabs");
  });

  it("names the 'section'-sized tab strip", async () => {
    await render({ value: "url", onChange: () => {}, tabs: sectionTabs, size: "section" });
    const el = tablist();
    expect(el, "[instrument] no [role='tablist'] rendered at all").not.toBeNull();
    expect(accessibleName(el), "the tablist must carry a real accessible name").toBe("Section tabs");
  });

  it("gives the 'main' and 'section' strips GENUINELY different names", async () => {
    // app/page.js mounts one of each simultaneously once "Manual Applying"
    // is selected (a "main" NavTabs plus a "section" NavTabs). Computed
    // live from two independent mounts rather than two string literals, so
    // this cannot pass by both sides happening to be hard-coded the same --
    // and the two not-empty checks below guard against the vacuous case
    // where both are "" and therefore trivially "different" from nothing.
    const a = mountFresh();
    await act(async () => {
      a.r.render(createElement(NavTabs, { value: "applying", onChange: () => {}, tabs: mainTabs, size: "main" }));
    });
    const mainName = accessibleName(a.el.querySelector('[role="tablist"]'), a.el);

    const b = mountFresh();
    await act(async () => {
      b.r.render(createElement(NavTabs, { value: "url", onChange: () => {}, tabs: sectionTabs, size: "section" }));
    });
    const sectionName = accessibleName(b.el.querySelector('[role="tablist"]'), b.el);

    await unmountFresh(a);
    await unmountFresh(b);

    expect(mainName, "[instrument] the 'main' tablist computed no name at all").not.toBe("");
    expect(sectionName, "[instrument] the 'section' tablist computed no name at all").not.toBe("");
    expect(
      sectionName,
      "two tablists render on the SAME page at once (app/page.js's 'main' and 'section' NavTabs) -- identical names leave them indistinguishable to a screen reader user scanning by role",
    ).not.toBe(mainName);
  });

  it("names the GROUP, not each tab -- per-tab labels stay exactly as authored", async () => {
    await render({ value: "applying", onChange: () => {}, tabs: mainTabs, size: "main" });
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.length, "[instrument] no [role='tab'] elements rendered").toBe(2);
    expect(tabs.map((t) => t.textContent.trim())).toEqual(["Materials", "Auto Applying"]);
  });
});
