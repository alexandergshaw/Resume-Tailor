import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractPublishedDate,
  formatMonthYear,
  htmlToText,
  stripTags,
  workdayCxsUrl,
  cleanOrgName,
  fetchUrlContent,
  findEmbeddedJobPosting,
  isBlockedHost,
  checkRequestUrl,
  MAX_REDIRECT_HOPS,
} from "./fetchUrlContent.js";

// A minimal mock of an HTML fetch Response (streaming body + content-type).
function htmlResponse(html, url = "https://board.example.com/job/1", chunkBytes = 0) {
  const bytes = new TextEncoder().encode(html);
  let offset = 0;
  const step = chunkBytes > 0 ? chunkBytes : bytes.byteLength || 1;
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= bytes.byteLength) return { done: true, value: undefined };
          const value = bytes.subarray(offset, offset + step);
          offset += step;
          return { done: false, value };
        },
        cancel() {},
      }),
    },
  };
}

// Case-insensitive Headers stand-in.
function headersOf(map) {
  const lower = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (k) => (Object.hasOwn(lower, String(k).toLowerCase()) ? lower[String(k).toLowerCase()] : null) };
}

/**
 * A fetch mock that honours BOTH redirect modes the way a real fetch does, so
 * a test can tell "we refused to send the request" apart from "we sent it and
 * the platform quietly followed the chain for us".
 *
 *   redirect: "follow"  -> the mock walks the chain itself and returns the
 *                          FINAL response, exactly as undici would. This is
 *                          what makes the pre-flight-check-only bug visible.
 *   redirect: "manual"  -> the mock returns the 302 with its Location header
 *                          and leaves the walking to the caller.
 *
 * `fn.requested` records every URL actually requested, including hops the mock
 * followed internally — so assertions can be about what was REQUESTED, not
 * merely about what was returned.
 */
function redirectingFetch(routes) {
  const requested = [];
  const fn = vi.fn(async (url, init = {}) => {
    let current = String(url);
    for (let hop = 0; hop < 25; hop += 1) {
      requested.push(current);
      const route = routes[current];
      if (!route) return { ok: false, status: 404, url: current, headers: headersOf({}) };
      if (route.redirectTo) {
        const target = new URL(route.redirectTo, current).href;
        if (init.redirect === "manual") {
          return {
            ok: false,
            status: route.status || 302,
            url: current,
            headers: headersOf({ location: route.redirectTo }),
          };
        }
        current = target;
        continue;
      }
      return htmlResponse(route.html, current);
    }
    throw new Error("too many redirects");
  });
  fn.requested = requested;
  return fn;
}

// Wall-clock helper for the ReDoS assertions.
function msToRun(fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
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

  it("tolerates a trailing comma in hand-built JSON-LD (e.g. HigherEdJobs)", () => {
    // HigherEdJobs' JobPosting node ends a nested object with a trailing comma,
    // which strict JSON.parse rejects — so the posting must still be recovered.
    const html = `<script type="application/ld+json">
      {
        "@type": "JobPosting",
        "title": "Temporary Computer Science Developer",
        "hiringOrganization": { "@type": "Organization", "name": "Worcester Polytechnic Institute" },
        "description": "<b>JOB DESCRIPTION</b><br>PHP, the LAMP stack, Angular, REST APIs, and Drupal.",
        "baseSalary": { "@type": "MonetaryAmount", "value": { "@type": "QuantitativeValue", "value": "$22 per hour", } }
      }
    </script>`;
    const r = findEmbeddedJobPosting(html);
    expect(r).not.toBeNull();
    expect(r.title).toBe("Temporary Computer Science Developer");
    expect(r.company).toBe("Worcester Polytechnic Institute");
    expect(r.description).toContain("Drupal");
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

// ===========================================================================
// FINDING 1 — SSRF
// ===========================================================================

// Every address family / encoding the security review verified as reachable
// past the old exact-string blocklist, plus the ones it already covered (which
// must STAY covered). One row per bypass, so a regression names itself.
const SSRF_BLOCKED = [
  ["http://127.0.0.2/x", "loopback other than the one literal in the old list"],
  ["http://127.255.255.254/x", "top of 127.0.0.0/8"],
  ["http://2130706433/x", "decimal-encoded 127.0.0.1"],
  ["http://0x7f000001/x", "hex-encoded 127.0.0.1"],
  ["http://0177.0.0.1/x", "octal-encoded 127.0.0.1"],
  ["http://127.1/x", "short-form 127.0.0.1"],
  ["http://10.1.2.3/x", "RFC1918 10.0.0.0/8"],
  ["http://172.16.0.1/x", "RFC1918 172.16.0.0/12 (low edge)"],
  ["http://172.31.255.254/x", "RFC1918 172.16.0.0/12 (high edge)"],
  ["http://192.168.5.5/x", "RFC1918 192.168.0.0/16"],
  ["http://169.254.1.1/x", "IPv4 link-local other than the metadata IP"],
  ["http://169.254.169.254/x", "the AWS/GCP metadata IP itself"],
  ["http://100.64.0.1/x", "CGNAT 100.64.0.0/10"],
  ["http://0.0.0.0/x", "unspecified IPv4"],
  ["http://0/x", "bare 0, which parses as 0.0.0.0"],
  ["http://[::1]/x", "IPv6 loopback"],
  ["http://[::]/x", "IPv6 unspecified"],
  ["http://[fc00::1]/x", "IPv6 unique-local fc00::/7"],
  ["http://[fd12:3456::1]/x", "IPv6 unique-local fd00::/8"],
  ["http://[fe80::1]/x", "IPv6 link-local fe80::/10"],
  ["http://[::ffff:127.0.0.1]/x", "IPv4-mapped IPv6 loopback"],
  ["http://[::ffff:a9fe:a9fe]/x", "IPv4-mapped IPv6 metadata address"],
  ["http://[64:ff9b::7f00:1]/x", "NAT64-embedded loopback"],
  ["http://[2002:a9fe:a9fe::]/x", "6to4-embedded metadata address"],
  ["http://localhost/x", "localhost"],
  ["http://localhost./x", "trailing-dot localhost"],
  ["http://LOCALHOST/x", "uppercase localhost"],
  ["http://api.localhost/x", "a subdomain of localhost"],
  ["http://metadata.google.internal/x", "GCP metadata hostname"],
  ["http://metadata.google.internal./x", "GCP metadata hostname, fully qualified"],
  ["http://printer.local/x", "mDNS .local"],
];

// Legitimate public job-board / article URLs. These must keep working — the
// point of the fix is a narrower, structural block, not a broader one.
const SSRF_ALLOWED = [
  "https://boards.greenhouse.io/acme/jobs/1",
  "https://jobs.lever.co/zeta/abc",
  "https://www.higheredjobs.com/details.cfm?JobCode=1",
  "https://8.8.8.8/robots.txt",
  "https://[2606:4700:4700::1111]/",
  "https://172.32.0.1/x",
  "https://11.0.0.1/x",
  "https://192.169.0.1/x",
  "https://169.253.0.1/x",
];

describe("isBlockedHost — the one deny-by-range gate (finding 1)", () => {
  it.each(SSRF_BLOCKED)("blocks the host in %s (%s)", (url, _why) => {
    expect(isBlockedHost(new URL(url).hostname)).toBe(true);
  });

  it.each(SSRF_ALLOWED)("allows the host in %s", (url) => {
    expect(isBlockedHost(new URL(url).hostname)).toBe(false);
  });

  it("does not block a DNS name merely because it starts like a private range", () => {
    // The old prefix list blocked any hostname starting "10." or "192.168." —
    // a string coincidence, not an address. A structural check must not.
    expect(isBlockedHost("10.jobs.example.com")).toBe(false);
    expect(isBlockedHost("192.168.example.com")).toBe(false);
  });
});

describe("checkRequestUrl — scheme allow-list (finding 1)", () => {
  it.each([
    "file:///etc/passwd",
    "gopher://127.0.0.1:11211/_stats",
    "ftp://internal.example.com/x",
    "data:text/html,<h1>x</h1>",
    "javascript:alert(1)",
  ])("rejects %s", (url) => {
    expect(checkRequestUrl(url).ok).toBe(false);
  });

  it.each(SSRF_BLOCKED)("rejects %s (%s)", (url, _why) => {
    expect(checkRequestUrl(url).ok).toBe(false);
  });

  it.each(SSRF_ALLOWED)("accepts %s", (url) => {
    expect(checkRequestUrl(url).ok).toBe(true);
  });

  it("resolves a relative redirect target against its base before judging it", () => {
    expect(checkRequestUrl("/next", "https://board.example.com/job/1").ok).toBe(true);
    expect(checkRequestUrl("//169.254.169.254/latest", "https://board.example.com/job/1").ok).toBe(false);
  });
});

describe("fetchUrlContent — refuses blocked hosts without sending a request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(SSRF_BLOCKED)("makes no request for %s (%s)", async (url, _why) => {
    const fetchMock = vi.fn(async () => htmlResponse("<html><body>SSRF-CANARY</body></html>", url));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchUrlContent(url);
    expect(r.error).toBeTruthy();
    expect(r.description).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled(); // assert on what was REQUESTED
  });
});

describe("fetchUrlContent — re-checks every redirect hop (finding 1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not follow an allowed host's 302 into the metadata service", async () => {
    const fetchMock = redirectingFetch({
      "https://board.example.com/job/1": { redirectTo: "http://169.254.169.254/latest/meta-data/" },
      "http://169.254.169.254/latest/meta-data/": { html: "<html><body>SSRF-CANARY iam creds</body></html>" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent("https://board.example.com/job/1");

    expect(fetchMock.requested).toEqual(["https://board.example.com/job/1"]);
    expect(fetchMock.requested).not.toContain("http://169.254.169.254/latest/meta-data/");
    expect(r.error).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain("SSRF-CANARY");
  });

  it("blocks a hop that only turns private partway down the chain", async () => {
    const fetchMock = redirectingFetch({
      "https://board.example.com/a": { redirectTo: "https://cdn.example.com/b" },
      "https://cdn.example.com/b": { redirectTo: "https://tracker.example.net/c" },
      "https://tracker.example.net/c": { redirectTo: "http://10.0.0.7/admin" },
      "http://10.0.0.7/admin": { html: "<html><body>SSRF-CANARY internal admin</body></html>" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent("https://board.example.com/a");

    expect(fetchMock.requested).not.toContain("http://10.0.0.7/admin");
    expect(r.error).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain("SSRF-CANARY");
  });

  it("blocks a redirect that leaves http(s) entirely", async () => {
    const fetchMock = redirectingFetch({
      "https://board.example.com/a": { redirectTo: "file:///etc/passwd" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchUrlContent("https://board.example.com/a");
    expect(r.error).toBeTruthy();
    expect(fetchMock.requested).toEqual(["https://board.example.com/a"]);
  });

  it("re-checks a RELATIVE Location against the URL it came from", async () => {
    const fetchMock = redirectingFetch({
      "https://board.example.com/a": { redirectTo: "//169.254.169.254/latest/" },
      "https://169.254.169.254/latest/": { html: "<html><body>SSRF-CANARY</body></html>" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchUrlContent("https://board.example.com/a");
    expect(r.error).toBeTruthy();
    expect(fetchMock.requested).toEqual(["https://board.example.com/a"]);
  });

  it("still follows a legitimate public redirect chain and reports the final URL", async () => {
    const fetchMock = redirectingFetch({
      "https://vertex.redirect/acme": { redirectTo: "https://news.example.com/story" },
      "https://news.example.com/story": {
        html: "<html><head><title>Acme opens a lab</title></head><body><p>Acme opened a research lab.</p></body></html>",
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent("https://vertex.redirect/acme");

    expect(r.error).toBeUndefined();
    expect(r.title).toBe("Acme opens a lab");
    expect(r.description).toContain("research lab");
    expect(r.finalUrl).toBe("https://news.example.com/story");
    expect(fetchMock.requested).toEqual([
      "https://vertex.redirect/acme",
      "https://news.example.com/story",
    ]);
  });

  it("caps the redirect chain at MAX_REDIRECT_HOPS", async () => {
    expect(MAX_REDIRECT_HOPS).toBeLessThanOrEqual(5);
    const routes = {};
    for (let i = 0; i < 12; i += 1) {
      routes[`https://hop${i}.example.com/`] = { redirectTo: `https://hop${i + 1}.example.com/` };
    }
    routes["https://hop12.example.com/"] = { html: "<html><body>done</body></html>" };
    const fetchMock = redirectingFetch(routes);
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent("https://hop0.example.com/");

    expect(r.error).toBeTruthy();
    expect(fetchMock.requested.length).toBe(MAX_REDIRECT_HOPS + 1);
  });

  it("re-checks the Workday CXS hop too, not just the generic fetch", async () => {
    const start = "https://acme.wd1.myworkdayjobs.com/en-US/acme/job/HQ/Role_R-1";
    const cxs = "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/acme/job/HQ/Role_R-1";
    const fetchMock = redirectingFetch({
      [cxs]: { redirectTo: "http://169.254.169.254/latest/meta-data/" },
      "http://169.254.169.254/latest/meta-data/": { html: "<html><body>SSRF-CANARY</body></html>" },
      [start]: { html: "<html><head><title>Role</title></head><body>Public page.</body></html>" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent(start);

    expect(fetchMock.requested).not.toContain("http://169.254.169.254/latest/meta-data/");
    expect(JSON.stringify(r)).not.toContain("SSRF-CANARY");
  });
});

// ===========================================================================
// FINDING 2 — ReDoS in stripTags
// ===========================================================================

// The exact regexes stripTags used before the fix, so the replacement can be
// proved to accept the same language rather than merely "look right".
function legacyStripTags(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

// Deterministic small-input corpus (seeded LCG) over an alphabet dense in the
// characters that drive the tag scanner.
function tagCorpus(count) {
  const alphabet = ["<", ">", "/", "a", "p", "b", "r", "d", "i", "v", " ", '"', "=", "\n", "script", "style"];
  let seed = 20260905;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const len = 1 + Math.floor(rand() * 24);
    let s = "";
    for (let j = 0; j < len; j += 1) s += alphabet[Math.floor(rand() * alphabet.length)];
    out.push(s);
  }
  return out;
}

describe("stripTags — linear, and identical to the regex it replaces (finding 2)", () => {
  it("accepts exactly the same language as the old regexes", () => {
    for (const input of tagCorpus(4000)) {
      expect(stripTags(input)).toBe(legacyStripTags(input));
    }
  });

  it.each([
    ["<>", "an empty pair matches nothing — the pattern needs a character between"],
    ["<<a>", "a run of '<' before a tag is consumed by the greedy class"],
    ["a<b>c<>d<e>", "mixed matching and non-matching pairs"],
    ["<a", "an unterminated tag is left alone"],
    ["<p>one</p><p>two</p>", "ordinary markup"],
    ["<script>var a = 1 < 2;</script>after", "a script body containing '<'"],
    ["<style>a{}</style>x", "a style block"],
  ])("matches the old behaviour on %s (%s)", (input, _why) => {
    expect(stripTags(input)).toBe(legacyStripTags(input));
  });

  it(
    "strips 200 000 unmatched '<' in well under a second (was 29.5 s)",
    () => {
      const evil = "<".repeat(200000);
      const ms = msToRun(() => stripTags(evil));
      expect(ms).toBeLessThan(1000);
    },
    60000,
  );

  it(
    "handles 100 000 '<a' pairs in well under a second (was 15.4 s)",
    () => {
      const evil = "<a".repeat(100000);
      const ms = msToRun(() => stripTags(evil));
      expect(ms).toBeLessThan(1000);
    },
    60000,
  );
});

describe("htmlToText — no quadratic blowup on hostile input (finding 2)", () => {
  it(
    "converts 200 000 unmatched '<' in well under a second (was 29.4 s)",
    () => {
      const ms = msToRun(() => htmlToText("<".repeat(200000)));
      expect(ms).toBeLessThan(1000);
    },
    60000,
  );

  it(
    "converts 100 000 '<a' pairs in well under a second (was ~30 s across both passes)",
    () => {
      // This shape also drives the second pass's /<\/?[a-z][^>]*>/i probe,
      // which was quadratic for the same reason.
      const ms = msToRun(() => htmlToText("<a".repeat(100000)));
      expect(ms).toBeLessThan(1000);
    },
    60000,
  );

  it(
    "converts a 2 MB body — the fetch cap — in well under a second",
    () => {
      const ms = msToRun(() => htmlToText("<".repeat(2 * 1024 * 1024)));
      expect(ms).toBeLessThan(1000);
    },
    60000,
  );

  it("still produces the same text for ordinary markup", () => {
    // The expected value is the output MEASURED from the pre-fix code, not a
    // tidier string: "</div>" becomes "\n" and the following "<p>" becomes " ",
    // so the leading space on line two is existing behaviour the fix must keep.
    expect(htmlToText("<div>Hello <b>world</b></div><p>Second</p>")).toBe("Hello world\n Second");
  });
});

describe("fetchUrlContent — caps the fetched body", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stops reading past ~2 MB instead of buffering an unbounded response", async () => {
    // 8 MB of markup, streamed in 256 KB chunks. If the cap were missing, the
    // whole thing would be decoded and scanned.
    const body = `<html><head><title>Big</title></head><body><p>${"x".repeat(8 * 1024 * 1024)}</p></body></html>`;
    const fetchMock = vi.fn(async () =>
      htmlResponse(body, "https://board.example.com/job/1", 256 * 1024),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchUrlContent("https://board.example.com/job/1", { maxChars: 50 });

    expect(r.error).toBeUndefined();
    expect(r.description.length).toBeLessThanOrEqual(51); // maxChars + the ellipsis
  }, 60000);
});
