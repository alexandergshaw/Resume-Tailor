// Every place B1 or B3 must fire IP3's own research trigger, and nowhere
// else may. Template and discipline copied directly from the already-landed
// app/glossaryTriggerSeams.test.js (reuse.r1.md RU-10): `codeOf()` strips
// comments so a prose mention of a symbol is never mistaken for a call to
// it; `bodyOf()` brace-matches a named function so an assertion scopes to
// exactly that function.
//
// SCOPE, STATED PLAINLY. design-structure.r1.md §7/DS-9 and
// design-operate.r1.md §9/OP-12 together name 16 census sites; exactly 5
// must fire IP3's own trigger (plan.r1.md §4/§5.2) and the other 11 must
// not. This file asserts the 5 POSITIVE sites with full confidence -- every
// one verified this session by direct read, at the exact function names
// below. For the NEGATIVE side, this file asserts only a VERIFIED,
// well-evidenced subset (3 of the 11): the whole in-app batch-tailor
// pipeline, which O-13 explicitly excludes from IP3's trigger set by name
// (owner-rulings.md O-13; rulings.md R-IP3-21's arithmetic). The tool that
// produced the full 16-site enumeration (`census2.mjs`) is confirmed NOT
// present in this repo (reuse.r1.md §3 -- it lived only in a prior seat's
// disposable scratchpad), so this seat does not have independently-verified
// file:line/function-name citations for the remaining ~8 negative sites and
// will not fabricate them. That gap is named again in this seat's own
// artifact, not smoothed over here.
//
// THE 5 POSITIVE SITES (plan.r1.md §4's table, each function name confirmed
// this session by direct grep/read against app/page.js and
// app/hooks/useManualPostings.js at HEAD):
//   generateWithReviewedValues   app/page.js                       B1 (Slot-review)
//   handleUrlSubmit              app/page.js                       B1 (Posting-URL submit)
//   handleTailorFeedPosting      app/page.js                       B1 (Live-feed tailor)
//   runWorker                    app/hooks/useManualPostings.js    B1 (manual/JobDescriptionTab)
//   handleToggleApplied          app/page.js                       B3 (mark-applied)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE = "app/page.js";
const MANUAL_POSTINGS = "app/hooks/useManualPostings.js";

function codeOf(rel) {
  return readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function bodyOf(code, name) {
  const match = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`).exec(code);
  if (!match) return null;
  // The parameter list itself can contain balanced "{...}" (a default-object
  // parameter, e.g. "opts = {}") or "(...)" (a default value that calls a
  // function) -- so the body's own opening brace must be found AFTER the
  // parameter list's own parens close, never at the first "{" anywhere after
  // the name. check-4b.r1.md's lead finding: the prior, naive
  // `code.indexOf("{", start)` matched the "{}" inside "opts = {}" for BOTH
  // handleUrlSubmit and handleTailorJob (identical `(x, opts = {})`
  // signatures), returning that truncated stub as their "body" -- making the
  // must-fire row permanently unsatisfiable and the must-never-fire row
  // permanently vacuous. Balance the parens first.
  const parenStart = match.index + match[0].length - 1; // index of the "(" itself
  let parenDepth = 0;
  let i = parenStart;
  for (; i < code.length; i += 1) {
    if (code[i] === "(") parenDepth += 1;
    else if (code[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        i += 1;
        break;
      }
    }
  }
  if (parenDepth !== 0) return null; // the parameter list itself never closed
  const open = code.indexOf("{", i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < code.length; j += 1) {
    if (code[j] === "{") depth += 1;
    else if (code[j] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open, j + 1);
    }
  }
  return null;
}

const POSITIVE_SITES = [
  { rel: PAGE, fn: "generateWithReviewedValues", triggerClass: "B1", label: "Slot-review" },
  { rel: PAGE, fn: "handleUrlSubmit", triggerClass: "B1", label: "Posting-URL submit" },
  { rel: PAGE, fn: "handleTailorFeedPosting", triggerClass: "B1", label: "Live-feed tailor" },
  { rel: MANUAL_POSTINGS, fn: "runWorker", triggerClass: "B1", label: "manual (JobDescriptionTab)" },
  { rel: PAGE, fn: "handleToggleApplied", triggerClass: "B3", label: "mark-applied" },
];

// A verified subset of the 11 sites that must NOT fire -- O-13's explicit
// exclusion of the whole in-app batch-tailor pipeline, each function
// confirmed this session by direct read (app/page.js:2089, :2112, :1888).
const VERIFIED_NEGATIVE_SITES = [
  { rel: PAGE, fn: "handleTailorAllVisible", label: "opens the batch-tailor dialog; O-13 excludes the whole pipeline" },
  { rel: PAGE, fn: "startBatchTailor", label: "the batch runner itself -- O-13's named exclusion" },
  { rel: PAGE, fn: "handleTailorJob", label: "the per-job worker startBatchTailor calls; not one of the 5 named B1/B3 sites" },
];

describe("[instrument] every seam function is findable by name -- if a rename made one null, the assertions below would pass on an empty string", () => {
  it.each(POSITIVE_SITES)("$fn ($label) exists in $rel", ({ rel, fn }) => {
    expect(bodyOf(codeOf(rel), fn), `${fn} vanished from ${rel}`).toBeTruthy();
  });

  it.each(VERIFIED_NEGATIVE_SITES)("$fn ($label) exists in $rel", ({ rel, fn }) => {
    expect(bodyOf(codeOf(rel), fn), `${fn} vanished from ${rel}`).toBeTruthy();
  });
});

describe("the 5 sites that MUST fire startInterviewPrepResearch, with the correct triggerClass", () => {
  it.each(POSITIVE_SITES)(
    '[currently RED -- prepTrigger.js does not exist] $fn calls startInterviewPrepResearch with triggerClass "$triggerClass"',
    ({ rel, fn, triggerClass }) => {
      const body = bodyOf(codeOf(rel), fn);
      expect(body).toMatch(/startInterviewPrepResearch\s*\(/);
      // The call and its triggerClass argument must be co-located, not
      // merely both present anywhere in a (possibly large) function body.
      const at = body.search(/startInterviewPrepResearch\s*\(/);
      const nearby = body.slice(at, at + 300);
      expect(nearby).toContain(`"${triggerClass}"`);
    },
  );

  it.each([PAGE, MANUAL_POSTINGS])("%s imports startInterviewPrepResearch from the ONE shared trigger module", (rel) => {
    // Path-depth-agnostic on purpose (../lib/interviewPrep/prepTrigger and
    // @/lib/interviewPrep/prepTrigger are both accepted) -- app/page.js
    // already uses a relative import for glossaryTrigger while other files
    // in this repo use the @/ alias, and asserting one specific depth here
    // would be exactly the "bad import depth" hazard only the build gate
    // can otherwise catch.
    expect(
      codeOf(rel),
      `${rel} must import startInterviewPrepResearch from lib/interviewPrep/prepTrigger`,
    ).toMatch(/import\s*\{[^}]*\bstartInterviewPrepResearch\b[^}]*\}\s*from\s*["'][^"']*prepTrigger["']/);
  });

  it("no seam AWAITS the trigger -- a void start is what keeps tailoring/applying independent of it (RU-6's three refusals)", () => {
    for (const rel of [PAGE, MANUAL_POSTINGS]) {
      expect(codeOf(rel), `${rel} awaits the prep trigger`).not.toMatch(/await\s+startInterviewPrepResearch/);
    }
  });
});

describe("the verified negative subset that must NEVER fire it (O-13's batch exclusion)", () => {
  it.each(VERIFIED_NEGATIVE_SITES)("$fn ($label) never calls startInterviewPrepResearch", ({ rel, fn }) => {
    const body = bodyOf(codeOf(rel), fn);
    expect(body).not.toMatch(/startInterviewPrepResearch\s*\(/);
  });
});

describe("[control] the seam reader can fail -- proven on synthetic fixtures, never by mutating a real file", () => {
  it("a body without the call is rejected", () => {
    const planted = "async function handleUrlSubmit() { await save(); }";
    const body = bodyOf(planted, "handleUrlSubmit");
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/startInterviewPrepResearch\s*\(/);
  });

  it("a call written inside a comment does not count", () => {
    const planted = "// startInterviewPrepResearch({ applicationId, triggerClass: \"B1\" });\nconst x = 1;";
    const stripped = planted
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/.*$/, ""))
      .join("\n");
    expect(stripped).not.toMatch(/startInterviewPrepResearch\s*\(/);
  });

  it("a call present but with the WRONG triggerClass fails the co-location check", () => {
    const wrongClassBody = '{ startInterviewPrepResearch({ applicationId, triggerClass: "B3" }); }';
    const at = wrongClassBody.search(/startInterviewPrepResearch\s*\(/);
    const nearby = wrongClassBody.slice(at, at + 300);
    expect(nearby).not.toContain('"B1"');
  });
});

describe("[control] the extractor correctly handles a default-object parameter (\"opts = {}\") -- the exact shape handleUrlSubmit/handleTailorJob share, and the bug check-4b.r1.md's lead finding proved", () => {
  it("a MUST-FIRE-shaped fixture (handleUrlSubmit's own signature): the real body is found, not the default parameter's own \"{}\"", () => {
    const planted = [
      "async function handleUrlSubmit(event, opts = {}) {",
      '  startInterviewPrepResearch({ applicationId, triggerClass: "B1" });',
      "}",
    ].join("\n");
    const body = bodyOf(planted, "handleUrlSubmit");
    expect(body, "bodyOf truncated to the default parameter's own {}").not.toBe("{}");
    expect(body).toMatch(/startInterviewPrepResearch\s*\(/);
  });

  it("the IDENTICAL default-parameter shape on a MUST-NEVER-FIRE fixture (handleTailorJob's own signature): a planted FORBIDDEN call is correctly found, not silently invisible", () => {
    // With the pre-fix extractor this fixture's body came back "{}", and the
    // real "must never fire" assertion elsewhere in this file
    // (`expect(body).not.toMatch(...)`) would have PASSED even with the
    // forbidden call actually present -- a permanently-vacuous guard for
    // O-13's exclusion. Proving the fixed extractor reports the call as
    // present here proves that row can now go red for a real regression.
    const planted = [
      "async function handleTailorJob(job, opts = {}) {",
      '  startInterviewPrepResearch({ applicationId, triggerClass: "B1" });',
      "}",
    ].join("\n");
    const body = bodyOf(planted, "handleTailorJob");
    expect(body, "bodyOf truncated to the default parameter's own {}").not.toBe("{}");
    expect(body).toMatch(/startInterviewPrepResearch\s*\(/);
    // Demonstrates the actual negative assertion this file makes elsewhere
    // would correctly FAIL (go red) against this fixture.
    expect(() => expect(body).not.toMatch(/startInterviewPrepResearch\s*\(/)).toThrow();
  });

  it("a default-object parameter with NO forbidden call present still extracts a real, substantial body -- the honest negative case, not a coincidence of an always-truncated stub", () => {
    const planted = [
      "async function handleTailorJob(job, opts = {}) {",
      "  return startBatchTailor(job, opts);",
      "}",
    ].join("\n");
    const body = bodyOf(planted, "handleTailorJob");
    expect(body).not.toBe("{}");
    expect(body.length).toBeGreaterThan(10);
    expect(body).not.toMatch(/startInterviewPrepResearch\s*\(/);
  });

  it("[canary] a default value that itself contains balanced parens, e.g. opts = makeDefaults(1, 2) -- the paren-balance still lands on the real body", () => {
    const planted = [
      "async function handleUrlSubmit(event, opts = makeDefaults(1, 2)) {",
      '  startInterviewPrepResearch({ applicationId, triggerClass: "B1" });',
      "}",
    ].join("\n");
    const body = bodyOf(planted, "handleUrlSubmit");
    expect(body).not.toBeNull();
    expect(body).toMatch(/startInterviewPrepResearch\s*\(/);
  });
});
