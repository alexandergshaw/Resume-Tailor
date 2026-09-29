// @vitest-environment jsdom
//
// N65 step 3 — wiring the salary-estimate entry point from StatusBar.
//
// Two units, both RED on HEAD:
//   1. `postingSalaryStated` (S1 gate) — the pure predicate that reuses
//      lib/feed/salary.js detection to decide whether a posting ALREADY states
//      pay. RED because the export does not exist yet (added in step 3 with its
//      production importer, StatusBar). A mutant that inverts it reds both the
//      true and the false case here.
//   2. StatusBar's "Ask AI" menu item must carry the pinned POSTING descriptor
//      (title/company/location + a computed `salaryStated`) so the ChatPanel
//      "Estimate salary" affordance (shipped in step 2, gated on
//      `chatPinnedContext.posting && !salaryStated`) can ever appear in the real
//      app. RED because at HEAD `askAiAbout` is called with NO `posting` key.
//
// REACHABILITY, not a direct call: the real chip "More actions" menu is opened
// and the real "Ask AI" item is clicked (the same idiom as StatusBar.test.js);
// the assertion is on the payload StatusBar hands its `askAiAbout` prop — which
// in production is chatbot.js's closure. A direct call would not prove the menu
// item is wired.
//
// The `askAiAbout` prop is a spy here BY DESIGN: this file proves StatusBar's
// contribution to the chain (it computes and forwards the posting). That the
// forwarded object then reaches the ChatPanel affordance is a separate JOIN test
// (ChatPanel.postingJoin.test.js), and that chatbot.js's askAiAbout threads the
// key into the pinned context is chatbot.askAiAboutPosting.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StatusBar from "./StatusBar.js";
import { postingSalaryStated } from "@/lib/salary/salaryEstimate";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 1. postingSalaryStated — the S1 "when not mentioned" gate (pure).
// ---------------------------------------------------------------------------

describe("postingSalaryStated — reports stated pay (S1 gate)", () => {
  it("is exported as a function", () => {
    // Deterministic RED-on-HEAD marker: the export is added in step 3. Without
    // this, the calls below throw an opaque "not a function" instead of a clear
    // "the feature is not built yet".
    expect(typeof postingSalaryStated).toBe("function");
  });

  it("true when a structured salary_min is present", () => {
    expect(postingSalaryStated({ salaryMin: 120000, salaryMax: 150000, description: "" })).toBe(true);
  });

  it("true when only a structured salary_max is present", () => {
    expect(postingSalaryStated({ salaryMin: null, salaryMax: 150000, description: "" })).toBe(true);
  });

  it("true when the description text states a $X–$Y range (no structured columns)", () => {
    // Reuses lib/feed/salary.js parseSalary via resolvePostingSalary: a posting
    // that carries its pay in prose is still "stated", not estimable.
    expect(
      postingSalaryStated({ salaryMin: null, salaryMax: null, description: "Compensation: $120,000 – $150,000 per year, plus equity." }),
    ).toBe(true);
  });

  it("false when there is no structured pay and the description states none", () => {
    // The ONLY branch where the estimate path may engage (owner's "when not
    // mentioned"). Paired with the true cases above, an inverted mutant reds.
    expect(postingSalaryStated({ salaryMin: null, salaryMax: null, description: "Great remote team building developer tools." })).toBe(false);
  });

  it("false for empty / absent input (safe default)", () => {
    expect(postingSalaryStated({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. StatusBar "Ask AI" carries the posting context (reachability + S1 gate).
// ---------------------------------------------------------------------------

let container;
let root;

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
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// A tracked job carrying the fields StatusBar's Ask AI path reads. title/company
// come off `menuJob`; location/salaryMin/salaryMax/description come off
// `jobForContext` (= menuFlags.fullJob || menuJob). The same fields are mirrored
// onto a matching `jobResults` entry so the payload is identical whether the
// implementer resolves jobForContext to the full job or the tracked chip.
function jobWith(overrides = {}) {
  return {
    id: "url-https://jobs.example.com/p/1",
    title: "Senior Platform Engineer",
    company: "Acme",
    location: "Remote (US)",
    description: "Build and operate the platform. Node.js and PostgreSQL.",
    salaryMin: null,
    salaryMax: null,
    url: "",
    ...overrides,
  };
}

function baseProps(job, overrides = {}) {
  return {
    trackedJobs: [job],
    // Mirror the salary-bearing fields onto the "full job" so jobForContext
    // carries them however the implementer resolves it.
    jobResults: [job],
    setTrackedJobs: vi.fn(),
    tailoringMap: {},
    resumeFile: null,
    toolbarScrollRef: { current: null },
    toolbarCanScrollLeft: false,
    toolbarCanScrollRight: false,
    handleToolbarWheel: vi.fn(),
    handleToolbarScroll: vi.fn(),
    scrollToolbar: vi.fn(),
    isDocxResume: vi.fn(() => false),
    getDownloadFileNameForTitle: vi.fn(() => "resume.docx"),
    askAiAbout: vi.fn(),
    // The real prod call passes chatbot.js's buildJobContextString; a spy is
    // enough here because this test asserts the `posting` key, not the context
    // string (which the shipped chat suite already covers).
    buildJobContextString: vi.fn(() => "Title: Senior Platform Engineer"),
    setMainTab: vi.fn(),
    setActiveSection: vi.fn(),
    downloadResumeForChipJob: vi.fn(() => Promise.resolve()),
    handleToggleApplied: vi.fn(),
    handleIgnoreJob: vi.fn(),
    handleUntrackJob: vi.fn(),
    openResumePreview: vi.fn(),
    openCompanyResearch: vi.fn(),
    onRegenerate: vi.fn(),
    appliedByExternalId: null,
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(StatusBar, props));
  });
}

async function openMenuForJobIndex(index) {
  const buttons = [...container.querySelectorAll('button[aria-label="More actions"]')];
  const button = buttons[index];
  if (!button) throw new Error(`No "More actions" button at index ${index} (found ${buttons.length})`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function findMenuItem(text) {
  return (
    [...document.body.querySelectorAll('li[role="menuitem"]')].find((el) => el.textContent.trim() === text) || null
  );
}

// Opens the (single) job's menu and clicks the REAL "Ask AI" item, returning the
// object StatusBar handed its askAiAbout prop.
async function clickAskAi(props) {
  await render(props);
  await openMenuForJobIndex(0);
  const askAi = findMenuItem("Ask AI");
  expect(askAi, "the 'Ask AI' menu item was not found").not.toBeNull();
  await act(async () => {
    askAi.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(props.askAiAbout).toHaveBeenCalledTimes(1);
  return props.askAiAbout.mock.calls[0][0];
}

describe("StatusBar — 'Ask AI' carries the pinned posting (S1/S12 reachability)", () => {
  it("passes a posting descriptor (title/company/location) when pay is NOT stated", async () => {
    const props = baseProps(jobWith());
    const arg = await clickAskAi(props);
    // RED on HEAD: no `posting` key is passed today.
    expect(arg.posting, "Ask AI did not carry a posting descriptor").toBeTruthy();
    expect(arg.posting).toMatchObject({
      title: "Senior Platform Engineer",
      company: "Acme",
      location: "Remote (US)",
      salaryStated: false,
    });
  });

  it("marks salaryStated TRUE when the posting states pay — never estimate over a stated figure (S1)", async () => {
    // The worse-error direction: offering an estimate over a posting that
    // already states pay. StatusBar must compute salaryStated:true here so the
    // ChatPanel gate suppresses the affordance.
    const props = baseProps(jobWith({ salaryMin: 130000, salaryMax: 160000 }));
    const arg = await clickAskAi(props);
    expect(arg.posting, "Ask AI did not carry a posting descriptor").toBeTruthy();
    expect(arg.posting.salaryStated).toBe(true);
  });

  it("still preserves the existing Ask AI contract (label + sourceJobId)", async () => {
    // CONTROL: the added `posting` key is additive; the pre-existing payload
    // StatusBar has always sent must be unchanged. This is GREEN on HEAD and
    // guards a fix that rebuilds the call and drops the old keys.
    const props = baseProps(jobWith());
    const arg = await clickAskAi(props);
    expect(typeof arg.label).toBe("string");
    expect(arg.label).toContain("Senior Platform Engineer");
    expect(arg.sourceJobId).toBe("url-https://jobs.example.com/p/1");
  });
});
