// @vitest-environment jsdom
//
// N104 Step 7 (4b) - ReviewFlagsPanel's two NEW opt-in props, both default false
// (R-4 shared-panel blast radius; design r2 §4.3, D-8; UX N104-UX-2/3, K21).
//
//   documentLevelMissingKeyword  true  -> a missing-keyword flag renders as a
//                                         document-level row (no blockquote of the
//                                         doc's first line it was anchored on).
//   classHints                   true  -> one class hint sentence under the Improve
//                                         and Confirm group titles.
//
// WHY A POWER ROW (R7). The panel is shared by the N103 strip and the N105 band.
// If either prop defaulted ON, or the missing-keyword merge-suppression leaked
// into the default path, EVERY consumer's DOM would change silently. The default
// render MUST be byte-for-byte today's; the landed N103/N105 panel suites are run
// unedited as the backstop (reported separately).
//
// RED on HEAD: the panel ignores both unknown props today, so (a) the line-1
// blockquote is still emitted under documentLevelMissingKeyword, and (b) the class
// hints never appear. Those are the behavioural reds. The default-off rows are the
// controls. Mutant watched in the scratchpad: "restore the anchor quote" reds (a).

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
  await act(async () => root.render(createElement(ReviewFlagsPanel, props)));
}
const text = () => container.textContent || "";
const lineQuotes = () => [...container.querySelectorAll("blockquote[data-quoted]")];

const FIRST_LINE = "Shipped microservices in Go";
// Two missing-keyword flags anchored on the SAME draft span (s1 = doc line 1),
// each naming a different posting requirement - exactly the shipped reviewer shape.
const missingKeywordFlags = [
  {
    category: "missing-keyword",
    spanId: "s1",
    message: 'The posting asks for "Kubernetes" ("...Kubernetes...") but this draft never mentions it.',
    excerpt: FIRST_LINE,
    evidenceRef: { origin: "posting", spanId: "q1" },
    evidenceExcerpt: "Hands-on experience with Kubernetes.",
  },
  {
    category: "missing-keyword",
    spanId: "s1",
    message: 'The posting asks for "PCI compliance" ("...PCI...") but this draft never mentions it.',
    excerpt: FIRST_LINE,
    evidenceRef: { origin: "posting", spanId: "q2" },
    evidenceExcerpt: "PCI compliance required.",
  },
];

describe("ReviewFlagsPanel documentLevelMissingKeyword (R-4 opt-in)", () => {
  it("DEFAULT (prop absent): a missing keyword is still merged onto the line-1 blockquote (control)", async () => {
    await render({ draftKind: "applicationReady", flags: missingKeywordFlags, unresolvedQualifications: [] });
    // Today's behaviour: the first line is quoted as the finding's blockquote.
    expect(lineQuotes().some((n) => (n.textContent || "").includes(FIRST_LINE))).toBe(true);
  });

  it("prop TRUE: no missing-keyword row quotes the document's first line (RED on HEAD)", async () => {
    await render({
      draftKind: "applicationReady",
      flags: missingKeywordFlags,
      unresolvedQualifications: [],
      documentLevelMissingKeyword: true,
    });
    // MUTANT (restore the anchor quote): the line-1 blockquote reappears -> reds.
    expect(lineQuotes().some((n) => (n.textContent || "").includes(FIRST_LINE))).toBe(false);
    // the finding is still shown, now as a posting-level row
    expect(text()).toMatch(/Posting keyword missing/);
    expect(text()).toMatch(/From the posting:/);
  });
});

describe("ReviewFlagsPanel classHints (R-4 opt-in)", () => {
  const mixedFlags = [
    { category: "vague-unsupported", spanId: "s2", message: "too vague", excerpt: "Drove impactful outcomes" },
    { category: "unverifiable-metric", spanId: "s3", message: "no baseline", excerpt: "Cut costs 90%" },
  ];

  it("DEFAULT (prop absent): no class hint sentence is rendered (control)", async () => {
    await render({ draftKind: "applicationReady", flags: mixedFlags, unresolvedQualifications: [] });
    expect(text()).not.toMatch(/Rewording can address these\./);
    expect(text()).not.toMatch(/Only you can check these/);
  });

  it("prop TRUE: the Improve and Confirm groups carry their class hints (RED on HEAD)", async () => {
    await render({ draftKind: "applicationReady", flags: mixedFlags, unresolvedQualifications: [], classHints: true });
    expect(text()).toMatch(/Rewording can address these\./); // under "Could be stronger"
    expect(text()).toMatch(/Only you can check these/); // under "Confirm before you send"
  });
});
