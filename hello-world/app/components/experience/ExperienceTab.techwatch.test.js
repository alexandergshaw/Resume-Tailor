// Gates the WIRING of the briefing panel into the Professional Experience
// tab, not the panel itself.
//
// This repo has shipped a fully-tested component that its caller never
// imported: every piece-level test passed because each one imports the piece
// directly, and the tab on screen was unchanged. Reading source text is
// normally a poor test and is the right one here, because the property being
// asserted IS the shape of the caller's source.
//
// Written before the wiring exists.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAB_PATH = fileURLToPath(new URL("./ExperienceTab.js", import.meta.url));
const source = readFileSync(TAB_PATH, "utf8");

describe("ExperienceTab renders the tech watch briefing", () => {
  it("imports the panel", () => {
    expect(source).toMatch(/import\s+TechWatchPanel\s+from\s+"\.\/TechWatchPanel(\.js)?"/);
  });

  it("actually renders it", () => {
    expect(source).toContain("<TechWatchPanel");
  });

  it("renders it after the bulk actions bar, which is deliberately early in the tab order", () => {
    const bulk = source.indexOf("<BulkActionsBar");
    const watch = source.indexOf("<TechWatchPanel");
    expect(bulk).toBeGreaterThan(-1);
    expect(watch).toBeGreaterThan(-1);
    expect(watch).toBeGreaterThan(bulk);
  });

  it("renders it outside the pages.length === 0 branch, so a new user sees it too", () => {
    // The briefing falls back to a default watchlist when the user has no
    // pages yet; hiding it behind the empty state would make the feature
    // invisible to exactly the people with nothing else on the page.
    const watch = source.indexOf("<TechWatchPanel");
    const emptyBranch = source.indexOf("pages.length === 0");
    expect(emptyBranch).toBeGreaterThan(-1);
    expect(watch).toBeLessThan(emptyBranch);
  });

  it("keeps the tab under the file-size limit", () => {
    expect(source.split("\n").length).toBeLessThan(1000);
  });

  it("does not reach into the panel's data - the panel owns its own hook", () => {
    // Threading briefing state through ExperienceTab would grow a file that
    // is already close to the limit and couple the tab to the feed shape.
    expect(source).not.toContain("useTechWatch");
    expect(source).not.toContain("/api/techwatch");
  });
});
