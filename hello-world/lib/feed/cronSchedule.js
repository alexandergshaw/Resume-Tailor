// N60 SECOND CHUNK, Step A -- the cadence contract "frequency" needs to be a
// real, honoured value rather than a stored-and-ignored column (ac.chat.r1.md
// 0.2 / AC2-C4a). This is the one module every cadence-aware caller shares:
// the cron route (clampIntervalMinutes + isAutoTailorDue) and the automation
// card's enable confirmation (describeCadence + clampIntervalMinutes).
//
// TAILOR_CRON_MINUTES stays MODULE-PRIVATE: nothing at runtime reads it
// (Vercel's own vercel.json is what actually schedules /api/cron/tailor), so
// exporting it would be a test-only export and move
// lib/sourceScan/exportReachability.sweep.test.js's pinned counts (363/435).
// The link from this constant to vercel.json's "*/15" schedule is proven by a
// SOURCE-TEXT read in app/api/cron/tailor/cronSchedule.test.js, not an import.
const TAILOR_CRON_MINUTES = 15;

// The cadence offered when nothing narrower was requested (owner ruling G.4,
// ac.chat.r1.md): under-promise against the 15-minute floor, since job boards
// do not refresh every 15 minutes anyway. Also the fallback for a stored
// interval that is missing or unreadable -- NULL must mean "use the default
// cadence", never "never run again".
const DEFAULT_AUTO_TAILOR_INTERVAL_MINUTES = 60;

/**
 * Clamps a requested auto-tailor interval to the cron's own floor.
 * A missing/non-finite request (null, undefined, NaN, a non-numeric string)
 * falls back to the default cadence -- never to the floor, which would
 * silently deliver a MORE expensive cadence than the default ever promised.
 * @param {*} minutes
 * @returns {number} an integer >= TAILOR_CRON_MINUTES
 */
export function clampIntervalMinutes(minutes) {
  if (minutes === null || minutes === undefined) {
    return DEFAULT_AUTO_TAILOR_INTERVAL_MINUTES;
  }
  const n = Number(minutes);
  if (!Number.isFinite(n)) {
    return DEFAULT_AUTO_TAILOR_INTERVAL_MINUTES;
  }
  return Math.max(TAILOR_CRON_MINUTES, n);
}

/**
 * Turns a stored (already-clamped) interval into copy the user reads as the
 * cadence they will actually get. A pure function of its argument -- callers
 * describe the CLAMPED, stored value, never the raw request, so a sub-floor
 * ask reads as the floor it will actually get.
 * @param {number} minutes
 * @returns {string}
 */
export function describeCadence(minutes) {
  const n = Number(minutes);
  if (n === 60) return "about every hour";
  if (n > 60 && n % 60 === 0) return `about every ${n / 60} hours`;
  return `every ${n} minutes`;
}

/**
 * Whether an auto-enabled saved search is due to run again.
 * A null/undefined/unparseable `lastRunAt` is DUE -- a search that has never
 * run is not "never run again". Otherwise due once at least
 * `intervalMinutes` have elapsed since `lastRunAt` (boundary-inclusive:
 * exactly the interval counts as due, not just strictly past it). The caller
 * passes an ALREADY-CLAMPED `intervalMinutes` (see clampIntervalMinutes).
 * @param {string|null|undefined} lastRunAt an ISO timestamp, or null/undefined
 * @param {number} intervalMinutes
 * @param {number} now epoch ms, read once by the caller so this stays pure
 * @returns {boolean}
 */
export function isAutoTailorDue(lastRunAt, intervalMinutes, now) {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt).getTime();
  if (!Number.isFinite(last)) return true;
  const interval = Number(intervalMinutes);
  const intervalMs = Number.isFinite(interval) ? interval * 60000 : 0;
  return now - last >= intervalMs;
}
