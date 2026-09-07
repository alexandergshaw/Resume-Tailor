// The ONE rule that decides what a citation may be CALLED.
//
// TWO PATHS ANSWERED THIS QUESTION DIFFERENTLY, so the same stored record
// rendered differently depending on which one produced it:
//
//   * lib/tracking/applicationDigest.js's groundedTitleForHost -- HOST-ONLY. It
//     looked a URL's host up in the grounded array and welded THAT entry's
//     headline onto this link, then fell back to the model's own link text and
//     finally to the RAW URL as the source's name.
//   * app/components/tracking/DigestPanel.js's entryLabel -- TITLE-FIRST. The
//     entry's own title, else its own host, else "Source (unnamed)", truncated
//     at a word boundary. It never printed a URL and never consulted a foreign
//     array.
//
// THE HARM THE RULE EXISTS TO STOP is narrower and worse than the
// disagreement. Gemini's legacy grounding metadata returns `web.uri` as a
// `vertexaisearch.cloud.google.com` REDIRECT proxy and `web.title` as the
// PUBLISHER'S BARE DOMAIN. Every write path paired the two verbatim, so a
// citation DISPLAYED as "reuters.com" while its href went to a Google API
// redirect. The label asserted a publisher the URL does not go to, the mismatch
// was stored permanently, and the only way for a reader to catch it was to
// hover the link.
//
// THE RULE, and why it is a rule rather than a comparison:
//
//     A TITLE THAT NAMES A HOST IS NOT A NAME. The only domain that may ever
//     appear as a citation's label is the one `citationHost` derives from that
//     citation's OWN href, in the same expression that produces the href.
//
// The obvious alternative is to compare the domain the title names against the
// host of the citation's own URL and drop it when they differ. That comparison
// is what this repo has already been bitten by twice -- a host-only match that
// welded one page's headline onto another, and a link scanner that disagreed
// with the renderer on 6 of 9 inputs -- and it is a comparison a future edit
// can get wrong four separate ways (`includes` instead of `===`, comparing
// before trimming, folding `www.` on one side, IDNA-folding neither). It also
// buys nothing: a title that names the citation's own host is redundant with
// the host line the panel already prints from that href, so a MATCH and a
// MISMATCH have the same correct outcome -- the title is not the label. So the
// rule removes the comparison instead of trying to get it right. A label can
// then only assert a publisher the URL does reach, structurally, because no
// foreign string can supply a domain at all.
//
// WHAT IS DELIBERATELY NOT A PUBLISHER ASSERTION: a headline. "Nimbus raises
// Series C" claims nothing about who published it, so it survives on any URL,
// including a redirect. Only the domain shape is a claim about identity.

import { describe, it, expect } from "vitest";
import { citationLabel, citationTitle, CITATION_LABEL_MAX } from "./citationLabel.js";

// ---------------------------------------------------------------- fixtures
//
// THE MISMATCH FIXTURE. Its host is NOT its label's domain, which is the whole
// point: a fixture whose URL host already equals its title exhibits no mismatch
// and proves nothing about one. Both halves are shapes the vendor really emits
// -- the redirect is the documented `models.generateContent` grounding URI, and
// the bare domain is the documented `web.title`.
const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123";
const PUBLISHER_DOMAIN = "reuters.com";

const REUTERS = "https://www.reuters.com/business/nimbus-series-c";
const HEADLINE = "Nimbus raises Series C";

const hidden = (...hosts) => new Set(hosts);
const NONE = new Set();

// ===========================================================================
describe("a title may not assert a publisher its own URL does not reach", () => {
  it("drops the publisher domain welded to a vendor redirect", () => {
    // THE assertion this whole change exists for.
    expect(citationTitle(PUBLISHER_DOMAIN)).toBe("");
  });

  it("labels that citation by what it actually is, never by the claimed publisher", () => {
    const label = citationLabel(
      { url: REDIRECT, title: PUBLISHER_DOMAIN },
      hidden("vertexaisearch.cloud.google.com")
    );
    expect(label.text).not.toContain("reuters");
    expect(label.kind).toBe("unnamed");
  });

  it("keeps the link -- the rule changes what is SAID, never where it goes", () => {
    // Refusing the citation outright would discard a real source the model
    // cited, and the redirect does reach the publisher.
    expect(citationLabel({ url: REDIRECT, title: PUBLISHER_DOMAIN }, NONE).kind).not.toBe("title");
  });

  it("NEGATIVE CONTROL: a headline on the same redirect survives untouched", () => {
    // Without this, "drop every title on a redirect" passes everything above.
    expect(citationTitle(HEADLINE)).toBe(HEADLINE);
    expect(citationLabel({ url: REDIRECT, title: HEADLINE }, NONE)).toEqual({
      text: HEADLINE,
      kind: "title",
    });
  });

  it("NEGATIVE CONTROL: a headline on an ordinary publisher URL survives", () => {
    expect(citationLabel({ url: REUTERS, title: HEADLINE }, NONE)).toEqual({
      text: HEADLINE,
      kind: "title",
    });
  });

  it("drops a publisher domain even when the citation's URL is refused outright", () => {
    // https://acme.com@evil.example/x renders as acme.com and navigates to
    // evil.example. There is no href-derived host to name it with, so the
    // claim must not stand on its own.
    expect(citationTitle("acme.com")).toBe("");
    expect(citationLabel({ url: "https://acme.com@evil.example/x", title: "acme.com" }, NONE)).toEqual(
      { text: "", kind: "unnamed" }
    );
  });

  it("drops a publisher domain on a javascript: URL while keeping a headline on one", () => {
    expect(citationLabel({ url: "javascript:alert(1)", title: "reuters.com" }, NONE)).toEqual({
      text: "",
      kind: "unnamed",
    });
    expect(citationLabel({ url: "javascript:alert(1)", title: "Nimbus latest" }, NONE)).toEqual({
      text: "Nimbus latest",
      kind: "title",
    });
  });
});

// ===========================================================================
// The label's domain comes from the HREF, so a lookalike host names itself.
//
// This is the case a comparison-based rule gets wrong: `reuters.com.evil.test`
// CONTAINS `reuters.com`, so an implementation matching by containment lets the
// real publisher's name stand on a lookalike domain.
describe("a lookalike host names itself, because the name comes from the href", () => {
  it("names a link to reuters.com.evil.test after reuters.com.evil.test", () => {
    const url = "https://reuters.com.evil.test/story";
    expect(citationLabel({ url, title: "reuters.com" }, NONE)).toEqual({
      text: "reuters.com.evil.test",
      kind: "host",
    });
  });

  it("refuses reuters.com.evil.test as the name of a link to reuters.com", () => {
    // The other containment direction.
    expect(citationLabel({ url: REUTERS, title: "reuters.com.evil.test" }, NONE)).toEqual({
      text: "reuters.com",
      kind: "host",
    });
  });

  it("refuses a bare domain as the name of a link to one of its subdomains", () => {
    expect(citationLabel({ url: "https://news.reuters.com/x", title: "reuters.com" }, NONE)).toEqual({
      text: "news.reuters.com",
      kind: "host",
    });
  });

  it("refuses a subdomain as the name of a link to its parent", () => {
    expect(citationLabel({ url: REUTERS, title: "news.reuters.com" }, NONE)).toEqual({
      text: "reuters.com",
      kind: "host",
    });
  });

  it("names a subdomain link after the subdomain, from its own href", () => {
    expect(citationLabel({ url: "https://news.bbc.co.uk/story", title: "news.bbc.co.uk" }, NONE)).toEqual(
      { text: "news.bbc.co.uk", kind: "host" }
    );
  });
});

// ===========================================================================
// Every spelling of a host is recognised AS a host, or the rule leaks: a
// spelling it fails to recognise passes straight through as an ordinary title.
describe("host spellings the rule must recognise", () => {
  it("recognises an IP literal", () => {
    expect(citationTitle("192.0.2.5")).toBe("");
    expect(citationLabel({ url: "https://192.0.2.5/a", title: "192.0.2.5" }, NONE)).toEqual({
      text: "192.0.2.5",
      kind: "host",
    });
  });

  it("recognises a bracketed IPv6 literal, which carries no dot at all", () => {
    expect(citationTitle("[2001:db8::1]")).toBe("");
    expect(citationLabel({ url: "https://[2001:db8::1]/a", title: "[2001:db8::1]" }, NONE)).toEqual({
      text: "[2001:db8::1]",
      kind: "host",
    });
  });

  it("recognises a unicode domain, which is a publisher's name spelled its own way", () => {
    // MEASURED, not assumed: new URL("https://реклама.com").hostname is
    // "xn--80aanufhx.com". A rule that only recognised ASCII domains would let
    // a Cyrillic-spelled publisher domain through as an ordinary headline --
    // and the panel prints it in the SAME place it would print a real one.
    expect(citationTitle("реклама.com")).toBe("");
    expect(citationLabel({ url: "https://xn--80aanufhx.com/a", title: "реклама.com" }, NONE)).toEqual({
      text: "xn--80aanufhx.com",
      kind: "host",
    });
  });

  it("recognises punycode written out literally", () => {
    expect(citationTitle("xn--80aanufhx.com")).toBe("");
  });

  it("recognises a www. and a mixed-case spelling", () => {
    expect(citationTitle("www.reuters.com")).toBe("");
    expect(citationTitle("REUTERS.COM")).toBe("");
    expect(citationTitle("Www.Reuters.Com")).toBe("");
  });

  it("recognises a host that arrived with whitespace around it", () => {
    // MUTANT KILLER, and measured: new URL("https://  reuters.com  ") THROWS,
    // so an implementation that tests the UNTRIMMED title sees no host at all,
    // calls it an ordinary headline, and prints it as the source's name.
    expect(citationTitle("  reuters.com  ")).toBe("");
    expect(citationTitle("\n reuters.com\t")).toBe("");
    expect(citationLabel({ url: REUTERS, title: "  reuters.com  " }, NONE)).toEqual({
      text: "reuters.com",
      kind: "host",
    });
  });

  it("recognises a whole URL written into the title field", () => {
    expect(citationTitle("https://reuters.com/world/x")).toBe("");
    expect(citationTitle("http://reuters.com")).toBe("");
  });

  it("recognises a domain carrying a path", () => {
    expect(citationTitle("reuters.com/world/article")).toBe("");
  });

  it("recognises a host spelled behind a scheme the link control would refuse", () => {
    // new URL("data://reuters.com/x").hostname is "reuters.com". The gate
    // belongs on the HREF side (citationHost), never here: this side only ever
    // REFUSES, so parsing more strings can catch more claims, never admit one.
    expect(citationTitle("data://reuters.com/x")).toBe("");
  });
});

// ===========================================================================
describe("a name that is not a domain is not a publisher assertion", () => {
  it("keeps a brand name carrying no TLD -- the documented residual", () => {
    // "Reuters" parses as the host "reuters", which is not a registrable name.
    // Refusing every capitalised word that COULD be a publisher would discard
    // most real headlines, so the rule is the literal domain shape and this
    // over-permission is stated rather than hidden.
    expect(citationTitle("Reuters")).toBe("Reuters");
  });

  it("keeps a headline that merely CONTAINS a domain", () => {
    // Whole-string, never containment: the prose around the domain is visible
    // to the reader, and discarding real headlines is the larger harm.
    expect(citationTitle("Reuters.com relaunches its business desk")).toBe(
      "Reuters.com relaunches its business desk"
    );
  });

  it("keeps a title made only of punctuation rather than reading it as a host", () => {
    // new URL("https://...").hostname is "..." -- dotted, but no label at all.
    expect(citationTitle("...")).toBe("...");
    expect(citationTitle(".")).toBe(".");
  });

  it("keeps a version-shaped title", () => {
    expect(citationTitle("v1.2.3")).toBe("v1.2.3");
  });
});

// ===========================================================================
describe("absent, empty and absurdly long titles", () => {
  it("falls back to the host when there is no title field at all", () => {
    // MUTANT KILLER: an implementation that treats an absent title as an empty
    // LABEL rather than falling through names every untitled source nothing.
    expect(citationLabel({ url: REUTERS }, NONE)).toEqual({ text: "reuters.com", kind: "host" });
  });

  it("falls back to the host for an empty and a whitespace-only title", () => {
    for (const title of ["", "   ", "\n\t "]) {
      expect(citationTitle(title)).toBe("");
      expect(citationLabel({ url: REUTERS, title }, NONE)).toEqual({
        text: "reuters.com",
        kind: "host",
      });
    }
  });

  it("falls back to the host for a title that is not a string", () => {
    for (const title of [null, undefined, 42, { toString: () => "reuters.com" }, ["x"]]) {
      expect(citationLabel({ url: REUTERS, title }, NONE)).toEqual({
        text: "reuters.com",
        kind: "host",
      });
    }
  });

  it("truncates an absurdly long title at a word boundary, never mid-word", () => {
    const long = `${"Nimbus ".repeat(20)}raises`;
    const { text, kind } = citationLabel({ url: REUTERS, title: long }, NONE);
    expect(kind).toBe("title");
    expect(text.length).toBeLessThanOrEqual(CITATION_LABEL_MAX + 1);
    expect(text.endsWith("…")).toBe(true);
    // The ellipsis is separated from the last word, so a reader meets a whole
    // word and then the mark that says "there was more".
    expect(text).not.toMatch(/\S…$/);
  });

  it("truncates a single unbroken word rather than returning it whole", () => {
    // No space to cut at, so the cap plus the detached ellipsis is the bound.
    const { text } = citationLabel({ url: REUTERS, title: "N".repeat(500) }, NONE);
    expect(text.length).toBeLessThanOrEqual(CITATION_LABEL_MAX + 2);
    expect(text).not.toMatch(/\S…$/);
  });

  it("collapses interior whitespace, so the cap measures what is read", () => {
    const padded = `${"Nimbus\n\n   ".repeat(20)}raises`;
    const { text } = citationLabel({ url: REUTERS, title: padded }, NONE);
    expect(text.length).toBeLessThanOrEqual(CITATION_LABEL_MAX + 2);
    expect(text).not.toMatch(/\s\s/);
    expect(text).not.toContain("\n");
  });

  it("leaves a title at exactly the cap alone", () => {
    const exact = "N".repeat(CITATION_LABEL_MAX);
    expect(citationLabel({ url: REUTERS, title: exact }, NONE).text).toBe(exact);
  });

  it("does not truncate the STORED title -- only the spoken label is capped", () => {
    // The panel prints the whole title on purpose (DigestPanel.test.js pins
    // that no CSS clamps it); the cap exists for the accessible name.
    const long = `${"Nimbus ".repeat(20)}raises`;
    expect(citationTitle(long)).toBe(long);
  });
});

// ===========================================================================
describe("the fallback chain, in order", () => {
  it("prefers the entry's own title", () => {
    expect(citationLabel({ url: REUTERS, title: HEADLINE }, NONE).kind).toBe("title");
  });

  it("falls to the host derived from the entry's own href", () => {
    expect(citationLabel({ url: REUTERS, title: "reuters.com" }, NONE)).toEqual({
      text: "reuters.com",
      kind: "host",
    });
  });

  it("refuses a hidden host as a name and reports unnamed", () => {
    expect(citationLabel({ url: REDIRECT }, hidden("vertexaisearch.cloud.google.com"))).toEqual({
      text: "",
      kind: "unnamed",
    });
  });

  it("reports unnamed when there is neither a usable host nor a title", () => {
    expect(citationLabel({ url: "not a url" }, NONE)).toEqual({ text: "", kind: "unnamed" });
    expect(citationLabel({}, NONE)).toEqual({ text: "", kind: "unnamed" });
  });

  it("never returns a URL as a name", () => {
    // The host-only path used to fall back to the raw URL. No path may now.
    for (const record of [
      { url: REUTERS },
      { url: REDIRECT },
      { url: REUTERS, title: REUTERS },
      { url: REDIRECT, title: REDIRECT },
      { url: REUTERS, title: "https://elsewhere.example/x" },
    ]) {
      const { text } = citationLabel(record, NONE);
      expect(text).not.toContain("://");
      expect(text).not.toContain("/");
    }
  });

  it("is idempotent -- a surviving title re-enters the rule unchanged", () => {
    // DigestPanel stores the admissible title on its entry and asks for the
    // label later, so the rule runs twice over the same record.
    for (const title of [HEADLINE, "reuters.com", "", "Reuters", "  reuters.com  "]) {
      const once = citationTitle(title);
      expect(citationTitle(once)).toBe(once);
    }
  });
});

// ===========================================================================
describe("totality -- a stored jsonb value is whatever the column holds", () => {
  const junk = [
    undefined,
    null,
    42,
    "bare string",
    [],
    [1, 2],
    { url: 42, title: 42 },
    { url: {}, title: {} },
    { url: null, title: null },
    { url: "", title: "" },
    { url: "https://", title: "reuters.com" },
    { url: "//evil.example/x", title: "reuters.com" },
    { url: "  https://reuters.com/x  ", title: "reuters.com" },
  ];

  it("never throws, and always returns one of the three kinds", () => {
    for (const record of junk) {
      expect(() => citationLabel(record, NONE)).not.toThrow();
      const out = citationLabel(record, NONE);
      expect(["title", "host", "unnamed"]).toContain(out.kind);
      expect(typeof out.text).toBe("string");
    }
  });

  it("tolerates a hiddenHosts that is not a Set", () => {
    for (const hosts of [undefined, null, [], {}, "reuters.com"]) {
      expect(() => citationLabel({ url: REUTERS }, hosts)).not.toThrow();
      expect(citationLabel({ url: REUTERS }, hosts).kind).toBe("host");
    }
  });

  it("never throws in citationTitle either", () => {
    for (const title of [undefined, null, 42, {}, [], " ", "https://", " "]) {
      expect(() => citationTitle(title)).not.toThrow();
      expect(typeof citationTitle(title)).toBe("string");
    }
  });
});
