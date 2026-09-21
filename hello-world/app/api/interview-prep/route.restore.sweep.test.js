// ---------------------------------------------------------------------------
// P3 (plan §2.7) / risk R2 -- the route-payload census.
//
// THE FAILURE THIS EXISTS FOR IS SILENT. route.js has FIVE terminal
// failure/unavailable finishAttempt call sites today (:299 spend-record
// refusal, :386 GATE 10 unavailable, :457 provider error/timeout, :471
// unparseable reply, :535 zero usable sections). The N47 fix has to reach all
// five. An implementation that reaches four fixes the bug for timeouts and
// leaves it alive for unparseable replies -- and nothing about that state is
// observable: the suite is green, the product says nothing, and the candidate
// only finds out on the one failure mode nobody wired.
//
// route.restore.test.js drives all five behaviourally, which is the stronger
// instrument. This census is the SECOND, independent one, and it answers a
// different question: it fails the moment a SIXTH failure branch is added
// without the spread, before anyone writes a behavioural test for it. The two
// together are what make "all of them" checkable rather than "the ones we
// happened to think of".
//
// ---------------------------------------------------------------------------
// INSTRUMENT I4 (plan §6.3), rebuilt rather than imported.
// ---------------------------------------------------------------------------
// `findCalls` / `splitTopLevelArgs` / `stripComments` exist at
// lib/interviewPrep/trustedNamesCallSites.sweep.test.js:61,119,144 but are
// module-private in a `.test.js`, and importing a `.test.js` re-executes its
// whole suite nested inside this one (lib/sourceScan/tokenizeSource.js's own
// header records that measurement). So the call extractor is rebuilt here --
// but ON TOP OF the shared lib/sourceScan/tokenizeSource.js, never a fifth
// private comment-stripper fork. That fork is not hypothetical: the sweep
// cited above forked one already, and exportReachability.sweep.test.js's
// header records that an earlier fork "was silently wrong and under-reported
// real sites with no error at all" -- which for a sweep means reporting CLEAN.
//
// `readable` (not `codeMask`) is the right view here: comments are blanked, so
// this file's own prose above cannot inflate its counts, while STRING
// CONTENTS survive -- and the whole census turns on reading the string
// literal `"failed"` inside an argument list.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tokenizeSource } from "@/lib/sourceScan/tokenizeSource.js";

const ROUTE_PATH = path.join(process.cwd(), "app", "api", "interview-prep", "route.js");
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

/** True when the identifier at `matchIndex` is a function DECLARATION rather
 *  than a call -- the same guard trustedNamesCallSites.sweep.test.js:108 uses,
 *  so `export async function finishAttempt(` in its own defining module can
 *  never be counted as a call site. */
function isDeclaration(src, matchIndex) {
  return /function\s*$/.test(src.slice(Math.max(0, matchIndex - 40), matchIndex));
}

/** Paren-balanced extraction of every `fnName(...)` call's argument text.
 *  Word-boundary anchored, so a differently-named identifier ending in the
 *  same letters can never match. */
function findCalls(src, fnName) {
  const calls = [];
  const re = new RegExp(`\\b${fnName}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(src))) {
    if (isDeclaration(src, m.index)) continue;
    const openIdx = src.indexOf("(", m.index);
    let depth = 0;
    let i = openIdx;
    for (; i < src.length; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const before = src.slice(0, m.index);
    calls.push({
      line: before.split("\n").length,
      argsText: src.slice(openIdx + 1, i),
    });
    re.lastIndex = i + 1;
  }
  return calls;
}

/** The comment-blanked, string-preserving view of one file. */
function readableOf(file) {
  return tokenizeSource(readFileSync(file, "utf8"), { label: path.basename(file) }).readable;
}

/** A terminal write that must put the previous document back: the payload
 *  names a `status` of "failed" or "unavailable". The success and embedded
 *  sites pass their own real `pack` and are deliberately out of scope. */
const TERMINAL_FAILURE_STATUS = /status\s*:\s*["'](failed|unavailable)["']/;

/** The restore spread the plan fixes by name (§2.2, ledger line P2): the five
 *  failure sites spread it EXPLICITLY, at the call site, rather than having
 *  finishAttempt inject content into a write its caller never asked for -- a
 *  hidden second writer of interview_prep_packs.pack would falsify
 *  R-N45-CLAIMS outright. */
const RESTORE_SPREAD = /\.\.\.\s*restore\b/;

function finishAttemptCalls() {
  return findCalls(readableOf(ROUTE_PATH), "finishAttempt");
}

describe("[canaries] the extractor is alive before anything is asserted about the tree", () => {
  it("finds at least 7 finishAttempt( call sites in route.js -- today's exact count", () => {
    // A dead regex finds zero sites and then passes every "for each site"
    // assertion by vacuous truth. Asserting a positive floor FIRST is what
    // rules that out. 7 is today's measured count (route.js:299, 386, 401,
    // 457, 471, 535, 547), asserted as a floor so an added branch does not
    // fail this canary for the wrong reason.
    expect(finishAttemptCalls().length).toBeGreaterThanOrEqual(7);
  });

  it("finds at least 5 of them carrying a terminal failure/unavailable status -- today's exact count", () => {
    const failures = finishAttemptCalls().filter((c) => TERMINAL_FAILURE_STATUS.test(c.argsText));
    expect(failures.length).toBeGreaterThanOrEqual(5);
  });

  it("[canary] a COMMENT that mentions finishAttempt( contributes zero call sites once blanked", () => {
    const fixture = [
      "// finishAttempt(supabase, { status: \"failed\" });",
      "/* finishAttempt(supabase, { status: \"unavailable\" }); */",
      "const x = 1;",
    ].join("\n");
    expect(fixture).toContain("finishAttempt(");
    expect(findCalls(tokenizeSource(fixture).readable, "finishAttempt")).toHaveLength(0);
  });

  it("[canary] this sweep's own file is never scanned -- its prose names the very patterns it looks for", () => {
    expect(SELF_PATH).not.toBe(path.resolve(ROUTE_PATH));
  });

  it("[canary] the two predicates can each tell a compliant site from a non-compliant one", () => {
    // Proven on synthetic fixtures, both directions, so neither predicate can
    // be an always-true or always-false stub.
    const compliant = 'finishAttempt(supabase, { ...attemptCtx, status: "failed", reason: "provider-error", ...restore });';
    const missing = 'finishAttempt(supabase, { ...attemptCtx, status: "failed", reason: "provider-error" });';
    const success = 'finishAttempt(supabase, { ...attemptCtx, status: computedStatus, pack: normalizedPack });';

    const compliantArgs = findCalls(tokenizeSource(compliant).readable, "finishAttempt")[0].argsText;
    const missingArgs = findCalls(tokenizeSource(missing).readable, "finishAttempt")[0].argsText;
    const successArgs = findCalls(tokenizeSource(success).readable, "finishAttempt")[0].argsText;

    expect(TERMINAL_FAILURE_STATUS.test(compliantArgs)).toBe(true);
    expect(TERMINAL_FAILURE_STATUS.test(missingArgs)).toBe(true);
    expect(TERMINAL_FAILURE_STATUS.test(successArgs)).toBe(false);
    expect(RESTORE_SPREAD.test(compliantArgs)).toBe(true);
    expect(RESTORE_SPREAD.test(missingArgs)).toBe(false);
  });
});

describe("P3 -- EVERY terminal failure/unavailable finishAttempt payload in route.js names the restore spread", () => {
  it("[RED on HEAD: 0 of 5 sites carry it] no failure branch is left behind", () => {
    // MUTATION KILL for this instrument: delete `...restore` from exactly one
    // of the five sites in a scratch copy and this test names that site's
    // line number. That is the whole point -- four-out-of-five is the silent
    // state, and the message below is what makes it loud.
    const offenders = finishAttemptCalls()
      .filter((c) => TERMINAL_FAILURE_STATUS.test(c.argsText))
      .filter((c) => !RESTORE_SPREAD.test(c.argsText))
      .map((c) => `route.js:${c.line}`);

    expect(
      offenders,
      `these terminal failure/unavailable finishAttempt payloads do not restore the prior document: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
