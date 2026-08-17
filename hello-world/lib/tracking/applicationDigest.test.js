// The researched "what the posting does not tell you" digest for a tracked
// application. Written before lib/tracking/applicationDigest.js exists.
//
// Two things here are load-bearing for reasons that are not about correctness:
//
//   * `selectAutoDigestTargets` is the COST gate. Each digest is one grounded
//     model call. A user opening the tracking table with sixty untouched rows
//     must not fire sixty calls, so this decides what auto-populates and what
//     waits for the Research button. It is a pure function precisely so that
//     decision is testable without mocking a network.
//   * `parseDigestAnswer` decides which of the model's links survive. The
//     digest is prose a user will act on, so an unsourced claim is worse than
//     a missing section.

import { describe, it, expect } from "vitest";
import {
  DIGEST_SECTIONS,
  AUTO_DIGEST_MAX_AGE_HOURS,
  AUTO_DIGEST_CONCURRENCY,
  buildDigestPrompt,
  parseDigestAnswer,
  digestSummaryLine,
  selectAutoDigestTargets,
} from "./applicationDigest.js";

const NOW = new Date("2026-08-17T15:30:00.000Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

const GROUNDED = [
  { uri: "https://www.crunchbase.com/organization/acme", title: "Acme" },
  { uri: "https://news.example.com/acme-series-c", title: "Acme raises" },
];

describe("DIGEST_SECTIONS", () => {
  it("fixes the section order, so two rows are comparable at a glance", () => {
    expect(Array.isArray(DIGEST_SECTIONS)).toBe(true);
    expect(DIGEST_SECTIONS.length).toBeGreaterThanOrEqual(5);
    const joined = DIGEST_SECTIONS.join(" | ").toLowerCase();
    for (const topic of ["size", "role", "culture", "interview"]) {
      expect(joined).toContain(topic);
    }
  });
});

describe("buildDigestPrompt", () => {
  const posting = {
    company: "Acme Robotics",
    title: "Senior Platform Engineer",
    location: "Remote (US)",
    description: "We are hiring a platform engineer to own our Kubernetes estate.",
  };

  it("names the company and the role", () => {
    const prompt = buildDigestPrompt(posting);
    expect(prompt).toContain("Acme Robotics");
    expect(prompt).toContain("Senior Platform Engineer");
  });

  it("asks for every section by name", () => {
    const prompt = buildDigestPrompt(posting);
    for (const section of DIGEST_SECTIONS) expect(prompt).toContain(section);
  });

  it("asks for what the posting does NOT say, and shows it the posting", () => {
    // Without the description the model happily restates the job ad, which is
    // the one thing the user can already read.
    const prompt = buildDigestPrompt(posting);
    expect(prompt).toContain("Kubernetes estate");
    expect(prompt).toMatch(/not (stated|mentioned|covered) in the posting|does not say|beyond the posting/i);
  });

  it("tells the model to write Not found rather than infer", () => {
    expect(buildDigestPrompt(posting)).toMatch(/not found/i);
  });

  it("does not throw on a sparse posting", () => {
    expect(() => buildDigestPrompt({})).not.toThrow();
    expect(() => buildDigestPrompt(null)).not.toThrow();
  });
});

describe("parseDigestAnswer", () => {
  const markdown = [
    "## What the company does",
    "",
    "Acme builds warehouse robots. [Crunchbase](https://www.crunchbase.com/organization/acme)",
    "",
    "## Recent signals",
    "",
    "Raised a Series C. [Report](https://news.example.com/acme-series-c)",
  ].join("\n");

  it("keeps a link the model actually grounded on", () => {
    const { markdown: out, sources } = parseDigestAnswer(markdown, { grounded: GROUNDED });
    expect(out).toContain("(https://www.crunchbase.com/organization/acme)");
    expect(sources.map((s) => s.url)).toContain("https://www.crunchbase.com/organization/acme");
  });

  it("demotes a link the model invented, without losing the sentence", () => {
    const invented = "## Recent signals\n\nRaised a Series C. [Report](https://invented.example/acme)";
    const { markdown: out, dropped } = parseDigestAnswer(invented, { grounded: GROUNDED });
    expect(out).toContain("Raised a Series C.");
    expect(out).not.toContain("https://invented.example/acme");
    expect(dropped).toContain("https://invented.example/acme");
  });

  it("demotes every link when the model grounded on nothing at all", () => {
    const { markdown: out, sources } = parseDigestAnswer(markdown, { grounded: [] });
    expect(out).not.toContain("https://");
    expect(sources).toEqual([]);
    // Positive control lives in the first test: an implementation that
    // stripped every link unconditionally would pass this one alone.
  });

  it("returns an empty digest for unusable input rather than throwing", () => {
    for (const raw of ["", "   ", null, undefined, 42]) {
      expect(() => parseDigestAnswer(raw, { grounded: GROUNDED })).not.toThrow();
      expect(parseDigestAnswer(raw, { grounded: GROUNDED })).toEqual({
        markdown: "",
        sources: [],
        dropped: [],
      });
    }
  });

  it("de-duplicates the source list", () => {
    const twice = `${markdown}\n\nAgain. [Crunchbase](https://www.crunchbase.com/organization/acme)`;
    const { sources } = parseDigestAnswer(twice, { grounded: GROUNDED });
    const urls = sources.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("digestSummaryLine", () => {
  it("gives the cell a readable first line, skipping the heading", () => {
    const line = digestSummaryLine("## What the company does\n\nAcme builds warehouse robots for grocers.");
    expect(line).toBe("Acme builds warehouse robots for grocers.");
  });

  it("strips markdown link syntax so a table cell never shows a raw url", () => {
    const line = digestSummaryLine("## X\n\nAcme builds robots. [src](https://example.com/a)");
    expect(line).not.toContain("https://");
    expect(line).not.toContain("](");
    expect(line).toContain("Acme builds robots.");
  });

  it("is empty for an empty digest", () => {
    expect(digestSummaryLine("")).toBe("");
    expect(digestSummaryLine(null)).toBe("");
  });
});

describe("selectAutoDigestTargets - the cost gate", () => {
  const row = (id, trackedHoursAgo) => ({ id, tracked_at: hoursAgo(trackedHoursAgo) });

  it("auto-populates a row that has no digest and was tracked just now", () => {
    const targets = selectAutoDigestTargets([row("a", 1)], {}, { now: NOW });
    expect(targets).toEqual(["a"]);
  });

  it("leaves an older row for the Research button", () => {
    // The user asked for exactly this split: auto for a new row, a button for
    // existing ones. It is also what stops a first load on a long-standing
    // table from firing one grounded call per row.
    expect(AUTO_DIGEST_MAX_AGE_HOURS).toBe(24);
    const rows = [row("new", 2), row("old", 72)];
    expect(selectAutoDigestTargets(rows, {}, { now: NOW })).toEqual(["new"]);
  });

  it("never re-requests a digest that already exists", () => {
    const rows = [row("a", 1), row("b", 1)];
    const digests = { a: { status: "ready", markdown: "## X\n\nsomething" } };
    expect(selectAutoDigestTargets(rows, digests, { now: NOW })).toEqual(["b"]);
  });

  it("does not auto-retry a digest that already failed", () => {
    // A row whose research failed would otherwise burn a model call on every
    // single page load, forever, with nothing on screen changing. Retrying is
    // what the Research button is for.
    const digests = { a: { status: "failed", error: "model unavailable" } };
    expect(selectAutoDigestTargets([row("a", 1)], digests, { now: NOW })).toEqual([]);
  });

  it("returns the newest rows first", () => {
    const rows = [row("older", 10), row("newest", 1), row("middle", 5)];
    expect(selectAutoDigestTargets(rows, {}, { now: NOW })).toEqual(["newest", "middle", "older"]);
  });

  it("tolerates rows with a missing or unparseable tracked_at", () => {
    const rows = [{ id: "no-date" }, { id: "bad-date", tracked_at: "whenever" }, row("good", 1)];
    expect(selectAutoDigestTargets(rows, {}, { now: NOW })).toEqual(["good"]);
  });

  it("returns an empty list for junk input rather than throwing", () => {
    for (const rows of [null, undefined, [], "nope"]) {
      expect(selectAutoDigestTargets(rows, {}, { now: NOW })).toEqual([]);
    }
  });

  it("keeps the auto fan-out small", () => {
    expect(AUTO_DIGEST_CONCURRENCY).toBeLessThanOrEqual(3);
    expect(AUTO_DIGEST_CONCURRENCY).toBeGreaterThan(0);
  });
});
