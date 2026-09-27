// N60 S3 (AC-S2, AC-S3, owner ruling 2) -- the ceilings that govern
// unattended (cron) auto-tailor spend, named in one place so
// app/api/cron/tailor/route.js's declared bound and the reasoned number in
// lib/feed/autoTailorSpendBounds.table.test.js can never quietly drift apart.
//
// Zero imports, pure constants + a pure predicate -- so a "use client"
// component can import the per-run ceiling for its own confirmation copy
// (AC-R3) without dragging any server code into the client bundle.

// The per-invocation ceiling on unattended tailors: cron/tailor/route.js
// breaks its per-search loop once `queued.length` reaches this.
export const MAX_TAILORS_PER_USER_PER_RUN = 5;

// Owner ruling 2: the durable per-UTC-day ceiling S4's counter enforces.
// `auto_tailor_daily_cap` on saved_searches is the user's own LOWERABLE
// version of this, never a per-search number of its own.
//
// Kept module-private on purpose: nothing at S3 reads it yet -- S4's durable
// counter (lib/feed/autoTailorSpendLedger.js) is the first caller. Exporting
// a not-yet-consumed constant now would make it a test-only export and move
// lib/sourceScan/exportReachability.sweep.test.js's pinned counts (363/435),
// the same reason lib/feed/llmSearchQueries.js keeps DEFAULT_MAX_QUERIES
// module-private. Referenced by the predicate below so it is not a floating,
// unused literal.
const MAX_TAILORS_PER_USER_PER_UTC_DAY = 20;

/**
 * Pure. How many more postings may be tailored for this user today, given
 * how many the day's durable counter already recorded. Never negative.
 *
 * Not yet called anywhere -- S4's durable counter is the first caller. Kept
 * module-private for the same reason the constant above is: exporting it now
 * would be a test-only export and move the exportReachability pins. Declared
 * now so MAX_TAILORS_PER_USER_PER_UTC_DAY has a real reader instead of an
 * unused module-private literal.
 *
 * @param {number} usedToday
 * @returns {number}
 */
function remainingDailyAllowance(usedToday) {
  return Math.max(0, MAX_TAILORS_PER_USER_PER_UTC_DAY - usedToday);
}
