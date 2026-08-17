// The normalized briefing-item contract every Tech Watch source produces.
//
// Written before lib/techwatch/item.js exists, from the acceptance criteria,
// and asserting observable behavior only. The rules encoded here are the ones
// a later source adapter will silently violate if they are not pinned: a
// half-normalized item (missing arrays, a local-time occurredAt, a
// javascript: documentation link) does not throw anywhere - it just quietly
// produces a briefing that sorts wrong, or a link that runs script.

import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  SEVERITIES,
  FUTURE_TOLERANCE_HOURS,
  normalizeItem,
  severityRank,
  compareItems,
  withinWindow,
} from "./item.js";

const NOW = new Date("2026-08-17T15:30:00.000Z");

function raw(overrides = {}) {
  return {
    id: "osv:nextjs:GHSA-1",
    sourceId: "osv",
    category: "vulnerability",
    severity: "high",
    title: "Next.js leaks a header to external hosts",
    technologyId: "nextjs",
    technology: "Next.js",
    occurredAt: "2026-08-17T14:05:00Z",
    ...overrides,
  };
}

describe("CATEGORIES / SEVERITIES", () => {
  it("names exactly the three briefing categories the panel renders", () => {
    expect(CATEGORIES).toEqual(["outage", "vulnerability", "lifecycle"]);
  });

  it("orders severities worst-first, which severityRank depends on", () => {
    expect(SEVERITIES).toEqual(["critical", "high", "medium", "low", "info"]);
  });
});

describe("normalizeItem", () => {
  it("keeps a well-formed item and fills every optional field with an empty value", () => {
    const item = normalizeItem(raw());
    expect(item).not.toBeNull();
    expect(item.affected).toBe("");
    expect(item.status).toBe("");
    expect(item.summary).toBe("");
    expect(item.rootCause).toBe("");
    expect(item.remedy).toBe("");
    expect(item.workaround).toBe("");
    expect(item.exploited).toBe(false);
    expect(item.exploitedAt).toBeNull();
    expect(item.cveIds).toEqual([]);
    expect(item.sources).toEqual([]);
    expect(item.timePrecision).toBe("minute");
  });

  it("re-emits occurredAt as a UTC ISO string so items are string-comparable", () => {
    // A source that hands back an offset timestamp must not end up sorting
    // against a Z timestamp lexically - "2026-08-17T14:05:00+02:00" is
    // GREATER than "2026-08-17T14:05:00Z" as a string but EARLIER in time.
    const item = normalizeItem(raw({ occurredAt: "2026-08-17T16:05:00+02:00" }));
    expect(item.occurredAt).toBe("2026-08-17T14:05:00.000Z");
  });

  it.each([
    ["a blank title", { title: "   " }],
    ["a missing title", { title: undefined }],
    ["an unparseable occurredAt", { occurredAt: "not a date" }],
    ["a missing occurredAt", { occurredAt: undefined }],
    ["a category outside CATEGORIES", { category: "announcement" }],
    ["a blank id", { id: "" }],
  ])("returns null for %s rather than a partial item", (_label, patch) => {
    expect(normalizeItem(raw(patch))).toBeNull();
  });

  it("coerces an unknown severity to info instead of rejecting the item", () => {
    const item = normalizeItem(raw({ severity: "SEV-1" }));
    expect(item).not.toBeNull();
    expect(item.severity).toBe("info");
  });

  it("coerces an unknown timePrecision to minute", () => {
    expect(normalizeItem(raw({ timePrecision: "fortnight" })).timePrecision).toBe("minute");
    expect(normalizeItem(raw({ timePrecision: "day" })).timePrecision).toBe("day");
  });

  it("drops a non-http documentation link but keeps the item", () => {
    const item = normalizeItem(
      raw({
        sources: [
          { label: "Advisory", url: "https://nvd.nist.gov/vuln/detail/CVE-2025-30218" },
          { label: "Exploit", url: "javascript:alert(1)" },
          { label: "Inline", url: "data:text/html,<script>1</script>" },
          { label: "Blank", url: "" },
        ],
      }),
    );
    expect(item).not.toBeNull();
    // Positive control: the ONE good link survives. An implementation that
    // dropped every source would also satisfy a bare "no javascript: link"
    // assertion, so assert what remains, not only what went.
    expect(item.sources).toEqual([
      { label: "Advisory", url: "https://nvd.nist.gov/vuln/detail/CVE-2025-30218" },
    ]);
  });

  it("uppercases and de-duplicates cveIds, preserving first-seen order", () => {
    const item = normalizeItem(
      raw({ cveIds: ["cve-2025-30218", "CVE-2024-0001", "CVE-2025-30218"] }),
    );
    expect(item.cveIds).toEqual(["CVE-2025-30218", "CVE-2024-0001"]);
  });

  it("does not throw on a null or non-object input", () => {
    expect(normalizeItem(null)).toBeNull();
    expect(normalizeItem(undefined)).toBeNull();
    expect(normalizeItem("nope")).toBeNull();
  });
});

describe("severityRank", () => {
  it("ranks critical worst and info best", () => {
    expect(severityRank("critical")).toBe(0);
    expect(severityRank("high")).toBe(1);
    expect(severityRank("medium")).toBe(2);
    expect(severityRank("low")).toBe(3);
    expect(severityRank("info")).toBe(4);
  });

  it("treats an unknown severity as the least severe", () => {
    expect(severityRank("catastrophic")).toBe(4);
    expect(severityRank(undefined)).toBe(4);
  });
});

describe("compareItems", () => {
  it("puts the newest item first", () => {
    const older = normalizeItem(raw({ id: "a", occurredAt: "2026-08-17T13:00:00Z" }));
    const newer = normalizeItem(raw({ id: "b", occurredAt: "2026-08-17T14:00:00Z" }));
    // Assert the WHOLE resolved order, not a pairwise indexOf comparison:
    // indexOf returns -1 for an item a broken sort dropped, and -1 sorts
    // before everything, so an indexOf assertion passes against a sort that
    // lost an item entirely.
    expect([older, newer].sort(compareItems).map((i) => i.id)).toEqual(["b", "a"]);
    expect([newer, older].sort(compareItems).map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("breaks a same-timestamp tie by severity, worst first", () => {
    const at = "2026-08-17T14:00:00Z";
    const low = normalizeItem(raw({ id: "low", severity: "low", occurredAt: at }));
    const crit = normalizeItem(raw({ id: "crit", severity: "critical", occurredAt: at }));
    const med = normalizeItem(raw({ id: "med", severity: "medium", occurredAt: at }));
    expect([low, med, crit].sort(compareItems).map((i) => i.id)).toEqual(["crit", "med", "low"]);
  });

  it("is a total order - two different items never compare equal", () => {
    const at = "2026-08-17T14:00:00Z";
    const a = normalizeItem(raw({ id: "a", title: "Same", occurredAt: at, severity: "high" }));
    const b = normalizeItem(raw({ id: "b", title: "Same", occurredAt: at, severity: "high" }));
    // Identical on every visible field; only the id differs. A sort that
    // returns 0 here is engine-order-dependent, which makes the rendered
    // briefing shuffle between reloads for no reason.
    expect(compareItems(a, b)).not.toBe(0);
    expect(Math.sign(compareItems(a, b))).toBe(-Math.sign(compareItems(b, a)));
  });
});

describe("withinWindow", () => {
  const item = (occurredAt) => normalizeItem(raw({ occurredAt }));

  it("keeps an item inside the window and drops one before it", () => {
    expect(withinWindow(item("2026-08-17T15:00:00Z"), { now: NOW, windowHours: 24 })).toBe(true);
    expect(withinWindow(item("2026-08-15T15:00:00Z"), { now: NOW, windowHours: 24 })).toBe(false);
  });

  it("includes the exact lower bound", () => {
    expect(withinWindow(item("2026-08-16T15:30:00Z"), { now: NOW, windowHours: 24 })).toBe(true);
  });

  it("tolerates a slightly post-dated item, because CISA really does publish them", () => {
    // KEV entries carry a dateAdded up to a day ahead of the feed's own
    // release time. A hard `<= now` hides the newest exploit in the
    // catalogue on the day it matters most.
    expect(FUTURE_TOLERANCE_HOURS).toBe(48);
    expect(withinWindow(item("2026-08-18T00:00:00Z"), { now: NOW, windowHours: 24 })).toBe(true);
  });

  it("excludes something announced for months away, which belongs in the support table", () => {
    // An end-of-life dated October is not an event in THIS hour. Putting it
    // on the timeline would file it under a future hour bucket and push it
    // above everything that actually happened.
    expect(withinWindow(item("2026-11-01T00:00:00Z"), { now: NOW, windowHours: 24 })).toBe(false);
  });
});
