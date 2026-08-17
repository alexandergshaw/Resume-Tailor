// The collector: fan out to every public feed the watchlist implies, isolate
// each one's failure, and perform the joins that make this briefing worth
// reading - marking an advisory CISA says is being exploited right now, and
// not reporting the same CVE twice under two different ids.
//
// Written before lib/techwatch/collect.js exists.
//
// The fetch layer is stubbed by URL and every stub returns a REAL fixture, so
// the real parsers run against real payloads and the joins are tested with the
// real producer's output rather than a hand-built idea of it. Two halves tested
// against different assumptions is exactly how a feature ships inert.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectTechWatch, SOURCE_CACHE_TTL_SECONDS, OSV_LOOKBACK_HOURS } from "./collect.js";
import { parseOsvVulns } from "./sources/osv.js";
import { __resetMemoryCache } from "./cache.js";

const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./sources/__fixtures__/${name}`, import.meta.url)), "utf8"));

const STATUSPAGE = fixture("statuspage.github.json");
const OSV = fixture("osv.next.json");
const KEV = fixture("kev.json");
const EOL = fixture("endoflife.json");

const NOW = new Date("2026-08-17T15:30:00.000Z");
const WIDE = 24 * 365 * 6; // six years, so the fixtures' own dates are all in range

const GITHUB = {
  id: "github",
  label: "GitHub",
  osv: null,
  eol: null,
  statuspage: { host: "www.githubstatus.com", vendor: "GitHub" },
  kev: null,
  detectedVersions: [],
};

const NEXTJS = {
  id: "nextjs",
  label: "Next.js",
  osv: { name: "next", ecosystem: "npm" },
  eol: "nextjs",
  statuspage: null,
  kev: null,
  detectedVersions: ["14.2.3"],
};

const TYPESCRIPT = {
  id: "typescript",
  label: "TypeScript",
  osv: { name: "typescript", ecosystem: "npm" },
  eol: null,
  statuspage: null,
  kev: null,
  detectedVersions: [],
};

// Routes by URL to the matching fixture. `kevJson` and `osvJson` are swappable
// so the joins can be driven from CVEs the real fixtures actually carry.
function makeFetch({ kevJson = KEV, osvJson = OSV, fail = () => null } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    const forced = fail(u);
    if (forced === "throw") throw new Error(`refused: ${u}`);
    if (forced === "down") return { ok: false, status: 503, json: async () => ({}) };
    if (forced === "notfound") return { ok: false, status: 404, json: async () => ({}) };
    if (u.includes("scheduled-maintenances")) return { ok: true, status: 200, json: async () => ({ scheduled_maintenances: [] }) };
    if (u.includes("githubstatus.com")) return { ok: true, status: 200, json: async () => STATUSPAGE };
    if (u.includes("api.osv.dev")) return { ok: true, status: 200, json: async () => osvJson };
    if (u.includes("cisa.gov")) return { ok: true, status: 200, json: async () => kevJson };
    if (u.includes("endoflife.date/api/nextjs")) return { ok: true, status: 200, json: async () => EOL.nextjs };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

// A pass-through cache so collection is exercised without Redis. Records the
// keys and TTLs it was asked for.
function makeCache() {
  const calls = [];
  const impl = async (key, ttl, producer) => {
    calls.push({ key, ttl });
    return producer();
  };
  impl.calls = calls;
  return impl;
}

const sourceById = (result, id) => result.sources.find((s) => s.id === id);
const collect = (over = {}) =>
  collectTechWatch({ now: NOW, windowHours: WIDE, fetchImpl: makeFetch(), cacheImpl: makeCache(), ...over });

let cacheImpl;
beforeEach(() => {
  cacheImpl = makeCache();
});

describe("collectTechWatch", () => {
  it("returns items from every configured source for the watchlist", async () => {
    const result = await collect({ entries: [GITHUB, NEXTJS], cacheImpl });
    const sourceIds = new Set(result.items.map((i) => i.sourceId));
    // One positive assertion per contributing source: "we got some items"
    // would pass with any of them silently contributing nothing.
    expect(sourceIds.has("statuspage")).toBe(true);
    expect(sourceIds.has("osv")).toBe(true);
    expect(sourceIds.has("endoflife")).toBe(true);
    expect(result.lifecycle.some((r) => r.technologyId === "nextjs")).toBe(true);
    // The CISA feed is global and always read, even when no watched
    // technology has a vendor matcher - it still drives the cross-mark. A
    // typo in its URL would otherwise leave the join permanently inert and
    // completely invisible.
    expect(sourceById(result, "kev")).toBeTruthy();
    expect(sourceById(result, "kev").ok).toBe(true);
  });

  it("hands back items already sorted newest-first", async () => {
    const result = await collect({ entries: [GITHUB, NEXTJS], cacheImpl });
    // A single item, or none, is trivially sorted.
    expect(result.items.length).toBeGreaterThan(3);
    const times = result.items.map((i) => Date.parse(i.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe("collectTechWatch - the exploited-in-the-wild cross-mark", () => {
  it("marks an advisory as actively exploited when CISA lists its CVE", async () => {
    // CVE-2026-44575 is a real alias of GHSA-267c-6grr-h53f in the OSV
    // fixture; here CISA's catalogue is made to carry that same CVE. This is
    // THE behavior that turns "an advisory exists" into "you are being
    // attacked through this today".
    const baseline = parseOsvVulns(OSV, { entry: NEXTJS, now: NOW, windowHours: WIDE }).find((i) =>
      i.cveIds.includes("CVE-2026-44575"),
    );
    expect(baseline.exploited).toBe(false);
    expect(baseline.severity).toBe("high");

    const kevJson = { vulnerabilities: [{ ...KEV.vulnerabilities[0], cveID: "CVE-2026-44575", dateAdded: "2026-08-16" }] };
    const result = await collect({ entries: [NEXTJS], fetchImpl: makeFetch({ kevJson }), cacheImpl });
    const marked = result.items.find((i) => i.id === baseline.id);
    expect(marked).toBeTruthy();
    expect(marked.exploited).toBe(true);
    expect(marked.severity).toBe("critical");
    expect(marked.exploitedAt).toBe("2026-08-16");
  });

  it("surfaces an OLD advisory that CISA listed today, inside a 24-hour window", async () => {
    // This is the test that stops the cross-mark shipping inert. OSV items
    // are window-filtered on `published`, CISA typically lists a CVE months
    // later, and the UI's longest window is 7 days - so without widening the
    // OSV lookback and re-dating to the KEV date, the join could essentially
    // never fire in production while its mechanism test stayed green.
    expect(OSV_LOOKBACK_HOURS).toBeGreaterThan(24 * 365);

    const oldAdvisory = OSV.vulns.find((v) => v.id === "GHSA-223j-4rm8-mrmf");
    expect(oldAdvisory.published.startsWith("2025-04")).toBe(true); // really is old

    const kevJson = {
      vulnerabilities: [{ ...KEV.vulnerabilities[0], cveID: "CVE-2025-30218", dateAdded: "2026-08-17" }],
    };
    const result = await collect({
      entries: [NEXTJS],
      windowHours: 24,
      fetchImpl: makeFetch({ kevJson }),
      cacheImpl,
    });
    const marked = result.items.find((i) => i.cveIds.includes("CVE-2025-30218"));
    expect(marked).toBeTruthy();
    expect(marked.exploited).toBe(true);
    expect(marked.occurredAt).toBe("2026-08-17T00:00:00.000Z");
    expect(marked.timePrecision).toBe("day");
    expect(marked.exploitedAt).toBe("2026-08-17");
    // Its own advisory text survives the re-dating - the point is to
    // resurface it, not to replace it with the CISA row.
    expect(marked.rootCause).toContain("In the process of remediating");
  });

  it("leaves an advisory CISA has not listed alone", async () => {
    const result = await collect({ entries: [NEXTJS], cacheImpl });
    const untouched = result.items.find((i) => i.cveIds.includes("CVE-2026-44575"));
    expect(untouched.exploited).toBe(false);
    expect(untouched.severity).toBe("high");
    expect(untouched.exploitedAt).toBeNull();
  });

  it("never lowers a severity when cross-marking", async () => {
    const kevJson = { vulnerabilities: [{ ...KEV.vulnerabilities[0], cveID: "CVE-2025-30218" }] };
    const result = await collect({ entries: [NEXTJS], fetchImpl: makeFetch({ kevJson }), cacheImpl });
    // CVE-2025-30218 is severity "low" in the OSV fixture. Being exploited
    // makes it worse, never better.
    const marked = result.items.find((i) => i.cveIds.includes("CVE-2025-30218"));
    expect(marked.severity).toBe("critical");
  });

  it("fetches the CISA catalogue once no matter how many technologies are watched", async () => {
    const fetchImpl = makeFetch();
    await collect({ entries: [GITHUB, NEXTJS, TYPESCRIPT], fetchImpl, cacheImpl });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("cisa.gov"))).toHaveLength(1);
  });
});

describe("collectTechWatch - cross-source merge", () => {
  // A technology CISA names by vendor AND that has a package feed: both
  // sources describe the same CVE under different ids.
  const TOMCAT = {
    id: "tomcat",
    label: "Apache Tomcat",
    osv: { name: "org.apache.tomcat:tomcat", ecosystem: "Maven" },
    eol: null,
    statuspage: null,
    kev: ["tomcat"],
    detectedVersions: [],
  };

  const osvJson = {
    vulns: [
      {
        id: "GHSA-tomcat-1",
        summary: "Apache Tomcat path traversal",
        details: "### Impact\n\nA crafted request escapes the web root.\n\n### Workarounds\n\nBlock the path prefix at the proxy.",
        aliases: ["CVE-2026-34486"],
        published: "2026-08-06T09:15:00Z",
        database_specific: { severity: "HIGH" },
        references: [{ type: "ADVISORY", url: "https://nvd.nist.gov/vuln/detail/CVE-2026-34486" }],
        affected: [{ package: { name: "org.apache.tomcat:tomcat", ecosystem: "Maven" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "11.0.4" }] }] }],
      },
    ],
  };

  it("reports one card, not two, when OSV and CISA describe the same CVE", async () => {
    const result = await collect({
      entries: [TOMCAT],
      windowHours: 24 * 30,
      fetchImpl: makeFetch({ osvJson }),
      cacheImpl,
    });
    const forCve = result.items.filter((i) => i.cveIds.includes("CVE-2026-34486"));
    expect(forCve).toHaveLength(1);
  });

  it("keeps the best of both sources on the surviving card", async () => {
    const result = await collect({
      entries: [TOMCAT],
      windowHours: 24 * 30,
      fetchImpl: makeFetch({ osvJson }),
      cacheImpl,
    });
    const [merged] = result.items.filter((i) => i.cveIds.includes("CVE-2026-34486"));
    expect(merged.exploited).toBe(true);
    expect(merged.severity).toBe("critical");
    // The workaround exists only in the OSV body; the required action exists
    // only in the CISA row. Losing either half is the failure this guards.
    expect(merged.workaround).toContain("Block the path prefix at the proxy");
    expect(merged.remedy.length).toBeGreaterThan(0);
    expect(merged.sources.length).toBeGreaterThan(1);
  });
});

describe("collectTechWatch - failure isolation and honesty", () => {
  it("keeps every other source's items when one source is down", async () => {
    const fetchImpl = makeFetch({ fail: (url) => (url.includes("api.osv.dev") ? "down" : null) });
    const result = await collect({ entries: [GITHUB, NEXTJS], fetchImpl, cacheImpl });
    expect(result.items.some((i) => i.sourceId === "statuspage")).toBe(true);
    expect(sourceById(result, "osv:nextjs").ok).toBe(false);
    expect(String(sourceById(result, "osv:nextjs").error)).toContain("503");
  });

  it("records a source that threw as a failure rather than letting it vanish", async () => {
    // runWithConcurrency swallows a worker's throw, so a worker that does
    // not catch its own errors would silently disappear from `sources` and
    // the UI would report a complete briefing that was missing a feed.
    const exploding = async (key, ttl, producer) => {
      if (String(key).includes("statuspage:github")) throw new Error("cache exploded");
      return producer();
    };
    const result = await collect({ entries: [GITHUB, NEXTJS], cacheImpl: exploding });
    const row = sourceById(result, "statuspage:github");
    expect(row).toBeTruthy();
    expect(row.ok).toBe(false);
    expect(String(row.error)).toContain("cache exploded");
    expect(result.items.some((i) => i.sourceId === "osv")).toBe(true);
  });

  it("reports every REMOTE source as failed when every source is down", async () => {
    const fetchImpl = makeFetch({ fail: () => "down" });
    const result = await collect({ entries: [GITHUB, NEXTJS], fetchImpl, cacheImpl });
    expect(result.items).toEqual([]);
    // Only rows with `note: null` represent an actual remote read. GitHub has
    // no package feed and no lifecycle feed, so those rows are `ok: true`
    // placeholders and would make a blanket `every(ok === false)` unsatisfiable.
    const remote = result.sources.filter((s) => s.note === null);
    expect(remote.length).toBeGreaterThan(0);
    expect(remote.every((s) => s.ok === false)).toBe(true);
  });

  it("names a technology with no lifecycle feed instead of implying all-clear", async () => {
    const result = await collect({ entries: [TYPESCRIPT], cacheImpl });
    const row = sourceById(result, "endoflife:typescript");
    expect(row).toBeTruthy();
    expect(row.ok).toBe(true);
    expect(row.itemCount).toBe(0);
    expect(row.note).toBe("no lifecycle feed");
    expect(row.technologyId).toBe("typescript");
  });

  it("distinguishes 'not configured' from 'unreachable' on note, never on ok", async () => {
    const result = await collect({ entries: [GITHUB], cacheImpl });
    // GitHub has a status page but no package or lifecycle feed.
    expect(sourceById(result, "statuspage:github").note).toBeNull();
    expect(sourceById(result, "osv:github").note).toBe("no package feed");
    expect(sourceById(result, "osv:github").ok).toBe(true);
    expect(sourceById(result, "endoflife:github").note).toBe("no lifecycle feed");
    expect(sourceById(result, "endoflife:github").ok).toBe(true);
  });

  it("carries a source's own note through to its row instead of reporting a failure", async () => {
    // A vendor that serves incidents but 404s on scheduled-maintenances (real
    // case: status.hashicorp.com) is not unreachable - it publishes no such
    // feed. The adapter says so via `note`, and the collector must not
    // overwrite that with its own computed value.
    const fetchImpl = makeFetch({
      fail: (url) => (url.includes("scheduled-maintenances") ? "notfound" : null),
    });
    const result = await collect({ entries: [GITHUB], fetchImpl, cacheImpl });
    const maint = sourceById(result, "statuspage-maint:github");
    expect(maint).toBeTruthy();
    expect(maint.ok).toBe(true);
    expect(maint.note).toBe("no maintenance feed");
    expect(maint.error).toBeNull();
    // The incidents feed on the same vendor is untouched and still reports.
    expect(sourceById(result, "statuspage:github").note).toBeNull();
    expect(sourceById(result, "statuspage:github").ok).toBe(true);
  });

  it("gives every source entry a technology-bearing label the UI can print", async () => {
    const result = await collect({ entries: [GITHUB, NEXTJS, TYPESCRIPT], cacheImpl });
    for (const source of result.sources) {
      expect(typeof source.label).toBe("string");
      expect(source.label.length).toBeGreaterThan(0);
      expect(typeof source.itemCount).toBe("number");
      expect(source).toHaveProperty("ok");
      expect(source).toHaveProperty("error");
      expect(source).toHaveProperty("note");
    }
    expect(sourceById(result, "statuspage:github").label).toContain("GitHub");
    expect(sourceById(result, "endoflife:typescript").label).toContain("TypeScript");
  });
});

describe("collectTechWatch - caching and hygiene", () => {
  it("de-duplicates items that arrive with the same id", async () => {
    const dupOsv = { vulns: [...OSV.vulns, OSV.vulns[0]] };
    const result = await collect({
      entries: [{ ...NEXTJS, eol: null }],
      fetchImpl: makeFetch({ osvJson: dupOsv }),
      cacheImpl,
    });
    const ids = result.items.map((i) => i.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain("osv:nextjs:GHSA-223j-4rm8-mrmf");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("routes every remote read through the cache at the shared TTL", async () => {
    await collect({ entries: [GITHUB, NEXTJS], cacheImpl });
    expect(cacheImpl.calls.length).toBeGreaterThan(0);
    for (const call of cacheImpl.calls) {
      expect(call.ttl).toBe(SOURCE_CACHE_TTL_SECONDS);
      expect(typeof call.key).toBe("string");
      expect(call.key.length).toBeGreaterThan(0);
    }
    expect(SOURCE_CACHE_TTL_SECONDS).toBe(600);
  });

  it("keys the cache by feed only, never by user", async () => {
    // These feeds are byte-identical for every user; a per-user key would
    // multiply the outbound fan-out by the user count for no benefit. Note
    // that asserting key UNIQUENESS would not catch that at all - per-user
    // keys are unique too.
    const first = makeCache();
    await collect({ entries: [GITHUB, NEXTJS], cacheImpl: first });
    const second = makeCache();
    await collect({ entries: [GITHUB, NEXTJS], cacheImpl: second });
    expect(second.calls.map((c) => c.key)).toEqual(first.calls.map((c) => c.key));
    for (const call of first.calls) {
      expect(call.key.startsWith("techwatch:")).toBe(true);
      expect(call.key).not.toMatch(/user/i);
    }
    expect(first.calls.map((c) => c.key)).toContain("techwatch:kev");
  });

  it("works when the caller supplies no cache implementation, which is how the route calls it", async () => {
    // Every other test in this file injects `cacheImpl`, so a missing DEFAULT
    // is invisible to all of them - and fatal in production. The route calls
    // `collectTechWatch({ entries, now, windowHours })` and nothing else; with
    // no default, every single source fails with "cacheImpl is not a function"
    // and the briefing renders empty with 41 failed sources. Found by running
    // the real collector against the real feeds, not by any unit test.
    //
    // `fetchImpl` is still injected here so this stays a hermetic test - it is
    // the CACHE default under test, not the network.
    __resetMemoryCache();
    const result = await collectTechWatch({
      entries: [NEXTJS],
      now: NOW,
      windowHours: WIDE,
      fetchImpl: makeFetch(),
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.sources.some((s) => s.ok && s.itemCount > 0)).toBe(true);
    for (const source of result.sources) {
      expect(String(source.error ?? "")).not.toContain("is not a function");
    }
    __resetMemoryCache();
  });

  it("never throws and always returns the full result shape", async () => {
    for (const entries of [[], null, undefined]) {
      const result = await collect({ entries, cacheImpl: makeCache() });
      expect(Array.isArray(result.items)).toBe(true);
      expect(Array.isArray(result.lifecycle)).toBe(true);
      expect(Array.isArray(result.sources)).toBe(true);
    }
  });
});
