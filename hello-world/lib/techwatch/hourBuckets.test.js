// Hour-by-hour bucketing - the shape of the briefing the user actually asked
// for. Written before lib/techwatch/hourBuckets.js exists.
//
// Bucketing is in UTC and labelling is local, deliberately: a bucket `key`
// that depended on the machine's zone would make every test here pass or fail
// according to where it ran, and would make two users disagree about which
// hour an incident belongs to.

import { describe, it, expect } from "vitest";
import { bucketByHour, summarize, formatHourLabel } from "./hourBuckets.js";
import { normalizeItem } from "./item.js";

const NOW = new Date("2026-08-17T15:30:00.000Z");

function item({ id, at, severity = "info", category = "outage", title = "T" }) {
  return normalizeItem({
    id,
    sourceId: "statuspage",
    category,
    severity,
    title,
    technologyId: "github",
    technology: "GitHub",
    occurredAt: at,
  });
}

describe("bucketByHour", () => {
  it("groups items into UTC hour buckets, newest bucket first", () => {
    const items = [
      item({ id: "a", at: "2026-08-17T13:05:00Z" }),
      item({ id: "b", at: "2026-08-17T15:01:00Z" }),
      item({ id: "c", at: "2026-08-17T15:59:00Z" }),
      item({ id: "d", at: "2026-08-17T14:30:00Z" }),
    ];
    const buckets = bucketByHour(items, { now: NOW, windowHours: 24 });
    expect(buckets.map((b) => b.key)).toEqual([
      "2026-08-17T15",
      "2026-08-17T14",
      "2026-08-17T13",
    ]);
    expect(buckets[0].startsAt).toBe("2026-08-17T15:00:00.000Z");
    expect(buckets[0].endsAt).toBe("2026-08-17T16:00:00.000Z");
  });

  it("omits hours with nothing in them rather than rendering empty gaps", () => {
    const items = [
      item({ id: "a", at: "2026-08-17T15:05:00Z" }),
      item({ id: "b", at: "2026-08-17T09:05:00Z" }),
    ];
    const buckets = bucketByHour(items, { now: NOW, windowHours: 24 });
    // Assert the exact resolved list. "length === 2" alone would also pass
    // against an implementation that emitted the wrong two hours.
    expect(buckets.map((b) => b.key)).toEqual(["2026-08-17T15", "2026-08-17T09"]);
  });

  it("sorts items inside a bucket worst-severity first", () => {
    const items = [
      item({ id: "info", at: "2026-08-17T15:10:00Z", severity: "info" }),
      item({ id: "crit", at: "2026-08-17T15:10:00Z", severity: "critical" }),
      item({ id: "med", at: "2026-08-17T15:10:00Z", severity: "medium" }),
    ];
    const [bucket] = bucketByHour(items, { now: NOW, windowHours: 24 });
    expect(bucket.items.map((i) => i.id)).toEqual(["crit", "med", "info"]);
  });

  it("drops items older than the window", () => {
    const items = [
      item({ id: "keep", at: "2026-08-17T15:05:00Z" }),
      item({ id: "drop", at: "2026-08-14T15:05:00Z" }),
    ];
    const buckets = bucketByHour(items, { now: NOW, windowHours: 24 });
    const ids = buckets.flatMap((b) => b.items.map((i) => i.id));
    // Positive control alongside the absence check: a bucketer that returned
    // nothing at all would satisfy "drop is absent" on its own.
    expect(ids).toEqual(["keep"]);
  });

  it("buckets a day-precision item at its 00 hour without special-casing it", () => {
    const eol = normalizeItem({
      id: "endoflife:react:17",
      sourceId: "endoflife",
      category: "lifecycle",
      severity: "high",
      title: "React 17 reached end of active support",
      technologyId: "react",
      technology: "React",
      occurredAt: "2026-08-17T00:00:00.000Z",
      timePrecision: "day",
    });
    const buckets = bucketByHour([eol], { now: NOW, windowHours: 24 });
    expect(buckets.map((b) => b.key)).toEqual(["2026-08-17T00"]);
    expect(buckets[0].items[0].timePrecision).toBe("day");
  });

  it("returns an empty array for no items, and does not throw on junk input", () => {
    expect(bucketByHour([], { now: NOW, windowHours: 24 })).toEqual([]);
    expect(bucketByHour([null, undefined], { now: NOW, windowHours: 24 })).toEqual([]);
  });
});

describe("summarize", () => {
  it("counts by category over the items given, and reports the worst severity present", () => {
    const items = [
      item({ id: "1", at: "2026-08-17T15:00:00Z", category: "outage", severity: "medium" }),
      item({ id: "2", at: "2026-08-17T15:00:00Z", category: "outage", severity: "high" }),
      item({ id: "3", at: "2026-08-17T15:00:00Z", category: "vulnerability", severity: "critical" }),
      item({ id: "4", at: "2026-08-17T15:00:00Z", category: "lifecycle", severity: "low" }),
    ];
    expect(summarize(items)).toEqual({
      total: 4,
      outage: 2,
      vulnerability: 1,
      lifecycle: 1,
      exploited: 0,
      worstSeverity: "critical",
    });
  });

  it("counts exploited items separately from their category", () => {
    const exploited = normalizeItem({
      id: "kev:nextjs:CVE-2025-1",
      sourceId: "kev",
      category: "vulnerability",
      severity: "critical",
      title: "Actively exploited",
      technologyId: "nextjs",
      technology: "Next.js",
      occurredAt: "2026-08-17T00:00:00Z",
      exploited: true,
    });
    const s = summarize([exploited]);
    expect(s.vulnerability).toBe(1);
    expect(s.exploited).toBe(1);
  });

  it("reports worstSeverity null for an empty list", () => {
    expect(summarize([])).toEqual({
      total: 0,
      outage: 0,
      vulnerability: 0,
      lifecycle: 0,
      exploited: 0,
      worstSeverity: null,
    });
  });
});

describe("formatHourLabel", () => {
  const bucket = {
    key: "2026-08-17T15",
    startsAt: "2026-08-17T15:00:00.000Z",
    endsAt: "2026-08-17T16:00:00.000Z",
    items: [],
  };

  it("renders a 24-hour range and marks the current day as Today", () => {
    const label = formatHourLabel(bucket, { now: NOW, timeZone: "UTC" });
    expect(label).toContain("15:00");
    expect(label).toContain("16:00");
    expect(label).toContain("Today");
  });

  it("uses a 24-hour clock even under a locale whose default is 12-hour", () => {
    // The default locale on a US machine formats 15:00Z as "03:00 PM". An
    // implementation that reaches for toLocaleTimeString without pinning the
    // hour cycle passes on en-GB and fails on en-US - so the clock format is
    // fixed by the contract, and only the day and month names follow locale.
    for (const locale of ["en-US", "en-GB", "de-DE", "ja-JP"]) {
      const label = formatHourLabel(bucket, { now: NOW, timeZone: "UTC", locale });
      expect(label).toContain("15:00");
      expect(label).toContain("16:00");
      expect(label).not.toMatch(/\b(AM|PM|am|pm)\b/);
    }
  });

  it("names the date instead of Today for an earlier day", () => {
    const earlier = {
      ...bucket,
      key: "2026-08-16T09",
      startsAt: "2026-08-16T09:00:00.000Z",
      endsAt: "2026-08-16T10:00:00.000Z",
    };
    const label = formatHourLabel(earlier, { now: NOW, timeZone: "UTC", locale: "en-GB" });
    expect(label).not.toContain("Today");
    // Pin the hours too. Asserting only that a "16" appears somewhere would
    // pass against a label that returned the raw key, or an off-by-one that
    // rendered "09:00 - 16:00".
    expect(label).toContain("09:00");
    expect(label).toContain("10:00");
    expect(label).toMatch(/16 Aug|Aug 16/);
  });

  it("renders in the requested time zone, not the machine's", () => {
    const label = formatHourLabel(bucket, { now: NOW, timeZone: "Asia/Tokyo", locale: "en-GB" });
    // 15:00Z is midnight in Tokyo on the following day. Asserting "00:00"
    // alone would also pass against a label that echoed startsAt verbatim,
    // and against a label that never left UTC - hence both bounds and the
    // explicit absence of the UTC hours.
    expect(label).toContain("00:00");
    expect(label).toContain("01:00");
    expect(label).not.toContain("15:00");
    expect(label).not.toContain("2026-08-17T15");
    // `now` is 00:30 on 18 August in Tokyo, so this bucket IS today there -
    // "today" has to be decided in the display zone, not in UTC.
    expect(label).toContain("Today");
  });

  it("falls back to UTC on an invalid time zone instead of throwing", () => {
    expect(() => formatHourLabel(bucket, { now: NOW, timeZone: "Not/AZone" })).not.toThrow();
    expect(formatHourLabel(bucket, { now: NOW, timeZone: "Not/AZone" })).toContain("15:00");
  });
});
