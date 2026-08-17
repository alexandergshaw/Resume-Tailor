// Gates that TechWatchPanel actually renders TechWatchItemCard.
//
// TechWatchPanel.test.js mocks nothing below the panel, so it would catch a
// missing card - but only through assertions about text that the panel could
// equally well have inlined. This file pins the composition itself, one level
// down from ExperienceTab.techwatch.test.js.
//
// The failure mode is specific and this repo has shipped it: a component
// written, fully unit-tested, and never imported by its caller. Every
// piece-level test passes because each one imports the piece directly.
//
// Written before either file exists.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const panel = readFileSync(fileURLToPath(new URL("./TechWatchPanel.js", import.meta.url)), "utf8");
const card = readFileSync(fileURLToPath(new URL("./TechWatchItemCard.js", import.meta.url)), "utf8");

describe("TechWatchPanel composes TechWatchItemCard", () => {
  it("imports it", () => {
    expect(panel).toMatch(/import\s+TechWatchItemCard\s+from\s+"\.\/TechWatchItemCard(\.js)?"/);
  });

  it("renders it", () => {
    expect(panel).toContain("<TechWatchItemCard");
  });

  it("marks each card so a test can address one card rather than the whole panel", () => {
    // Without this hook, an assertion about what a CARD says has to be made
    // over the panel's whole textContent, which also contains the hour
    // heading - and that makes at least one assertion time-zone dependent.
    expect(card).toContain("data-techwatch-item");
  });

  it("keeps both files under the size limit", () => {
    expect(panel.split("\n").length).toBeLessThan(1000);
    expect(card.split("\n").length).toBeLessThan(1000);
  });

  it("keeps the card free of data fetching - the panel owns the hook", () => {
    expect(card).not.toContain("useTechWatch");
    expect(card).not.toContain("fetch(");
  });
});
