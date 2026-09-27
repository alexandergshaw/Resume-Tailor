// @vitest-environment jsdom
//
// N60 S7 (4b) -- THE LAST HOP. AC-R5 requires the run log be "visible to the
// user who owns it, in the app". This repo's single most-repeated defect is a
// complete mechanism whose last hop is missing -- a surface that renders
// perfectly in isolation but is mounted nowhere. So this file does NOT import
// AutoTailorRunLog directly: it mounts the REAL shipped LiveFeedTab and clicks
// the REAL toolbar the way a user does, then asserts the run log is actually
// reached. A prop or handler call would NOT satisfy reachability.
//
// TWO reachable placements, both required by the design (plan 3.5: one
// component, mode="full" in the Automation view and mode="compact" atop the
// queue view -- the queue view is where a user asks "why is this empty?", which
// is exactly the question AC-R4's reason exists to answer):
//   * Automation view  -> FeedAutomationPanel (S8, already shipped) renders the
//                          full run log.
//   * Queue view       -> AutoApplyQueueTab renders the compact run log.
//
// RED ON HEAD: at HEAD nothing mounts AutoTailorRunLog anywhere, so navigating
// to either view neither fetches /api/auto-apply-queue/runs nor renders a run.
// MEASURED: the component and store are ABSENT; grep for a mount finds none.
//
// The reachability signal is deliberately robust: the run-log surface, when
// mounted in a view, ISSUES the /api/auto-apply-queue/runs fetch (only that
// surface does), AND renders the fetched run's legible reason. The fetch proves
// the surface is present; the rendered reason proves it is not merely mounted-
// but-broken. A CLASS guard (companyResearchAccept idiom) pins the wiring in
// source so a future view that drops the mount fails here too.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme/index.js";
import LiveFeedTab from "../LiveFeedTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let viewportWidth = 1200;
function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}
window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

const PROFILE = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };

// A zero run with a distinct reason: the legible copy for it can ONLY appear on
// screen if the run log actually rendered this row. AutoApplyQueueTab's own
// empty-queue message ("Enable auto-tailor on a saved search and wait for the
// next run") does not contain this reason, so it cannot produce a false positive.
const RUNS = [
  {
    id: "r1",
    ran_at: "2026-09-27T12:00:00.000Z",
    payload: {
      userId: "u1",
      autoEligible: 1,
      autoProcessed: 1,
      tailored: 0,
      skipped: {},
      emailEligible: 0,
      emailed: 0,
      autoFeatureError: null,
      emailFeatureError: null,
      zeroReason: "no_search_enabled",
      emailZeroReason: null,
    },
  },
];

let runsFetched;
const json = (body) => Promise.resolve({ ok: true, json: async () => body });
function installFetch() {
  runsFetched = false;
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.startsWith("/api/auto-apply-queue/runs")) {
      runsFetched = true;
      return json({ runs: RUNS });
    }
    if (u.startsWith("/api/alerts/status")) return json({ emailConfigured: true, reason: null, alertsPaused: false });
    if (u.startsWith("/api/auto-apply-queue")) return json({ items: [] });
    if (u.startsWith("/api/user-profile")) return json({ profile: PROFILE });
    if (u.startsWith("/api/saved-searches/unviewed-counts")) return json({ counts: {} });
    if (u.startsWith("/api/saved-searches")) return json({ search: { id: "srv-1", name: "S", job_keywords: [] } });
    if (u.startsWith("/api/feed")) {
      return json({ items: [], nextCursor: null, lastUpdatedAt: "2026-09-07T12:00:00.000Z", sourceHealth: {} });
    }
    return json({});
  });
}

let container;
let root;
function props(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    savedSearches: [{ id: "srv-1", name: "Backend roles", emailOnNewJobs: false, autoTailorEnabled: false, autoTailorDailyCap: 10 }],
    setSavedSearches: () => {},
    setSavedSearchAutoTailor: () => {},
    deleteSavedSearch: () => {},
    GREENHOUSE_COMPANIES: [],
    COMPANY_CATEGORIES: [],
    onTailor: async () => "",
    canTailor: true,
    ...overrides,
  };
}
async function mount(overrides) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme }, createElement(LiveFeedTab, props(overrides))));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
}
async function click(el) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}
function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  return (label || el.textContent || "").trim();
}
const named = (re) => Array.from(document.querySelectorAll("button")).find((b) => re.test(accessibleName(b)));

const REASON_COPY_RE = /no (saved )?search|not enabled|nothing enabled|no search enabled/i;

beforeEach(() => {
  viewportWidth = 1200;
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  delete global.fetch;
});

describe("harness: the toolbar's Queue and Automation buttons exist and switch views", () => {
  // If these fail every reachability case below is INVALID, not a zero
  // (measurement-instruments). Both buttons ship today (FeedToolbar.js).
  it("mounts LiveFeedTab and both view buttons are present", async () => {
    await mount();
    expect(container.querySelector("section") || container.firstChild, "the tab mounts").toBeTruthy();
    expect(named(/queue/i), "the Queue view button").toBeTruthy();
    expect(named(/automation/i), "the Automation view button").toBeTruthy();
  });
});

describe("AC-R5 reachability: the run log is reached from the shipped toolbar", () => {
  it("Automation view renders the run log (fetches /runs and shows a run's legible reason)", async () => {
    await mount();
    const btn = named(/automation/i);
    expect(btn).toBeTruthy();
    await click(btn);
    expect(runsFetched, "the run-log surface issues the own-runs fetch when reached").toBe(true);
    expect(REASON_COPY_RE.test(container.textContent || ""), "the fetched run's reason is rendered legibly").toBe(true);
  });

  it("Queue view renders the compact run log (fetches /runs and shows a run's legible reason)", async () => {
    // The queue is empty (items: []), so no per-item download buttons exist --
    // the run log is the only thing that can render a run reason here.
    await mount();
    const btn = named(/queue/i);
    expect(btn).toBeTruthy();
    await click(btn);
    expect(runsFetched, "the compact run log issues the own-runs fetch when reached").toBe(true);
    expect(REASON_COPY_RE.test(container.textContent || ""), "the fetched run's reason is rendered legibly").toBe(true);
  });

  it("[control] the run log is NOT reached before any view switch", async () => {
    // The default view is "feed"; the run log must not be mounted there, or the
    // "reached by clicking" claim above would be vacuous (it is reached anyway).
    await mount();
    expect(runsFetched, "the feed view does not mount the run log").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLASS GUARD (companyResearchAccept.wiring idiom). Pins the mount in SOURCE so
// a view that later drops it fails here, not only in the render-and-click cases
// above. What it cannot catch: a mount wired to the wrong data -- that is what
// the render-and-click cases are for.
// ---------------------------------------------------------------------------
describe("class guard: both views mount AutoTailorRunLog with a mode", () => {
  const readIf = (rel) => {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const panelSrc = readIf("./FeedAutomationPanel.js");
  const queueSrc = readIf("../AutoApplyQueueTab.js");
  const componentSrc = readIf("./AutoTailorRunLog.js");

  function callSiteOf(source, tag) {
    if (!source) return null;
    const m = source.match(new RegExp(`<${tag}\\b[\\s\\S]*?/>`));
    return m ? m[0] : null;
  }
  function propNamesOf(source, componentName) {
    if (!source) return [];
    const sig = source.match(new RegExp(`export default function ${componentName}\\(\\{([\\s\\S]*?)\\}\\)\\s*\\{`));
    if (!sig) return [];
    return sig[1]
      .split(/[\n,]/)
      .map((line) => line.trim())
      .map((line) => line.match(/^([A-Za-z0-9_$]+)/)?.[1])
      .filter(Boolean);
  }

  it("AutoTailorRunLog exists and declares a mode prop", () => {
    expect(componentSrc, "app/components/feed/AutoTailorRunLog.js must exist").not.toBeNull();
    expect(propNamesOf(componentSrc, "AutoTailorRunLog")).toEqual(expect.arrayContaining(["mode"]));
  });

  it("the Automation panel mounts the full run log", () => {
    const site = callSiteOf(panelSrc, "AutoTailorRunLog");
    expect(site, "<AutoTailorRunLog .../> in FeedAutomationPanel.js").not.toBeNull();
    expect(site).toMatch(/mode=/);
    expect(site).toMatch(/full/);
  });

  it("the queue tab mounts the compact run log", () => {
    const site = callSiteOf(queueSrc, "AutoTailorRunLog");
    expect(site, "<AutoTailorRunLog .../> in AutoApplyQueueTab.js").not.toBeNull();
    expect(site).toMatch(/mode=/);
    expect(site).toMatch(/compact/);
  });
});
