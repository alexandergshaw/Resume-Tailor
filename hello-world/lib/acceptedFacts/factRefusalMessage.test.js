// N56 half (b) -- a refusal must never name a cause the app has not
// established. Two things are pinned here:
//
//   T-b1  the reason -> message mapping is TOTAL and HONEST: every refusal
//         reason factDocx.js can return maps to a distinct, plain,
//         cover-letter-naming message; an UNRECOGNISED reason degrades to a
//         generic message that names NO cause (so the next reason someone
//         adds to factDocx.js cannot silently inherit the missing-file copy).
//         (AC-9, AC-12.)
//
//   T-b2  a CENSUS: every `reason: "..."` literal factDocx.js returns on a
//         refusal is covered by the mapping. (AC-10.)
//
// ---------------------------------------------------------------------------
// WHY THE MODULE IS LOADED LAZILY.
// ---------------------------------------------------------------------------
// `lib/acceptedFacts/factRefusalMessage.js` does not exist on HEAD -- it is
// half (b)'s new module. A STATIC import of it would make this whole file fail
// to load; vitest would print "Tests  no tests", and the census-instrument
// canaries below (the ones that PROVE the census can discriminate) would never
// run at all. A red that reports no tests is inconclusive. So the mapping is
// loaded lazily and only the legs that need it go red -- the extractor and the
// canary legs, which need no mapping, stay green and demonstrate the
// instrument on HEAD.
//
// ---------------------------------------------------------------------------
// WHAT THIS CENSUS READS, AND ITS BLIND SPOT (AC-10).
// ---------------------------------------------------------------------------
// It reads exactly ONE file, `lib/acceptedFacts/factDocx.js`, off disk. It
// does NOT walk the tree (backlog N58: the whole-tree census files time out
// under load; this one is immune by construction). Its blind spot: a refusal
// `reason` minted anywhere OTHER than factDocx.js is invisible to it. The
// enumeration of reachable refusal outcomes lives in the N56 AC (§3, R0..R8);
// this file only checks that factDocx.js's own literals are all covered.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACT_DOCX = path.join(HERE, "factDocx.js");

// The module under test -- loaded lazily (see the header). `messageFor` throws
// a clear instrument message when the module is absent, so a red names the
// missing module rather than a cryptic "not a function".
let messageForRefusal = null;
let moduleLoadError = null;
beforeAll(async () => {
  try {
    ({ messageForRefusal } = await import("./factRefusalMessage.js"));
  } catch (err) {
    moduleLoadError = err;
  }
});
function messageFor(reason) {
  if (typeof messageForRefusal !== "function") {
    throw new Error(
      `lib/acceptedFacts/factRefusalMessage.js#messageForRefusal is not available: ${
        moduleLoadError?.message || "not exported"
      }`,
    );
  }
  return messageForRefusal(reason);
}

// ---------------------------------------------------------------------------
// The extractor. Pulls every `reason: "<literal>"` that factDocx.js returns,
// EXCLUDING the success return (`reason: ""`). Comments are stripped first, so
// a reason named in a comment or JSDoc is not counted. Regex-literal-aware
// stripping is the shared `stripComments`, not a private fourth copy.
// ---------------------------------------------------------------------------
function reasonLiteralsIn(code) {
  const stripped = stripComments(code);
  const re = /reason:\s*("([^"]*)"|'([^']*)')/g;
  const out = new Set();
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const val = m[2] ?? m[3] ?? "";
    if (val !== "") out.add(val); // the success return is `reason: ""` -- not a refusal
  }
  return [...out];
}

// Given a set of reasons and a predicate "is this reason covered?", report
// both counts and the uncovered list. This is the census; a reason found in
// the source but not covered by the predicate is the failure it exists to see.
function coverageReport(reasons, isCovered) {
  const uncovered = reasons.filter((r) => !isCovered(r));
  return { found: reasons.length, covered: reasons.length - uncovered.length, uncovered };
}

const REAL_REASONS = reasonLiteralsIn(readFileSync(FACT_DOCX, "utf8"));

// ---------------------------------------------------------------------------
// CANARY FIRST. Before any verdict about the real mapping, prove the extractor
// and the census can DISCRIMINATE -- on fabricated inputs, and independent of
// the production module (which does not exist on HEAD).
// ---------------------------------------------------------------------------

describe("the census instrument discriminates (canary)", () => {
  const FABRICATED_SOURCE = `
    // reason: "in-a-comment" -- must NOT be counted
    export async function fake(b64) {
      if (!b64) return { applied: false, reason: "fab-no-bytes" };
      if (x) return { applied: false, reason: "fab-stale" };
      return { applied: true, reason: "" }; // success -- excluded
    }
  `;

  it("extracts the two refusal reasons and excludes the success return and the comment", () => {
    const found = reasonLiteralsIn(FABRICATED_SOURCE);
    expect(found.sort()).toEqual(["fab-no-bytes", "fab-stale"]);
    expect(found).not.toContain("in-a-comment");
    expect(found).not.toContain("");
  });

  it("a reason present in the source but ABSENT from the mapping makes the census fail", () => {
    // The load-bearing canary. A fake mapping that covers one of two reasons
    // must be reported as failing, with BOTH counts. Without this the real
    // assertion below could pass vacuously (e.g. an extractor that found
    // nothing, or a coverage predicate that was always true).
    const fakeMap = { "fab-no-bytes": "a message" };
    const found = reasonLiteralsIn(FABRICATED_SOURCE);
    const report = coverageReport(found, (r) => r in fakeMap);
    expect(report.found).toBe(2);
    expect(report.covered).toBe(1);
    expect(report.uncovered).toEqual(["fab-stale"]);
    expect(report.uncovered.length).toBeGreaterThan(0); // census would go RED
  });

  it("when every reason IS covered the census passes -- both directions", () => {
    const fakeMap = { "fab-no-bytes": "a", "fab-stale": "b" };
    const found = reasonLiteralsIn(FABRICATED_SOURCE);
    const report = coverageReport(found, (r) => r in fakeMap);
    expect(report.uncovered).toEqual([]);
    expect(report.covered).toBe(report.found);
  });

  it("the extractor really reached factDocx.js and found its refusal reasons", () => {
    // Floor: a broken extractor that silently matched nothing must not let the
    // real census pass vacuously. factDocx.js returns five refusal reasons.
    expect(REAL_REASONS.length).toBeGreaterThanOrEqual(5);
    expect(REAL_REASONS).toEqual(
      expect.arrayContaining(["no-cover-bytes", "stale-plan", "no-edits", "not-found", "docx-error"]),
    );
    // The success return must NOT be in the set -- it is not a refusal.
    expect(REAL_REASONS).not.toContain("");
  });
});

// ---------------------------------------------------------------------------
// T-b2 -- the real census (AC-10). RED on HEAD, and honestly so: there is no
// mapping for it to check against yet. Say that in the report; do not present
// it as a caught defect.
// ---------------------------------------------------------------------------

describe("every refusal reason factDocx.js can return is covered by the mapping (AC-10 census)", () => {
  it("maps every one of factDocx.js's refusal reasons to a specific (non-default) message", () => {
    // The default is discovered by asking the mapping about a reason no key
    // covers. A reason that maps to the default is UNCOVERED.
    const DEFAULT = messageFor("a-fabricated-reason-no-key-covers-xyzzy");
    const report = coverageReport(
      REAL_REASONS,
      (r) => typeof messageFor(r) === "string" && messageFor(r).length > 0 && messageFor(r) !== DEFAULT,
    );
    expect(
      report.uncovered,
      `found ${report.found} refusal reasons in factDocx.js, ${report.covered} are covered; uncovered: ${JSON.stringify(
        report.uncovered,
      )}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T-b1 -- the mapping itself (AC-9, AC-12).
// ---------------------------------------------------------------------------

const KNOWN_REASONS = ["no-cover-bytes", "stale-plan", "no-edits", "not-found", "docx-error"];

// The internal-vocabulary ban (AC-12). Word-boundaried where a bare substring
// would catch an ordinary English word ("plan" in "explain", "stale" in
// "installed", "edit" in "editor", "null" in "annulled") -- the ban is on the
// developer jargon, not on words that happen to contain it. `docx`, `b64`,
// `base64`, `splice`, `lineIndex`, `object Object` are unambiguous as
// substrings and stay bare.
const DEV_VOCAB = /\bstale\b|splice|docx|\bb64\b|base64|lineIndex|\bplan\b|edit\[|\bundefined\b|\bnull\b|object ?Object/i;

describe("the reason -> message mapping is total, distinct and honest (AC-9, AC-12)", () => {
  it("an UNRECOGNISED reason yields a generic message that names NO cause", () => {
    // AC-9(ii): this is what makes the next mis-mapping impossible to be a
    // false cause. The default must not claim the file is missing, must not
    // tell the candidate to regenerate (the remedy that destroys the fix), and
    // must leak no internals.
    const def = messageFor("quantum-flux");
    expect(typeof def).toBe("string");
    expect(def.length).toBeGreaterThan(20);
    expect(def).not.toMatch(/saved file is missing/i);
    expect(def).not.toMatch(/regenerat/i);
    expect(def).not.toMatch(DEV_VOCAB);
    // Two different unknown reasons get the SAME default -- it is a single
    // fallback arm, not per-reason invented copy.
    expect(messageFor("another-unknown-reason")).toBe(def);
  });

  it("the five factDocx refusal reasons map to pairwise-DISTINCT messages", () => {
    const msgs = KNOWN_REASONS.map((r) => messageFor(r));
    for (const m of msgs) expect(typeof m).toBe("string");
    expect(new Set(msgs).size, `messages were ${JSON.stringify(msgs)}`).toBe(KNOWN_REASONS.length);
    // And none of them is the default (each is specifically handled).
    const def = messageFor("quantum-flux");
    for (const [r, m] of KNOWN_REASONS.map((r, i) => [r, msgs[i]])) {
      expect(m, `${r} fell through to the default`).not.toBe(def);
    }
  });

  it("NO reason -- known or unknown -- produces the missing-file copy (AC-9 iii)", () => {
    // The missing-file / regenerate copy belongs to the R1 pre-check in the
    // hook alone. No arm of this mapping may reproduce it, or a splice refusal
    // would again tell the candidate their file is missing when it is not.
    for (const r of [...KNOWN_REASONS, "quantum-flux"]) {
      expect(messageFor(r), `${r} produced the missing-file copy`).not.toMatch(/saved file is missing/i);
      expect(messageFor(r), `${r} told the candidate to regenerate`).not.toMatch(/regenerat/i);
    }
  });

  it("the stale-plan message offers the remedy that actually works: add them one at a time (AC-12)", () => {
    // The whole point of half (b): a same-paragraph collision (stale-plan) is
    // fixed by accepting the cards one at a time -- a remedy that exists and
    // works today (per acceptFactIdDerivation.test.js). The false "regenerate"
    // remedy destroys the very bytes the accept needs.
    const m = messageFor("stale-plan");
    expect(m).toMatch(/one at a time/i);
    expect(m).not.toMatch(/regenerat/i);
  });

  it("every message names the cover letter, offers no developer vocabulary, and is not a bare code (AC-12)", () => {
    for (const r of [...KNOWN_REASONS, "quantum-flux"]) {
      const m = messageFor(r);
      expect(m, `${r}`).toMatch(/cover letter/i);
      expect(m, `${r} leaked developer vocabulary`).not.toMatch(DEV_VOCAB);
      expect(m, `${r} is a bare number or stringified object`).not.toMatch(/^\[object|^\d+$/);
    }
  });
});

// WHAT THIS FILE CANNOT CATCH, stated so the next reader does not over-trust
// it. (1) The census reads ONE file; a refusal reason minted outside
// factDocx.js is invisible to it (AC-10's stated blind spot). (2) It cannot
// see whether the hook actually ROUTES the splice refusal through
// `messageForRefusal` -- that reachability is `acceptRefusalMessage.test.js`'s
// job, by render-and-click. A perfect mapping that nothing calls would pass
// every assertion here. (3) It pins that the stale-plan copy CONTAINS "one at
// a time"; it cannot judge whether the whole sentence reads well.
