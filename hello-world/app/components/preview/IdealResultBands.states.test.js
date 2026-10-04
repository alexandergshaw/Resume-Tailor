// @vitest-environment jsdom
//
// N105 Step 8-UI -- IdealResultBands beyond the partial / clean / absent trio
// IdealResultBands.verdict.test.js pins: the other states, the group order and
// omission rules, the coverage line, and the phone collapse. The same K3 rule runs
// through all of it: no state but the one licensed one may read as clean.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import IdealResultBands from "./IdealResultBands.js";
import { CATEGORY } from "@/lib/review/contract.js";
import { UNVERIFIED_FLAG } from "@/lib/llm/ideal/applicationReadyGate.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const phone = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/app/hooks/useResponsive", () => ({ useIsMobile: () => phone.mobile, useIsTablet: () => phone.mobile }));

const CLEAN_PHRASE = /no issues flagged/i;

let container;
let root;

beforeEach(() => {
  phone.mobile = false;
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
    root.render(createElement(IdealResultBands, props));
  });
}

function chromeText() {
  const clone = container.cloneNode(true);
  clone.querySelectorAll("[data-quoted]").forEach((n) => n.remove());
  return clone.textContent || "";
}

const ALL = Object.values(CATEGORY);
const completeCoverage = { complete: true, engineMode: "full", evaluatedCategories: ALL };

function review(overrides = {}) {
  return {
    coverage: completeCoverage,
    flags: [],
    unresolvedQualifications: [],
    removed: [],
    leftOut: [],
    counts: { kept: 6, keptAccomplishments: 4, removed: 0, leftOut: 0 },
    ...overrides,
  };
}

const ideal = (rev, result = "BODY") => ({ applicationReady: { result }, review: rev });

const REMOVED = {
  spanId: "s9",
  text: "Removed claim text",
  section: "Experience",
  contextKey: "Acme - Staff Engineer",
  reasonCode: "partial-match",
  flag: UNVERIFIED_FLAG,
  anchor: null,
};
const LEFT_OUT = { spanId: "d1", text: "Left out claim text", reasonCode: "no-match" };

describe("N105 Step 8-UI -- the band outside the partial / clean / absent trio", () => {
  it("a hand-edited resume over a COMPLETE, finding-free review is not clean, and says so", async () => {
    await render({ ideal: ideal(review()), currentText: "BODY, then my own edit", handEdited: true });
    const chrome = chromeText();
    expect(chrome).not.toMatch(CLEAN_PHRASE);
    expect(chrome).toMatch(/You have edited this resume since the review ran/);
  });

  it("a different saved version hides the review entirely: no groups, no clean verdict", async () => {
    await render({
      ideal: ideal(review({ removed: [REMOVED], leftOut: [LEFT_OUT] })),
      currentText: "SOME OTHER SAVED VERSION",
      handEdited: false,
    });
    const body = container.textContent;
    expect(body).toMatch(/A different saved version is showing/);
    expect(body).not.toMatch(CLEAN_PHRASE);
    expect(body).not.toMatch(/Removed claim text/);
    expect(body).not.toMatch(/Left out claim text/);
  });

  it("a THIN result (no accomplishment kept) is not clean even with nothing flagged", async () => {
    const thin = review({ counts: { kept: 2, keptAccomplishments: 0, removed: 0, leftOut: 0 } });
    await render({ ideal: ideal(thin), currentText: "BODY", handEdited: false });
    expect(chromeText()).not.toMatch(CLEAN_PHRASE);
    expect(chromeText()).toMatch(/only your employers, dates and education/);
  });

  it("the clean state shows only the Left out group, and only when it has rows", async () => {
    await render({
      ideal: ideal(review({ leftOut: [LEFT_OUT] })),
      currentText: "BODY",
      handEdited: false,
    });
    expect(chromeText()).toMatch(CLEAN_PHRASE);
    expect(container.textContent).toMatch(/Left out because your resume does not support them \(1\)/);
    expect(container.textContent).not.toMatch(/Removed - verify/);
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("a complete review WITH findings shows the groups in order and a non-zero-only summary", async () => {
    const withFindings = review({
      flags: [
        { draftKind: "applicationReady", category: CATEGORY.REPETITION, spanId: "s2", message: "again", excerpt: "Improve line" },
        { draftKind: "applicationReady", category: CATEGORY.UNVERIFIABLE_METRIC, spanId: "s3", message: "no base", excerpt: "Confirm line" },
      ],
      unresolvedQualifications: [{ requirementId: "r1", text: "Ten years of Rust" }],
      removed: [REMOVED],
      leftOut: [LEFT_OUT],
    });
    await render({ ideal: ideal(withFindings), currentText: "BODY", handEdited: false });
    const body = container.textContent;
    expect(chromeText()).not.toMatch(CLEAN_PHRASE);
    expect(body).toMatch(/1 removed to verify, 1 to confirm, 1 requirement wording cannot cover, 1 suggestion/);
    const at = (s) => body.indexOf(s);
    const order = [
      "Removed - verify and add back",
      "Confirm before you send",
      "Requirements your resume cannot meet by rewording",
      "Could be stronger",
      "Left out because your resume does not support them",
    ].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No zero count is ever named.
    expect(body).not.toMatch(/\b0 (removed|to confirm|requirements?|suggestions?)/);
  });

  it("flags raised on the HYPOTHETICAL draft do not appear on the application-ready band", async () => {
    const other = review({
      flags: [{ draftKind: "hypothetical", category: CATEGORY.REPETITION, spanId: "s1", message: "m", excerpt: "Hypothetical-only line" }],
    });
    await render({ ideal: ideal(other), currentText: "BODY", handEdited: false });
    expect(container.textContent).not.toMatch(/Hypothetical-only line/);
    // The review is still not provably clean: a finding exists somewhere.
    expect(chromeText()).not.toMatch(CLEAN_PHRASE);
  });

  it("a partial review lists what ran and what did not", async () => {
    const partial = review({
      coverage: { complete: false, engineMode: "mechanical-only", evaluatedCategories: [CATEGORY.MISSING_KEYWORD] },
    });
    await render({ ideal: ideal(partial), currentText: "BODY", handEdited: false });
    const chrome = chromeText();
    expect(chrome).toMatch(/Checked: posting keywords\./);
    expect(chrome).toMatch(/Not fully checked: .*role and seniority claims/);
    expect(chrome).toMatch(/Read the whole resume once before you send\./);
    expect(chrome).not.toMatch(CLEAN_PHRASE);
  });

  it("unusable coverage, or a mechanical run claiming all seven, never reads as 'everything checked'", async () => {
    const unusable = review({ coverage: null });
    await render({ ideal: ideal(unusable), currentText: "BODY", handEdited: false });
    expect(chromeText()).toMatch(/Which checks ran is unknown for this result/);
    expect(chromeText()).not.toMatch(/Checked:/);

    const contradiction = review({ coverage: { complete: true, engineMode: "mechanical-only", evaluatedCategories: ALL } });
    await render({ ideal: ideal(contradiction), currentText: "BODY", handEdited: false });
    expect(chromeText()).toMatch(/Which checks ran is unknown for this result/);
    expect(chromeText()).not.toMatch(/Checked:/);
    expect(chromeText()).not.toMatch(CLEAN_PHRASE);
  });

  it("states Revise is off for an Ideal result", async () => {
    await render({ ideal: ideal(review()), currentText: "BODY", handEdited: false });
    expect(chromeText()).toMatch(/Revise is off for Ideal-level results/);
  });
});

describe("N105 Step 8-UI -- the band on a phone", () => {
  const partialWithOne = ideal(
    review({
      coverage: { complete: false, engineMode: "mechanical-only", evaluatedCategories: [CATEGORY.REPETITION] },
      removed: [REMOVED],
    }),
  );

  it("collapses to a summary that carries the partial state, and expands on tap", async () => {
    phone.mobile = true;
    await render({ ideal: partialWithOne, currentText: "BODY", handEdited: false });
    const toggle = container.querySelector("button[aria-expanded]");
    expect(toggle.textContent).toMatch(/Partial review - 1 to check/);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // getElementById, not a selector: React's generated ids contain characters a
    // CSS selector would have to escape.
    const body = document.getElementById(toggle.getAttribute("aria-controls"));
    expect(body.hasAttribute("hidden")).toBe(true);

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.hasAttribute("hidden")).toBe(false);
  });

  it("renders no collapse control on desktop", async () => {
    await render({ ideal: partialWithOne, currentText: "BODY", handEdited: false });
    expect(container.querySelector("button[aria-expanded]")).toBeNull();
  });
});
