// The chip-untrack fix, at the ONE seam its own unit tests cannot see:
// app/page.js.
//
// The reported bug — "clicking remove on the tailored chips doesn't actually
// remove the jobs" — was not in `deleteUntrackedApplication` (its refusal is
// correct and stays), and not in any presentation code. It was in page.js's
// `handleUntrackJob`, which turned that refusal into
//
//     if (refused) return;
//     setTrackedJobs((prev) => prev.filter((j) => j.id !== jobId));
//
// so a tailored or applied chip could never be removed and the user was
// never told why. `app/hooks/useUntrackChip.test.js` mounts the replacement
// and tests its behaviour for real; this file pins the two things that hook
// cannot check from inside itself: that page.js actually uses it, and that
// "Mark as applied" and the ⋯ menu's "Remove" reach the SAME function.
//
// WHY SOURCE-SCANNING: `app/page.js` is a single un-exported "use client"
// component (`export default function Home()`) and cannot be mounted — the
// same constraint app/page.autoTailoredUrl.test.js,
// app/page.duplicateApply.wiring.test.js and
// test/repro/appliedStatusDataLoss.test.js all record for this file. Line
// numbers are NOT used as anchors; each function is located by its signature
// and extracted by brace-depth counting.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("./page.js", import.meta.url));
const pageSource = readFileSync(pagePath, "utf8");

function extractFunctionBody(source, signatureRegex) {
  const match = source.match(signatureRegex);
  if (!match) return null;
  const braceStart = source.indexOf("{", match.index + match[0].length - 1);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

describe("page.js no longer owns the untrack decision", () => {
  it("has no `handleUntrackJob` of its own — the hook is the single implementation", () => {
    expect(pageSource).not.toMatch(/function\s+handleUntrackJob\s*\(/);
  });

  it("does not carry the refusal-as-early-return that made Remove a no-op", () => {
    // The exact line the bug report is about.
    expect(pageSource).not.toMatch(/if\s*\(\s*refused\s*\)\s*return/);
  });

  it("mounts useUntrackChip with the dock state it has to mutate", () => {
    const callSite = pageSource.match(/useUntrackChip\(\{[\s\S]{0,400}?\}\)/);
    expect(callSite).not.toBeNull();
    expect(callSite[0]).toMatch(/\bcurrentUser\b/);
    expect(callSite[0]).toMatch(/\btrackedJobs\b/);
    expect(callSite[0]).toMatch(/\bsetTrackedJobs\b/);
  });

  it("issues no untrack statement itself any more — neither the delete nor the position lookup", () => {
    expect(pageSource).not.toMatch(/deleteUntrackedApplication/);
    // A CALL, specifically: page.js keeps a comment mentioning `getPositionId`
    // by name at `handleTailorJob`'s upsertPosition, and that comment is not
    // what this is about.
    expect(pageSource).not.toMatch(/getPositionId\(/);
  });
});

describe("every route into the dock's untrack is the same route", () => {
  it("the mark-applied path awaits the hook's handler, not a private copy", () => {
    // The chip drop after a successful promotion lives at the end of
    // `handleToggleApplied` (the ⋯ menu's "Mark as applied").
    const body = extractFunctionBody(pageSource, /async\s+function\s+handleToggleApplied\s*\([^)]*\)\s*\{/);
    expect(body).not.toBeNull();
    // Intent: clear the chip now that the job is applied. That intent was
    // silently defeated for the whole life of the old guard — an APPLIED row
    // is precisely the row `deleteUntrackedApplication` refuses, so the chip
    // it meant to drop could never be dropped.
    expect(body).toMatch(/await\s+untrackChip\.handleUntrackJob\(\s*jobId\s*\)/);
  });

  it("StatusBar's Remove/Ignore are bound to that same handler", () => {
    expect(pageSource).toMatch(/handleUntrackJob=\{untrackChip\.handleUntrackJob\}/);
  });
});

describe("the refusal is visible and audible", () => {
  it("StatusBar receives the notice and a way to dismiss it", () => {
    expect(pageSource).toMatch(/untrackNotice=\{untrackChip\.untrackNotice\}/);
    expect(pageSource).toMatch(/onUntrackNoticeDismiss=\{untrackChip\.dismissUntrackNotice\}/);
  });

  it("the announcement lives in a live region page.js mounts unconditionally", () => {
    // NOT inside StatusBar: that component's empty-dock early return would
    // mount the region already carrying its message (S-11), and removing the
    // last chip — the case this notice most needs to announce — is exactly
    // when that dock empties.
    const region = pageSource.match(
      /<Box[^>]*data-untrack-flag="live"[\s\S]{0,400}?<\/Box>/,
    );
    expect(region).not.toBeNull();
    expect(region[0]).toMatch(/role="status"/);
    expect(region[0]).toMatch(/aria-live="polite"/);
    expect(region[0]).toMatch(/untrackChip\.untrackNotice\?\.announcement/);
    // Keyed on the sequence counter so two identical announcements in a row
    // are both announced.
    expect(region[0]).toMatch(/key=\{untrackChip\.untrackAnnounceSeq\}/);
  });
});

describe("page.js stays under its line ceiling", () => {
  it("is shorter than 3050 lines", () => {
    const lines = pageSource.split("\n").length;
    expect(lines).toBeLessThan(3050);
  });
});
