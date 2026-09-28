// N60 S3, AC-C4 / N60 SECOND CHUNK AC2-C4a -- the link from vercel.json's actual
// tailor-cron schedule to the named cadence-floor constant.
//
// MEASURED: the schedule itself is already pinned at
// app/api/cron/position-glossary/route.test.js:196-199 (one toContainEqual
// per job, plus crons.toHaveLength(3)) and :204 (no key on vercel.json other
// than "crons"). This file does not duplicate that pin -- it proves the
// LINK: that "*/15 * * * *" in vercel.json is not a bare literal a future
// schedule edit could drift away from unnoticed, but is tied to the named
// TAILOR_CRON_MINUTES constant. Same shape as
// lib/copilot/glossaryConstants.test.js does for the position-glossary
// cron's own cadence constant.
//
// SECOND-CHUNK F1 MOVE (checker finding, resolved here): the cadence floor now
// lives in lib/feed/cronSchedule.js -- the one module the cron route imports its
// clamp + due-check from -- NOT as a module-private const in route.js. So this
// pin reads TAILOR_CRON_MINUTES from lib/feed/cronSchedule.js. This is the ONE
// drift pin between vercel.json and the floor; it is REPOINTED, not duplicated
// (the checker warned that adding a second pin, or importing the const, would
// either strand two literals that can drift or move the export census). On HEAD
// lib/feed/cronSchedule.js does not exist yet, so both blocks below are RED
// (subject absent) until Step A lands the module -- the accounted breakage this
// edit deliberately introduces, in place of the plan's route.js-const removal
// that would have left this file's old regex matching nothing.
//
// SOURCE-TEXT READ, not an import: TAILOR_CRON_MINUTES has no runtime consumer
// (Vercel's own vercel.json IS the schedule; the route decides nothing from the
// bare constant -- it uses clampIntervalMinutes/isAutoTailorDue instead).
// Importing the constant here would make it a test-only export and move
// lib/sourceScan/exportReachability.sweep.test.js's pinned counts (363/435). A
// source-text read pins the value without an import edge, so the constant may
// stay module-private inside cronSchedule.js.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function tailorCronMinutes() {
  const src = readFileSync(path.join(ROOT, "lib", "feed", "cronSchedule.js"), "utf8");
  const match = /\bconst TAILOR_CRON_MINUTES\s*=\s*(\d+)\b/.exec(src);
  if (!match) throw new Error("TAILOR_CRON_MINUTES not found in lib/feed/cronSchedule.js");
  return Number(match[1]);
}

describe("N60 S3 AC-C4: the tailor cron's vercel.json schedule matches its own named constant", () => {
  it("vercel.json's /api/cron/tailor schedule equals */<TAILOR_CRON_MINUTES> * * * *", () => {
    const { crons } = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const entry = crons.find((c) => c.path === "/api/cron/tailor");
    expect(entry, "no /api/cron/tailor entry in vercel.json").toBeTruthy();
    expect(entry.schedule).toBe(`*/${tailorCronMinutes()} * * * *`);
  });

  it("the constant is a plausible cron cadence in minutes, not an accidental huge or zero value", () => {
    // A cheap positive control: if the regex above ever matched the wrong
    // thing (e.g. a comment mentioning a different number), this bounds it
    // to something that could actually be a "*/N * * * *" minute field.
    const minutes = tailorCronMinutes();
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThan(60);
  });
});
