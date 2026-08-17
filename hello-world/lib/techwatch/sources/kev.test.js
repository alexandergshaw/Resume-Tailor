// CISA's Known Exploited Vulnerabilities catalogue - the "found exploits"
// half of the briefing. Written before lib/techwatch/sources/kev.js exists.
//
// __fixtures__/kev.json is a REAL trimmed slice of the live feed, captured
// 2026-08-17 (the full feed is 1666 entries / ~1.6 MB).
//
// KEV names vendors the way a procurement department does - "Apache",
// "Microsoft", "Atlassian" - and never names a JavaScript framework. That is
// why this source has two jobs: direct matches for the infrastructure a user
// runs, and `kevCveSet`, which is how an OSV advisory for `next` finds out it
// is being exploited in the wild. The second job is the valuable one and it
// is deliberately independent of vendor naming.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseKevCatalog, kevCveSet, fetchKevCatalog } from "./kev.js";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/kev.json", import.meta.url)), "utf8"),
);

const NOW = new Date("2026-08-17T15:30:00.000Z");

const TOMCAT = { id: "tomcat", label: "Apache Tomcat", kev: ["tomcat"] };
const REACT = { id: "react", label: "React", kev: null };

describe("parseKevCatalog", () => {
  it("matches an entry against the vendor and product fields", () => {
    const items = parseKevCatalog(FIXTURE, {
      entries: [TOMCAT],
      now: NOW,
      windowHours: 24 * 30,
    });
    expect(items.map((i) => i.id)).toEqual(["kev:tomcat:CVE-2026-34486"]);
    expect(items[0].technology).toBe("Apache Tomcat");
  });

  it("never matches an entry with no kev matchers", () => {
    const items = parseKevCatalog(FIXTURE, { entries: [REACT], now: NOW, windowHours: 24 * 365 });
    expect(items).toEqual([]);
    // Positive control against the same fixture and window, so an
    // always-empty parser cannot pass this pair.
    const matched = parseKevCatalog(FIXTURE, { entries: [TOMCAT], now: NOW, windowHours: 24 * 365 });
    expect(matched.length).toBeGreaterThan(0);
  });

  it("marks every KEV item as exploited and dated to the day, not the hour", () => {
    const [item] = parseKevCatalog(FIXTURE, { entries: [TOMCAT], now: NOW, windowHours: 24 * 30 });
    expect(item.exploited).toBe(true);
    expect(item.category).toBe("vulnerability");
    expect(item.status).toBe("exploited");
    expect(item.occurredAt).toBe("2026-08-04T00:00:00.000Z");
    expect(item.exploitedAt).toBe("2026-08-04");
    expect(item.timePrecision).toBe("day");
  });

  it("carries CISA's own description as the root cause and its required action as the remedy", () => {
    const [item] = parseKevCatalog(FIXTURE, { entries: [TOMCAT], now: NOW, windowHours: 24 * 30 });
    expect(item.rootCause.length).toBeGreaterThan(20);
    expect(item.remedy).toContain("Apply mitigations");
    expect(item.cveIds).toEqual(["CVE-2026-34486"]);
  });

  it("rates a known ransomware campaign critical and everything else high", () => {
    const base = FIXTURE.vulnerabilities.find((v) => v.cveID === "CVE-2026-34486");
    const known = { ...base, cveID: "CVE-2026-00001", knownRansomwareCampaignUse: "Known" };
    const unknown = { ...base, cveID: "CVE-2026-00002", knownRansomwareCampaignUse: "Unknown" };
    const items = parseKevCatalog(
      { vulnerabilities: [known, unknown] },
      { entries: [TOMCAT], now: NOW, windowHours: 24 * 30 },
    );
    const sev = Object.fromEntries(items.map((i) => [i.cveIds[0], i.severity]));
    expect(sev["CVE-2026-00001"]).toBe("critical");
    expect(sev["CVE-2026-00002"]).toBe("high");
  });

  it("pulls every documentation link out of the semicolon-separated notes field", () => {
    const base = FIXTURE.vulnerabilities.find((v) => v.cveID === "CVE-2026-34486");
    const [item] = parseKevCatalog(
      { vulnerabilities: [base] },
      { entries: [TOMCAT], now: NOW, windowHours: 24 * 30 },
    );
    expect(item.sources.length).toBeGreaterThanOrEqual(2);
    for (const s of item.sources) {
      expect(s.url).toMatch(/^https?:\/\//);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.label).not.toMatch(/^https?:/); // labelled by host, not the raw url
    }
    expect(item.sources.length).toBeLessThanOrEqual(4);
  });

  it("keeps an entry CISA post-dated into the future", () => {
    // The live feed really does carry dateAdded values a day ahead of
    // dateReleased; dropping them would hide the newest exploit in the
    // catalogue on the day it matters most.
    const ray = { id: "ray", label: "Ray", kev: ["ray"] };
    const items = parseKevCatalog(FIXTURE, { entries: [ray], now: NOW, windowHours: 24 });
    expect(items.map((i) => i.cveIds[0])).toEqual(["CVE-2025-62593"]);
  });

  it("drops entries added before the window", () => {
    const items = parseKevCatalog(FIXTURE, { entries: [TOMCAT], now: NOW, windowHours: 24 });
    expect(items).toEqual([]);
  });

  it("matches on word boundaries, so Ray does not match array", () => {
    const json = {
      vulnerabilities: [
        { ...FIXTURE.vulnerabilities[0], cveID: "CVE-2026-11111", vendorProject: "Arrayed", product: "Xray toolkit" },
      ],
    };
    expect(parseKevCatalog(json, { entries: [{ id: "ray", label: "Ray", kev: ["ray"] }], now: NOW, windowHours: 24 * 365 })).toEqual([]);
  });

  it("emits one item per technology+CVE pair even when the feed repeats a row", () => {
    // The real feed can list the same CVE twice; two identical ids would
    // render the same card twice in the same hour.
    const dup = FIXTURE.vulnerabilities.filter((v) => v.cveID === "CVE-2026-68820");
    expect(dup.length).toBeGreaterThan(1); // the fixture really does repeat it
    const items = parseKevCatalog(
      { vulnerabilities: dup },
      { entries: [{ id: "windows", label: "Windows", kev: ["windows"] }], now: NOW, windowHours: 24 * 365 },
    );
    expect(items.map((i) => i.id)).toEqual(["kev:windows:CVE-2026-68820"]);
  });

  it("returns an empty array for a malformed payload instead of throwing", () => {
    for (const json of [null, undefined, {}, { vulnerabilities: null }, { vulnerabilities: 7 }]) {
      expect(parseKevCatalog(json, { entries: [TOMCAT], now: NOW, windowHours: 24 })).toEqual([]);
    }
  });
});

describe("kevCveSet", () => {
  it("maps every CVE id in the feed to the date CISA catalogued it", () => {
    // A Map, not a Set: the cross-mark in collect.js re-dates an advisory to
    // the day it became known-exploited, which is the news. Membership alone
    // is not enough information to do that.
    const map = kevCveSet(FIXTURE);
    expect(map).toBeInstanceOf(Map);
    expect(map.get("CVE-2026-34486")).toBe("2026-08-04");
    expect(map.get("CVE-2025-62593")).toBe("2026-08-18");
    // The 2026-07-14 entries are far outside any window the UI offers; the
    // cross-mark still has to know about them, because an advisory published
    // today can name a CVE catalogued weeks ago - and, more importantly, an
    // advisory published years ago can be catalogued today.
    expect(map.get("CVE-2026-56155")).toBe("2026-07-14");
    expect(map.has("CVE-9999-00000")).toBe(false);
    expect(map.size).toBeGreaterThan(5);
  });

  it("returns an empty map for a malformed payload instead of throwing", () => {
    expect(kevCveSet(null).size).toBe(0);
    expect(kevCveSet({}).size).toBe(0);
  });
});

describe("fetchKevCatalog", () => {
  it("fetches CISA's published feed once and hands back the parsed json", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => FIXTURE });
    const result = await fetchKevCatalog({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    );
    expect(result.ok).toBe(true);
    expect(result.json.vulnerabilities.length).toBe(FIXTURE.vulnerabilities.length);
  });

  it("reports failure without throwing", async () => {
    const bad = await fetchKevCatalog({
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    });
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toContain("404");

    const thrown = await fetchKevCatalog({
      fetchImpl: vi.fn().mockRejectedValue(new Error("aborted")),
    });
    expect(thrown.ok).toBe(false);
    expect(String(thrown.error)).toContain("aborted");
  });
});
