// Vulnerabilities - and workarounds - from OSV.dev.
// Written before lib/techwatch/sources/osv.js exists.
//
// __fixtures__/osv.next.json is a REAL response for `next` on npm, captured
// 2026-08-17 with `details` intact. Do not truncate it: an earlier capture cut
// `details` to 600 characters, which hid the GitHub advisory template's section
// structure - and that structure is the whole reason this parser can produce a
// workaround at all. 35 of the 64 live advisories for this one package carry an
// explicit "### Workarounds" section.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOsvVulns, fetchOsvVulns } from "./osv.js";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/osv.next.json", import.meta.url)), "utf8"),
);

const NOW = new Date("2026-08-17T15:30:00.000Z");

const ENTRY = { id: "nextjs", label: "Next.js", osv: { name: "next", ecosystem: "npm" } };

// Wide enough to include the 2021 advisory in the fixture.
const WIDE = { entry: ENTRY, now: NOW, windowHours: 24 * 365 * 6 };

const byId = (items, id) => items.find((i) => i.id === `osv:nextjs:${id}`);

describe("parseOsvVulns", () => {
  it("maps every advisory in the fixture inside a wide window", () => {
    const items = parseOsvVulns(FIXTURE, WIDE);
    expect(items.map((i) => i.id).sort()).toEqual([
      "osv:nextjs:GHSA-223j-4rm8-mrmf",
      "osv:nextjs:GHSA-25mp-g6fv-mqxx",
      "osv:nextjs:GHSA-267c-6grr-h53f",
    ]);
  });

  it("uses the advisory summary as the title and its publish time as the hour", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-267c-6grr-h53f");
    expect(item.category).toBe("vulnerability");
    expect(item.title).toBe(
      "Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes",
    );
    expect(item.occurredAt).toBe("2026-05-11T15:54:24.000Z");
    expect(item.timePrecision).toBe("minute");
    expect(item.technology).toBe("Next.js");
    expect(item.exploited).toBe(false);
    expect(item.exploitedAt).toBeNull();
  });

  it("falls back to the advisory id when it has no summary", () => {
    // Every advisory in the fixture has one, so this path is otherwise
    // untested and an implementation with no fallback emits a null title,
    // which normalizeItem rejects - the advisory would vanish silently.
    const vuln = { ...FIXTURE.vulns[0], id: "GHSA-nosummary", summary: undefined };
    const [item] = parseOsvVulns({ vulns: [vuln] }, WIDE);
    expect(item.title).toBe("GHSA-nosummary");
  });

  it.each([
    ["GHSA-223j-4rm8-mrmf", "low"],
    ["GHSA-25mp-g6fv-mqxx", "high"],
    ["GHSA-267c-6grr-h53f", "high"],
  ])("maps %s to severity %s from database_specific", (id, severity) => {
    expect(byId(parseOsvVulns(FIXTURE, WIDE), id).severity).toBe(severity);
  });

  it.each([
    ["CRITICAL", "critical"],
    ["MODERATE", "medium"],
    ["MEDIUM", "medium"],
    [undefined, "info"],
  ])("maps database_specific.severity %s to %s", (upstream, expected) => {
    const vuln = { ...FIXTURE.vulns[0], id: "GHSA-x", database_specific: { severity: upstream } };
    expect(parseOsvVulns({ vulns: [vuln] }, WIDE)[0].severity).toBe(expected);
  });
});

describe("parseOsvVulns - the markdown body", () => {
  it("takes the root cause from the Impact section, not the heading above it", () => {
    // "first paragraph of details" - the obvious reading - yields the literal
    // string "### Impact" for this advisory, because the template puts the
    // heading on its own line.
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-267c-6grr-h53f");
    expect(item.rootCause).not.toMatch(/^#{1,6}\s/);
    expect(item.rootCause).not.toContain("Impact");
    expect(item.rootCause.startsWith("App Router applications that rely on middleware")).toBe(true);
    expect(item.rootCause).toContain("segment prefetching");
  });

  it("takes the root cause from a Summary section when that is the heading used", () => {
    // This advisory separates its heading from its body with a SINGLE
    // newline, so a paragraph splitter that treats the heading block as one
    // paragraph drops the real text and surfaces "Learn more here." instead.
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-223j-4rm8-mrmf");
    expect(item.rootCause).toBe(
      "In the process of remediating CVE-2025-29927, we looked at other possible exploits of Middleware. " +
        "We independently verified this low severity vulnerability in parallel with two reports from " +
        "independent researchers. Learn more here.",
    );
  });

  it("falls back to the first paragraph when the advisory has no headings at all", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-25mp-g6fv-mqxx");
    expect(item.rootCause.startsWith("Next.js is a React framework.")).toBe(true);
    expect(item.rootCause).toContain("invalid or malformed URLs");
  });

  it("flattens markdown links to their text rather than printing a url", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-223j-4rm8-mrmf");
    expect(item.rootCause).toContain("CVE-2025-29927");
    expect(item.rootCause).not.toContain("https://");
    expect(item.rootCause).not.toContain("](");
  });

  it("truncates a long body on a word boundary and marks that it did", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-25mp-g6fv-mqxx");
    expect(item.rootCause.length).toBeLessThanOrEqual(401);
    expect(item.rootCause.endsWith("…")).toBe(true);
    expect(item.rootCause).not.toMatch(/\s…$/); // no space before the ellipsis
  });

  it("extracts the workaround the advisory actually published", () => {
    // The user asked for workarounds specifically. This is the one field no
    // other source in the briefing can supply.
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-267c-6grr-h53f");
    expect(item.workaround).toBe(
      "If you cannot upgrade immediately, enforce authorization in the underlying route or page logic " +
        "instead of relying solely on middleware.",
    );
  });

  it("leaves the workaround blank when the advisory published none", () => {
    // Positive control lives in the test above; these two genuinely have no
    // Workarounds section, so blank is the truth rather than a parser failure.
    const items = parseOsvVulns(FIXTURE, WIDE);
    expect(byId(items, "GHSA-223j-4rm8-mrmf").workaround).toBe("");
    expect(byId(items, "GHSA-25mp-g6fv-mqxx").workaround).toBe("");
  });

  it("leaves the root cause blank when the advisory carries no details at all", () => {
    const vuln = { ...FIXTURE.vulns[0], id: "GHSA-nodetails", details: undefined };
    const [item] = parseOsvVulns({ vulns: [vuln] }, WIDE);
    expect(item.rootCause).toBe("");
    expect(item.workaround).toBe("");
  });
});

describe("parseOsvVulns - remedy and affected range", () => {
  it("builds the remedy from every fixed version the advisory names", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-267c-6grr-h53f");
    expect(item.remedy).toBe("Upgrade to 15.5.16, 16.2.5");
  });

  it("falls back to the Fix section when no fixed version is published", () => {
    const base = FIXTURE.vulns.find((v) => v.id === "GHSA-267c-6grr-h53f");
    const vuln = {
      ...base,
      id: "GHSA-nofix",
      affected: [{ package: { name: "next", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }] }] }],
    };
    const [item] = parseOsvVulns({ vulns: [vuln] }, WIDE);
    expect(item.remedy).toContain("App Router transport variants");
    expect(item.affected).toBe(">= 1.0.0");
  });

  it("says nothing rather than inventing a remedy when there is neither a fix version nor a Fix section", () => {
    const vuln = {
      ...FIXTURE.vulns.find((v) => v.id === "GHSA-25mp-g6fv-mqxx"),
      id: "GHSA-unfixed",
      affected: [{ package: { name: "next", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }] }] }],
    };
    expect(parseOsvVulns({ vulns: [vuln] }, WIDE)[0].remedy).toBe("");
  });

  it("renders the affected range in a form a reader can act on", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-223j-4rm8-mrmf");
    expect(item.affected).toBe(">= 12.3.5, < 12.3.6");
  });

  it("renders an introduced-at-zero range as a plain upper bound", () => {
    const vuln = {
      ...FIXTURE.vulns[0],
      id: "GHSA-zero",
      affected: [{ package: { name: "next", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "14.2.25" }] }] }],
    };
    expect(parseOsvVulns({ vulns: [vuln] }, WIDE)[0].affected).toBe("< 14.2.25");
  });
});

describe("parseOsvVulns - identifiers, links and window", () => {
  it("extracts CVE aliases, uppercased, for the exploited-in-the-wild join", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-223j-4rm8-mrmf");
    expect(item.cveIds).toEqual(["CVE-2025-30218"]);
  });

  it("ignores non-CVE aliases", () => {
    const vuln = { ...FIXTURE.vulns[0], id: "GHSA-alias", aliases: ["GHSA-abcd-efgh-ijkl", "cve-2020-1234", "BIT-next-2020-1234"] };
    expect(parseOsvVulns({ vulns: [vuln] }, WIDE)[0].cveIds).toEqual(["CVE-2020-1234"]);
  });

  it("labels documentation links by reference type", () => {
    const item = byId(parseOsvVulns(FIXTURE, WIDE), "GHSA-223j-4rm8-mrmf");
    expect(item.sources.find((s) => s.url === "https://nvd.nist.gov/vuln/detail/CVE-2025-30218").label).toBe("Advisory");
    expect(item.sources.find((s) => s.url === "https://github.com/vercel/next.js").label).toBe("Package");
    expect(item.sources.find((s) => s.url.startsWith("https://vercel.com/changelog")).label).toBe("vercel.com");
    expect(item.sources).toHaveLength(4);
  });

  it("caps the documentation links at six", () => {
    // The richest advisory in the fixture has 5 references, so an uncapped
    // implementation passes every other test in this file.
    const refs = Array.from({ length: 11 }, (_, i) => ({ type: "WEB", url: `https://example${i}.com/a` }));
    const vuln = { ...FIXTURE.vulns[0], id: "GHSA-manyrefs", references: refs };
    expect(parseOsvVulns({ vulns: [vuln] }, WIDE)[0].sources).toHaveLength(6);
  });

  it("drops advisories published before the window", () => {
    const items = parseOsvVulns(FIXTURE, { entry: ENTRY, now: NOW, windowHours: 24 * 400 });
    expect(items.map((i) => i.id)).toEqual(["osv:nextjs:GHSA-267c-6grr-h53f"]);
  });

  it("returns an empty array for a malformed payload instead of throwing", () => {
    for (const json of [null, undefined, {}, { vulns: null }, { vulns: "nope" }]) {
      expect(parseOsvVulns(json, WIDE)).toEqual([]);
    }
  });
});

describe("fetchOsvVulns", () => {
  it("posts the package coordinates OSV expects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => FIXTURE });
    const result = await fetchOsvVulns({ entry: ENTRY, fetchImpl, now: NOW, windowHours: 24 * 365 * 6 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.osv.dev/v1/query");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ package: { name: "next", ecosystem: "npm" } });
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.error).toBeNull();
  });

  it("makes no request for an entry with no package coordinates", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchOsvVulns({
      entry: { id: "github", label: "GitHub", osv: null },
      fetchImpl,
      now: NOW,
      windowHours: 24,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, items: [], error: null });
  });

  it("reports a non-ok response and a network throw as failures, never throwing", async () => {
    const bad = await fetchOsvVulns({
      entry: ENTRY,
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }),
      now: NOW,
      windowHours: 24,
    });
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toContain("429");

    const thrown = await fetchOsvVulns({
      entry: ENTRY,
      fetchImpl: vi.fn().mockRejectedValue(new Error("socket hang up")),
      now: NOW,
      windowHours: 24,
    });
    expect(thrown.ok).toBe(false);
    expect(String(thrown.error)).toContain("socket hang up");
  });
});
