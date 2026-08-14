import { describe, it, expect } from "vitest";
import {
  SOURCE_LABELS,
  sourceLabel,
  sourceProvenance,
  sourceHealthFailureCount,
  freshnessLabel,
} from "@/lib/feed/liveFeedClient";

// The Live Feed rendered `posting.source` raw, so every card showed a database
// value: "greenhouse", "highered_rss", and after the AI-search feature shipped,
// "ai_search" (docs/REGRESSION.md R-209). These live here beside REMOTE_LABELS
// and SINCE_LABELS, which are the same kind of thing, rather than in a new
// module — and here rather than in the component, because this repo's vitest
// runs environment "node" and a value defined inside a component module is
// far harder to pin.

describe("sourceLabel", () => {
  it("gives every source the feed actually ingests a human label", () => {
    // Every source ingestFeed writes must be covered. A missing one is not a
    // cosmetic gap: it is a raw database value on screen.
    for (const source of ["greenhouse", "lever", "ashby", "highered_rss", "ai_search"]) {
      const label = sourceLabel(source);
      expect(label).toBeTruthy();
      expect(label).not.toBe(source);
      expect(label).not.toMatch(/_/); // no snake_case leaking through
    }
  });

  it("falls back to the raw value for a source it has never heard of", () => {
    // A new source added to ingestFeed without updating this map must still
    // render something identifiable. Hiding it behind "Unknown" would erase
    // the one clue anyone debugging has.
    expect(sourceLabel("some_new_board")).toBe("some_new_board");
  });

  it("returns empty for a missing source rather than the word undefined", () => {
    for (const bad of [null, undefined, "", 0]) {
      expect(sourceLabel(bad)).toBe("");
    }
  });

  it("keeps SOURCE_LABELS and sourceLabel in agreement", () => {
    for (const [key, value] of Object.entries(SOURCE_LABELS)) {
      expect(sourceLabel(key)).toBe(value);
    }
  });
});

describe("sourceProvenance", () => {
  it("explains what verification an AI-found posting actually got", () => {
    const text = sourceProvenance("ai_search");
    expect(text).toBeTruthy();
    // It must say the page was opened/checked — that is the entire reason to
    // trust a posting a model proposed.
    expect(text.toLowerCase()).toMatch(/open|check|verif/);
  });

  it("does not overstate the verification", () => {
    // lib/feed/llmSearch.js proves the URL resolves to a page that reads like
    // an individual posting. It proves nothing about the role's quality, and
    // nothing about whether the job is still open.
    const text = sourceProvenance("ai_search").toLowerCase();
    expect(text).not.toMatch(/still open|currently open|guarantee|accurate|high.quality|vetted/);
  });

  it("stays short enough to sit on a card that repeats forty times", () => {
    // It is rendered as visible text on every AI-found card, so a paragraph
    // here becomes forty identical paragraphs down the feed. The trust signal
    // has to fit beside the source chip.
    expect(sourceProvenance("ai_search").length).toBeLessThanOrEqual(60);
  });

  it("says nothing for sources that came straight from a job board", () => {
    // A Greenhouse posting came from the company's own ATS. There is no
    // verification story to tell, and inventing one would be noise on 4 of
    // the 5 sources.
    for (const source of ["greenhouse", "lever", "ashby", "highered_rss", "unknown", null]) {
      expect(sourceProvenance(source)).toBe("");
    }
  });
});

describe("sourceHealthFailureCount", () => {
  const health = {
    greenhouse: { failures: 2 },
    lever: { failures: 1 },
    ashby: { failures: 0 },
    highered_rss: { failures: 0 },
    ai_search: { failures: 3 },
  };

  it("counts failures across every source, not just Greenhouse", () => {
    // The toolbar chip read sourceHealth.greenhouse.failures alone, so a total
    // outage of any other source displayed as perfect health. There are five
    // sources now; that reading was wrong the moment the second was added.
    expect(sourceHealthFailureCount(health)).toBe(6);
  });

  it("returns 0 for healthy, missing, or malformed health", () => {
    expect(sourceHealthFailureCount({ greenhouse: { failures: 0 } })).toBe(0);
    for (const bad of [null, undefined, {}, "nope", { greenhouse: null }, { x: { failures: "many" } }]) {
      expect(sourceHealthFailureCount(bad)).toBe(0);
    }
  });

  it("ignores a skipped source, which is not a failure", () => {
    // ai_search reports `skipped` when the engine, the key or the cadence gate
    // says not to run (R-205). Counting that as an error would show a warning
    // on every correctly-configured deploy.
    expect(sourceHealthFailureCount({ ai_search: { skipped: "cadence", failures: 0 } })).toBe(0);
  });
});

describe("freshnessLabel", () => {
  it("says the feed is out of date IN TEXT when it is stale", () => {
    // Staleness was signalled only by a dot changing from green to amber —
    // colour carrying meaning with no text equivalent (WCAG 1.4.1).
    const stale = freshnessLabel({ lastUpdatedAt: 1, isStale: true, relativeLabel: "12m ago" });
    const fresh = freshnessLabel({ lastUpdatedAt: 1, isStale: false, relativeLabel: "30s ago" });
    expect(stale).not.toBe(fresh);
    expect(stale.toLowerCase()).toMatch(/out of date|stale|not updat/);
    expect(fresh.toLowerCase()).not.toMatch(/out of date|stale/);
  });

  it("carries the relative time in both states", () => {
    expect(freshnessLabel({ lastUpdatedAt: 1, isStale: true, relativeLabel: "12m ago" })).toContain("12m ago");
    expect(freshnessLabel({ lastUpdatedAt: 1, isStale: false, relativeLabel: "30s ago" })).toContain("30s ago");
  });

  it("reports the pre-first-ingest state distinctly", () => {
    const label = freshnessLabel({ lastUpdatedAt: null, isStale: false, relativeLabel: "" });
    expect(label).toBeTruthy();
    expect(label.toLowerCase()).toContain("await");
  });
});
