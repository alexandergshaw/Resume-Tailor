// Gates the digest column's WIRING into the tracking table.
//
// This repo has shipped a fully-tested component its caller never imported,
// and the failure is invisible to piece-level tests because each one imports
// the piece directly. Reading source text is normally a poor test and is the
// right one here, because the property being asserted IS the shape of the
// caller's source.
//
// Two things beyond mere presence matter and are asserted below:
//   * the table has a SECOND, stacked-card layout below the md breakpoint, so
//     a column added only to the <Table> is invisible on a phone;
//   * the row already has an onClick that opens the edit dialog, guarded on
//     `e.target.closest("a, button, ...")` - so the digest control has to be a
//     real <button> or the row click swallows it.
//
// Written before the wiring exists.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tab = read("./TrackingTab.js");
const dialog = read("./AppViewDialog.js");
const panel = read("./tracking/DigestPanel.js");

describe("TrackingTab renders the digest column", () => {
  it("adds a header cell naming the column", () => {
    expect(tab).toMatch(/Company\s*&(amp;)?\s*role|Company and role/i);
  });

  it("offers a Research control", () => {
    expect(tab).toContain("Research");
  });

  it("opens the digest through the existing row dialog rather than a second one", () => {
    // AppViewDialog is already opened from a tracking cell as
    // { open, rowIndex, kind: "jd" }. Reusing its kind mechanism keeps one
    // dialog for row content instead of two competing ones.
    expect(tab).toMatch(/kind:\s*"digest"/);
    expect(dialog).toContain("digest");
  });

  it("renders the digest with the real markdown parser, not the job-description heuristic", () => {
    // FormattedContent.js is a plain-text heuristic shaped for job ads and
    // resumes; the digest is genuine markdown the model wrote.
    //
    // Re-anchored when the panel moved into its own module: the literal
    // "MarkdownPreview" left AppViewDialog.js with the extraction, and a test
    // that went red for THAT reason would have said nothing about this
    // property. Both teeth are kept - the dialog delegates to the panel, and
    // the panel is the one on the real parser - and neither file routes the
    // digest through FormattedContent.
    expect(dialog).toMatch(/import DigestPanel from ".\/tracking\/DigestPanel/);
    expect(dialog).toContain("<DigestPanel");
    expect(panel).toMatch(/MarkdownPreview/);
    expect(panel).not.toContain("FormattedContent");
  });

  it("actually renders the extracted panel rather than keeping a second copy", () => {
    // lib/feed/liveFeedWiring.test.js's three-part shape: the render site, the
    // import, and the ABSENCE of the shape it replaced. Only the third can
    // fail when someone imports the new module and leaves the old one
    // rendering - which is how a repo ships a fully-tested component twice.
    expect(dialog).not.toMatch(/function DigestPanel/);
  });

  it("threads the research controls the panel needs into the dialog", () => {
    // The panel's `Research again` is only reachable if TrackingTab passes
    // what it already holds. Both are already props of TrackingTab (:100-101),
    // so this is a threading assertion, not a new data path.
    expect(tab).toMatch(/researchingIds=\{/);
    expect(tab).toMatch(/researchOne=\{/);
  });

  it("surfaces a failed digest's own error, and a way to read the stale prose", () => {
    // digest.error is written on both route paths and was read by nothing.
    // The failure disclosure lives in the dialog, so the failed cell must
    // offer a way to reach it rather than returning before the summary.
    expect(tab).toContain("digest.error");
  });

  it("still renders the phone layout, which is a separate block from the table", () => {
    // The mobile card view is a different render path entirely. A column
    // added only to the desktop <Table> simply does not exist on a phone.
    const mobileMarker = /useIsTablet|isTablet/;
    expect(tab).toMatch(mobileMarker);
    const digestMentions = (tab.match(/digest/gi) || []).length;
    expect(digestMentions).toBeGreaterThanOrEqual(2);
  });

  it("keeps both files under the size limit", () => {
    expect(tab.split("\n").length).toBeLessThan(1000);
    expect(dialog.split("\n").length).toBeLessThan(1000);
  });

  it("hard-calls researchOne, so an unwired Research button fails loudly", () => {
    // This repo has shipped this bug twice: a Retry button wired to
    // undefined, and `onPagesChanged?.()` - the only one of three callbacks
    // called with optional chaining, which is exactly why its failure was
    // silent while the other two would have thrown. `researchOne` is never
    // optional (page.js always passes it), so `?.()` here buys nothing and
    // converts a wiring regression into a button that quietly does nothing.
    expect(tab).toContain("researchOne");
    expect(tab).not.toMatch(/researchOne\?\./);
  });

  it("does not fetch from the table component itself", () => {
    // The tracking table is presentational and driven by props from page.js;
    // page.js is already 3300 lines and must not grow a research pipeline.
    expect(tab).not.toContain("/api/application-digest");
  });
});
