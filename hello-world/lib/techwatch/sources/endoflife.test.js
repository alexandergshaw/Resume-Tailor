// Lifecycle: versions going out of support, and versions already out of it.
// Written before lib/techwatch/sources/endoflife.js exists.
//
// __fixtures__/endoflife.json holds REAL trimmed responses for react, nodejs
// and nextjs captured 2026-08-17. Two properties of the real payload are the
// whole reason this parser is not a one-liner, and both are exercised below:
//
//   * `eol` and `support` are EITHER an ISO date string OR a boolean.
//     `new Date(false)` is 1970 and `new Date(true)` is 1970 plus a
//     millisecond - neither throws, so a parser that forgets this quietly
//     reports that every supported release died in 1970.
//   * React records `eol: false` on every cycle and tracks only `support`.
//     Next.js records `eol` dates and no `support` at all. A parser that
//     handles one of those two shapes handles half the catalogue.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEolCycles, fetchEolCycles } from "./endoflife.js";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/endoflife.json", import.meta.url)), "utf8"),
);

const NOW = new Date("2026-08-17T15:30:00.000Z");

const entryFor = (id, label, eol, detectedVersions = []) => ({ id, label, eol, detectedVersions });

const REACT = entryFor("react", "React", "react");
const NEXT = entryFor("nextjs", "Next.js", "nextjs");
const NODE = entryFor("nodejs", "Node.js", "nodejs");

const rowFor = (result, cycle) => result.lifecycle.find((r) => r.cycle === cycle);

describe("parseEolCycles - the support table", () => {
  it("classifies a cycle whose end-of-life has passed as unsupported", () => {
    const result = parseEolCycles(FIXTURE.nextjs, { entry: NEXT, now: NOW, windowHours: 24 });
    expect(rowFor(result, "14").state).toBe("unsupported");
    expect(rowFor(result, "14").eolAt).toBe("2025-10-26");
  });

  it("classifies a cycle whose end-of-life is still ahead as supported", () => {
    const result = parseEolCycles(FIXTURE.nextjs, { entry: NEXT, now: NOW, windowHours: 24 });
    expect(rowFor(result, "15").state).toBe("supported");
  });

  it("treats a boolean support/eol as 'nothing announced', never as 1970", () => {
    const result = parseEolCycles(FIXTURE.react, { entry: REACT, now: NOW, windowHours: 24 });
    const current = rowFor(result, "19"); // { eol: false, support: true }
    expect(current.state).toBe("supported");
    expect(current.supportEndsAt).toBeNull();
    expect(current.eolAt).toBeNull();
  });

  it("classifies a cycle past active support but with no announced end-of-life as security-only", () => {
    const result = parseEolCycles(FIXTURE.react, { entry: REACT, now: NOW, windowHours: 24 });
    expect(rowFor(result, "17").state).toBe("security-only");
    expect(rowFor(result, "17").supportEndsAt).toBe("2022-03-29");
    // Node 22: support ended 2025-10-21, eol not until 2027-04-30.
    const node = parseEolCycles(FIXTURE.nodejs, { entry: NODE, now: NOW, windowHours: 24 });
    expect(rowFor(node, "22").state).toBe("security-only");
  });

  it("sorts cycles newest first rather than trusting the payload's order", () => {
    // The fixture already arrives newest-first, so asserting against it
    // cannot distinguish "the parser sorts" from "the parser passes through".
    // endoflife.date makes no ordering guarantee across its 464 products.
    const shuffled = [FIXTURE.nodejs[3], FIXTURE.nodejs[0], FIXTURE.nodejs[5], FIXTURE.nodejs[1]];
    const result = parseEolCycles(shuffled, { entry: NODE, now: NOW, windowHours: 24 });
    expect(result.lifecycle.map((r) => r.cycle)).toEqual(["26", "25", "23", "21"]);
  });

  it("returns every cycle, newest first, carrying the latest patch release", () => {
    const result = parseEolCycles(FIXTURE.nodejs, { entry: NODE, now: NOW, windowHours: 24 });
    expect(result.lifecycle.map((r) => r.cycle)).toEqual(["26", "25", "24", "23", "22", "21"]);
    expect(rowFor(result, "26").latest).toBe("26.7.0");
    expect(rowFor(result, "26").technologyId).toBe("nodejs");
    expect(rowFor(result, "26").technology).toBe("Node.js");
  });

  it("marks the cycle the user's own pages actually name", () => {
    const entry = entryFor("react", "React", "react", ["17.0.2"]);
    const result = parseEolCycles(FIXTURE.react, { entry, now: NOW, windowHours: 24 });
    expect(rowFor(result, "17").inUse).toBe(true);
    expect(rowFor(result, "18").inUse).toBe(false);
    expect(rowFor(result, "19").inUse).toBe(false);
  });

  it("matches a detected version to its cycle on a dot boundary, not a prefix", () => {
    // "1" must not mark cycle "19" or "15"; "19" must not be matched by "1".
    const entry = entryFor("react", "React", "react", ["1"]);
    const result = parseEolCycles(FIXTURE.react, { entry, now: NOW, windowHours: 24 });
    expect(result.lifecycle.filter((r) => r.inUse)).toEqual([]);
    // Positive control in the same shape.
    const exact = parseEolCycles(FIXTURE.react, {
      entry: entryFor("react", "React", "react", ["19"]),
      now: NOW,
      windowHours: 24,
    });
    expect(exact.lifecycle.filter((r) => r.inUse).map((r) => r.cycle)).toEqual(["19"]);
  });
});

describe("parseEolCycles - events inside the window", () => {
  it("raises an item on the day a cycle reached end of life", () => {
    // Node 25's eol is 2026-06-01 in the real payload.
    const now = new Date("2026-06-02T10:00:00.000Z");
    const { items } = parseEolCycles(FIXTURE.nodejs, { entry: NODE, now, windowHours: 48 });
    expect(items.map((i) => i.id)).toEqual(["endoflife:nodejs:25:eol"]);
    const [item] = items;
    expect(item.category).toBe("lifecycle");
    expect(item.title).toBe("Node.js 25 reached end of life");
    expect(item.occurredAt).toBe("2026-06-01T00:00:00.000Z");
    expect(item.timePrecision).toBe("day");
    expect(item.severity).toBe("high");
    expect(item.status).toBe("unsupported");
    expect(item.remedy).toBe("Upgrade to Node.js 26");
    expect(item.sources).toEqual([{ label: "endoflife.date", url: "https://endoflife.date/nodejs" }]);
  });

  it("raises a milder item on the day a cycle left active support", () => {
    // React 18's support ended 2024-12-05 in the real payload.
    const now = new Date("2024-12-05T12:00:00.000Z");
    const { items } = parseEolCycles(FIXTURE.react, { entry: REACT, now, windowHours: 24 });
    expect(items.map((i) => i.id)).toEqual(["endoflife:react:18:support"]);
    expect(items[0].title).toBe("React 18 reached end of active support");
    expect(items[0].severity).toBe("medium");
    expect(items[0].status).toBe("security-only");
  });

  it("raises nothing when no cycle changed state inside the window", () => {
    const { items, lifecycle } = parseEolCycles(FIXTURE.react, { entry: REACT, now: NOW, windowHours: 24 });
    expect(items).toEqual([]);
    // The support table is NOT window-scoped - it is the standing answer to
    // "which of my versions are dead", and must survive a quiet day.
    expect(lifecycle.length).toBe(5);
  });

  it("never dates an event to 1970 from a boolean", () => {
    // React records `eol: false` on every cycle and `support: true` on the
    // current one. `new Date(false)` is 1970 and does not throw, so a parser
    // that forgets the boolean case reports that every supported release
    // died at the epoch.
    //
    // The window has to run BACKWARDS from a present-day `now`, not forwards
    // from 1970: with `now` at the epoch every real date is in the future,
    // `items` comes back empty, and the loop below asserts nothing at all.
    const { items } = parseEolCycles(FIXTURE.react, {
      entry: REACT,
      now: NOW,
      windowHours: 24 * 365 * 30,
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(new Date(item.occurredAt).getUTCFullYear()).toBeGreaterThan(2000);
    }
    // And the cycle whose fields are booleans raises no event at all.
    expect(items.map((i) => i.id)).not.toContain("endoflife:react:19:eol");
    expect(items.map((i) => i.id)).not.toContain("endoflife:react:19:support");
  });

  it("returns empty results for a malformed payload instead of throwing", () => {
    for (const json of [null, undefined, {}, "nope", [null, 3]]) {
      expect(parseEolCycles(json, { entry: REACT, now: NOW, windowHours: 24 })).toEqual({
        items: [],
        lifecycle: [],
      });
    }
  });
});

describe("fetchEolCycles", () => {
  it("requests the product's own endoflife.date feed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => FIXTURE.nextjs });
    const result = await fetchEolCycles({ entry: NEXT, fetchImpl, now: NOW, windowHours: 24 });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://endoflife.date/api/nextjs.json");
    expect(result.ok).toBe(true);
    expect(result.lifecycle.length).toBe(6);
  });

  it("makes no request for a technology with no lifecycle feed", async () => {
    // TypeScript is the user's own example of something "going under" and
    // endoflife.date does not carry it. Guessing a slug would 404 forever
    // and read on screen as an outage at endoflife.date.
    const fetchImpl = vi.fn();
    const result = await fetchEolCycles({
      entry: entryFor("typescript", "TypeScript", null),
      fetchImpl,
      now: NOW,
      windowHours: 24,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, items: [], lifecycle: [], error: null });
  });

  it("reports failure without throwing", async () => {
    const bad = await fetchEolCycles({
      entry: NEXT,
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
      now: NOW,
      windowHours: 24,
    });
    expect(bad.ok).toBe(false);
    expect(bad.items).toEqual([]);
    expect(bad.lifecycle).toEqual([]);
    expect(String(bad.error)).toContain("404");

    const thrown = await fetchEolCycles({
      entry: NEXT,
      fetchImpl: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
      now: NOW,
      windowHours: 24,
    });
    expect(thrown.ok).toBe(false);
    expect(String(thrown.error)).toContain("ETIMEDOUT");
  });
});
