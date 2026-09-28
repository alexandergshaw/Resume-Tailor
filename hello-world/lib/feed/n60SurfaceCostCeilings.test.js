import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// N60 S11 -- the composite-surface-cost ratchet (AC Part F). This chunk grew
// a lot of surface (an Automation view, three feed components, a run-log
// component, a pause control, two API routes, several lib modules) and Part F
// requires the growth be bounded at the files it actually touched, not just
// at app/page.js. The three page.js pins already existed and were tightened
// in place (lib/feed/feedTailorFullDescription.test.js,
// app/components/DocumentPreviewMount.test.js,
// app/page.untrackChip.wiring.test.js); this file adds the two ceilings named
// in the N60 plan (step S11) that had none before this chunk.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const lineCount = (rel) => read(rel).split("\n").length;

describe("app/api/cron/tailor/route.js: AC-F4's ceiling, ratcheted to the measured truth", () => {
  it("stays at or under 550 lines", () => {
    // AC-F4 required this route "does not grow past 400 lines" -- the
    // reporting (AC-R4), the spend counter (AC-S1) and the mail counters
    // (AC-E2) were meant to live in lib/feed/ and lib/email/ modules the
    // route calls, which is also the only way they get unit tests. The route
    // DOES delegate to those modules (autoTailorRunLog, autoTailorRunStore,
    // autoTailorBounds, autoTailorSpendLedger, alertMailLedger, killSwitch,
    // alertPause all imported and called, not reimplemented inline), but it
    // still grew from 331 lines (measured at the tree just before N60) to
    // 530 lines at this chunk's close -- past the 400-line requirement.
    // That is a finding, not something this ratchet step fixes: S11's job is
    // to measure and lock in what actually grew, not to refactor production
    // code. 550 gives 20 lines of ordinary working room above the 530
    // measured here; it does NOT restore the AC-F4 bound, and the gap
    // between 400 and 530 should be treated as open follow-up work, not as
    // satisfied by this ceiling.
    expect(lineCount("../../app/api/cron/tailor/route.js")).toBeLessThanOrEqual(550);
  });
});

describe("app/components/AutoApplyQueueTab.js: the repo's existing CAPPED_AT_1000 class", () => {
  it("stays under 1000 lines", () => {
    // Untouched by N60 in substance (733 -> 737 lines, a wiring change), but
    // it renders in the same feed area this chunk grew and had no line
    // ceiling anywhere in the suite before this step -- the same gap that
    // left the feed components unlisted until N60 added them to
    // lib/feed/liveFeedWiring.test.js's FEED_COMPONENTS. 1000 is the repo's
    // existing wide-margin class for a file this size (see
    // lib/drive/lineCeiling.test.js's CAPPED_AT_1000 and
    // lib/feed/liveFeedWiring.test.js's FEED_COMPONENTS, both <1000), real
    // margin rather than a number tuned to today's byte count.
    expect(lineCount("../../app/components/AutoApplyQueueTab.js")).toBeLessThan(1000);
  });
});
