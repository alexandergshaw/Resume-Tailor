import { describe, it, expect } from "vitest";
import { extractPublishedDate, formatMonthYear, htmlToText } from "./fetchUrlContent.js";

describe("htmlToText", () => {
  it("strips real HTML tags and decodes entities", () => {
    expect(htmlToText("<p>Hello &amp; <strong>welcome</strong></p>")).toBe("Hello & welcome");
  });

  it("cleans entity-encoded HTML (e.g. higheredjobs JSON-LD descriptions)", () => {
    // The posting body arrives double-encoded: &lt;strong&gt; rather than <strong>.
    const encoded = "&lt;strong&gt;Job ID: &lt;/strong&gt; 60125&lt;br&gt;&lt;br&gt;&lt;strong&gt;Job Description&lt;/strong&gt;&lt;br&gt;The Department invites applications.";
    const out = htmlToText(encoded);
    expect(out).not.toMatch(/<\/?[a-z][^>]*>/i); // no literal tags left
    expect(out).toContain("Job ID: 60125");
    expect(out).toContain("The Department invites applications.");
  });
});

describe("formatMonthYear", () => {
  it("formats ISO dates as Month YYYY without timezone drift", () => {
    expect(formatMonthYear("2026-02-14T08:00:00-05:00")).toBe("February 2026");
    expect(formatMonthYear("2026-02-01")).toBe("February 2026");
  });

  it("falls back to a bare year when only a year is present", () => {
    expect(formatMonthYear("Published 2026")).toBe("2026");
  });

  it("returns empty for unparseable input", () => {
    expect(formatMonthYear("")).toBe("");
    expect(formatMonthYear("sometime soon")).toBe("");
  });
});

describe("extractPublishedDate", () => {
  it("prefers JSON-LD datePublished", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "NewsArticle",
      datePublished: "2026-03-09T10:00:00Z",
    })}</script>`;
    expect(extractPublishedDate(html)).toBe("March 2026");
  });

  it("digs datePublished out of an @graph", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [{ "@type": "WebPage" }, { "@type": "Article", datePublished: "2026-05-20" }],
    })}</script>`;
    expect(extractPublishedDate(html)).toBe("May 2026");
  });

  it("reads the article:published_time meta tag", () => {
    const html = `<meta property="article:published_time" content="2026-01-15T00:00:00Z" />`;
    expect(extractPublishedDate(html)).toBe("January 2026");
  });

  it("falls back to a <time datetime> element", () => {
    expect(extractPublishedDate(`<time datetime="2026-07-04">July 4</time>`)).toBe("July 2026");
  });

  it("returns empty when no date is present", () => {
    expect(extractPublishedDate("<html><body>no dates here</body></html>")).toBe("");
  });
});
