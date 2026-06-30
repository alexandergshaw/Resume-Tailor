import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractPublishedDate,
  formatMonthYear,
  htmlToText,
  workdayCxsUrl,
  cleanOrgName,
  fetchUrlContent,
  findEmbeddedJobPosting,
} from "./fetchUrlContent.js";

// A minimal mock of an HTML fetch Response (streaming body + content-type).
function htmlResponse(html, url = "https://board.example.com/job/1") {
  let sent = false;
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: new TextEncoder().encode(html) };
        },
        cancel() {},
      }),
    },
  };
}

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

describe("workdayCxsUrl", () => {
  it("maps a public Workday URL (with locale) to its CXS JSON endpoint", () => {
    const url = new URL(
      "https://smithcollege.wd5.myworkdayjobs.com/en-US/smithcollege/job/Smith-College/Drupal-and-Integrations-Developer_R-202600314",
    );
    expect(workdayCxsUrl(url)).toBe(
      "https://smithcollege.wd5.myworkdayjobs.com/wday/cxs/smithcollege/smithcollege/job/Smith-College/Drupal-and-Integrations-Developer_R-202600314",
    );
  });

  it("maps a URL without a locale segment", () => {
    const url = new URL("https://acme.wd1.myworkdayjobs.com/External/job/HQ/Engineer_R-1");
    expect(workdayCxsUrl(url)).toBe("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/job/HQ/Engineer_R-1");
  });

  it("returns empty for a non-job Workday path", () => {
    expect(workdayCxsUrl(new URL("https://acme.wd1.myworkdayjobs.com/External"))).toBe("");
  });
});

describe("cleanOrgName", () => {
  it("strips legal-entity prefixes universities use in Workday", () => {
    expect(cleanOrgName("The Trustees of the Smith College")).toBe("Smith College");
    expect(cleanOrgName("The Regents of the University of California")).toBe("University of California");
    expect(cleanOrgName("Board of Trustees of Acme University")).toBe("Acme University");
    expect(cleanOrgName("Globex Corporation")).toBe("Globex Corporation");
  });
});

describe("findEmbeddedJobPosting (host-agnostic)", () => {
  it("reads a JSON-LD JobPosting", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Engineer",
      hiringOrganization: { name: "Acme" },
      description: "<p>Work <b>here</b></p>",
    })}</script>`;
    expect(findEmbeddedJobPosting(html)).toMatchObject({ title: "Engineer", company: "Acme", description: "Work here" });
  });

  it("digs a JobPosting out of __NEXT_DATA__ framework state", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { posting: { "@type": "JobPosting", jobTitle: "Analyst", description: "x".repeat(60) } } },
    })}</script>`;
    expect(findEmbeddedJobPosting(html).title).toBe("Analyst");
  });

  it("handles a Workday-style jobPostingInfo wrapper embedded in a page", () => {
    const html = `<script type="application/json">${JSON.stringify({
      jobPostingInfo: { title: "Dev", jobDescription: `<p>${"y".repeat(60)}</p>` },
      hiringOrganization: { name: "Globex" },
    })}</script>`;
    const r = findEmbeddedJobPosting(html);
    expect(r.title).toBe("Dev");
    expect(r.company).toBe("Globex");
  });

  it("ignores non-job JSON so an article/product page isn't misread", () => {
    const html = `<script type="application/json">${JSON.stringify({ "@type": "Product", name: "Widget", description: "A nice widget" })}</script>`;
    expect(findEmbeddedJobPosting(html)).toBeNull();
  });
});

describe("fetchUrlContent — generic embedded JSON", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extracts an embedded JobPosting from an arbitrary SPA page (no per-site code)", async () => {
    const html = `<html><head><title>Board</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { job: { "@type": "JobPosting", title: "Data Engineer", hiringOrganization: { name: "The Trustees of the Foo College" }, description: "<p>Build pipelines with Python and SQL.</p>" } } },
    })}</script></body></html>`;
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(html)));
    const r = await fetchUrlContent("https://board.example.com/job/1");
    expect(r.error).toBeUndefined();
    expect(r.title).toBe("Data Engineer");
    expect(r.company).toBe("Foo College"); // cleanOrgName applied at the fetch layer
    expect(r.description).toContain("Python and SQL");
  });
});

describe("fetchUrlContent — Workday CXS", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a Workday posting via the CXS JSON API", async () => {
    const cxs = {
      jobPostingInfo: {
        title: "Drupal and Integrations Developer",
        jobDescription:
          "<h2>Job Description</h2><p>Maintain custom <strong>Drupal</strong> modules and <strong>Salesforce</strong> integrations.</p>",
        startDate: "2026-07-13",
      },
      hiringOrganization: { name: "The Trustees of the Smith College" },
    };
    const fetchMock = vi.fn(async (u) => {
      expect(u).toContain("/wday/cxs/smithcollege/smithcollege/job/");
      return { ok: true, json: async () => cxs };
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent(
      "https://smithcollege.wd5.myworkdayjobs.com/en-US/smithcollege/job/Smith-College/Drupal-and-Integrations-Developer_R-202600314",
    );
    expect(r.error).toBeUndefined();
    expect(r.title).toBe("Drupal and Integrations Developer");
    expect(r.company).toBe("Smith College"); // legal prefix stripped
    expect(r.description).toContain("Drupal");
    expect(r.description).toContain("Salesforce");
    expect(r.publishedDate).toBe("July 2026");
    expect(fetchMock).toHaveBeenCalledTimes(1); // CXS only, no generic HTML fetch
  });

  it("falls back to the generic fetch when the CXS API has no posting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 }) // CXS
      .mockResolvedValueOnce({ ok: false, status: 500 }); // generic HTML fetch
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent("https://x.wd1.myworkdayjobs.com/en-US/x/job/HQ/Role_R-1");
    expect(fetchMock).toHaveBeenCalledTimes(2); // tried CXS, then fell through
    expect(r.error).toMatch(/Failed to fetch URL/);
  });
});
