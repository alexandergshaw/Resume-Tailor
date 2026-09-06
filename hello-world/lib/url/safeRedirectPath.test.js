// The falsifier for safeRedirectPath: the ONE function that decides whether a
// `?redirect=` (or similar) query value may be handed to a same-origin
// navigation after sign-in.
//
// WHY THIS TABLE HAS THE SHAPES IT HAS.
//
// The existing precedent this app already shipped, app/auth/callback/route.js:
//
//   const next = requested.startsWith("/") ? requested : "/";
//
// is ITSELF insufficient, verified by probing `new URL(candidate, base)`
// (base = "https://app.example") in Node 22 before any of this was written:
//
//   "//evil.example"     -> new URL admits (startsWith("/") === true),
//                           resolves to origin "https://evil.example"
//   "/\\evil.example"     -> new URL admits (startsWith("/") === true),
//                           resolves to origin "https://evil.example"
//                           (a backslash is a path/host separator for a
//                           special-scheme URL, same as "/")
//
// So a pattern that only checks the FIRST character is not enough: it must
// also rule out a second "/" or "\" right after it. But checking the first
// TWO characters is not enough either -- the browser's URL parser strips
// TAB/CR/LF from anywhere in the string before parsing it, not just the
// ends, so a tab can manufacture the dangerous "//" AFTER the check has
// already looked past it:
//
//   "/\t/evil.example"   -> first two chars are "/" + TAB, so a check of
//                           "does the 2nd char start a host swap" sees
//                           nothing wrong -- but the URL parser strips the
//                           tab, the string becomes "//evil.example", and
//                           it resolves to origin "https://evil.example".
//
// This is the row that separates "resolve with new URL and compare origins"
// from "pattern-match the first two characters," and it is why this file's
// mutant section below targets exactly that gap (see
// mutantSecondCharCheck).
//
// Everything else in this table is corroboration, not a novel claim: run the
// same probe used to write these comments again if any of it is doubted.

import { describe, it, expect } from "vitest";
import { safeRedirectPath } from "./safeRedirectPath.js";

const REFUSED = "/"; // the fallback every call site in this app wants

const TABLE = [
  // --- not a string / empty -------------------------------------------------
  [null, REFUSED, "null"],
  [undefined, REFUSED, "undefined"],
  [123, REFUSED, "a number"],
  [{}, REFUSED, "an object"],
  ["", REFUSED, "the empty string"],

  // --- absolute URLs of any scheme -------------------------------------------
  ["https://evil.example", REFUSED, "absolute https URL"],
  ["http://evil.example", REFUSED, "absolute http URL"],
  ["javascript:alert(1)", REFUSED, "javascript: URL"],
  ["mailto:someone@evil.example", REFUSED, "mailto: URL"],
  ["ftp://evil.example/x", REFUSED, "ftp: URL"],

  // --- protocol-relative ------------------------------------------------------
  ["//evil.example", REFUSED, "protocol-relative //host"],
  ["///evil.example", REFUSED, "triple-slash //host variant"],

  // --- backslash variants (browsers treat \ as / for special schemes) --------
  ["/\\evil.example", REFUSED, "single leading slash then backslash (/\\host)"],
  ["\\\\evil.example", REFUSED, "double backslash, no leading slash (\\\\host)"],
  ["\\/evil.example", REFUSED, "backslash then slash, no leading slash"],

  // --- whitespace/control characters the URL parser strips -------------------
  // These are the TRUE detectors: the raw string's first two characters look
  // harmless ("/" + a control char), so anything that inspects only those two
  // characters is fooled. Only resolving through new URL() and comparing the
  // resulting origin catches these.
  ["/\t/evil.example", REFUSED, "tab between two slashes manufactures // once stripped"],
  ["/\n/evil.example", REFUSED, "newline between two slashes manufactures // once stripped"],
  ["/\r/evil.example", REFUSED, "carriage return between two slashes manufactures // once stripped"],
  // Leading whitespace before the slash: a weaker guard (rejected already by
  // "must begin with a single /", before any URL resolution is needed).
  [" /evil.example", REFUSED, "leading space before the slash"],
  ["\t/evil.example", REFUSED, "leading tab before the slash"],
  ["\n/evil.example", REFUSED, "leading newline before the slash"],

  // --- must begin with a single "/" -------------------------------------------
  ["evil.example", REFUSED, "no leading slash at all"],
  ["tracking", REFUSED, "bare relative path segment, no leading slash"],

  // --- legitimate same-origin paths, must pass through unharmed ---------------
  ["/", "/", "root"],
  ["/tracking", "/tracking", "a plain app path"],
  ["/tracking?tab=x#y", "/tracking?tab=x#y", "a path with query and hash"],
  ["/tracking/sub/path", "/tracking/sub/path", "a nested path"],
];

describe("safeRedirectPath", () => {
  for (const [raw, expected, label] of TABLE) {
    it(`${expected === REFUSED ? "refuses and falls back for" : "admits"} ${label}`, () => {
      expect(safeRedirectPath(raw)).toBe(expected);
    });
  }

  // The single most important row, called out individually so it cannot be
  // quietly dropped from the table later.
  it("refuses the tab-manufactures-// shape even though its first two raw characters are '/' and a control char", () => {
    expect(safeRedirectPath("/\t/evil.example")).toBe("/");
  });

  it("refuses both backslash shapes named in the brief", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("\\\\evil.example")).toBe("/");
  });

  it("honors a custom fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/home")).toBe("/home");
    expect(safeRedirectPath(null, "/home")).toBe("/home");
  });

  it("never throws, whatever it is handed", () => {
    const hostile = [Object.create(null), () => "/x", new Date(), NaN, "%%%", "/%", "/["];
    for (const v of hostile) {
      expect(() => safeRedirectPath(v)).not.toThrow();
    }
  });
});

// --------------------------------------------------------------------------
// The mutation proof: two plausible-but-wrong implementations, run against
// the SAME table, to prove the table actually separates correct from broken
// rather than merely restating the trivial cases every implementation gets
// right.
// --------------------------------------------------------------------------

/**
 * Mutant 1: the ACTUAL precedent already shipped in
 * app/auth/callback/route.js. Known-insufficient per the probe in this
 * file's header.
 */
function mutantExistingPrecedent(raw) {
  if (typeof raw !== "string") return "/";
  return raw.startsWith("/") ? raw : "/";
}

/**
 * Mutant 2: a "smarter" fix that inspects the first TWO characters to rule
 * out "//" and "/\" -- catches everything mutant 1 misses EXCEPT the
 * control-character rows, because those rows only become dangerous AFTER
 * the URL parser strips the tab/newline/CR, which a two-character
 * pattern-match never sees. This is the mutant the "resolve, don't
 * pattern-match" design rule exists to kill.
 */
function mutantSecondCharCheck(raw) {
  if (typeof raw !== "string" || raw === "") return "/";
  if (raw[0] !== "/") return "/";
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

function divergences(mutant) {
  return TABLE.filter(([raw, expected]) => mutant(raw) !== expected).map(([, , label]) => label);
}

describe("the table kills the implementations that are actually plausible", () => {
  it("kills the existing (insufficient) precedent, on the protocol-relative and backslash rows specifically", () => {
    const dead = divergences(mutantExistingPrecedent);
    expect(dead).toContain("protocol-relative //host");
    expect(dead).toContain("single leading slash then backslash (/\\host)");
    expect(dead.length).toBeGreaterThanOrEqual(2);
  });

  it("kills the smarter second-character check, and ONLY on the control-character rows", () => {
    const dead = divergences(mutantSecondCharCheck);
    // This is the whole point of resolving instead of pattern-matching: it
    // is the ONE class of row a two-character inspection cannot see coming.
    expect(dead).toContain("tab between two slashes manufactures // once stripped");
    expect(dead).toContain("newline between two slashes manufactures // once stripped");
    expect(dead).toContain("carriage return between two slashes manufactures // once stripped");
    // And it correctly handles the rows mutant 1 got wrong, which is why a
    // SECOND mutant is needed to isolate what resolving actually buys.
    expect(dead).not.toContain("protocol-relative //host");
    expect(dead).not.toContain("single leading slash then backslash (/\\host)");
  });

  it("passes the real implementation, so the mutant check is not vacuous", () => {
    expect(divergences(safeRedirectPath)).toEqual([]);
  });
});
