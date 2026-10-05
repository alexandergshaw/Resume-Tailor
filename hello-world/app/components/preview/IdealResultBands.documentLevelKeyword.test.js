// @vitest-environment jsdom
//
// N115 part 1 -- the R-4 opt-in, as the Application-ready band wires it.
//
// ReviewFlagsPanel honors `documentLevelMissingKeyword` (ReviewFlagsPanel.n104props
// .test.js and .n104order.test.js pin the panel in isolation) but defaults it off,
// so a consumer that does not pass it still gets the old display: the reviewer
// anchors every missing-keyword flag on the document's first line, and the panel
// then quotes that line as if the keyword were missing FROM it. A missing keyword has
// no source line. These tests render through the band itself, so they fail when the
// band does not opt in, however correct the panel is.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import IdealResultBands from "./IdealResultBands.js";
import { CATEGORY } from "@/lib/review/contract.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const phone = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/app/hooks/useResponsive", () => ({ useIsMobile: () => phone.mobile, useIsTablet: () => phone.mobile }));

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

const FIRST_LINE = "Shipped microservices in Go";
const LINE_LEVEL = "Drove impactful outcomes";
const KEYWORD_LABEL = "Posting keyword missing";

// The shipped reviewer shape: one flag per missing term, every one anchored on the
// first draft span (s1) and carrying that line as its excerpt.
const keywordFlag = (term, requirementId) => ({
  draftKind: "applicationReady",
  category: CATEGORY.MISSING_KEYWORD,
  spanId: "s1",
  message: `The posting asks for "${term}" ("...${term}...") but this draft never mentions it.`,
  excerpt: FIRST_LINE,
  evidenceRef: { origin: "posting", spanId: requirementId },
  evidenceExcerpt: `Needs ${term}.`,
});

const lineFlag = {
  draftKind: "applicationReady",
  category: CATEGORY.VAGUE_UNSUPPORTED,
  spanId: "s3",
  message: "too vague",
  excerpt: LINE_LEVEL,
};

function bandWith(flags) {
  return {
    ideal: {
      applicationReady: { result: "BODY" },
      review: {
        coverage: { complete: true, engineMode: "full", evaluatedCategories: Object.values(CATEGORY) },
        flags,
        unresolvedQualifications: [],
        removed: [],
        leftOut: [],
        counts: { kept: 6, keptAccomplishments: 4, removed: 0, leftOut: 0 },
      },
    },
    currentText: "BODY",
    handEdited: false,
  };
}

const quotes = () => [...container.querySelectorAll("blockquote[data-quoted]")].map((n) => n.textContent || "");

// The row (outer li) each flag label sits in. A row is one `li` holding an optional
// blockquote and a list of labelled items.
function rowsLabelled(label) {
  const labels = [...container.querySelectorAll("span")].filter((n) => (n.textContent || "") === label);
  return [...new Set(labels.map((n) => n.closest("li").parentElement.closest("li")))];
}

describe("IdealResultBands -- a missing keyword is a document-level row, not a line-1 quote (R-4)", () => {
  it("does not quote the document's first line for a missing keyword", async () => {
    await render(bandWith([keywordFlag("Kubernetes", "q1"), keywordFlag("PCI compliance", "q2")]));
    // The finding is still on screen, from the posting ...
    expect(container.textContent).toContain(KEYWORD_LABEL);
    expect(container.textContent).toContain("From the posting:");
    expect(container.textContent).toContain("Needs Kubernetes.");
    // ... and no row quotes the line the reviewer anchored it on.
    expect(quotes().some((text) => text.includes(FIRST_LINE))).toBe(false);
  });

  it("gives each missing keyword its own row, and none of those rows holds a quote", async () => {
    await render(bandWith([keywordFlag("Kubernetes", "q1"), keywordFlag("PCI compliance", "q2")]));
    const rows = rowsLabelled(KEYWORD_LABEL);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelector("blockquote")).toBeNull();
  });

  it("still quotes the line of a line-level flag beside the keyword rows", async () => {
    await render(bandWith([keywordFlag("Kubernetes", "q1"), lineFlag]));
    expect(quotes()).toEqual([LINE_LEVEL]);
    expect(rowsLabelled(KEYWORD_LABEL)).toHaveLength(1);
    expect(rowsLabelled(KEYWORD_LABEL)[0].querySelector("blockquote")).toBeNull();
  });
});

// Every flag row the panel drew: an outer `li` that holds the row's labelled list.
const panelRows = () =>
  [...container.querySelectorAll("li")].filter((li) => [...li.children].some((child) => child.tagName === "UL"));
const number = (pattern) => Number(pattern.exec(container.textContent || "")?.[1] ?? 0);
const metricFlag = {
  draftKind: "applicationReady",
  category: CATEGORY.UNVERIFIABLE_METRIC,
  spanId: "s1",
  message: "no baseline",
  excerpt: FIRST_LINE,
};

describe("IdealResultBands -- the summary count is the number of rows the panel lists (R-4 count)", () => {
  it("2 keywords on one span + a line flag: 3 rows, and the summary says 3, not the merged 2", async () => {
    await render(bandWith([keywordFlag("Kubernetes", "q1"), keywordFlag("PCI compliance", "q2"), lineFlag]));
    expect(panelRows()).toHaveLength(3);
    expect(container.textContent).toContain("3 suggestions");
    expect(number(/(\d+) suggestions?/)).toBe(panelRows().length);
  });

  it("with a Confirm flag on the keywords' span: 4 rows, 1 to confirm + 3 suggestions", async () => {
    await render(bandWith([keywordFlag("Kubernetes", "q1"), keywordFlag("PCI compliance", "q2"), metricFlag, lineFlag]));
    expect(panelRows()).toHaveLength(4);
    expect(number(/(\d+) to confirm/)).toBe(1);
    expect(number(/(\d+) suggestions?/)).toBe(3);
    expect(number(/(\d+) to confirm/) + number(/(\d+) suggestions?/)).toBe(panelRows().length);
  });

  it("CONTROL: with no keyword flag the summary and the rows are the merged-by-span numbers they always were", async () => {
    await render(bandWith([metricFlag, lineFlag]));
    expect(panelRows()).toHaveLength(2);
    expect(number(/(\d+) to confirm/)).toBe(1);
    expect(number(/(\d+) suggestions?/)).toBe(1);
  });
});
