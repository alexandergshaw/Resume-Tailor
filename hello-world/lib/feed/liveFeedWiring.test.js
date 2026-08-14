import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The extraction is only worth anything if LiveFeedTab actually USES it.
//
// Every other test in this change gates a piece: the label helpers, the card.
// All of them pass just as happily against a LiveFeedTab.js that is still 1320
// lines, still renders `label={posting.source}`, still reads
// `sourceHealth?.greenhouse?.failures`, and still signals staleness with colour
// alone -- with the new components sitting beside it, fully tested and never
// rendered. This file is the guard against exactly that, and against the file
// creeping back over the limit later.
//
// It reads source text, which is ordinarily a poor way to test anything. It is
// used here deliberately: the alternative is mounting the whole tab, which owns
// network state and a 60-second refresh timer, and the properties being pinned
// are about the SHAPE OF THE SOURCE (is the defect gone, is the file short
// enough) rather than about behaviour. Where a behavioural test is possible it
// lives in FeedPostingCard.test.js instead.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const TAB = "../../app/components/LiveFeedTab.js";
const FEED_COMPONENTS = [
  TAB,
  "../../app/components/feed/FeedPostingCard.js",
  "../../app/components/feed/FeedToolbar.js",
  "../../app/components/feed/FeedFilterSummary.js",
];

describe("LiveFeedTab renders the extracted components", () => {
  it("renders FeedPostingCard rather than an inline copy of the card", () => {
    const src = read(TAB);
    expect(src).toMatch(/<FeedPostingCard/);
    expect(src).toMatch(/from ["'].*feed\/FeedPostingCard["']/);
  });

  it("renders FeedToolbar and FeedFilterSummary", () => {
    const src = read(TAB);
    expect(src).toMatch(/<FeedToolbar/);
    expect(src).toMatch(/<FeedFilterSummary/);
  });

  it("no longer renders a raw source value anywhere", () => {
    // docs/REGRESSION.md R-209 is the gap this closes. The chip read
    // `label={posting.source}` with no mapping, so every card showed a
    // database value.
    expect(read(TAB)).not.toMatch(/label=\{posting\.source\}/);
  });
});

describe("LiveFeedTab uses the shared helpers rather than its own inline logic", () => {
  it("counts source health across every source, not Greenhouse alone", () => {
    // Five sources ingest into this feed. Reading only greenhouse.failures
    // meant a total Lever, Ashby, RSS or AI-search outage displayed as
    // perfect health.
    const src = read(TAB);
    expect(src).not.toMatch(/sourceHealth\?\.greenhouse\?\.failures/);
    expect(src).toMatch(/sourceHealthFailureCount/);
  });

  it("gets its freshness text from freshnessLabel", () => {
    // Staleness used to be carried only by a dot turning amber -- colour with
    // no text equivalent (WCAG 1.4.1). The wording is the helper's job now.
    const src = read(TAB);
    expect(src).toMatch(/freshnessLabel/);
    expect(src).not.toMatch(/"Awaiting first ingest"/);
  });
});

describe("the 1000-line limit this work item exists to enforce", () => {
  // There is no max-lines eslint rule in this repo, so without this the limit
  // is verified only by a wc -l line in a hand-written report.
  it.each(FEED_COMPONENTS)("%s stays under 1000 lines", (file) => {
    expect(read(file).split("\n").length).toBeLessThan(1000);
  });

  it("actually shrank LiveFeedTab rather than just adding files beside it", () => {
    // It was 1320 lines before the split. A token extraction that moved fifty
    // lines out would satisfy the limit check above only by luck, and would
    // not be the seam-finding this work item asked for.
    expect(read(TAB).split("\n").length).toBeLessThan(900);
  });
});
