// N60 S8 (AC-F2). The automation surfaces must NOT live in the Live Feed
// Filters sheet. LiveFeedTab.js:721-751 renders `filterPanel` into a
// full-screen FormDialog on a phone, and LiveFeedTab.js documents that this
// sheet was ITSELF a fixed mobile defect -- a multi-thousand-pixel wall pushing
// the feed off screen at 375px. Adding the chat panel, the config-review panel
// or the per-search automation card into that same sheet recreates the defect
// it documents. They belong in the third "Automation" view instead, a sibling
// of the queue tab, outside `filterPanel`.
//
// WHY A SOURCE SCAN. `filterPanel` is a JSX expression assigned to a const and
// rendered in two places; "which components are inside it" is a question about
// the SHAPE OF THE SOURCE, and mounting the whole tab (network state, a 60s
// refresh timer) to answer it buys nothing. This reads the real source, slices
// the `filterPanel` expression, and asserts the automation components are not
// named inside it. The extraction (S8 moves Search+Refine into FeedRefinePanel)
// takes the Refine half out of the slice, so the check also covers
// FeedRefinePanel's own source.
//
// CANARY. A slice scan is worthless if the slice is empty: "contains none of X"
// passes trivially on "". So the slice is proven non-empty by requiring the two
// things that MUST stay in it -- SavedSearchStrip (never extracted) and
// FeedRefinePanel (the post-extraction mount). We deliberately do NOT canary on
// FeedSearchFields: after the extraction it is no longer in the slice, and a
// canary that goes red for the very change it is meant to permit is worse than
// none.
//
// RED-AT-HEAD DISCLOSURE. At HEAD the "slice excludes automation components"
// assertions pass VACUOUSLY -- those components do not exist yet, so nothing
// references them anywhere. The genuine red at HEAD is the FeedRefinePanel
// canary: the extraction has not happened, so the slice does not yet contain
// `FeedRefinePanel`. The exclusion assertions gain their power against a build
// that HAS the components (proven by mutant in the TDD notes), not at HEAD.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => {
  const p = fileURLToPath(new URL(rel, import.meta.url));
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const tabSrc = read("./LiveFeedTab.js");
const refineSrc = read("./feed/FeedRefinePanel.js");

// The names that must never appear inside the Filters sheet.
const AUTOMATION_COMPONENTS = [
  "FeedAutomationPanel",
  "FeedAutomationCard",
  "FeedConfigChat",
  "DerivedConfigReview",
  "AutoTailorRunLog",
];

// Slice the `const filterPanel = (` expression up to the component's `return (`.
function filterPanelSlice(source) {
  if (!source) return null;
  const start = source.indexOf("const filterPanel = (");
  if (start === -1) return null;
  const end = source.indexOf("return (", start);
  if (end === -1) return null;
  return source.slice(start, end);
}

describe("AC-F2: the automation surfaces are not rendered inside the Filters sheet", () => {
  it("LiveFeedTab.js exists and its filterPanel slice can be extracted", () => {
    expect(tabSrc, "app/components/LiveFeedTab.js").not.toBeNull();
    expect(filterPanelSlice(tabSrc), "a `const filterPanel = (` ... `return (` slice").not.toBeNull();
  });

  it("CANARY: the slice is non-empty -- it still contains SavedSearchStrip and FeedRefinePanel", () => {
    // Without both of these the exclusion checks below could pass on an empty
    // or mis-sliced string. SavedSearchStrip is never extracted;
    // FeedRefinePanel is the post-extraction mount that keeps the Search+Refine
    // sections one level down (so LiveFeedTab.js stays under its 900-line cap).
    const slice = filterPanelSlice(tabSrc) || "";
    expect(slice).toMatch(/<SavedSearchStrip\b/);
    expect(slice).toMatch(/<FeedRefinePanel\b/);
  });

  it("the filterPanel slice names none of the automation components", () => {
    const slice = filterPanelSlice(tabSrc) || "";
    for (const name of AUTOMATION_COMPONENTS) {
      expect(
        new RegExp(`<${name}\\b`).test(slice),
        `${name} must not be rendered inside the Filters sheet (AC-F2)`,
      ).toBe(false);
    }
  });

  it("FeedRefinePanel's own source names none of the automation components either", () => {
    // The extraction moves the Refine half OUT of the slice, so the slice alone
    // would stop covering it. FeedRefinePanel must carry Search+Refine only.
    expect(refineSrc, "app/components/feed/FeedRefinePanel.js must exist after the extraction").not.toBeNull();
    for (const name of AUTOMATION_COMPONENTS) {
      expect(
        new RegExp(`<${name}\\b`).test(refineSrc || ""),
        `${name} must not be inside FeedRefinePanel either (AC-F2)`,
      ).toBe(false);
    }
  });

  it("the per-search email/automation controls are gone from the Filters sheet (FeedEmailAlerts removed)", () => {
    // AC-F3 + §7.2: the old per-search email card is deleted and its controls
    // move into FeedAutomationCard in the Automation view. The Filters sheet
    // must no longer mount FeedEmailAlerts.
    const slice = filterPanelSlice(tabSrc) || "";
    expect(slice).not.toMatch(/<FeedEmailAlerts\b/);
  });
});
