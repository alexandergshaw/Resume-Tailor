// Interview-stage constants and small helpers shared by the tracking UI
// (page.js, TrackingTab, StageDialog). Pure data/formatting — no React.

export const STAGE_TYPE_OPTIONS = [
  ["phone_screen", "Phone Screen"],
  ["technical", "Technical"],
  ["behavioral", "Behavioral"],
  ["system_design", "System Design"],
  ["hiring_manager", "Hiring Manager"],
  ["panel", "Panel"],
  ["offer_call", "Offer Call"],
  ["other", "Other"],
];

export const STAGE_TYPE_LABELS = Object.fromEntries(STAGE_TYPE_OPTIONS);

export const STAGE_OUTCOME_OPTIONS = [
  ["pending", "Pending"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["cancelled", "Cancelled"],
];

export function createStageDialogState(overrides = {}) {
  return {
    open: false,
    applicationId: null,
    stageId: null,
    stageName: "",
    stageType: "phone_screen",
    scheduledAt: "",
    durationMinutes: "",
    outcome: "pending",
    interviewerNames: "",
    notes: "",
    ...overrides,
  };
}

// NOTE: this reads a `scheduled_at`-shaped value with `new Date(...)`
// directly, and treats a bare (offset-less) value as LOCAL wall-clock time -
// the opposite convention from parseStageInstant below, which treats the
// same shape as UTC. That is intentional here (this function exists to seed
// a <input type="datetime-local"> from a stored value with the input's own
// wall-clock-in-viewer's-zone semantics) but it means the two functions
// disagree about a bare value. Left as-is: this function has its own callers
// (TrackingTab.js) and changing its convention is out of scope for a
// timestamp-formatting fix.
export function formatDateTimeLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeInterviewValue(value) {
  return (value || "").trim().toLowerCase();
}

// A mandated read of a stored `scheduled_at` for display purposes (NOT the
// only reader of that field in this module - see the note on
// formatDateTimeLocalInputValue above, which reads the same field with the
// opposite, LOCAL convention for a different purpose). This function's
// domain is meant to be the DATABASE value, never the datetime-local input's
// wall-clock string: a bare timestamp here has no offset because the app's
// only writer stores full UTC (always with seconds - see
// upsertInterviewStage / useApplicationDialogs), so it must be treated as
// UTC. Plain `new Date(...)` on the same string parses it as LOCAL and
// silently shifts by the reader's own offset; that mis-parse is the defect
// this function exists to close. No caller of THIS function may call
// `new Date()` on a `scheduled_at` value directly.
//
// Caution: unlike the date-only shape (structurally excluded below - see
// widenZoneSuffix), the seconds-less datetime-local shape itself
// ("2026-09-10T13:00", i.e. exactly what formatDateTimeLocalInputValue
// produces) IS matched by this regex, because seconds are optional here.
// It is not reachable today (nothing currently feeds a datetime-local string
// into this function - the sole writer always includes seconds), but if it
// ever were, it would be misinterpreted as UTC instead of the LOCAL value
// the input control actually holds. This is closed by convention, not by
// the grammar, so guard any new caller accordingly.
const STAGE_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:\d{2}(?:\.\d+)?)?\s*(.*)$/;

// Classifies the trailing zone token of a matched timestamp. Anchoring the
// caller's regex on the time component first (rather than testing this
// suffix alone) is what keeps a date-only value like "2026-09-10" from ever
// reaching here - its trailing "-10" would otherwise misread as an offset.
function widenZoneSuffix(raw) {
  if (raw === "") return "Z"; // bare timestamp: the only writer emits UTC
  if (/^[Zz]$/.test(raw)) return "Z";
  const offset = raw.match(/^([+-])(\d{2}):?(\d{2})?$/);
  if (!offset) return null; // includes +HH:MM:SS and anything unrecognized - never a guess
  const [, sign, hh, mm] = offset;
  // V8 can't parse a short "+00"/"-10" offset at all; it must be widened to
  // "+00:00"/"-10:00" rather than merely detected.
  return `${sign}${hh}:${mm || "00"}`;
}

export function parseStageInstant(value) {
  if (typeof value !== "string") return null; // covers null, undefined, number, Date, object
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(STAGE_INSTANT_PATTERN);
  if (!match) return null;
  const [, year, month, day, hour, minute, secondsPart, zoneRaw] = match;
  const zone = widenZoneSuffix(zoneRaw);
  if (zone === null) return null;
  const iso = `${year}-${month}-${day}T${hour}:${minute}${secondsPart || ":00"}${zone}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
