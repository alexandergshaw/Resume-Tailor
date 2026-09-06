// The falsifier for the digest's citation URL contract.
//
// WHAT THIS FILE DOES *NOT* DO, and why that is the point.
//
// It does not re-test the seven URL-safety rules. Those live in
// lib/url/safeExternalHref.js and are falsified — table, three separating
// shapes, two mutants — by lib/url/safeExternalHref.test.js. `citationHref`
// is a RE-EXPORT of that function, not a second implementation of it, and
// the first assertion below is what holds that true: it compares function
// identity, so an implementer who "helpfully" re-writes the seven rules here
// fails immediately even though every behavioural row would still pass.
// A second copy of a security control is exactly what promoting
// safeExternalHref out of lib/tracking/ was done to avoid.
//
// The three shapes that separate a correct URL control from the plausible
// broken one (`raw.startsWith("https://")`) are still asserted here, through
// `citationHref`'s own name, because this is the name the digest's render
// path will import and a future edit that re-pointed it at something weaker
// must go red at THIS file, not only at the other one:
//
//   https://acme.com@evil.example/x     correct: REFUSED   naive: PASSES
//   https://user:pw@evil.example/x      correct: REFUSED   naive: PASSES
//   https://          (empty hostname)  correct: REFUSED   naive: PASSES
//
// The genuinely new surface here is `citationHost` and `nonPublisherHosts`,
// and those carry full tables.

import { describe, it, expect } from "vitest";
import { safeExternalHref } from "../url/safeExternalHref.js";
import { citationHref, citationHost, nonPublisherHosts } from "./citationHref.js";

describe("citationHref", () => {
  // THE detector for "someone wrote the seven rules a second time". Every
  // behavioural assertion in this file passes against a faithful copy; only
  // this one fails.
  it("IS lib/url/safeExternalHref, not a second copy of its rules", () => {
    expect(citationHref).toBe(safeExternalHref);
  });

  it("refuses a host swapped behind userinfo that reads as the real host", () => {
    expect(citationHref("https://acme.com@evil.example/x")).toBeNull();
  });

  it("refuses a host swapped behind user:password", () => {
    expect(citationHref("https://user:pw@evil.example/x")).toBeNull();
  });

  it("refuses an https URL with no hostname", () => {
    expect(citationHref("https://")).toBeNull();
  });

  it("returns an admitted URL verbatim, never a normalised copy", () => {
    const raw = "https://acme.com/a//b/../c?x=%20";
    expect(citationHref(raw)).toBe(raw);
    expect(citationHref(raw)).not.toBe(new URL(raw).href);
  });

  it("refuses a stringified object, which is how a jsonb element reaches an href today", () => {
    expect(citationHref("[object Object]")).toBeNull();
    expect(citationHref({ url: "https://acme.com/x" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// citationHost — SEC-F2. The host is derived from the anchor's OWN href, in
// the same expression that produces the href. There is no host lookup, ever.
// ---------------------------------------------------------------------------

const HOST_TABLE = [
  // [raw, expected, label]
  ["https://acme.com/story", "acme.com", "a plain https URL"],
  ["http://acme.com/story", "acme.com", "a plain http URL"],
  ["https://www.reuters.com/business/x", "reuters.com", "a leading www. is stripped"],
  // The strip is ANCHORED. A `replace(/www\./, "")` without the ^ turns this
  // into "news.example.com" — a host the URL never had.
  ["https://news.www.example.com/x", "news.www.example.com", "a www. label that is not the prefix"],
  ["https://www.wwwtest.com/x", "wwwtest.com", "www. before a host that itself starts www"],
  ["https://acme.com:8443/x", "acme.com", "an explicit port is not part of the host"],
  ["HTTPS://ACME.com/story", "acme.com", "an upper-case authority"],
  [
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC",
    "vertexaisearch.cloud.google.com",
    "the vendor redirect host",
  ],

  // Everything citationHref refuses has NO host. This is the row that kills
  // the obvious mutant `new URL(raw).hostname` with no gate in front of it:
  // `data://acme.com/x` parses, and its hostname is "acme.com".
  ["data://acme.com/x", null, "a data: URL whose authority reads as a real host"],
  ["vbscript://acme.com/x", null, "a vbscript: URL with a real-looking host"],
  ["intent://acme.com/x#Intent;scheme=http;end", null, "an intent: URL with a real-looking host"],
  ["https://acme.com@evil.example/x", null, "userinfo that reads as the real host"],
  ["https://user:pw@evil.example/x", null, "user:password before the real host"],
  ["https://", null, "https with an empty hostname"],
  ["//evil.example/x", null, "protocol-relative"],
  ["  https://acme.com/story  ", null, "space-padded https"],
  ["javascript:alert(1)", null, "javascript:"],
  ["not a url at all", null, "free text"],
  ["", null, "the empty string"],
  [null, null, "null"],
  [undefined, null, "undefined"],
  [{ url: "https://acme.com/x" }, null, "an object"],
];

describe("citationHost", () => {
  for (const [raw, expected, label] of HOST_TABLE) {
    it(`${expected === null ? "has no host for" : `reads ${expected} from`} ${label}`, () => {
      expect(citationHost(raw)).toBe(expected);
    });
  }

  it("never throws, whatever it is handed", () => {
    for (const v of [Object.create(null), () => "x", new Date(), NaN, "https://[", "%%%"]) {
      expect(() => citationHost(v)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// nonPublisherHosts — 1c NP-1.
//
// (a) the vendor redirect host, and
// (b) a host byte-identical across EVERY entry, when there is more than one
//     entry, AND absent from every entry's own title.
//
// Both clauses exist because either alone misfires: (a) alone misses a
// RENAMED redirector, (b) alone misfires on a genuine single-publisher
// digest — which is what (b)'s title guard and its `> 1` guard are for.
// Every one of those four guards has its own negative control below.
// ---------------------------------------------------------------------------

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC";

describe("nonPublisherHosts", () => {
  it("names the vendor redirect host, whatever the path", () => {
    const out = nonPublisherHosts([
      { href: REDIRECT, title: "Nimbus raises $80M" },
      { href: "https://vertexaisearch.cloud.google.com/anything/else", title: "Nimbus hires" },
    ]);
    expect(out.has("vertexaisearch.cloud.google.com")).toBe(true);
  });

  it("names any cloud.google.com subdomain SERVING a grounding redirect", () => {
    const out = nonPublisherHosts([
      { href: "https://groundingsearch.cloud.google.com/grounding-api-redirect/Z", title: "Nimbus raises $80M" },
    ]);
    expect(out.has("groundingsearch.cloud.google.com")).toBe(true);
  });

  // Negative control for clause (a): the mutant that suppresses the whole of
  // cloud.google.com. A real Google Cloud blog post is a legitimate publisher
  // page and its host must still be shown.
  it("does NOT name a cloud.google.com page that is not a grounding redirect", () => {
    const out = nonPublisherHosts([
      { href: "https://cloud.google.com/blog/nimbus-partnership", title: "Nimbus and Google Cloud" },
      { href: "https://www.reuters.com/business/nimbus", title: "Nimbus raises $80M" },
    ]);
    expect(out.size).toBe(0);
  });

  it("names a host identical across every entry of a multi-entry digest", () => {
    const out = nonPublisherHosts([
      { href: "https://r.example/a", title: "Nimbus raises $80M" },
      { href: "https://r.example/b", title: "Nimbus opens a depot" },
      { href: "https://r.example/c", title: "Nimbus hires a CFO" },
    ]);
    expect([...out]).toEqual(["r.example"]);
  });

  // Negative control for clause (b)'s TITLE guard: three articles from one
  // real publisher, whose own titles name it. Dropping the guard turns a
  // single-publisher digest into a suppressed host.
  it("does NOT name a shared host that an entry's own title names", () => {
    const out = nonPublisherHosts([
      { href: "https://reuters.com/a", title: "Nimbus raises $80M | reuters.com" },
      { href: "https://reuters.com/b", title: "Nimbus opens a depot" },
    ]);
    expect(out.size).toBe(0);
  });

  it("matches the title guard case-insensitively", () => {
    const out = nonPublisherHosts([
      { href: "https://reuters.com/a", title: "Nimbus raises $80M | REUTERS.COM" },
      { href: "https://reuters.com/b", title: "Nimbus opens a depot" },
    ]);
    expect(out.size).toBe(0);
  });

  // Negative control for clause (b)'s `> 1` guard: a genuine single-source
  // digest. Its one host is trivially "identical across every entry".
  it("does NOT name the host of a single-entry digest", () => {
    const out = nonPublisherHosts([{ href: "https://r.example/a", title: "Nimbus raises $80M" }]);
    expect(out.size).toBe(0);
  });

  it("names nothing when the entries come from different hosts", () => {
    const out = nonPublisherHosts([
      { href: "https://reuters.com/a", title: "Nimbus raises $80M" },
      { href: "https://techcrunch.com/b", title: "Nimbus opens a depot" },
    ]);
    expect(out.size).toBe(0);
  });

  it("compares hosts after www-stripping, so www and bare are one host", () => {
    const out = nonPublisherHosts([
      { href: "https://www.r.example/a", title: "Nimbus raises $80M" },
      { href: "https://r.example/b", title: "Nimbus opens a depot" },
    ]);
    expect([...out]).toEqual(["r.example"]);
  });

  // An entry whose href is refused renders NO anchor and therefore no host,
  // so it cannot contradict "identical across every entry". Counting it as a
  // second, different host would silently disable clause (b) on any digest
  // carrying one unusable citation.
  it("skips entries whose href citationHref refuses rather than letting them break clause (b)", () => {
    const out = nonPublisherHosts([
      { href: "data://evil.example/a", title: "Nimbus raises $80M" },
      { href: "https://r.example/b", title: "Nimbus opens a depot" },
      { href: "https://r.example/c", title: "Nimbus hires a CFO" },
    ]);
    expect([...out]).toEqual(["r.example"]);
  });

  it("returns an empty Set for a non-array, an empty array, and junk elements", () => {
    for (const input of [undefined, null, "entries", 7, [], [null, undefined, 3, "x"]]) {
      const out = nonPublisherHosts(input);
      expect(out).toBeInstanceOf(Set);
      expect(out.size).toBe(0);
    }
  });

  it("tolerates a missing or non-string title without treating it as naming the host", () => {
    const out = nonPublisherHosts([
      { href: "https://r.example/a" },
      { href: "https://r.example/b", title: 42 },
    ]);
    expect([...out]).toEqual(["r.example"]);
  });
});
