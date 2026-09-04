import { describe, it, expect } from "vitest";
import { parseStageInstant } from "./stages.js";

// Restores `process.env.TZ` to what it was before a test pinned it. `TZ` is
// genuinely unset on this machine, so `process.env.TZ` reads back as the
// *string* `undefined` was captured from a property read - i.e. the JS value
// `undefined`. Assigning `process.env.TZ = undefined` does NOT delete the
// var: Node coerces it to the literal string "undefined", which Node's ICU
// binding treats as an unrecognized zone name and falls back to `Etc/Unknown`
// (UTC+0) - silently changing the ambient zone for every test that runs
// after in the same process, rather than restoring it.
function restoreTZ(original) {
  if (original === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = original;
  }
}

// parseStageInstant is the single mandated read of a stored `scheduled_at`.
// Its domain is the DATABASE value (a bare or offset-bearing timestamp
// string), never the datetime-local input's wall-clock string. A bare
// timestamp has no offset because the app's only writer stores UTC, so it
// must be treated as UTC — plain `new Date(...)` on the same string parses
// it as LOCAL and silently shifts by the reader's own offset, which is
// exactly the defect this function exists to close.

const SAME_INSTANT = "2026-09-10T18:00:00.000Z";

describe("parseStageInstant — positive shapes all resolve to the same instant", () => {
  it.each([
    ["timestamptz JSON shape", "2026-09-10T18:00:00+00:00"],
    ["bare Z", "2026-09-10T18:00:00Z"],
    ["lowercase z", "2026-09-10T18:00:00z"],
    ["bare timestamp, no offset at all (must be treated as UTC)", "2026-09-10T18:00:00"],
    ["space-separated Postgres form", "2026-09-10 18:00:00"],
    ["milliseconds included", "2026-09-10T18:00:00.000Z"],
    ["+HHMM widened to +HH:MM", "2026-09-10T18:00:00+0000"],
    ["+HH short offset widened (Invalid Date in V8 unwidened)", "2026-09-10T18:00:00+00"],
    ["equivalent non-UTC offset (New York)", "2026-09-10T13:00:00-05:00"],
    ["equivalent non-UTC offset, short form (Honolulu, negative sign)", "2026-09-10T08:00:00-10"],
    ["trims surrounding whitespace", "  2026-09-10T18:00:00+00:00  "],
    // Seconds are optional in the pattern; when omitted, the code defaults
    // the seconds component to ":00" (not, say, ":01" or the current
    // second) before building the ISO string it hands to `new Date`. These
    // two rows pin that default with an exact-instant assertion, so a
    // silent shift in the default (even by one second) fails loudly instead
    // of surviving unnoticed.
    ["no seconds at all, bare (defaults seconds to :00, treated as UTC)", "2026-09-10T18:00"],
    ["no seconds at all, with offset (defaults seconds to :00)", "2026-09-10T13:00-05:00"],
  ])("%s", (_label, input) => {
    const result = parseStageInstant(input);
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(SAME_INSTANT);
  });
});

describe("parseStageInstant — negative shapes return null, never a guess", () => {
  it.each([
    ["null (new Date(null) is the EPOCH — a valid Date that sorts first)", null],
    ["undefined", undefined],
    ["a number", 1234567890],
    ["a Date object", new Date()],
    ["a plain object", {}],
    ["empty string", ""],
    ["whitespace-only string", "   "],
    ["date-only, no time component (the '-10' offset trap)", "2026-09-10"],
    ["garbage text", "not a date at all"],
    ["HH:MM:SS offset — named-rejected, not a guess", "2026-09-10T18:00:00+00:00:00"],
    ["HH:MM:SS offset, negative sign", "2026-09-10T13:00:00-05:00:00"],
    // These all match STAGE_INSTANT_PATTERN — every field is the right shape
    // and width — but the calendar/clock value is out of range, so
    // `new Date(iso)` yields `Invalid Date`. `Invalid Date` is an object and
    // therefore truthy, so without the `Number.isNaN(date.getTime())` guard
    // it would sail past `if (!instant) return null` and reach
    // `formatInterviewWhen`'s `Intl.DateTimeFormat().format()`, which throws
    // a RangeError on an invalid instant and would take down the whole chat
    // reply. This is the guard's one job — see the paired test below.
    ["regex matches, but month 13 makes the date invalid", "2026-13-01T18:00:00Z"],
    ["regex matches, but day 32 makes the date invalid", "2026-09-32T18:00:00Z"],
    ["regex matches, but minute 60 makes the date invalid", "2026-09-10T18:60:00Z"],
    ["regex matches, but hour 25 makes the date invalid", "2026-09-10T25:00:00Z"],
  ])("%s", (_label, input) => {
    expect(parseStageInstant(input)).toBeNull();
  });
});

describe("parseStageInstant — the Invalid Date guard is load-bearing", () => {
  it("never returns a Date object whose getTime() is NaN", () => {
    // A regression-proof restatement of the row above: even if some other
    // regex-matching-but-out-of-range input slips through the table, the
    // returned value must never be an unchecked Invalid Date. `Invalid Date`
    // is truthy, so a caller's `if (!instant)` check alone cannot catch it —
    // only the internal Number.isNaN guard can.
    const result = parseStageInstant("2026-13-01T18:00:00Z");
    expect(result).toBeNull();
    // Guard against a future refactor "fixing" this to return the invalid
    // Date instead of null:
    if (result !== null) {
      expect(Number.isNaN(result.getTime())).toBe(false);
    }
  });
});

describe("parseStageInstant — the date-only trap is structural, not incidental", () => {
  it("a date-only value is never misread as carrying a trailing offset", () => {
    // "2026-09-10" ends in "-10", which a suffix-only offset detector could
    // mistake for a "-10" (Hawaii) offset. The time-anchor regex makes this
    // impossible: a date-only string can never match at all.
    expect(parseStageInstant("2026-09-10")).toBeNull();
  });

  it("does not fall back to the epoch the way new Date(null) silently does", () => {
    expect(parseStageInstant(null)).not.toEqual(new Date(0));
    expect(parseStageInstant(null)).toBeNull();
  });
});

describe("parseStageInstant — zone-invariant by construction", () => {
  const originalTZ = process.env.TZ;

  it("a bare timestamp resolves to the identical UTC instant under America/Chicago", () => {
    process.env.TZ = "America/Chicago";
    try {
      expect(parseStageInstant("2026-09-10T18:00:00").toISOString()).toBe(SAME_INSTANT);
    } finally {
      restoreTZ(originalTZ);
    }
  });

  it("a bare timestamp resolves to the identical UTC instant under Asia/Kolkata", () => {
    process.env.TZ = "Asia/Kolkata";
    try {
      expect(parseStageInstant("2026-09-10T18:00:00").toISOString()).toBe(SAME_INSTANT);
    } finally {
      restoreTZ(originalTZ);
    }
  });

  it("an offset-bearing value is unaffected by the ambient zone at all", () => {
    for (const zone of ["America/Chicago", "Asia/Kolkata", "Pacific/Kiritimati", "UTC"]) {
      process.env.TZ = zone;
      try {
        expect(parseStageInstant("2026-09-10T18:00:00+00:00").toISOString()).toBe(SAME_INSTANT);
      } finally {
        restoreTZ(originalTZ);
      }
    }
  });
});
