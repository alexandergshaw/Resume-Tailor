// N105 Step 6 (4b) — PURE delivery rules + the dark-launch gate (K14, D1-D4).
// Binds to: N105.plan.r2.md Step 6 + PL-13 + P-DARK; N105.ux.r2.md 2.3 D1-D7,
// UX-17; N105.design.r2.md §3. The slider/preview rendering (UX-1, UX-15, UX-17
// render halves) are jsdom component rows left to the Step 6/7 render pass; the
// RULES those surfaces obey are pinned here, purely and deterministically.
//
// WHY K14 IS A POWER ROW (SILENT, NEW F2/P-DARK). Slice 1 builds the whole Ideal
// path but it must be UNREACHABLE by users until Step 9 + N106 land, because its
// review is only ever the honest `no-review` state. The gate predicate is the
// single flip-point; it must default OFF. A mutant forcing it ON (with no Step-9
// wiring) makes review-less Ideal generation reachable -> this test reds.
//
// RED on HEAD: module absent (collection failure); satisfiability proven by the
// scratchpad reference.

import { describe, it, expect } from "vitest";
import {
  idealLevelEnabled,
  shouldAutoOpenIdealPreview,
} from "./idealDelivery.js";

describe("idealLevelEnabled — the P-DARK dark-launch gate (K14)", () => {
  it("defaults OFF in slice 1 (the Ideal stop is not user-reachable)", () => {
    expect(idealLevelEnabled()).toBe(false);
  });
});

describe("shouldAutoOpenIdealPreview — D2/D3/D4 (never auto-download, never displace)", () => {
  it("a single user-initiated run with no preview open -> opens the preview (D2)", () => {
    expect(shouldAutoOpenIdealPreview({ isOpen: false, opts: {} })).toBe(true);
  });

  it("a run finishing while a preview is already open -> does NOT displace it (D3)", () => {
    expect(shouldAutoOpenIdealPreview({ isOpen: true, opts: {} })).toBe(false);
  });

  it("a skipDownload run (batch tailor-only, screenshots, re-tailor) -> neither downloads nor auto-opens (D4)", () => {
    expect(shouldAutoOpenIdealPreview({ isOpen: false, opts: { skipDownload: true } })).toBe(false);
  });
});

describe("D1 / UX-17(f) — the Ideal delivery helper never downloads", () => {
  // Structural source sweep: the delivery helper must contain no downloadDocxFiles
  // token (comment-stripped, with a canary) — the never-auto-download barrier is
  // structural, not a flag the UI can forget. RED on HEAD because the module is
  // absent (readFileSync throws); green once idealDelivery.js exists with no
  // download call.
  it("idealDelivery.js contains no downloadDocxFiles call", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./idealDelivery.js", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // Canary: the sweep can find a real identifier that is present.
    expect(code).toMatch(/shouldAutoOpenIdealPreview/);
    expect(code).not.toMatch(/downloadDocxFiles/);
  });
});
