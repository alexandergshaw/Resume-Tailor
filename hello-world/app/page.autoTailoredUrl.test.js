// LIVE DEFECT under test: `applications.application_url` is a per-user
// override of the shared `positions.url`. TrackingTab.js and
// useApplicationDialogs.js already honour it (`app.application_url ||
// pos.url`), and AutoApplyQueueTab.js / AutoTailorTab.js were just fixed to
// match -- but the two page.js data paths that feed those tabs never select
// or forward the column, so the override never arrives:
//
//   1. `loadAutoTailored()` (feeds `autoTailoredPostings`, which
//      AutoTailorTab.js reads) selects `positions ( ... url )` but not the
//      application's own `application_url`.
//   2. `applyAutoTailoredRow(row)` -- the "Apply" button's actual onClick,
//      wired directly in AutoTailorTab.js's props, not read from anything
//      that component itself computes -- reads `row?.positions?.url` raw.
//      Even once (1) is fixed, the click path stays wrong until this reads
//      the override too.
//
// WHY SOURCE-SCANNING: `app/page.js` is a single un-exported "use client"
// component (`export default function Home()`); neither function is
// reachable by import, and mounting the whole 3000+ line component just to
// click one button pulls in Supabase, fetch, and a screen's worth of other
// hooks for no benefit -- see test/repro/appliedStatusDataLoss.test.js's own
// "cannot be imported" note for the same constraint on this same file.
// TrackingTab.digest.test.js already established the pattern this file
// follows: read the real source and assert on its shape, because the shape
// of the caller's source IS the property under test here.
//
// Line numbers are NOT used as anchors (this file has changed many times in
// one day); each function body is located by its signature and extracted by
// brace-matching, so the assertions track the function wherever it moves.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pageSource = readFileSync(fileURLToPath(new URL("./page.js", import.meta.url)), "utf8");

// Extracts the full `{ ... }` body of the first function whose signature
// matches `signatureRegex`, using brace-depth counting rather than a
// non-greedy regex so nested blocks (if/for/etc. inside the function) don't
// truncate the match early. Returns null if the signature isn't found.
function extractFunctionBody(source, signatureRegex) {
  const match = source.match(signatureRegex);
  if (!match) return null;
  const braceStart = source.indexOf("{", match.index);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}

describe("loadAutoTailored selects application_url", () => {
  const body = extractFunctionBody(pageSource, /async function loadAutoTailored\(\)\s*\{/);

  it("the function still exists (sanity check for the extractor itself)", () => {
    expect(body).not.toBeNull();
  });

  it("includes application_url as a bare column in the applications select, not merely a comment mentioning it", () => {
    const selectMatch = body.match(/\.select\(`([\s\S]*?)`\)/);
    expect(selectMatch).not.toBeNull();
    const selectColumns = selectMatch[1];
    expect(selectColumns).toMatch(/\bapplication_url\b/);
  });
});

describe("applyAutoTailoredRow opens the per-user override when present", () => {
  const body = extractFunctionBody(pageSource, /async function applyAutoTailoredRow\(row\)\s*\{/);

  it("the function still exists (sanity check for the extractor itself)", () => {
    expect(body).not.toBeNull();
  });

  it("resolves application_url before falling back to positions.url", () => {
    expect(body).toMatch(/const url = row\?\.application_url \|\| row\?\.positions\?\.url;/);
  });

  it("hands that resolved `url` binding to navigateBeside and openPostingBeside -- not a second, direct read of positions.url", () => {
    // Both navigation calls must reference the resolved `url` local, so a fix
    // to the assignment above can't be undone by a call site that still
    // reaches into row.positions.url on its own.
    expect(body).toMatch(/navigateBeside\(presetPopup,\s*url\)/);
    expect(body).toMatch(/openPostingBeside\(url\)/);
    // Exactly one read of positions.url in the whole function: the fallback
    // half of the `url` assignment above. A second occurrence would mean
    // some other line still bypasses the override.
    const positionsUrlReads = (body.match(/row\??\.positions\??\.url/g) || []).length;
    expect(positionsUrlReads).toBe(1);
  });

  it("[pin] does not touch the status write or the applied_at stamp", () => {
    // Ground truth per REPRO D4 (test/repro/appliedStatusDataLoss.test.js):
    // this function must keep writing status via writeApplicationStatus by
    // position id, unconditionally, with no direct applied_at write of its
    // own. This pins that shape so a change to "which URL it opens" can't
    // quietly also change what gets written or when.
    expect(body).toMatch(/writeApplicationStatus\(supabase,\s*\{/);
    expect(body).toMatch(/status:\s*STATUS\.APPLIED/);
    expect(body).not.toMatch(/applied_at:/);
  });
});
