// N69 (SPACING) — CB-D-3 clause i: the whole-document spacing must survive a
// reload via the existing slim per-job localStorage summary, with NO migration.
//
// WHY THIS IS A SOURCE CENSUS, not a behaviour test. app/page.js is a single
// un-exported "use client" component (`export default function Home()`) and
// cannot be mounted — the same constraint page.untrackChip.wiring.test.js,
// page.duplicateApply.wiring.test.js and test/repro/appliedStatusDataLoss.test.js
// all record. The slim-summary write (page.js:487-497) is inline in that
// component, so a census of that exact block is the accepted instrument for
// this seam, exactly as those files census their own page.js seams. The reload
// READ side is generic — `setTailoringMap(parsed)` restores the whole object —
// so it needs no change; that is asserted green below so a future narrowing of
// the read cannot silently drop spacing on hydrate.
//
// RED-on-HEAD: the slim object literal carries status/error/downloaded/
// generatedJobTitle and NOT spacing (verified against the tree). Its canary
// (downloaded/generatedJobTitle ARE present) proves the extraction found the
// real block, so "spacing is absent" is a measured absence, not a bad regex.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pageSource = readFileSync(fileURLToPath(new URL("./page.js", import.meta.url)), "utf8");

// Extract the `slim[jobId] = { ... }` object literal by brace-depth, so a
// reformat that moves the fields onto their own lines does not defeat this.
function extractSlimObjectLiteral(source) {
  const m = source.match(/slim\[jobId\]\s*=\s*\{/);
  if (!m) return null;
  const start = source.indexOf("{", m.index);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

describe("page.js persists spacing in the slim tailoringMap summary", () => {
  const slim = extractSlimObjectLiteral(pageSource);

  it("CANARY: the extraction found the real slim summary (carries downloaded + generatedJobTitle)", () => {
    expect(slim, "could not locate the slim[jobId] = { ... } write").toBeTruthy();
    expect(slim).toMatch(/\bdownloaded\b/);
    expect(slim).toMatch(/\bgeneratedJobTitle\b/);
  });

  it("carries `spacing` into the persisted summary (RED on HEAD)", () => {
    // e.g. `spacing: entry.spacing || null` — the value the download applies,
    // so a reload shows what the file will carry (CB-D-3 clause i).
    expect(slim).toMatch(/\bspacing\b/);
  });

  it("GUARD: the hydrate path restores the whole object, so spacing comes back on reload (green today)", () => {
    // page.js:477 — setTailoringMap(parsed). Kept green so a future read-side
    // narrowing that drops spacing on reload is caught here.
    expect(pageSource).toMatch(/setTailoringMap\(parsed\)/);
  });

  it("NO MIGRATION: this seam adds no SQL — persistence is localStorage only", () => {
    // The slim write goes to localStorage under "tailoringMapStatus"; no DB.
    expect(pageSource).toMatch(/localStorage\.setItem\("tailoringMapStatus"/);
  });
});
