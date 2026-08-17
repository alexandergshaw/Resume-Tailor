// Grounded lifecycle answers, for the technologies no public feed covers.
// Written before lib/techwatch/lifecycleSearch.js exists.
//
// This is the only part of Tech Watch that lets a model author a fact the user
// reads. Everything asserted here is about refusing to print one it did not
// prove: a row whose citation the model never actually searched is worth less
// than the honest "no lifecycle feed" line it would replace, because it looks
// exactly like a row that came from endoflife.date.

import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_CACHE_TTL_SECONDS,
  buildLifecyclePrompt,
  parseLifecycleAnswer,
} from "./lifecycleSearch.js";

const NOW = new Date("2026-08-17T15:30:00.000Z");

const TECHNOLOGIES = [
  { id: "typescript", label: "TypeScript" },
  { id: "java", label: "Java" },
];

// What the model actually searched. `isGroundedHost` compares hostnames.
const GROUNDED = [
  { uri: "https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/", title: "Announcing TypeScript" },
  { uri: "https://www.oracle.com/java/technologies/java-se-support-roadmap.html", title: "Oracle Java SE Support Roadmap" },
];

const ROW = {
  technology: "TypeScript",
  cycle: "5.9",
  latest: "5.9.3",
  supportEndsAt: "2026-03-01",
  eolAt: null,
  state: "security-only",
  sourceUrl: "https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/",
};

const answer = (rows) => JSON.stringify(rows);
const parse = (raw, over = {}) =>
  parseLifecycleAnswer(raw, { technologies: TECHNOLOGIES, grounded: GROUNDED, now: NOW, ...over });

describe("LIFECYCLE_CACHE_TTL_SECONDS", () => {
  it("caches for a day, because lifecycle facts move on the order of months", () => {
    expect(LIFECYCLE_CACHE_TTL_SECONDS).toBe(60 * 60 * 24);
  });
});

describe("buildLifecyclePrompt", () => {
  it("names every requested technology", () => {
    const prompt = buildLifecyclePrompt(TECHNOLOGIES);
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("Java");
  });

  it("asks for exactly the keys the parser reads", () => {
    const prompt = buildLifecyclePrompt(TECHNOLOGIES);
    for (const key of ["technology", "cycle", "latest", "supportEndsAt", "eolAt", "state", "sourceUrl"]) {
      expect(prompt).toContain(key);
    }
  });

  it("names the three allowed states and the date format", () => {
    const prompt = buildLifecyclePrompt(TECHNOLOGIES);
    expect(prompt).toContain("supported");
    expect(prompt).toContain("security-only");
    expect(prompt).toContain("unsupported");
    expect(prompt).toContain("YYYY-MM-DD");
  });

  it("tells the model to omit rather than guess", () => {
    // The parser drops an unsourced row anyway, but a prompt that invites a
    // guess and then silently discards it wastes the call and teaches nothing.
    const prompt = buildLifecyclePrompt(TECHNOLOGIES);
    expect(prompt).toMatch(/omit|leave it out|do not guess|rather than guess/i);
  });

  it("does not throw on an empty list", () => {
    expect(() => buildLifecyclePrompt([])).not.toThrow();
  });
});

describe("parseLifecycleAnswer - shape", () => {
  it("returns a row in the same shape the deterministic lifecycle rows use", () => {
    const { rows } = parse(answer([ROW]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      technologyId: "typescript",
      technology: "TypeScript",
      cycle: "5.9",
      latest: "5.9.3",
      releasedAt: null,
      supportEndsAt: "2026-03-01",
      eolAt: null,
      state: "security-only",
      inUse: false,
      source: "ai",
      citation: {
        label: "devblogs.microsoft.com",
        url: "https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/",
      },
    });
  });

  it("marks every row as AI-sourced, so the panel can never render it as a primary source", () => {
    const { rows } = parse(answer([ROW, { ...ROW, cycle: "5.8" }]));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.source).toBe("ai");
  });

  it("reads a fenced code block", () => {
    const raw = "Here is what I found:\n\n```json\n" + answer([ROW]) + "\n```\n\nHope that helps.";
    expect(parse(raw).rows).toHaveLength(1);
  });

  it("reads bare JSON with prose either side", () => {
    expect(parse("Sure. " + answer([ROW]) + " Let me know.").rows).toHaveLength(1);
  });

  it("returns empty results for anything unparseable, and never throws", () => {
    for (const raw of ["", "   ", "I could not find anything.", "{not json", "[1,2,3", null, undefined]) {
      expect(() => parse(raw)).not.toThrow();
      expect(parse(raw)).toEqual({ rows: [], dropped: [] });
    }
  });
});

describe("parseLifecycleAnswer - refusing what the model did not prove", () => {
  it("drops a row whose citation host the model never searched", () => {
    const invented = { ...ROW, sourceUrl: "https://totally-made-up-source.example/typescript" };
    const { rows, dropped } = parse(answer([invented]));
    expect(rows).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].url).toBe("https://totally-made-up-source.example/typescript");
    expect(String(dropped[0].reason)).toMatch(/ground/i);
  });

  it("drops everything when the model grounded on nothing at all", () => {
    // An empty grounding list is no evidence the model searched. Treating it
    // as permissive is exactly how a fabricated answer reaches the user.
    const { rows, dropped } = parse(answer([ROW]), { grounded: [] });
    expect(rows).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("keeps a grounded row while dropping an ungrounded one from the same answer", () => {
    // The positive control matters: a parser that dropped everything would
    // satisfy both tests above on its own.
    const good = ROW;
    const bad = { ...ROW, cycle: "4.0", sourceUrl: "https://invented.example/ts" };
    const { rows, dropped } = parse(answer([good, bad]));
    expect(rows.map((r) => r.cycle)).toEqual(["5.9"]);
    expect(dropped).toHaveLength(1);
  });

  it("drops a technology nobody asked about", () => {
    // The brief was TypeScript and Java. A model that volunteers Python is
    // widening its own remit, and that row would appear in the table with no
    // deterministic row to contradict it.
    const python = { ...ROW, technology: "Python", sourceUrl: GROUNDED[0].uri };
    const { rows, dropped } = parse(answer([python]));
    expect(rows).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(String(dropped[0].reason)).toMatch(/request|ask/i);
  });

  it("matches the requested technology case-insensitively", () => {
    const { rows } = parse(answer([{ ...ROW, technology: "typescript" }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].technologyId).toBe("typescript");
    expect(rows[0].technology).toBe("TypeScript"); // our label, not the model's casing
  });

  it.each([
    ["an unknown state", { state: "deprecated" }],
    ["a non-ISO supportEndsAt", { supportEndsAt: "March 2026" }],
    ["a non-ISO eolAt", { eolAt: "2026" }],
    ["a blank cycle", { cycle: "" }],
    ["a missing sourceUrl", { sourceUrl: "" }],
  ])("drops a row with %s rather than coercing it", (_label, patch) => {
    const { rows } = parse(answer([{ ...ROW, ...patch }]));
    expect(rows).toEqual([]);
  });

  it("accepts a null date but not a malformed one", () => {
    const { rows } = parse(answer([{ ...ROW, supportEndsAt: null, eolAt: null }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].supportEndsAt).toBeNull();
  });

  it("de-duplicates by technology and cycle, keeping the first", () => {
    const { rows } = parse(answer([ROW, { ...ROW, latest: "9.9.9" }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].latest).toBe("5.9.3");
  });

  it("caps how many rows one technology can contribute", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...ROW, cycle: `5.${i}` }));
    const { rows } = parse(answer(many));
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("ignores entries that are not objects", () => {
    const { rows } = parse(answer([ROW, null, 42, "nope"]));
    expect(rows).toHaveLength(1);
  });
});
