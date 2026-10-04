// @vitest-environment jsdom
//
// N105 Step 8-UI -- ReviewFlagsPanel behaviours beyond ReviewFlagsPanel.test.js:
// the evidence quote, the group order around "Requirements", the cap control
// staying mounted, and what is and is not marked data-quoted.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ReviewFlagsPanel from "./ReviewFlagsPanel.js";
import { CATEGORY, ORIGIN } from "@/lib/review/contract.js";

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
    root.render(createElement(ReviewFlagsPanel, props));
  });
}

const text = () => container.textContent || "";
const quoted = () => [...container.querySelectorAll("[data-quoted]")].map((n) => n.textContent);

describe("N105 Step 8-UI -- ReviewFlagsPanel rows", () => {
  it("shows evidence under its origin prefix, quoted, only when the text was resolved", async () => {
    await render({
      draftKind: "applicationReady",
      flags: [
        {
          category: CATEGORY.CONSISTENCY,
          spanId: "s1",
          message: "dates differ",
          excerpt: "Staff Engineer 2019 to 2022",
          evidenceRef: { origin: ORIGIN.DRAFT, draftKind: "hypothetical", spanId: "s4" },
          evidenceExcerpt: "Staff Engineer 2018 to 2022",
        },
        {
          category: CATEGORY.MISSING_KEYWORD,
          spanId: "s2",
          message: "absent",
          excerpt: "Built services",
          evidenceRef: { origin: ORIGIN.POSTING, spanId: "r1" },
        },
      ],
      unresolvedQualifications: [],
    });
    expect(text()).toMatch(/In the HYPOTHETICAL draft: /);
    expect(quoted()).toContain("Staff Engineer 2018 to 2022");
    // The second flag has an evidenceRef but no resolved text: nothing to quote.
    expect(text()).not.toMatch(/From the posting:/);
  });

  it("marks the offending line, evidence and requirements data-quoted, but not the reviewer's own message", async () => {
    await render({
      draftKind: "applicationReady",
      flags: [{ category: CATEGORY.REPETITION, spanId: "s1", message: "REVIEWER SENTENCE", excerpt: "OFFENDING LINE" }],
      unresolvedQualifications: [{ requirementId: "r1", text: "A POSTING REQUIREMENT" }],
    });
    expect(quoted()).toEqual(expect.arrayContaining(["OFFENDING LINE", "A POSTING REQUIREMENT"]));
    expect(quoted()).not.toContain("REVIEWER SENTENCE");
    expect(quoted().some((q) => /REVIEWER SENTENCE/.test(q))).toBe(false);
  });

  it("orders the groups Confirm, Requirements, Could be stronger", async () => {
    await render({
      draftKind: "applicationReady",
      flags: [
        { category: CATEGORY.REPETITION, spanId: "s1", message: "m", excerpt: "improve line" },
        { category: CATEGORY.CONSISTENCY, spanId: "s2", message: "m", excerpt: "confirm line" },
      ],
      unresolvedQualifications: [{ requirementId: "r1", text: "needs rust" }],
    });
    const body = text();
    const at = (s) => body.indexOf(s);
    expect(at("Confirm before you send")).toBeGreaterThanOrEqual(0);
    expect(at("Confirm before you send")).toBeLessThan(at("Requirements your resume cannot meet by rewording"));
    expect(at("Requirements your resume cannot meet by rewording")).toBeLessThan(at("Could be stronger"));
  });

  it("the hypothetical draft's flags sit under one Note group, never under Confirm", async () => {
    await render({
      draftKind: "hypothetical",
      flags: [{ category: CATEGORY.UNVERIFIABLE_METRIC, spanId: "h1", message: "m", excerpt: "Cut costs 90%" }],
      unresolvedQualifications: [],
    });
    expect(text()).toMatch(/Reviewer notes/);
    expect(text()).not.toMatch(/Confirm before you send/);
    expect(text()).toMatch(/Unsourced figure/);
  });

  it("renders nothing at all for no flags and no requirements", async () => {
    await render({ draftKind: "applicationReady", flags: [], unresolvedQualifications: [] });
    expect(container.innerHTML).toBe("");
  });

  it("'Show all' reveals the rest and stays mounted as 'Show fewer'", async () => {
    const nine = Array.from({ length: 9 }, (_v, i) => ({ text: `Requirement number ${i + 1}` }));
    await render({ draftKind: "applicationReady", flags: [], unresolvedQualifications: nine });
    const button = () => [...container.querySelectorAll("button")].find((b) => /show (all|fewer)/i.test(b.textContent));
    const first = button();
    expect(first.textContent).toBe("Show all (9)");
    expect(first.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      first.click();
    });
    // No \b after the digit: textContent runs the rows together with no separator.
    expect(text()).toMatch(/Requirement number 9/);
    // Same node, still in the DOM: keyboard focus is not dropped to <body>.
    expect(button()).toBe(first);
    expect(first.textContent).toBe("Show fewer");
    expect(first.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      first.click();
    });
    expect(text()).not.toMatch(/Requirement number 9/);
  });

  it("caps each flag group at 8 rows on its own", async () => {
    const flags = Array.from({ length: 10 }, (_v, i) => ({
      category: CATEGORY.REPETITION,
      spanId: `s${i + 1}`,
      message: "m",
      excerpt: `Flagged line ${i + 1}`,
    }));
    await render({ draftKind: "applicationReady", flags, unresolvedQualifications: [] });
    // Document order, not string order: s8 is shown, s9 and s10 are behind "Show
    // all" (string order would have put s10 ahead of s2).
    expect(text()).toMatch(/Flagged line 8/);
    expect(text()).not.toMatch(/Flagged line 9/);
    expect(text()).not.toMatch(/Flagged line 10/);
    expect(text()).toMatch(/Show all \(10\)/);
  });
});
