// Hour-by-hour bucketing for the Tech Watch timeline.
//
// Bucketing itself is UTC-only - the `key`/`startsAt`/`endsAt` of a bucket
// must never depend on the machine or viewer's zone, or two users (or two
// test runs on different CI machines) would disagree about which hour an
// incident belongs to. Only `formatHourLabel`'s rendered text is localized.

import { SEVERITIES, severityRank, compareItems, withinWindow } from "./item.js";

// Constructing an Intl.DateTimeFormat with an unknown IANA zone throws
// synchronously (not at format-time), so this is where an invalid `timeZone`
// gets caught and swapped for UTC rather than surfacing to the caller.
function safeTimeZone(timeZone) {
  const zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return "UTC";
  }
}

// Zero-padded 24-hour "HH:mm" in the given zone. Locale is deliberately fixed
// to "en-US" here (not the caller's `locale`) because digit formatting itself
// does not vary by locale once hourCycle is pinned - only the AM/PM decision
// does, and h23/hour12:false rules that out entirely.
function zonedClock(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

// "YYYY-MM-DD" of `date` as seen in `zone`, used only to decide whether a
// bucket falls on the same calendar day as `now` - "today" has to be judged
// in the display zone, since a UTC evening is already tomorrow in Tokyo.
function zonedYMD(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

// "Sat 16 Aug" (or locale's own weekday/day/month order) for a bucket that
// isn't today. Built from formatToParts rather than a plain `format()` call
// so the locale's own separators (commas, "de") can be dropped in favor of a
// single space, keeping the label compact on a narrow card.
function formatDayLabel(date, zone, locale) {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(date);
  return parts
    .filter((p) => p.type !== "literal")
    .map((p) => p.value)
    .join(" ");
}

// Groups already-normalized items into UTC hour buckets, newest first. Items
// outside the [now-windowHours, now+FUTURE_TOLERANCE_HOURS] window (see
// item.js) are excluded, and an hour with nothing in it is omitted rather
// than rendered as an empty gap.
export function bucketByHour(items, { now, windowHours }) {
  const byKey = new Map();
  for (const item of items || []) {
    if (!item || !item.occurredAt) continue;
    if (!withinWindow(item, { now, windowHours })) continue;
    // occurredAt is always a normalizeItem-produced `...Z` string, so the
    // first 13 characters ("YYYY-MM-DDTHH") are exactly the UTC hour key -
    // no separate Date math needed, and no zone can leak in here.
    const key = item.occurredAt.slice(0, 13);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }

  const keys = Array.from(byKey.keys()).sort().reverse();
  return keys.map((key) => {
    const startsAt = `${key}:00:00.000Z`;
    const endsAt = new Date(new Date(startsAt).getTime() + 3600e3).toISOString();
    return {
      key,
      startsAt,
      endsAt,
      items: byKey.get(key).slice().sort(compareItems),
    };
  });
}

// Counts over exactly the items passed in - callers decide whether that's a
// bucket, the whole window, or something else. `exploited` is a separate tab
// on the same items, not a fourth category: an exploited vulnerability is
// still counted once under `vulnerability` too.
export function summarize(items) {
  const result = {
    total: 0,
    outage: 0,
    vulnerability: 0,
    lifecycle: 0,
    exploited: 0,
    worstSeverity: null,
  };
  let worstRank = null;
  for (const item of items || []) {
    if (!item) continue;
    result.total += 1;
    if (item.category === "outage") result.outage += 1;
    else if (item.category === "vulnerability") result.vulnerability += 1;
    else if (item.category === "lifecycle") result.lifecycle += 1;
    if (item.exploited) result.exploited += 1;
    const rank = severityRank(item.severity);
    if (worstRank === null || rank < worstRank) worstRank = rank;
  }
  result.worstSeverity = worstRank === null ? null : SEVERITIES[worstRank];
  return result;
}

// "15:00 – 16:00 · Today" / "09:00 – 10:00 · Sat 16 Aug". The clock is always
// zero-padded 24-hour regardless of locale (a US-default toLocaleTimeString
// would render "03:00 PM" and pass on en-GB while failing on en-US); `locale`
// only ever reaches the weekday/month names.
export function formatHourLabel(bucket, { now, timeZone, locale = "en-GB" } = {}) {
  const zone = safeTimeZone(timeZone);
  const start = new Date(bucket.startsAt);
  const end = new Date(bucket.endsAt);
  const nowDate = now instanceof Date ? now : new Date(now);

  const startClock = zonedClock(start, zone);
  const endClock = zonedClock(end, zone);
  const isToday = zonedYMD(start, zone) === zonedYMD(nowDate, zone);
  const dayPart = isToday ? "Today" : formatDayLabel(start, zone, locale);

  return `${startClock} – ${endClock} · ${dayPart}`;
}
