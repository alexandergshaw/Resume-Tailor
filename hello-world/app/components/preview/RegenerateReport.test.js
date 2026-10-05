// @vitest-environment jsdom
//
// N104 Waves D/E (4b) - the "What regenerating changed" report LEAF (UX 6.1-6.5 /
// plan step 9). It draws the regenerateReportView view-model and offers Undo. RED
// on HEAD: app/components/preview/RegenerateReport.js does not exist.
//
// It is fed the REAL view-model (regenerateReportView), so this is the join test:
// a shape the view-model does not produce cannot pass. The report never claims a
// closure the comparator withheld, and its chrome passes the design-6.3 sweep.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import RegenerateReport from "./RegenerateReport.js";
import { regenerateReportView } from "@/lib/review/regenerateReportView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FORBIDDEN = [
  /\b(fixed|resolved|addressed|closed|filled)\b/i,
  /all (clear|done|good)/i,
  /nothing left/i,
  /\bATS\b/,
  /\bscore\b/i,
  /optimi[sz]/i,
];

const gap = (requirementId, term) => ({ category: "missing-keyword", requirementId, term, label: "Posting keyword missing" });

const CLOSURE = {
  correspondenceUnavailable: false,
  closed: [gap("q1", "kubernetes")],
  stillOpen: [gap("q3", "graphql")],
  countsBefore: { missingKeyword: 2, vague: 1, repetition: 0 },
  countsAfter: { missingKeyword: 1, vague: 1, repetition: 0 },
  lineCountBefore: 30,
  lineCountAfter: 28,
  genuinelyUnqualifiedStillOpen: [{ requirementId: "q9", text: "Active clearance." }],
};

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderReport(props) {
  await act(async () => root.render(createElement(RegenerateReport, props)));
}

// Text that is the report's OWN wording - quoted keyword terms (data-quoted) are
// the posting's, excluded exactly as the band's clean-verdict sweep excludes them.
function chromeText() {
  const clone = container.cloneNode(true);
  clone.querySelectorAll("[data-quoted]").forEach((n) => n.remove());
  return clone.textContent || "";
}

describe("RegenerateReport - structure and the join with the real view-model", () => {
  it("is a region named 'What regenerating changed' (K23)", async () => {
    const view = regenerateReportView({ closure: CLOSURE, setAside: { removed: 2, leftOut: 0 }, confirmCount: 1 });
    await renderReport({ view, onUndo: () => {} });
    const region = container.querySelector('[aria-label="What regenerating changed"]');
    expect(region).toBeTruthy();
  });

  it("renders the headline and the K18 footer", async () => {
    const view = regenerateReportView({ closure: CLOSURE, setAside: {}, confirmCount: 1 });
    await renderReport({ view, onUndo: () => {} });
    expect(container.textContent).toContain(view.headline);
    expect(container.textContent).toContain("It is not a verdict on the whole resume.");
  });

  it("renders present group titles as h3 headings, and the closed term as a row", async () => {
    const view = regenerateReportView({ closure: CLOSURE, setAside: {}, confirmCount: 1 });
    await renderReport({ view, onUndo: () => {} });
    const h3 = [...container.querySelectorAll("h3")].map((n) => (n.textContent || "").trim());
    expect(h3).toContain("No longer flagged");
    expect(h3).toContain("Still flagged");
    expect(container.textContent).toContain("kubernetes");
    expect(container.textContent).toContain("graphql");
  });

  it("renders the Length and Still-listed sentences from the view-model", async () => {
    const view = regenerateReportView({ closure: CLOSURE, setAside: { removed: 2, leftOut: 0 }, confirmCount: 1 });
    await renderReport({ view, onUndo: () => {} });
    expect(container.textContent).toMatch(/Length: 30 lines before, 28 now\./);
    expect(container.textContent).toMatch(/Still listed in the review:/);
  });
});

describe("RegenerateReport - the F1 guard reaches the screen", () => {
  it("renders NO 'No longer flagged' heading when correspondence was unavailable", async () => {
    const view = regenerateReportView({
      closure: { ...CLOSURE, correspondenceUnavailable: true, closed: [], stillOpen: [] },
      setAside: {},
    });
    await renderReport({ view, onUndo: () => {} });
    const h3 = [...container.querySelectorAll("h3")].map((n) => (n.textContent || "").trim());
    expect(h3).not.toContain("No longer flagged");
    expect(container.textContent).not.toMatch(/no longer flagged/i);
  });
});

describe("RegenerateReport - Undo and the activity log button (UX 6.5 / K18)", () => {
  it("offers 'Undo regenerate' and calls onUndo once when clicked", async () => {
    const onUndo = vi.fn();
    const view = regenerateReportView({ closure: CLOSURE, setAside: {}, confirmCount: 1 });
    await renderReport({ view, onUndo });
    const undo = [...container.querySelectorAll("button")].find((b) => /undo regenerate/i.test(b.textContent || ""));
    expect(undo, "the report footer must offer Undo regenerate").toBeTruthy();
    await act(async () => undo.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("offers a visible 'Download activity log' button in the footer", async () => {
    const view = regenerateReportView({ closure: CLOSURE, setAside: {}, confirmCount: 1 });
    await renderReport({ view, onUndo: () => {} });
    const log = [...container.querySelectorAll("button")].find((b) => /download activity log/i.test(b.textContent || ""));
    expect(log).toBeTruthy();
  });

  it("the unchanged-text report offers NO Undo (nothing to undo)", async () => {
    const view = regenerateReportView({ closure: CLOSURE, textUnchanged: true, setAside: {} });
    await renderReport({ view, onUndo: () => {} });
    const undo = [...container.querySelectorAll("button")].find((b) => /undo regenerate/i.test(b.textContent || ""));
    expect(undo).toBeFalsy();
  });
});

describe("RegenerateReport - the design-6.3 vocabulary sweep (chrome only), with a canary", () => {
  it("the rendered chrome (minus quoted terms) matches none of the forbidden patterns", async () => {
    const views = [
      regenerateReportView({ closure: CLOSURE, setAside: { removed: 2, leftOut: 1 }, confirmCount: 1 }),
      regenerateReportView({ closure: { ...CLOSURE, correspondenceUnavailable: true, closed: [], stillOpen: [] }, setAside: {} }),
      regenerateReportView({ closure: CLOSURE, textUnchanged: true, setAside: {} }),
    ];
    for (const view of views) {
      await renderReport({ view, onUndo: () => {} });
      const text = chromeText();
      for (const re of FORBIDDEN) expect(re.test(text), `chrome must not match ${re}`).toBe(false);
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it("CANARY: a quoted term 'closed-caption' is excluded but a chrome 'closed' is caught", async () => {
    // the sweep strips [data-quoted]; prove it still catches chrome.
    const probe = document.createElement("div");
    probe.innerHTML = '<span data-quoted="true">closed-caption</span><p>All issues addressed</p>';
    const clone = probe.cloneNode(true);
    clone.querySelectorAll("[data-quoted]").forEach((n) => n.remove());
    expect(FORBIDDEN.some((re) => re.test(clone.textContent || ""))).toBe(true);
  });
});
