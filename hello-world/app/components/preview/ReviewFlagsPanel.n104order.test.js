// @vitest-environment jsdom
//
// N104 - documentLevelMissingKeyword beyond the one landed row: each missing
// keyword is its OWN row (two terms on one requirement do not merge), the
// document-level rows come before the line-level rows of the same group, no
// document-level row quotes any line, a line-level flag keeps its quote, and the
// Confirm and Improve hints appear only with classHints. ReviewFlagsPanel.n104props
// .test.js pins the on/off switch; this pins the shape of the rows it produces.

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
  await act(async () => root.unmount());
  container.remove();
});
async function render(props) {
  await act(async () => root.render(createElement(ReviewFlagsPanel, { draftKind: "applicationReady", unresolvedQualifications: [], ...props })));
}

const LINE_ONE = "Shipped microservices in Go";
const keyword = (term, requirementId) => ({
  category: "missing-keyword",
  spanId: "s1",
  message: `The posting asks for "${term}" ("...${term}...") but this draft never mentions it.`,
  excerpt: LINE_ONE,
  evidenceRef: { origin: "posting", spanId: requirementId },
  evidenceExcerpt: `Needs ${term}.`,
});
// Two terms under ONE requirement (they share a requirement id), then a line-level flag.
const flags = [
  { category: "vague-unsupported", spanId: "s2", message: "too vague", excerpt: "Drove impactful outcomes" },
  keyword("Kubernetes", "q1"),
  keyword("Terraform", "q1"),
];

describe("documentLevelMissingKeyword - the shape of the rows", () => {
  it("renders one row per keyword and none of them quotes a line", async () => {
    await render({ flags, documentLevelMissingKeyword: true });
    const text = container.textContent || "";
    expect(text).toContain("Needs Kubernetes.");
    expect(text).toContain("Needs Terraform.");
    // the only quoted line is the line-level flag's
    const quotes = [...container.querySelectorAll("blockquote[data-quoted]")].map((n) => n.textContent);
    expect(quotes).toEqual(["Drove impactful outcomes"]);
  });

  it("lists the keyword rows BEFORE the line-level row in the same group", async () => {
    await render({ flags, documentLevelMissingKeyword: true });
    const text = container.textContent || "";
    expect(text.indexOf("Needs Kubernetes.")).toBeGreaterThan(-1);
    expect(text.indexOf("Needs Kubernetes.")).toBeLessThan(text.indexOf("Drove impactful outcomes"));
    expect(text.indexOf("Needs Terraform.")).toBeLessThan(text.indexOf("Drove impactful outcomes"));
  });

  it("CONTROL: default, the two keywords merge into the quoted line-one row and follow the line order", async () => {
    await render({ flags });
    const quotes = [...container.querySelectorAll("blockquote[data-quoted]")].map((n) => n.textContent);
    expect(quotes).toContain(LINE_ONE);
    const text = container.textContent || "";
    expect(text.indexOf(LINE_ONE)).toBeLessThan(text.indexOf("Drove impactful outcomes"));
  });

  it("tolerates a flags list with junk entries and an unusable one", async () => {
    await render({ flags: [null, "text", keyword("Kubernetes", "q1")], documentLevelMissingKeyword: true });
    expect(container.textContent).toContain("Needs Kubernetes.");
    await render({ flags: "nope", documentLevelMissingKeyword: true });
    expect(container.textContent).toBe("");
  });
});

describe("classHints", () => {
  const mixed = [
    { category: "vague-unsupported", spanId: "s2", message: "too vague", excerpt: "Drove impactful outcomes" },
    { category: "unverifiable-metric", spanId: "s3", message: "no baseline", excerpt: "Cut costs 90%" },
  ];

  it("shows the hint under Confirm and Improve only when asked, and never under a group that is not shown", async () => {
    await render({ flags: mixed, classHints: true });
    expect(container.textContent).toMatch(/Rewording can address these\./);
    expect(container.textContent).toMatch(/Only you can check these - they depend on what is true of you\./);
    // only the Improve group exists: its hint shows, the Confirm hint does not
    await render({ flags: [mixed[0]], classHints: true });
    expect(container.textContent).toMatch(/Rewording can address these\./);
    expect(container.textContent).not.toMatch(/Only you can check these/);
  });

  it("the Reviewer notes group (hypothetical draft) never carries a hint", async () => {
    await render({ flags: mixed, draftKind: "hypothetical", classHints: true });
    expect(container.textContent).not.toMatch(/Rewording can address these\./);
    expect(container.textContent).not.toMatch(/Only you can check these/);
  });
});
