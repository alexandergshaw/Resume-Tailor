// The falsifier for the ONE function that decides whether a string may become
// an href anywhere in this app.
//
// Why this table has the shapes it has. Measured against the INSTALLED React
// (19.2.4 / react-dom 19.2.4, jsdom 29.1.1) by rendering a real
// `<a href={raw}>` and reading the attribute back:
//
//   BLOCKED by React:  javascript: in 5 of 6 obfuscations (plain, mixed case,
//                      leading spaces, embedded tab, embedded newline).
//   NOT blocked:       javascript: with an embedded NUL, and EVERY one of
//                      data:, data:;base64, vbscript:, intent:, blob:, file:,
//                      //protocol-relative, https://user@other-host/,
//                      https://user:pw@other-host/, and "https://".
//
// So React closes exactly one scheme and nothing else. A test built only from
// the `javascript:` example therefore proves nothing: it asserts the thing the
// framework already does.
//
// The three shapes that actually separate a correct implementation from the
// plausible broken one (`raw.startsWith("https://")`) are
//
//   https://acme.com@evil.example/x     correct: REFUSED   naive: PASSES
//   https://user:pw@evil.example/x      correct: REFUSED   naive: PASSES
//   https://          (empty hostname)  correct: REFUSED   naive: PASSES
//
// and they are asserted individually below as well as in the table, because
// they are the only rows whose loss would silently gut this file. The two
// mutants at the bottom of this file prove that claim rather than asserting it.

import { describe, it, expect } from "vitest";
import { safeExternalHref } from "./safeExternalHref.js";

// [shape, expected] where expected === null means REFUSED and a string means
// "admitted, and it must come back byte-identical".
const REFUSED = null;

const TABLE = [
  // --- rule 1: not a string -------------------------------------------------
  [null, REFUSED, "null"],
  [undefined, REFUSED, "undefined"],
  [123, REFUSED, "a number"],
  [{ url: "https://acme.com/x" }, REFUSED, "an object"],
  [["https://acme.com/x"], REFUSED, "an array"],
  // `sources` is jsonb with no element-level type guarantee; String({url})
  // is what an object reaches an href as today.
  ["[object Object]", REFUSED, "a stringified object"],

  // --- rule 2: the exact string rendered must be the string validated -------
  ["  https://acme.com/story  ", REFUSED, "space-padded https"],
  ["\thttps://acme.com/story", REFUSED, "tab-prefixed https"],
  ["https://acme.com/story\n", REFUSED, "newline-suffixed https"],

  // --- rule 3: must parse as an absolute URL --------------------------------
  ["//evil.example/x", REFUSED, "protocol-relative"],
  ["/library", REFUSED, "a root-relative path"],
  ["", REFUSED, "the empty string"],
  ["not a url at all", REFUSED, "free text"],
  // `https://` has no host, so the WHATWG parser rejects it outright: this
  // row is refused at rule 3, not rule 6. Rule 6 stays as defence in depth
  // for any scheme whose parser tolerates an empty host.
  ["https://", REFUSED, "https with an empty hostname"],
  ["http://", REFUSED, "http with an empty hostname"],

  // --- rule 4: allow-list, never a deny-list --------------------------------
  ["javascript:alert(1)", REFUSED, "javascript:"],
  ["JaVaScRiPt:alert(1)", REFUSED, "javascript: mixed case"],
  ["java\u0000script:alert(1)", REFUSED, "javascript: with an embedded NUL"],
  ["data:text/html,<script>alert(1)</script>", REFUSED, "data: html"],
  ["data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", REFUSED, "data: base64"],
  ["vbscript:msgbox(1)", REFUSED, "vbscript:"],
  ["intent://acme.com/x#Intent;scheme=http;end", REFUSED, "intent:"],
  ["blob:https://evil.example/abc", REFUSED, "blob:"],
  ["file:///C:/Windows/System32/calc.exe", REFUSED, "file:"],
  ["mailto:someone@evil.example", REFUSED, "mailto:"],
  ["ftp://evil.example/x", REFUSED, "ftp:"],
  // A deny-list of "the bad schemes" is what this row exists to kill: nobody
  // writes `chrome-extension:` into a deny-list, and an allow-list needs no
  // one to have thought of it.
  ["chrome-extension://abcdefg/page.html", REFUSED, "an unforeseen scheme"],

  // --- rule 5: the userinfo host swap ---------------------------------------
  ["https://acme.com@evil.example/x", REFUSED, "userinfo that reads as the real host"],
  ["https://user:pw@evil.example/x", REFUSED, "user:password before the real host"],
  ["http://boards.greenhouse.io@evil.example/jobs/1", REFUSED, "userinfo on http"],
  ["https://acme.com:@evil.example/x", REFUSED, "empty password, host still swapped"],

  // --- admitted, and returned VERBATIM --------------------------------------
  ["https://acme.com/story", "https://acme.com/story", "plain https"],
  ["http://acme.com/story", "http://acme.com/story", "plain http"],
  [
    "https://boards.greenhouse.io/acme/jobs/1?src=feed#top",
    "https://boards.greenhouse.io/acme/jobs/1?src=feed#top",
    "https with query and fragment",
  ],
  // Uppercase scheme parses to `https:` but must come back UNCHANGED: the
  // function never normalises, so the string checked is the string rendered.
  ["HTTPS://acme.com/story", "HTTPS://acme.com/story", "uppercase scheme"],
  [
    "https://en.wikipedia.org/wiki/Nimbus_(company)",
    "https://en.wikipedia.org/wiki/Nimbus_(company)",
    "a path containing parentheses",
  ],
  ["https://acme.com", "https://acme.com", "bare origin, no path"],
  ["https://acme.com:8443/x", "https://acme.com:8443/x", "an explicit port"],
];

describe("safeExternalHref", () => {
  for (const [raw, expected, label] of TABLE) {
    it(`${expected === REFUSED ? "refuses" : "admits"} ${label}`, () => {
      expect(safeExternalHref(raw)).toBe(expected);
    });
  }

  // The three separating shapes, called out individually. If a future edit
  // trims the table, these must be the last things to go.
  it("refuses a host swapped behind userinfo that reads as the real host", () => {
    expect(safeExternalHref("https://acme.com@evil.example/x")).toBeNull();
  });

  it("refuses a host swapped behind user:password", () => {
    expect(safeExternalHref("https://user:pw@evil.example/x")).toBeNull();
  });

  it("refuses an https URL with no hostname", () => {
    expect(safeExternalHref("https://")).toBeNull();
  });

  it("returns the SAME string object identity-wise, never a normalised copy", () => {
    const raw = "https://acme.com/a//b/../c?x=%20";
    // new URL(raw).href would be "https://acme.com/a/c?x=%20" - a different
    // string. Rendering a string other than the one validated is the whole
    // hazard rule 2 exists to prevent, so assert pass-through explicitly.
    expect(safeExternalHref(raw)).toBe(raw);
    expect(safeExternalHref(raw)).not.toBe(new URL(raw).href);
  });

  it("never throws, whatever it is handed", () => {
    const hostile = [
      Object.create(null),
      () => "https://acme.com/x",
      new Date(),
      NaN,
      Number.POSITIVE_INFINITY,
      "%%%",
      "https://%",
      "https://[",
    ];
    for (const v of hostile) {
      expect(() => safeExternalHref(v)).not.toThrow();
    }
  });
});

// --------------------------------------------------------------------------
// The mutation proof.
//
// A falsifier is only worth what it kills. These are the two implementations
// an engineer actually writes instead of the real one; each is run against
// the SAME table above, and the test asserts the table catches it. If a
// future edit weakens the table, these stop finding a divergence and go red -
// which is the point.
// --------------------------------------------------------------------------

/** Mutant 1: the prefix test. This is the mistake, verbatim. */
function mutantPrefix(raw) {
  if (typeof raw !== "string") return null;
  return raw.startsWith("https://") || raw.startsWith("http://") ? raw : null;
}

/**
 * Mutant 2: rule 2 removed. Trims first, prefix-tests the trimmed string,
 * then renders the UNTRIMMED original - so what was checked and what is
 * rendered are two different strings.
 */
function mutantTrimThenPrefix(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.startsWith("https://") || t.startsWith("http://") ? raw : null;
}

function divergences(mutant) {
  return TABLE.filter(([raw, expected]) => mutant(raw) !== expected).map(([, , label]) => label);
}

describe("the table kills the implementations that are actually written instead", () => {
  it("kills the naive prefix test, and on the three separating shapes specifically", () => {
    const dead = divergences(mutantPrefix);
    expect(dead).toContain("userinfo that reads as the real host");
    expect(dead).toContain("user:password before the real host");
    expect(dead).toContain("https with an empty hostname");
    expect(dead.length).toBeGreaterThanOrEqual(3);
  });

  it("kills the trim-then-prefix mutant on rule 2, which the naive one survives", () => {
    const dead = divergences(mutantTrimThenPrefix);
    // This is the ONLY thing rule 2 buys, so it must be exactly what fails.
    expect(dead).toContain("space-padded https");
    expect(dead).toContain("tab-prefixed https");
    expect(dead).toContain("newline-suffixed https");
    // And the padded rows are precisely what mutant 1 gets right by accident,
    // which is why one mutant is not enough.
    expect(divergences(mutantPrefix)).not.toContain("space-padded https");
  });

  it("passes the real implementation, so the mutant check is not vacuous", () => {
    expect(divergences(safeExternalHref)).toEqual([]);
  });
});
