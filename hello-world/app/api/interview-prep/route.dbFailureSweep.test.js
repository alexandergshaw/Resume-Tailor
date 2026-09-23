// ---------------------------------------------------------------------------
// F-R12-1 (fix round r12, MAJOR, verify.r12.md) -- nine of route.js's own
// response paths returned a database's own error text verbatim to the
// candidate. Only ONE base-read refusal (F-R11-2, fix round r11) was ever
// sanitised, and the two comments beside it went on to claim the whole class
// was closed -- which was true of neither file-wide claim (route.js:290,
// 382, 741, 800, 855, 867, 876, 931, 951 all still leaked).
//
// Every one of those nine sites, plus the two F-R11-2 sites, now goes
// through dbFailureResponse (lib/interviewPrep/prepStore.js), the single
// choke point that makes "can this route ever leak schema detail through a
// 5xx response" answerable by reading one function instead of auditing nine
// call sites by hand. A TENTH site (F-R13-1, fix round r13, MAJOR,
// verify.r13.md) leaked past this function entirely: GET's own `error:
// trustedError` field is a SOFT field on an otherwise-200 response, never a
// 5xx this sweep polices, so it is fixed at ITS OWN source
// (trustedNames.js's readTrustedNames, via prepStore.js's logDbFailure)
// rather than through dbFailureResponse -- see route.trustedNamesLeak.test.js
// for the executed proof, and isFailureResponseCall's own docstring below
// for why a status-scoped sweep can never be the thing that catches it.
//
// THIS is the guard that keeps the 5xx class closed: a SWEEP over route.js's
// own text, not a list of line numbers -- a list goes stale the moment the
// file is edited again, and it cannot catch an eleventh 5xx site added
// later. The sweep re-reads the file every run and checks EVERY top-level
// value in a matched call's own body (F-R13-2, verify.r13.md MAJOR widened
// this from the single `error:` key alone), not only the exact shapes the
// original nine sites happened to use -- but it is still a source-text
// regex, not a type system: a value that is safe for a reason this sweep
// cannot see from the call site alone (e.g. a function call that always
// returns a literal) will still be flagged, and a call this file does not
// know the name of is invisible to it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tokenizeSource } from "@/lib/sourceScan/tokenizeSource.js";

const ROUTE_PATH = path.join(process.cwd(), "app", "api", "interview-prep", "route.js");
const LIB_INTERVIEW_PREP_DIR = path.join(process.cwd(), "lib", "interviewPrep");

function readableRouteSource() {
  return tokenizeSource(readFileSync(ROUTE_PATH, "utf8"), { label: "route.js" }).readable;
}

/** Paren-balanced extraction of every `name(...)` call's own argument text
 *  and 1-based source line -- the same shape route.restore.sweep.test.js's
 *  own `findCalls` uses, generalised to any callee (including a dotted one
 *  like `Response.json`, where the literal `.` inside the pattern still only
 *  ever matches the real dot). */
function findCallsByName(src, name) {
  const calls = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(src))) {
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
    calls.push({ line: before.split("\n").length, argsText: src.slice(openIdx + 1, i) });
    re.lastIndex = i + 1;
  }
  return calls;
}

/** Scans `text` starting at `start`, skipping over any string/template
 *  literal whole, and returns the index of the first TOP-LEVEL (relative to
 *  `start`) comma or unmatched closing bracket -- or `text.length` if none.
 *  Used by `splitTopLevelArgs` so a comma or bracket sitting inside a message
 *  string (readable's own view keeps string CONTENTS intact, only comments
 *  are blanked) can never be mistaken for a real argument boundary. */
function scanToBoundary(text, start) {
  let depth = 0;
  let inString = null;
  let i = start;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      break;
    }
  }
  return i;
}

/** Splits a call's own argument text into its top-level, comma-separated
 *  arguments -- string- and bracket-depth aware. */
function splitTopLevelArgs(argsText) {
  const parts = [];
  let start = 0;
  while (start <= argsText.length) {
    const end = scanToBoundary(argsText, start);
    const part = argsText.slice(start, end).trim();
    if (part) parts.push(part);
    if (end >= argsText.length) break;
    start = end + 1;
  }
  return parts;
}

/** True for a `{...}` object-literal text (as opposed to an expression like
 *  `String(error)` or a bare identifier) -- only this shape is safe to scan
 *  property-by-property; anything else is opaque source text. */
function isObjectLiteralText(text) {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

/** Splits a `{...}` object literal's OWN interior into its top-level
 *  entries -- `key: value`, a bare shorthand identifier, or a `...spread` --
 *  string- and bracket-depth aware (reuses splitTopLevelArgs's own scanner,
 *  which treats `{`/`}` exactly like `(`/`)`/`[`/`]`, so a nested object's
 *  own commas never get mistaken for a top-level boundary). Returns `null`
 *  when `text` is not a plain `{...}` object literal at all. */
function entriesOf(text) {
  const trimmed = text.trim();
  if (!isObjectLiteralText(trimmed)) return null;
  return splitTopLevelArgs(trimmed.slice(1, -1));
}

/** True for a spread entry (`...expr`) -- opaque by construction. Source
 *  text alone cannot prove what an unknown spread carries, so it is always
 *  treated as a potential offender rather than silently skipped
 *  (F-R13-2, verify.r13.md MAJOR: EVADE-spreadErrorObject). */
function isSpreadEntry(entry) {
  return entry.trim().startsWith("...");
}

/** Splits ONE entry (`key: value`, or a bare shorthand identifier) into its
 *  key and value text. The colon searched for is the first TOP-LEVEL one --
 *  string- and bracket-depth aware, so a nested object's own colon
 *  (`stages: { name: x }`) is never mistaken for this entry's own
 *  separator. A shorthand entry (`error`, no colon at all) means
 *  `{ error: error }` in real JS, so its key and value are both the
 *  identifier itself (F-R13-2, verify.r13.md MAJOR: EVADE's shorthand form,
 *  and the real, pre-fix `route.js:800`, both went unseen by a check that
 *  only recognised the `key: value` shape). */
function splitEntry(entry) {
  let depth = 0;
  let inString = null;
  for (let i = 0; i < entry.length; i += 1) {
    const ch = entry[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === ":" && depth === 0) {
      return { key: entry.slice(0, i).trim(), value: entry.slice(i + 1).trim() };
    }
  }
  const shorthand = entry.trim();
  return { key: shorthand, value: shorthand };
}

/** True for a boolean/number/null literal token -- extra body fields like
 *  PUT's own `written: false` carry a boolean, not a string, so
 *  isStringLiteral alone is too narrow for a whole-body scan. */
function isLiteralToken(value) {
  return /^(true|false|null|-?\d+(\.\d+)?)$/.test(value.trim());
}

/** True for a plain double- or single-quoted string literal with no
 *  interpolation and no embedded quote of its own kind -- never a template
 *  literal, never an expression. */
function isStringLiteral(value) {
  if (!value || value.length < 2) return false;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return false;
  return !value.slice(1, -1).includes(quote);
}

/** True for a SCREAMING_SNAKE_CASE identifier -- route.js's own module-scope
 *  constants (RATE_LIMITED_MESSAGE, NO_KEY_REFUSAL) are the only non-literal
 *  `error` values this file carries on purpose, and both are bound to a
 *  literal string at module scope, never to request- or database-derived
 *  data. A raw leak is always a lowercase identifier or a property access
 *  (`appErr.message`, `result.error`, `write.error`) -- never this shape. */
function isSafeConstant(value) {
  return /^[A-Z][A-Z0-9_]*$/.test(value);
}

/** Scoped to a genuine FAILURE response -- a call whose own argument text
 *  carries a 5xx status (every one of the nine F-R12-1 sites, and every
 *  dbFailureResponse( call, does). Broadened from `status: 500` alone
 *  (F-R13-2, verify.r13.md MAJOR: EVADE-status502 moved a real site to 502
 *  and the narrower check never even looked at it) to any 500-599 value.
 *  Deliberately NOT widened to every 4xx too: a 409/429 body legitimately
 *  carries a controlled, non-database enum (`claim.reason`,
 *  `RATE_LIMITED_MESSAGE`), and scanning those for "every value is a
 *  literal" would flag real, disclosed, non-leaking responses -- 5xx is
 *  exactly the range every F-R12-1 site and every dbFailureResponse( call
 *  actually uses.
 *
 *  Out of scope by construction, not by exclusion: GET's own healthy 200
 *  body, which separately surfaces `error: trustedError` from
 *  readTrustedNames as a SOFT, non-fatal field on an otherwise successful
 *  read. That site is not a 5xx failure response at all, so a status-scoped
 *  sweep can never reach it regardless of how this predicate is drawn --
 *  it is fixed AT ITS OWN SOURCE instead (trustedNames.js's own fail-closed
 *  branch, via prepStore.js's logDbFailure -- F-R13-1, verify.r13.md MAJOR;
 *  see route.trustedNamesLeak.test.js for the executed proof). An earlier
 *  version of this comment scoped that site out reasoning that
 *  "trustedNames.js is not one of this round's allowed files" -- that
 *  reasoning did not hold (the leak site is route.js:821, always in scope),
 *  and has been removed rather than repeated. */
function isFailureResponseCall(argsText) {
  return /\bstatus\s*:\s*5\d\d\b/.test(argsText);
}

/** Literal-or-provably-safe: a string literal, a SCREAMING_SNAKE_CASE
 *  module-scope constant, or a boolean/number/null literal token. Anything
 *  else -- a bare identifier, a property access, a template literal, a
 *  function call -- is a value this sweep cannot prove safe from source
 *  text alone, and is treated as an offender. */
function isLiteralValue(value) {
  return isStringLiteral(value) || isSafeConstant(value) || isLiteralToken(value);
}

/** Every top-level entry of a 5xx `Response.json(` call's OWN body (its
 *  first argument) that is not provably safe -- covers a differently-named
 *  key (`detail: error`), the `error:`-shorthand form (`{ error }`), and a
 *  spread (`...{ error }`), not only the single `error:` key the narrower
 *  original check alone saw (F-R13-2, verify.r13.md MAJOR). A body that
 *  isn't a plain object literal at all (e.g. a bare safe constant like
 *  `DISABLED`, route.js:325) is checked the same way a single value would
 *  be, rather than reported as unparseable. */
function offendingBodyEntries(call) {
  const [bodyText] = splitTopLevelArgs(call.argsText);
  const trimmedBody = (bodyText || "").trim();
  const entries = entriesOf(trimmedBody);
  if (!entries) {
    if (isLiteralValue(trimmedBody)) return [];
    return [`route.js:${call.line} (body is not a plain object literal or literal value: ${trimmedBody})`];
  }
  const offenders = [];
  for (const raw of entries) {
    if (isSpreadEntry(raw)) {
      offenders.push(`route.js:${call.line} (spread ${raw.trim()})`);
      continue;
    }
    const { key, value } = splitEntry(raw);
    if (isLiteralValue(value)) continue;
    offenders.push(`route.js:${call.line} (${key}: ${value})`);
  }
  return offenders;
}

/** Every entry of a dbFailureResponse( call's own FOURTH argument (`extra`),
 *  scanned the same way offendingBodyEntries scans a Response.json( body.
 *  Defense in depth alongside prepStore.js's own DB_FAILURE_EXTRA_KEYS
 *  allow-list (F-R13-2, verify.r13.md MAJOR: EVADE-extraFourthArg survived
 *  the whole 814-test suite because nothing checked this argument's own
 *  shape at all -- the allow-list closes the runtime leak; this closes the
 *  matching gap in the sweep that is supposed to catch a regression of it).
 *  A call with fewer than four arguments is never flagged -- `extra` is
 *  optional. */
function offendingExtraEntries(call) {
  const args = splitTopLevelArgs(call.argsText);
  if (args.length < 4) return [];
  const entries = entriesOf(args[3]);
  if (!entries) return [`route.js:${call.line} (fourth argument is not a plain object literal: ${args[3]})`];
  const offenders = [];
  for (const raw of entries) {
    if (isSpreadEntry(raw)) {
      offenders.push(`route.js:${call.line} (spread ${raw.trim()})`);
      continue;
    }
    const { key, value } = splitEntry(raw);
    if (isLiteralValue(value)) continue;
    offenders.push(`route.js:${call.line} (${key}: ${value})`);
  }
  return offenders;
}

describe("[canaries] the extractor and predicates are alive before anything is asserted about route.js", () => {
  it("finds at least 18 Response.json( call sites in route.js -- today's exact count", () => {
    // A dead regex finds zero sites and then passes every offender check
    // below by vacuous truth.
    expect(findCallsByName(readableRouteSource(), "Response.json").length).toBeGreaterThanOrEqual(18);
  });

  it("finds exactly 5 of those calls carrying a 5xx status -- today's exact count, the scope this sweep polices (the other 5xx calls route.js used to build by hand now go through dbFailureResponse instead)", () => {
    // Broadened from `status: 500` alone (3 sites) to any 5xx (F-R13-2,
    // verify.r13.md MAJOR) -- the two GATE-1/getGeminiClient 503 sites
    // (DISABLED, NO_KEY_REFUSAL) are now in scope too, and both are already
    // safe (a module-scope constant object, and a call with a safe-constant
    // `error`), so widening the scope adds no offender.
    const failureCalls = findCallsByName(readableRouteSource(), "Response.json").filter((call) =>
      isFailureResponseCall(call.argsText),
    );
    expect(failureCalls.length).toBe(5);
  });

  it("finds at least 9 dbFailureResponse( call sites -- one per site F-R12-1 closed", () => {
    expect(findCallsByName(readableRouteSource(), "dbFailureResponse").length).toBeGreaterThanOrEqual(9);
  });

  it("isStringLiteral/isSafeConstant tell a literal, a safe constant and a raw leak apart", () => {
    expect(isStringLiteral('"Could not load this application\'s prep pack."')).toBe(true);
    expect(isStringLiteral("'ok'")).toBe(true);
    expect(isStringLiteral("appErr.message")).toBe(false);
    expect(isStringLiteral('appErr.message || "fallback text"')).toBe(false);
    expect(isStringLiteral("`templated ${x}`")).toBe(false);
    expect(isSafeConstant("RATE_LIMITED_MESSAGE")).toBe(true);
    expect(isSafeConstant("appErr")).toBe(false);
    expect(isSafeConstant("appErr.message")).toBe(false);
  });

  it("splitTopLevelArgs splits dbFailureResponse( 's own four arguments, string- and comma-aware", () => {
    const fixture = 'dbFailureResponse("GATE 6 application read failed", { applicationId, error: appErr }, "Could not load this application.")';
    const call = findCallsByName(tokenizeSource(fixture).readable, "dbFailureResponse")[0];
    const args = splitTopLevelArgs(call.argsText);
    expect(args).toEqual(['"GATE 6 application read failed"', "{ applicationId, error: appErr }", '"Could not load this application."']);
  });
});

describe("F-R12-1 -- every FAILURE Response.json( call in route.js (5xx) returns only literal/safe-constant values in its OWN body", () => {
  it("[RED before this fix round: F-R11-2's own two sites already passed; the other nine did not, because they built Response.json({error: <raw>}) by hand instead of routing through dbFailureResponse] no value in a 5xx call's own body is a raw expression, under any key name, shorthand, or spread", () => {
    // MUTATION KILL for this instrument: revert any one of the nine sites in
    // route.dbFailureSweep's own second describe block below (they build
    // their 5xx through dbFailureResponse, not Response.json( directly) back
    // to a hand-built `Response.json({ error: <raw> }, { status: 500 })` in a
    // scratch copy, and this test names the offending line.
    //
    // F-R13-2 (fix round r13, MAJOR, verify.r13.md): widened from "the value
    // bound to the `error:` key alone" to EVERY top-level entry of the
    // body -- the narrower check never saw a differently-named key
    // (`detail: error`), the `error:`-shorthand form (`{ error }`, the exact
    // shape route.js:800's own PRE-fix text used), or a spread
    // (`...{ error }`). See the dedicated evasion tests below for each shape
    // individually.
    const offenders = findCallsByName(readableRouteSource(), "Response.json")
      .filter((call) => isFailureResponseCall(call.argsText))
      .flatMap((call) => offendingBodyEntries(call));

    expect(offenders, `these 5xx Response.json( calls can return non-literal, non-constant text: ${offenders.join(", ")}`).toEqual([]);
  });

  it("[no-op control, proven on a synthetic fixture] a 5xx Response.json( call with only literal/safe-constant body values is never flagged", () => {
    const fixture = [
      'Response.json({ error: "Could not save this attempt." }, { status: 500 });',
      "Response.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });",
      "Response.json(DISABLED, { status: 503 });",
      'Response.json({ error: NO_KEY_REFUSAL, written: false }, { status: 503 });',
    ].join("\n");
    const offenders = findCallsByName(tokenizeSource(fixture).readable, "Response.json")
      .filter((call) => isFailureResponseCall(call.argsText))
      .flatMap((call) => offendingBodyEntries(call));
    expect(offenders).toEqual([]);
  });

  it("[proof the sweep bites] a SYNTHETIC reversion of one real site back to raw text is caught", () => {
    const reverted = readableRouteSource().replace(
      '{ error: "Could not load this application\'s prep pack." }, { status: 500 }',
      "{ error: base.error }, { status: 500 }",
    );
    expect(reverted, "the literal text this test reverts was not found -- the sweep's own fixture drifted from route.js").not.toEqual(readableRouteSource());
    const offenders = findCallsByName(reverted, "Response.json")
      .filter((call) => isFailureResponseCall(call.argsText))
      .flatMap((call) => offendingBodyEntries(call));
    expect(offenders.length).toBeGreaterThan(0);
  });
});

// F-R13-2 (fix round r13, MAJOR, verify.r13.md) -- the six evasions the
// checker built against the pre-fix predicates, re-run here as the SAME
// kind of synthetic-fixture proof the two describe blocks above already use
// (never a mutation of the real, working-tree route.js -- these fixtures
// stand in for what a mutated call site would read like). Four died only on
// a COUNT canary before this fix; this block asserts the CONTENT check
// itself -- offendingBodyEntries / offendingExtraEntries -- is what catches
// each one now.
describe("F-R13-2 -- all six evasions, re-run against the fixed predicates", () => {
  it("[EVADE-templateLiteral] a template-literal error value is flagged", () => {
    const fixture = "Response.json({ error: `Could not load: ${error}` }, { status: 500 })";
    const call = findCallsByName(tokenizeSource(fixture).readable, "Response.json")[0];
    expect(offendingBodyEntries(call).length).toBeGreaterThan(0);
  });

  it("[EVADE-helperInAnotherModule] a dbFailureResponse( call whose message argument is a computed expression, not a literal, is flagged", () => {
    const fixture = 'dbFailureResponse("where", { applicationId, error }, String(error))';
    const call = findCallsByName(tokenizeSource(fixture).readable, "dbFailureResponse")[0];
    const args = splitTopLevelArgs(call.argsText);
    expect(isStringLiteral(args[2])).toBe(false);
  });

  it("[EVADE-spreadErrorObject] a status:5xx body spreading an unknown object is flagged, never silently skipped", () => {
    const fixture = "Response.json({ ...{ error } }, { status: 500 })";
    const call = findCallsByName(tokenizeSource(fixture).readable, "Response.json")[0];
    expect(offendingBodyEntries(call).length).toBeGreaterThan(0);
  });

  it("[EVADE-differentKeyName] a status:5xx body carrying the raw error under a DIFFERENT key (`detail`, not `error`) is flagged", () => {
    const fixture = 'Response.json({ error: "Could not load this application\'s prep pack.", detail: error }, { status: 500 })';
    const call = findCallsByName(tokenizeSource(fixture).readable, "Response.json")[0];
    const offenders = offendingBodyEntries(call);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((o) => o.includes("detail"))).toBe(true);
  });

  it("[EVADE-status502] the same raw-error body moved to a non-500 5xx status is still reached and caught -- the broadened isFailureResponseCall is what makes this reachable at all", () => {
    const fixture = "Response.json({ error }, { status: 502 })";
    const call = findCallsByName(tokenizeSource(fixture).readable, "Response.json")[0];
    expect(isFailureResponseCall(call.argsText)).toBe(true);
    expect(offendingBodyEntries(call).length).toBeGreaterThan(0);
  });

  it("[EVADE-extraFourthArg] a dbFailureResponse( call smuggling the raw error through its fourth argument, under a different key, is flagged", () => {
    const fixture =
      'dbFailureResponse("GET pack read failed", { applicationId, error }, "Could not load this application\'s prep pack.", { detail: error })';
    const call = findCallsByName(tokenizeSource(fixture).readable, "dbFailureResponse")[0];
    expect(offendingExtraEntries(call).length).toBeGreaterThan(0);
  });
});

describe("F-R12-1 -- every dbFailureResponse( call in route.js passes a LITERAL candidate-facing message, never the raw error", () => {
  it("[RED before dbFailureResponse existed] every call's third argument (the message) is a string literal", () => {
    const offenders = findCallsByName(readableRouteSource(), "dbFailureResponse")
      .map((call) => ({ line: call.line, args: splitTopLevelArgs(call.argsText) }))
      .filter((entry) => !isStringLiteral(entry.args[2] || ""))
      .map((entry) => `route.js:${entry.line}`);

    expect(offenders, `these dbFailureResponse( calls do not pass a literal message: ${offenders.join(", ")}`).toEqual([]);
  });

  it("[no-op control, synthetic] a call whose third argument is the raw error variable instead of a literal IS flagged", () => {
    const fixture = 'dbFailureResponse("where", { error: e }, e.message)';
    const call = findCallsByName(tokenizeSource(fixture).readable, "dbFailureResponse")[0];
    const args = splitTopLevelArgs(call.argsText);
    expect(isStringLiteral(args[2])).toBe(false);
  });

  // F-R13-2 (fix round r13, MAJOR, verify.r13.md) -- the fourth argument
  // (`extra`) is now checked too, not just the message: PUT's own two real
  // callers are the only sites carrying one today, and both pass only the
  // literal-safe `{ written: false }`.
  it("every dbFailureResponse( call's fourth argument, when present, carries only literal/safe-constant values", () => {
    const offenders = findCallsByName(readableRouteSource(), "dbFailureResponse").flatMap((call) =>
      offendingExtraEntries(call),
    );
    expect(offenders, `these dbFailureResponse( calls carry a non-literal fourth-argument value: ${offenders.join(", ")}`).toEqual([]);
  });

  it("[no-op control, synthetic] a fourth argument carrying only the declared, literal-safe written: false is never flagged", () => {
    const fixture = 'dbFailureResponse("PUT candidate name save failed", { applicationId, error }, "Could not save your name.", { written: false })';
    const call = findCallsByName(tokenizeSource(fixture).readable, "dbFailureResponse")[0];
    expect(offendingExtraEntries(call)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-R14-1 (fix round r14, MINOR, verify.r14.md) -- every check above only
// ever counted CALLS BY NAME inside route.js's own text (Response.json(,
// dbFailureResponse(). A response built by a DIFFERENTLY NAMED helper,
// defined in a module route.js imports and called ahead of (or instead of)
// the real dbFailureResponse site, changes neither count:
// POWER-freshSiteForeignHelper-countsPreserved (verify.r14.md) added
// `packReadFailure`, a SECOND Response.json( construction site inside
// prepStore.js, called at route.js:800 before the existing dbFailureResponse
// call -- both canaries above stayed satisfied (route.js's own
// Response.json( and dbFailureResponse( counts were untouched) while a real
// GET, driven through the actual handler, returned a raw PostgREST message.
// 828/828 passed.
//
// The fix does not add another callee name to enumerate -- an eleventh
// helper would only repeat the gap. Instead it inverts the question: not
// "does route.js call a KNOWN leaky shape" but "how many places across the
// modules route.js imports construct a Response.json( body AT ALL". Today
// exactly one, dbFailureResponse itself (prepStore.js). A second site, under
// any name, in any of these files, changes that count regardless of what
// route.js's own text does or does not call -- so this check needs no
// predicate work of its own; it inherits offendingBodyEntries' reach the
// moment a second site exists, by construction (there would be two callers
// for route.js to route a failure through, and this repo's own convention --
// dbFailureResponse as the ONE choke point -- would already be violated).
// ---------------------------------------------------------------------------

/** Every non-test `.js` file directly under lib/interviewPrep/ -- the module
 *  boundary route.js's own imports actually reach (design-structure.r1.md
 *  §3): `__fixtures__/` and `data/` are directories, never matched by the
 *  `.js` filter, so this never needs to skip them explicitly. */
function nonTestLibInterviewPrepFiles() {
  return readdirSync(LIB_INTERVIEW_PREP_DIR)
    .filter((name) => name.endsWith(".js") && !name.includes(".test."))
    .sort();
}

/** Every `Response.json(` construction site across those files, as
 *  `"<file>:<line>"` -- the same `findCallsByName` extractor the checks
 *  above already trust, run once per file instead of once against
 *  route.js's own text. */
function responseJsonConstructionSites() {
  const sites = [];
  for (const name of nonTestLibInterviewPrepFiles()) {
    const filePath = path.join(LIB_INTERVIEW_PREP_DIR, name);
    const readable = tokenizeSource(readFileSync(filePath, "utf8"), { label: name }).readable;
    for (const call of findCallsByName(readable, "Response.json")) {
      sites.push(`${name}:${call.line}`);
    }
  }
  return sites;
}

describe("F-R14-1 -- the sweep's OWN blind spot: a response built by a callee this file does not name", () => {
  it("[canary] the scan is alive -- it lists at least one lib/interviewPrep/*.js file and finds at least one Response.json( site", () => {
    expect(nonTestLibInterviewPrepFiles().length).toBeGreaterThan(0);
    expect(responseJsonConstructionSites().length).toBeGreaterThan(0);
  });

  it("[RED before this fix round: POWER-freshSiteForeignHelper-countsPreserved survived 828/828 undetected, with a raw leak proven at runtime -- verify.r14.md] lib/interviewPrep/*.js constructs Response.json( from EXACTLY ONE site -- inside dbFailureResponse -- so a second, differently-named helper doing the same thing cannot hide from either count canary above, no matter which module it lives in or what it is called", () => {
    const sites = responseJsonConstructionSites();
    expect(sites, `lib/interviewPrep now constructs Response.json( from more than one site: ${sites.join(", ")}`).toHaveLength(1);
    expect(sites[0]).toMatch(/^prepStore\.js:\d+$/);
  });

  it("[proof the scan bites -- a synthetic fixture standing in for a mutated site, never a mutation of the real tree] a second, foreign-named helper's own Response.json( construction is counted right alongside dbFailureResponse's, so the real scan's count would rise the moment one existed", () => {
    // Stands in for POWER-freshSiteForeignHelper-countsPreserved's own
    // addition to prepStore.js, without ever writing it to the real file.
    const foreignHelper = [
      "export function packReadFailure(error) {",
      "  return Response.json({ error: errMessage(error) }, { status: 500 });",
      "}",
    ].join("\n");
    const readable = tokenizeSource(foreignHelper, { label: "synthetic" }).readable;
    const real = responseJsonConstructionSites();
    const withForeignHelper = real.length + findCallsByName(readable, "Response.json").length;
    expect(withForeignHelper, "the synthetic foreign helper's own Response.json( was not found -- this fixture drifted from the real leak shape").toBeGreaterThan(real.length);
    expect(withForeignHelper).toBe(2);
  });
});
