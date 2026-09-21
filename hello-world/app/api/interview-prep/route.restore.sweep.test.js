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

// ---------------------------------------------------------------------------
// FIX ROUND EXTENSION (verify.r1's F-M1/F-M2): the census above only ever
// looked at finishAttempt( PAYLOADS carrying a "failed"/"unavailable" status
// -- it could not see (a) a SUCCESS write whose own CHECK-safe retry has
// nothing to fall back to, because a success payload is deliberately out of
// this file's own P3 scope ("the success and embedded sites pass their own
// real `pack` and are deliberately out of scope"), or (b) a post-claim exit
// that never calls finishAttempt( AT ALL, because a census over finishAttempt
// CALLS cannot see a branch that makes none. Both are exactly the shape three
// live gaps took (the no-key 503, and both success sites' own retry). The two
// blocks below close each independently.
// ---------------------------------------------------------------------------

/** A standalone `restore` FIELD (as opposed to a `...restore` SPREAD) --
 *  route.js's own fix for a SUCCESS write (:454ish, :606ish): the write
 *  itself carries fresh content, so `restore` is never spread into it, but
 *  the CHECK-safe fallback retry still needs it. Computed by stripping every
 *  `...restore` occurrence first, then checking whether a bare `restore`
 *  identifier (immediately followed by `,` or `}`) survives -- so a spread
 *  can never be double-counted as a standalone field. */
function hasRestoreField(argsText) {
  const withoutSpread = argsText.replace(/\.\.\.\s*restore\b/g, "");
  return /\brestore\b\s*(?=[,}])/.test(withoutSpread);
}

describe("P3-EXT (fix round) -- every finishAttempt call in route.js can reach `restore`, spread or standalone", () => {
  it("[canary] hasRestoreField tells a `restore,` field apart from a `...restore` spread and from neither", () => {
    const spreadOnly = 'finishAttempt(supabase, { ...attemptCtx, status: "failed", ...restore })';
    const fieldOnly = 'finishAttempt(supabase, { ...attemptCtx, status: "partial", pack, restore })';
    const neither = 'finishAttempt(supabase, { ...attemptCtx, status: "partial", pack })';

    const spreadArgs = findCalls(tokenizeSource(spreadOnly).readable, "finishAttempt")[0].argsText;
    const fieldArgs = findCalls(tokenizeSource(fieldOnly).readable, "finishAttempt")[0].argsText;
    const neitherArgs = findCalls(tokenizeSource(neither).readable, "finishAttempt")[0].argsText;

    expect(hasRestoreField(spreadArgs), "a ...restore spread must not ALSO read as a standalone field").toBe(false);
    expect(hasRestoreField(fieldArgs)).toBe(true);
    expect(hasRestoreField(neitherArgs)).toBe(false);
  });

  it("[RED before this fix round: GATE 11's embedded success and the final gemini success carried neither] every finishAttempt payload names restore -- spread (a failure/unavailable write reusing the prior document as its own) or standalone (a success write giving its own CHECK-safe retry something to fall back to)", () => {
    const offenders = finishAttemptCalls()
      .filter((c) => !RESTORE_SPREAD.test(c.argsText) && !hasRestoreField(c.argsText))
      .map((c) => `route.js:${c.line}`);
    expect(offenders, `these finishAttempt calls cannot reach restore at all: ${offenders.join(", ")}`).toEqual([]);
  });
});

/** Helpers/functions defined ELSEWHERE in route.js that a post-claim branch
 *  may delegate to instead of calling finishAttempt( directly, PROVIDED that
 *  helper itself always calls finishAttempt before returning -- an explicit,
 *  reviewed allowlist (the same discipline
 *  trustedNamesCallSites.sweep.test.js's own KNOWN_CALL_SITES uses), not a
 *  generic call-graph walk. `refuseRecordingFailure` is the one delegate
 *  route.js has today (GATE 12's spend-record refusal, route.js:305-315,
 *  which itself spreads `...restore` into its own finishAttempt call). A
 *  future delegate must be added here in the SAME step that adds it. */
const FINISH_ATTEMPT_DELEGATES = ["refuseRecordingFailure"];

/** Is the `{` at `braceIndex` a STATEMENT block (an if/try/catch/else/
 *  finally/do body) rather than an OBJECT LITERAL or destructuring pattern?
 *  Decided by the single non-whitespace token immediately before it: `)`
 *  (closes an `if(...)`/`while(...)`/`catch(...)` condition) or the bare
 *  keyword `try`/`else`/`finally`/`do`/`catch` (a paren-less catch). Anything
 *  else -- `(`, `,`, `=`, `:`, `return`, the start of `const {` -- is an
 *  expression brace. This is the one piece of real JS-shape knowledge the
 *  census below needs; everything else is plain depth counting. */
function isBlockBrace(text, braceIndex) {
  let k = braceIndex - 1;
  while (k >= 0 && /\s/.test(text[k])) k -= 1;
  if (k < 0) return true;
  if (text[k] === ")") return true;
  let wordStart = k + 1;
  while (wordStart > 0 && /[A-Za-z]/.test(text[wordStart - 1])) wordStart -= 1;
  const word = text.slice(wordStart, k + 1);
  return ["try", "else", "finally", "do", "catch"].includes(word);
}

/** Splits `body` into its own top-level STATEMENT blocks, interleaved with
 *  the flat code between them, in source order. An expression brace (an
 *  object literal or destructuring pattern) is still walked past in a
 *  depth-balanced way -- so nothing inside it is ever miscounted -- but it
 *  does NOT start a new segment; only a genuine statement block does. This
 *  is what keeps `finishAttempt(supabase, { ...restore })` and the `return`
 *  that follows it in the SAME segment as each other. */
function splitTopLevelSegments(body) {
  const segments = [];
  let i = 0;
  let segStart = 0;
  while (i < body.length) {
    if (body[i] === "{") {
      const blockBrace = isBlockBrace(body, i);
      let depth = 1;
      let j = i + 1;
      for (; j < body.length && depth > 0; j += 1) {
        if (body[j] === "{") depth += 1;
        else if (body[j] === "}") depth -= 1;
      }
      if (blockBrace) {
        segments.push(body.slice(segStart, i));
        segments.push(body.slice(i, j));
        segStart = j;
      }
      i = j;
    } else {
      i += 1;
    }
  }
  segments.push(body.slice(segStart));
  return segments;
}

/** The `POST` handler's own body (braces of the function signature itself
 *  stripped), from the comment-blanked view. */
function postHandlerBody() {
  const src = readableOf(ROUTE_PATH);
  const marker = "export async function POST";
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("export async function POST was not found in route.js");
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(braceStart + 1, i);
}

/** Every top-level segment of `POST`, from the claim onward, that contains a
 *  `return` but neither `finishAttempt(` nor a call to a FINISH_ATTEMPT_DELEGATES
 *  member -- exempting the claim's OWN immediate refusal (`claim.reason`),
 *  since a refused claim never blanked anything. This is F-M1's exact shape:
 *  a post-claim exit that calls finishAttempt zero times has no payload for
 *  the payload-only census (above) to ever examine. */
function orphanTerminalSegments(body) {
  const claimIdx = body.indexOf("claimPrepPack(");
  const afterClaim = claimIdx >= 0 ? body.slice(claimIdx) : body;
  const offenders = [];
  for (const segment of splitTopLevelSegments(afterClaim)) {
    if (!/\breturn\b/.test(segment)) continue;
    if (segment.includes("claim.reason")) continue;
    const covered =
      segment.includes("finishAttempt(") || FINISH_ATTEMPT_DELEGATES.some((name) => segment.includes(`${name}(`));
    if (!covered) offenders.push(segment.trim().slice(0, 160));
  }
  return offenders;
}

describe("post-claim terminal-exit census (fix round, F-M1) -- no return after the claim is orphaned", () => {
  it("[canary, synthetic] the segment splitter + orphan detector tell a covered exit from an orphaned one, and are not fooled by nested object-literal braces", () => {
    const covered = `
      const claim = await claimPrepPack(supabase, { applicationId, userId });
      if (!claim.claimed) {
        return Response.json({ status: "refused", reason: claim.reason }, { status: 409 });
      }
      try {
        client = getGeminiClient();
      } catch {
        const { write } = await finishAttempt(supabase, { ...attemptCtx, status: "failed", ...restore });
        if (!write.written) return writeFailureResponse(write);
        return Response.json({ error: NO_KEY_REFUSAL }, { status: 503 });
      }
    `;
    const orphaned = `
      const claim = await claimPrepPack(supabase, { applicationId, userId });
      if (!claim.claimed) {
        return Response.json({ status: "refused", reason: claim.reason }, { status: 409 });
      }
      try {
        client = getGeminiClient();
      } catch {
        return Response.json({ error: NO_KEY_REFUSAL }, { status: 503 });
      }
    `;
    expect(orphanTerminalSegments(tokenizeSource(covered).readable)).toEqual([]);
    expect(orphanTerminalSegments(tokenizeSource(orphaned).readable).length).toBeGreaterThan(0);
  });

  it("[proof this census bites, no source mutation needed: the SAME check against the pre-fix route.js (git HEAD) finds exactly the no-key catch block] every return in today's POST, after the claim, is backed by finishAttempt(, a named delegate, or is the claim's own refusal", () => {
    const offenders = orphanTerminalSegments(postHandlerBody());
    expect(
      offenders,
      `these POST segments return after the claim with no finishAttempt reachable: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
