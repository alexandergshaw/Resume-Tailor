// N60 S7 (4b) -- AC-R5's downloadable-log core, and AC-R4's "the reason is
// LEGIBLE, not a code" requirement.
//
// `renderRunLogMarkdown` and `runLogFileName` were DELIBERATELY DEFERRED from S1
// to here (autoTailorRunLog.js:17-19): exporting them earlier, with only a test
// consumer, would have moved the export-reachability census literals (363/435).
// S7 is where their production consumer lands -- the AutoTailorRunLog component's
// download control (`lib/document/download.js`'s triggerBlobDownload). So this
// file pins them for the first time.
//
// RED ON HEAD: neither function exists in lib/feed/autoTailorRunLog.js, so the
// import below fails collection. MEASURED before authoring:
//   grep -n "renderRunLogMarkdown\|runLogFileName" lib/feed/autoTailorRunLog.js
//   -> only the two comment lines that say they are deferred.
//
// THE LEGIBILITY CLASS GUARD (brief item 5). A user reading this log must
// understand WHY nothing happened. Every reason string the module knows --
// every value in SKIP_REASONS and ZERO_REASONS -- must render as human copy,
// never as the raw snake_case enum token. This is pinned over the CLASS (each
// reason value, extracted from the module source), not one instance, so adding
// a reason without copy fails here rather than leaking an identifier into a
// user-facing file. The extractor is canaried against a known positive so a
// broken extraction cannot make the guard pass on an empty set.
//
// CONTROLS: the legible-copy assertion is paired with a NON-VACUITY floor (the
// run actually rendered, so "copy present" is not vacuously true against an
// empty document) and an over-fire control (a tailored>0 run does NOT print a
// "nothing happened" reason line).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderRunLogMarkdown, runLogFileName, describeRunReason } from "./autoTailorRunLog.js";

const MODULE_SRC = readFileSync(
  fileURLToPath(new URL("./autoTailorRunLog.js", import.meta.url)),
  "utf8",
);

// Extract every reason string literal from the two frozen enums in the module
// source. This is a deliberate source-text SWEEP that enumerates the class, not
// a prose assertion -- and it has its own canary below.
function reasonValuesFrom(objectName) {
  const block = new RegExp(`${objectName}\\s*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`).exec(
    MODULE_SRC,
  );
  if (!block) return [];
  return [...block[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
}
const SKIP_VALUES = reasonValuesFrom("SKIP_REASONS");
const ZERO_VALUES = reasonValuesFrom("ZERO_REASONS");
const ALL_REASON_VALUES = [...new Set([...SKIP_VALUES, ...ZERO_VALUES])];

// A persisted run row exactly as loadRecentRuns / the runs API returns it:
// { id, ran_at, payload } where payload is summarizeRun's output.
function row(payload = {}, ran_at = "2026-09-27T12:00:00.000Z") {
  return {
    id: "run-1",
    ran_at,
    payload: {
      userId: "user-1",
      autoEligible: 1,
      autoProcessed: 1,
      tailored: 0,
      skipped: {},
      emailEligible: 0,
      emailed: 0,
      autoFeatureError: null,
      emailFeatureError: null,
      zeroReason: "no_new_matching_postings",
      emailZeroReason: null,
      ...payload,
    },
  };
}

describe("the reason-value sweep actually found the class (canary)", () => {
  // Without this, a broken extractor would make every legibility assertion
  // below pass on an empty set -- the exact zero-power trap the class guard
  // exists to avoid.
  it("extracted the known reason strings from both enums", () => {
    expect(SKIP_VALUES).toContain("per_run_cap_reached");
    expect(SKIP_VALUES).toContain("no_resume_in_storage");
    expect(ZERO_VALUES).toContain("no_new_matching_postings");
    expect(ZERO_VALUES).toContain("no_search_enabled");
    // Both enums together carry at least the ten distinct causes S1/S4/S6 named.
    expect(ALL_REASON_VALUES.length).toBeGreaterThanOrEqual(10);
    // Every extracted value is a snake_case machine token (contains an
    // underscore), which is what the legibility assertion checks the OUTPUT is
    // free of.
    for (const v of ALL_REASON_VALUES) expect(v).toMatch(/_/);
  });
});

describe("runLogFileName produces a single .md file named for this feature", () => {
  it("ends in .md and names the auto-apply/run log", () => {
    const name = runLogFileName();
    expect(name).toBeTypeOf("string");
    expect(name.endsWith(".md"), `expected a .md filename, got ${name}`).toBe(true);
    expect(name).toMatch(/run|auto.?apply/i);
    // A single file, not a path.
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });
});

describe("renderRunLogMarkdown renders each run's outcome", () => {
  it("returns a non-empty markdown string for a list of runs", () => {
    const md = renderRunLogMarkdown([row({ tailored: 2 })]);
    expect(md).toBeTypeOf("string");
    expect(md.length).toBeGreaterThan(0);
  });

  it("shows the counts a user needs -- eligible, processed, tailored", () => {
    // NON-VACUITY floor for the reason assertions: the run must actually render.
    const md = renderRunLogMarkdown([
      row({ autoEligible: 3, autoProcessed: 3, tailored: 2, zeroReason: null }),
    ]);
    // The tailored count reaches the page (as a number, in words nearby).
    expect(md).toMatch(/2/);
    expect(md.toLowerCase()).toMatch(/tailor|queued|generated/);
  });

  it("renders an empty history as a legible 'nothing yet', not a blank string or a throw", () => {
    // AC-R5: a missing/empty history renders as "nothing yet" rather than an
    // error or a blank. A renderer that returned "" for [] would hand the
    // download control an empty file.
    const md = renderRunLogMarkdown([]);
    expect(md).toBeTypeOf("string");
    expect(md.trim().length, "an empty log still produces a readable file").toBeGreaterThan(0);
    // Must not have thrown, and must not print a raw enum either.
    for (const v of ALL_REASON_VALUES) expect(md).not.toContain(v);
  });
});

describe("[LEGIBILITY CLASS GUARD] every reason renders as human copy, never a raw enum (AC-R4/R5, brief item 5)", () => {
  it("a zero run's reason is explained in words, and the raw token never appears", () => {
    const md = renderRunLogMarkdown([row({ tailored: 0, zeroReason: "no_new_matching_postings" })]);
    // The machine token itself must be absent...
    expect(md).not.toContain("no_new_matching_postings");
    // ...and a human explanation present. (Loose on wording; strict on "not a
    // code": the point is the reader understands it.)
    expect(md.toLowerCase()).toMatch(/no (new )?match|nothing new|no new (job|posting)/);
  });

  it("EVERY reason in SKIP_REASONS and ZERO_REASONS has SPECIFIC human copy (adding one without copy fails)", () => {
    // The class, not the instance -- and stronger than "does not leak the
    // token": every reason must have its OWN copy, distinct from the generic
    // fallback. So a reason added later with no entry (which falls back to the
    // generic string) FAILS here, rather than silently degrading to an
    // uninformative catch-all. GENERIC is read from the module itself, so this
    // tracks whatever fallback the module uses.
    expect(ALL_REASON_VALUES.length).toBeGreaterThanOrEqual(10);
    const GENERIC = describeRunReason("__definitely_not_a_real_reason__");
    for (const reason of ALL_REASON_VALUES) {
      const copy = describeRunReason(reason);
      expect(copy, `${reason} has no copy`).toBeTypeOf("string");
      expect(copy.length, `${reason} copy is empty`).toBeGreaterThan(0);
      // Not the raw enum, and not a code (no underscore token).
      expect(copy, `${reason} renders as its own raw enum`).not.toBe(reason);
      expect(copy, `${reason} copy still contains an enum token`).not.toContain(reason);
      // Not the generic fallback -- it has its OWN explanation.
      expect(copy, `${reason} has no specific copy (falls back to the generic string)`).not.toBe(
        GENERIC,
      );
    }
  });

  it("renderRunLogMarkdown itself never leaks a raw enum token for any reason", () => {
    // The render function must actually USE the legible copy. Each reason is
    // driven through BOTH the zero-reason slot and the skipped map.
    for (const reason of ALL_REASON_VALUES) {
      const md = renderRunLogMarkdown([
        row({ tailored: 0, zeroReason: reason, skipped: { [reason]: 2 } }),
      ]);
      expect(md, `renderRunLogMarkdown leaked the raw enum "${reason}"`).not.toContain(reason);
    }
  });

  it("[over-fire control] a run that tailored > 0 does NOT claim nothing was tailored", () => {
    // Guards a renderer that hardwires a zero-reason line onto EVERY run (even a
    // successful one, where zeroReason is null and describeRunReason falls back
    // to a generic string). A successful run's log must read positively and
    // never contain a 'nothing (was) tailored' claim.
    const md = renderRunLogMarkdown([
      row({ tailored: 4, autoProcessed: 4, autoEligible: 2, zeroReason: null }),
    ]).toLowerCase();
    expect(md, "a successful run must not say 'nothing'").not.toMatch(/nothing/);
    expect(md).not.toMatch(/no (new )?match|no search enabled/);
    // And the positive outcome IS present, so this is not vacuous.
    expect(md).toMatch(/tailor|queued/);
  });
});
