// DEFECT originally under test: `applications.application_url` is a per-user
// override of the shared `positions.url`. TrackingTab.js and
// useApplicationDialogs.js already honour it (`app.application_url ||
// pos.url`), and AutoApplyQueueTab.js was fixed to match -- but the two
// page.js data paths below never selected or forwarded the column, so the
// override never arrived:
//
//   1. `loadAutoTailored()` (feeds `autoTailoredPostings`) selected
//      `positions ( ... url )` but not the application's own
//      `application_url`.
//   2. `applyAutoTailoredRow(row)` -- the "Apply" action for an auto-tailored
//      row -- read `row?.positions?.url` raw. Even once (1) is fixed, the
//      click path stays wrong until this reads the override too.
//
// STATUS NOTE, and the reason this file is worth keeping. The component these
// two functions fed, app/components/AutoTailorTab.js, has since been DELETED
// as unreachable (commit 6e55e7d). Both functions still exist in page.js and
// both are still correct, but nothing renders their output today:
// `autoTailoredPostings` now feeds only the unread-count memo and the
// mark-as-seen effect, and `applyAutoTailoredRow` has no call site at all.
// This suite is currently their ONLY consumer of any kind, which makes it the
// surviving record of why they are shaped the way they are. If page.js's
// auto-tailor block is ever removed wholesale, delete this file in the same
// change -- do not "repair" it against a page.js that no longer has these
// functions, and do not delete the functions while leaving this file behind.
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
