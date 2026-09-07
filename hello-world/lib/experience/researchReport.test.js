import { describe, it, expect } from "vitest";
import { buildResearchPrompt, reconcileCitations } from "./researchReport.js";
import { parseMarkdown } from "./markdown.js";

// The "how would current technology improve this project" researcher.
//
// reconcileCitations is the honesty-critical half and the reason this module
// exists as pure code. app/api/company-research/route.js already learned this
// lesson the expensive way, in its own words: model-supplied links 404 and
// model-supplied dates are invented. So the model's claimed citations are
// checked against groundingMetadata - the URLs the search tool actually
// visited - and anything uncorroborated is demoted to plain text.
//
// A research report with fabricated citations is worse than no report, because
// it looks checkable. That is the property these tests exist to hold.

const grounded = (uri, title = "") => ({ uri, title });

describe("buildResearchPrompt", () => {
  const page = {
    id: "p1",
    title: "Payments migration",
    body: "# Context\n\nMoved billing off the legacy processor.",
  };

  it("includes the page, its place in the tree, and its children", () => {
    const prompt = buildResearchPrompt({
      page,
      breadcrumb: ["Work", "Platform", "Payments migration"],
      childTitles: ["Rollout plan"],
      attachments: [],
    });
    expect(prompt).toContain("Payments migration");
    expect(prompt).toContain("Moved billing off the legacy processor.");
    expect(prompt).toContain("Work / Platform / Payments migration");
    expect(prompt).toContain("Rollout plan");
  });

  it("passes an attachment's name and notes, never its bytes", () => {
    // Notes are the ONLY thing a model ever learns about a video, since video
    // bytes are not sent as context. Shipping bytes into a search-grounded
    // prompt would be pure cost for no signal.
    const prompt = buildResearchPrompt({
      page,
      breadcrumb: ["Payments migration"],
      childTitles: [],
      attachments: [
        { name: "arch.png", notes: "current topology", dataB64: "AAAABBBB", storage_path: "u1/x" },
      ],
    });
    expect(prompt).toContain("arch.png");
    expect(prompt).toContain("current topology");
    expect(prompt).not.toContain("AAAABBBB");
    expect(prompt).not.toContain("u1/x");
  });

  it("asks for what the user actually wants, not resume phrasing", () => {
    // The user chose "doing the work" over "talking about the work". If the
    // prompt drifts to positioning language the report becomes the other
    // feature, silently.
    const prompt = buildResearchPrompt({
      page,
      breadcrumb: ["Payments migration"],
      childTitles: [],
      attachments: [],
    }).toLowerCase();
    expect(prompt).toContain("trade");
    expect(prompt).not.toContain("resume");
    expect(prompt).not.toContain("interview");
  });

  it("survives an empty page without producing a prompt about nothing", () => {
    const prompt = buildResearchPrompt({
      page: { id: "p2", title: "", body: "" },
      breadcrumb: [],
      childTitles: [],
      attachments: [],
    });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("reconcileCitations", () => {
  it("keeps a citation the search actually visited", () => {
    const out = reconcileCitations({
      markdown: "Consider [Postgres logical replication](https://www.postgresql.org/docs/current/logical-replication.html).",
      groundedSources: [grounded("https://www.postgresql.org/docs/current/logical-replication.html", "Logical Replication")],
    });
    expect(out.markdown).toContain("](https://www.postgresql.org/docs/current/logical-replication.html)");
    expect(out.dropped).toEqual([]);
  });

  it("demotes a citation the search never visited, keeping its text", () => {
    // The invented-link case. The claim may still be worth reading; the link
    // must not look verified.
    const out = reconcileCitations({
      markdown: "See [the 2026 benchmark](https://example.com/invented-benchmark) for numbers.",
      groundedSources: [grounded("https://www.postgresql.org/docs/current/logical-replication.html")],
    });
    expect(out.markdown).not.toContain("https://example.com/invented-benchmark");
    expect(out.markdown).toContain("the 2026 benchmark");
    expect(out.markdown).toContain("for numbers");
    expect(out.dropped).toEqual(["https://example.com/invented-benchmark"]);
  });

  it("matches a grounded source despite a differing query, fragment, or trailing slash", () => {
    // Grounding metadata routinely carries tracking parameters and redirect
    // wrappers that the model's own citation does not. Comparing raw strings
    // would drop real citations, which trains the reader to distrust the
    // filter rather than the model.
    const out = reconcileCitations({
      markdown: "[docs](https://www.postgresql.org/docs/current/logical-replication.html)",
      groundedSources: [
        grounded("https://WWW.postgresql.org/docs/current/logical-replication.html/?utm_source=x#frag"),
      ],
    });
    expect(out.dropped).toEqual([]);
  });

  it("does not treat a different path on the same host as corroborated", () => {
    // The positive control's inverse: host-only matching would wave through
    // any page on a site the search happened to touch.
    const out = reconcileCitations({
      markdown: "[claim](https://www.postgresql.org/docs/current/something-else.html)",
      groundedSources: [grounded("https://www.postgresql.org/docs/current/logical-replication.html")],
    });
    expect(out.dropped).toEqual(["https://www.postgresql.org/docs/current/something-else.html"]);
  });

  it("appends a sources section built only from grounded URLs", () => {
    const out = reconcileCitations({
      markdown: "Body text with [a link](https://a.example/one).",
      groundedSources: [grounded("https://a.example/one", "One"), grounded("https://b.example/two", "Two")],
    });
    expect(out.markdown).toContain("https://a.example/one");
    expect(out.markdown).toContain("https://b.example/two");
  });

  it("marks a report ungrounded when the search returned nothing", () => {
    // Presenting an ungrounded answer as researched is the failure this whole
    // module exists to prevent. Every citation goes, and the report says so.
    const out = reconcileCitations({
      markdown: "Use [this](https://example.com/x) approach.",
      groundedSources: [],
    });
    expect(out.grounded).toBe(false);
    expect(out.dropped).toEqual(["https://example.com/x"]);
    expect(out.markdown.toLowerCase()).toContain("not grounded");
    expect(out.markdown).not.toContain("https://example.com/x");
  });

  it("reports a grounded run as grounded", () => {
    const out = reconcileCitations({
      markdown: "no links here",
      groundedSources: [grounded("https://a.example/one")],
    });
    expect(out.grounded).toBe(true);
    expect(out.dropped).toEqual([]);
  });

  it("leaves a report with no citations alone", () => {
    const out = reconcileCitations({ markdown: "Plain prose.", groundedSources: [] });
    expect(out.markdown).toContain("Plain prose.");
    expect(out.dropped).toEqual([]);
  });

  it("never emits a dangerous scheme, even if the model produced one", () => {
    // The report is rendered by the page markdown renderer, which has its own
    // allowlist - but a citation is also copied into a sources list, so this
    // must not be the only line of defence, and it must not be the weaker one.
    const out = reconcileCitations({
      markdown: "[x](javascript:alert(1)) and [y](data:text/html;base64,PHM+)",
      groundedSources: [grounded("javascript:alert(1)")],
    });
    expect(out.markdown).not.toContain("javascript:");
    expect(out.markdown).not.toContain("data:text/html");
  });

  it("survives junk input without throwing", () => {
    for (const input of [
      { markdown: "", groundedSources: [] },
      { markdown: null, groundedSources: null },
      { markdown: "text", groundedSources: [{ uri: null }, null] },
      {},
    ]) {
      expect(() => reconcileCitations(input)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// WHAT A CITATION MAY BE CALLED.
//
// Gemini's legacy grounding metadata returns `web.uri` as a
// `vertexaisearch.cloud.google.com` REDIRECT proxy and `web.title` as the
// PUBLISHER'S BARE DOMAIN. This module used to pair them verbatim -
// `- [${g.title || g.uri}](${g.uri})` - so a stored report's Sources section
// read "reuters.com" over an href that reaches a Google API redirect: a claim
// about who published this research that the link does not support, written
// permanently into experience_pages.body and catchable only by hovering.
//
// The rule that closes it is lib/tracking/citationLabel.js's, IMPORTED rather
// than restated: a title that names a host is not a name, and the only domain
// that may appear as a label is the one `citationHost` derives from that
// citation's OWN href. Every fixture below MISMATCHES on purpose - a real
// redirect href beside a real publisher domain as the title. A fixture whose
// href host already equals its title cannot exhibit this defect at all, and the
// one that does appear here is the deliberate CONTROL: it proves the rule is a
// byte-identical no-op on the honest case, which is why removing the
// title-vs-host comparison beats getting the comparison right.
// ---------------------------------------------------------------------------

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFm3nH2r4pQ";
const REDIRECT_2 = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BXKJZRGn7pQ2wLd8";

// The terminal proof, asked of the renderer itself rather than of a second
// pattern: what does lib/experience/markdown.js - the code that actually draws
// this stored body - make of the markdown we wrote?
function renderedLinks(markdown) {
  const out = [];
  const walk = (tokens) => {
    for (const t of tokens || []) {
      if (t?.type === "link") out.push({ href: t.href, label: labelOf(t.children) });
      if (Array.isArray(t?.children)) walk(t.children);
      if (Array.isArray(t?.items)) for (const item of t.items) walk(item.children);
    }
  };
  walk(parseMarkdown(markdown));
  return out;
}

function labelOf(children) {
  let s = "";
  for (const t of children || []) {
    if (typeof t?.value === "string") s += t.value;
    else if (Array.isArray(t?.children)) s += labelOf(t.children);
  }
  return s;
}

describe("reconcileCitations — what a citation may be CALLED", () => {
  it("never labels a vendor redirect with the publisher domain the vendor supplied", () => {
    // THE DEFECT, exactly as measured: web.uri is the redirect, web.title is
    // the bare domain. Pairing them verbatim asserts Reuters published this.
    const out = reconcileCitations({
      markdown: "Throughput doubled.",
      groundedSources: [
        { uri: REDIRECT, title: "reuters.com" },
        { uri: REDIRECT_2, title: "bbc.co.uk" },
      ],
    });

    // The claim is gone from the stored body entirely - not merely from the
    // anchor text, since a reader copies this markdown around.
    expect(out.markdown).not.toContain("reuters.com");
    expect(out.markdown).not.toContain("bbc.co.uk");

    // ...and the LINK is untouched. Refusing the citation outright would throw
    // away a source the search really visited.
    const links = renderedLinks(out.markdown);
    expect(links.map((l) => l.href)).toEqual([REDIRECT, REDIRECT_2]);
    expect(links.map((l) => l.label)).toEqual(["Source (unnamed)", "Source (unnamed)"]);
  });

  it("keeps the model's own inline citation as a link, but not as a publisher claim", () => {
    // The SECOND label path in this module. A citation only survives if its url
    // matches a grounded key, and on this surface every grounded key IS a
    // redirect - so a surviving inline link's href is a redirect and its label
    // is unconstrained model text. Same anchor, same lie, different line.
    const out = reconcileCitations({
      markdown: `As [reuters.com](${REDIRECT}) reported, throughput doubled.`,
      groundedSources: [
        { uri: REDIRECT, title: "Nimbus doubles throughput" },
        { uri: REDIRECT_2, title: "bbc.co.uk" },
      ],
    });

    expect(out.dropped).toEqual([]);
    expect(out.markdown).not.toContain("reuters.com");
    // The sentence still reads, and the link still works.
    expect(out.markdown).toContain("reported, throughput doubled.");
    expect(renderedLinks(out.markdown).map((l) => l.href)).toContain(REDIRECT);
  });

  it("keeps a body link's href exactly as the model wrote it", () => {
    // The rule changes what is SAID about a citation, never where the link
    // GOES. The href is re-emitted from the link's OWN capture: a label
    // rebuilt against the wrong end of the grounded array would silently point
    // a corroborated sentence at a different source. The body link here
    // deliberately matches the SECOND grounded entry, so a href taken from the
    // first would go unnoticed by any fixture that used only one.
    const out = reconcileCitations({
      markdown: `As [reuters.com](${REDIRECT_2}) reported, throughput doubled.`,
      groundedSources: [
        { uri: REDIRECT, title: "A first story" },
        { uri: REDIRECT_2, title: "A second story" },
      ],
    });
    const [bodyOut] = out.markdown.split("\n\n## Sources\n");
    expect(bodyOut).toContain(`](${REDIRECT_2})`);
    expect(bodyOut).not.toContain(REDIRECT);
    expect(bodyOut).not.toContain("reuters.com");
  });

  it("leaves no dangling bracket in a name a reader meets", () => {
    // Brackets go from BOTH sides. A lone "[" cannot open a link on its own
    // under markdown.js's grammar, but it is still a visible defect in a
    // source's name, so stripping only "]" is not enough.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: REDIRECT, title: "[Video] Nimbus raises a Series C" }],
    });
    expect(out.markdown).toContain(`- [Video Nimbus raises a Series C](${REDIRECT})`);
  });

  it("is a byte-identical no-op when the title names the citation's OWN host", () => {
    // THE CONTROL. A title naming its own host is redundant with the host the
    // rule derives from that href, so a MATCH and a MISMATCH have the same
    // correct outcome - which is why there is no comparison to get wrong.
    const markdown = "See [reuters.com](https://www.reuters.com/tech/a) for numbers.";
    const out = reconcileCitations({
      markdown,
      groundedSources: [
        { uri: "https://www.reuters.com/tech/a", title: "" },
        { uri: "https://apnews.com/b", title: "" },
      ],
    });
    expect(out.markdown).toContain("See [reuters.com](https://www.reuters.com/tech/a) for numbers.");
  });

  it("a headline is not a publisher claim, so it survives on a redirect", () => {
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: REDIRECT, title: "Nimbus raises a Series C" }],
    });
    expect(out.markdown).toContain(`- [Nimbus raises a Series C](${REDIRECT})`);

    // ...collapsed to one line, because a Sources entry is a list ITEM: a
    // stored title carrying a newline would split it into a second bullet.
    const wrapped = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: REDIRECT, title: "Nimbus raises\na Series C" }],
    });
    expect(wrapped.markdown).toContain(`- [Nimbus raises a Series C](${REDIRECT})`);
  });

  it("takes the host from the control that decides the href, not a looser parse", () => {
    // `safeUrl` above admits userinfo; safeExternalHref's rule 5 refuses it,
    // and `citationHost` is gated on that control. A second, ungated
    // `new URL(...).hostname` here would name a source the link cannot reach —
    // which is this defect wearing a different hat.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: "https://reuters.com:x@evil.example/a", title: "" }],
    });
    expect(out.markdown).toContain("- [Source (unnamed)](https://reuters.com:x@evil.example/a)");
    expect(out.markdown).not.toContain("[evil.example]");
    expect(out.markdown).not.toContain("[reuters.com]");
  });

  it("suppresses a single shared host exactly as the digest panel does", () => {
    // `nonPublisherHosts` is handed the ADMITTED titles, precisely as
    // DigestPanel hands it `entry.title`. Handing it the RAW vendor titles
    // instead would let a set whose every title IS the shared domain keep that
    // domain as a name, and the two surfaces would then disagree about the
    // same data - which is the divergence this whole exercise exists to remove.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [
        { uri: "https://reuters.com/a", title: "reuters.com" },
        { uri: "https://reuters.com/b", title: "reuters.com" },
      ],
    });
    expect(out.markdown).toContain("- [Source (unnamed)](https://reuters.com/a)");
    expect(out.markdown).toContain("- [Source (unnamed)](https://reuters.com/b)");
    expect(out.markdown).not.toContain("reuters.com](");
  });

  it("names an untitled source by its own host, and never by its URL", () => {
    // The old chain ended at `|| g.uri`: an untitled source was written into
    // the report under its own URL as its NAME. A URL is not a name.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [
        { uri: "https://www.reuters.com/tech/a", title: "" },
        { uri: "https://apnews.com/b", title: "" },
      ],
    });
    expect(out.markdown).toContain("- [reuters.com](https://www.reuters.com/tech/a)");
    expect(out.markdown).toContain("- [apnews.com](https://apnews.com/b)");
    expect(out.markdown).not.toContain("[https://");
  });

  it("refuses a lookalike domain outright rather than comparing it to the host", () => {
    // The `includes()` mutant's fixture: a comparison written with `includes`
    // instead of `===` lets "reuters.com" stand as the NAME of
    // reuters.com.evil.test. The rule refuses the title either way.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: "https://reuters.com.evil.test/x", title: "reuters.com" }],
    });
    expect(out.markdown).toContain("- [reuters.com.evil.test](https://reuters.com.evil.test/x)");
    expect(out.markdown).not.toContain("[reuters.com]");
  });

  it("refuses a padded domain — and the padding must survive to be refused", () => {
    // "compares before trimming" is the third way a comparison goes wrong, and
    // it CANNOT be exhibited on the Sources path: `safeGrounded` already trims
    // `g.title`, so a padded vendor title never reaches the label expression
    // padded. The model's own inline link text is NOT trimmed anywhere -
    // LINK_RE captures it verbatim - so that is the boundary where a rule that
    // compared raw strings would let " reuters.com " stand on a redirect.
    const out = reconcileCitations({
      markdown: `Per [ reuters.com ](${REDIRECT}) the migration held.`,
      groundedSources: [
        { uri: REDIRECT, title: "Nimbus doubles throughput" },
        { uri: REDIRECT_2, title: "A second story" },
      ],
    });
    expect(out.markdown).not.toContain("reuters.com");
    expect(out.dropped).toEqual([]);
    expect(renderedLinks(out.markdown).map((l) => l.href)).toContain(REDIRECT);
  });

  it("refuses a www-spelled domain that folds to its own host", () => {
    // The fourth way: folding `www.` on ONE side only. Fold it out of the host
    // but not the title and the two compare UNEQUAL, so the comparison keeps
    // "www.reuters.com" as the name. The rule refuses it and the host - which
    // is the only domain allowed to appear - is printed in its place.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: "https://www.reuters.com/tech/a", title: "www.reuters.com" }],
    });
    expect(out.markdown).toContain("- [reuters.com](https://www.reuters.com/tech/a)");
    expect(out.markdown).not.toContain("[www.reuters.com]");
  });

  it("refuses a non-ASCII domain, which only a URL parser recognises", () => {
    // A hand-written domain regex is a second recogniser that drifts.
    // "реклама.com" is a domain; nothing about its spelling says so in ASCII.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: REDIRECT, title: "реклама.com" }],
    });
    expect(out.markdown).not.toContain("реклама.com");
    expect(out.markdown).toContain(`- [Source (unnamed)](${REDIRECT})`);
  });

  it("does not cap the label, because this markdown is stored and not spoken", () => {
    const headline = "How one payments team moved eleven million recurring subscriptions off a legacy processor without a single missed charge";
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: REDIRECT, title: headline }],
    });
    expect(out.markdown).toContain(`- [${headline}](${REDIRECT})`);
  });

  it("a title may not close the link and open the model's own", () => {
    // THE ONE THING THIS SURFACE NEEDS THAT THE PANEL DOES NOT. The label is
    // emitted into MARKDOWN, not into a React text node, and markdown.js takes
    // the FIRST "]" with no escape handling - so a "]" inside a vendor title
    // closes our anchor and the rest of the title opens an attacker's.
    const out = reconcileCitations({
      markdown: "Body.",
      groundedSources: [{ uri: REDIRECT, title: "Analysis ](https://evil.example/phish) and more" }],
    });
    expect(out.markdown).not.toContain("](https://evil.example/phish)");
    // Asked of the renderer, not of a second pattern.
    expect(renderedLinks(out.markdown).map((l) => l.href)).toEqual([REDIRECT]);
  });

  it("survives a non-string title without throwing or naming anything", () => {
    for (const title of [null, undefined, false, 42, ["reuters.com"]]) {
      const out = reconcileCitations({
        markdown: "Body.",
        groundedSources: [{ uri: REDIRECT, title }],
      });
      expect(out.markdown).toContain(`- [Source (unnamed)](${REDIRECT})`);
    }
  });
});
