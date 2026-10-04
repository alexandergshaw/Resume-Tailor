// @vitest-environment jsdom
//
// N105 Step 8-UI -- ReviewFlagsPanel, the draft-agnostic reviewer-flag list
// (UX-21, UX-24). Lands RED: neither the component nor lib/review/flagPresentation.js
// exists yet, so the import fails -- but every body asserts the REAL rendered DOM
// so each row carries weight the moment the component is built.
//
// Render contract this file pins (the implementer builds to it):
//   <ReviewFlagsPanel flags={[{category, spanId, message, excerpt}]}
//                     unresolvedQualifications={[{text}]}
//                     draftKind="applicationReady" | "hypothetical" />
//   - one ROW per span: several flags on one span merge into one row carrying
//     several labels; each row quotes the offending line ONCE in a node marked
//     data-quoted (so the band's clean-verdict sweep excludes it).
//   - labels and tiers come from lib/review/flagPresentation.js, keyed by
//     (draftKind, category) per UX 5.2.
//   - ordering: Confirm tier before Improve tier, then document order.
//   - unresolved requirements render as their own group, capped at 8 + "Show all (n)".

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ReviewFlagsPanel from "./ReviewFlagsPanel.js";

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
const quotedNodes = () => [...container.querySelectorAll("[data-quoted]")];

describe("N105 Step 8-UI -- ReviewFlagsPanel reviewer flags", () => {
  it("renders the application-ready label vocabulary from flagPresentation (UX 5.2)", async () => {
    await render({
      draftKind: "applicationReady",
      flags: [
        { category: "unsupported-authority", spanId: "s1", message: "Led a team of 40", excerpt: "Directed a 40-person org" },
      ],
      unresolvedQualifications: [],
    });
    expect(text()).toMatch(/Role or seniority not in your resume/);
    // The reviewer's own message is the specific detail under the stable label.
    expect(text()).toMatch(/Led a team of 40/);
    // The offending line is quoted and marked data-quoted.
    expect(quotedNodes().length).toBe(1);
    expect(quotedNodes()[0].textContent).toMatch(/Directed a 40-person org/);
  });

  it("merges several flags on one span into ONE row carrying several labels", async () => {
    await render({
      draftKind: "applicationReady",
      flags: [
        { category: "vague-unsupported", spanId: "s2", message: "too vague", excerpt: "Drove impactful outcomes" },
        { category: "repetition", spanId: "s2", message: "repeats line 3", excerpt: "Drove impactful outcomes" },
      ],
      unresolvedQualifications: [],
    });
    // One span -> one quoted line -> one row, with BOTH labels.
    expect(quotedNodes().length).toBe(1);
    expect(text()).toMatch(/Vague claim/);
    expect(text()).toMatch(/Repeats another line/);
  });

  it("orders Confirm-tier flags before Improve-tier flags regardless of input order", async () => {
    await render({
      draftKind: "applicationReady",
      flags: [
        // Improve tier first in input...
        { category: "missing-keyword", spanId: "a", message: "missing Kubernetes", excerpt: "Shipped services" },
        // ...Confirm tier second.
        { category: "unverifiable-metric", spanId: "b", message: "no baseline", excerpt: "Cut costs 90%" },
      ],
      unresolvedQualifications: [],
    });
    const body = text();
    const confirmLabel = body.indexOf("Figure cannot be checked"); // unverifiable-metric / Confirm
    const improveLabel = body.indexOf("Posting keyword missing"); // missing-keyword / Improve
    expect(confirmLabel).toBeGreaterThanOrEqual(0);
    expect(improveLabel).toBeGreaterThanOrEqual(0);
    expect(confirmLabel).toBeLessThan(improveLabel);
  });

  it("is draft-agnostic: the hypothetical draft uses its own labels and the Note tier", async () => {
    await render({
      draftKind: "hypothetical",
      flags: [
        { category: "unsupported-authority", spanId: "h1", message: "VP with 2 years", excerpt: "VP of Engineering" },
      ],
      unresolvedQualifications: [],
    });
    // On the hypothetical, unsupported-authority reads differently (UX 5.2).
    expect(text()).toMatch(/Seniority does not add up/);
    expect(text()).not.toMatch(/Role or seniority not in your resume/);
  });

  it("renders unresolved requirements as their own group, capped at 8 + 'Show all (9)'", async () => {
    const nine = Array.from({ length: 9 }, (_v, i) => ({ text: `Requirement number ${i + 1}` }));
    await render({ draftKind: "applicationReady", flags: [], unresolvedQualifications: nine });
    const body = text();
    expect(body).toMatch(/Requirements your resume cannot meet by rewording/);
    // 8 shown, the 9th behind "Show all".
    expect(body).toMatch(/Requirement number 8/);
    expect(body).not.toMatch(/Requirement number 9\b/);
    expect(body).toMatch(/show all/i);
    expect(body).toMatch(/9/);
  });
});
