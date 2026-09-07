// THE DOWNLOADED FILE: one markdown document for a whole session, and the name
// it is saved under.
//
// The other half of appActivityLog.js, split for the same reason
// duplicateApplyLogDocument.js is split from duplicateApplyLog.js: the recorder
// stays a pure, injectable ledger with its own suite, and everything that is
// only true of a WHOLE SESSION -- the scope statement, the drop notice, the
// ordering, the file name -- lives here.
//
// PURE AND SYNCHRONOUS. No Date.now() (every instant arrives as a number on the
// snapshot), no DOM, no network, no import of triggerBlobDownload -- that is a
// DOM helper for the actual click, and this module has no DOM. Never throws:
// the one thing worse than an incomplete log is a download button that fails.
//
// TWO THINGS THIS FILE MUST ALWAYS SAY, even when there is nothing to report:
//
//   1. WHAT IT CONTAINS AND WHAT IT DOES NOT, from activityChannels.js, so a
//      reader can tell "nothing happened" from "that subsystem does not report
//      to this file". The coverage sweep checks both directions of that
//      registry against the real tree, so these paragraphs cannot go stale
//      without a red test.
//
//   2. WHAT IT DROPPED. A log that silently truncates has defeated itself --
//      lib/experience/pageContext.js shipped exactly that and it took a
//      measured reproduction to find. The notice names the count, the kinds and
//      the stretch of time that went, and it is rationed through
//      lib/experience/droppedNames.js (the one shared fragment builder every
//      budgeted surface in this repo uses) so the notice can never be the thing
//      that overflows.

import { formatDroppedNames } from "../experience/droppedNames.js";
import { CAPTURED_CHANNELS, UNCAPTURED_SURFACES, FEATURE_LOG_LEDGER } from "./activityChannels.js";
import { MAX_ACTIVITY_EVENTS } from "./appActivityLog.js";

// How much of the drop notice the NAMES may occupy. The reserve never moves,
// the names do (droppedNames.js's own rule): with forty channels in play the
// fragment gives names back to the "and N more" tally until it fits, so the
// sentence stays one readable line instead of growing without bound.
const DROP_NOTICE_NAME_BUDGET = 200;

// The document's own outline is `#` / `##` / `###`. An attached feature log
// brings its own `#` heading, so every heading it carries is pushed three
// levels down; without that the combined file reads as several documents
// stapled together rather than one.
const SECTION_HEADING_DEMOTION = 3;

const NONE = "-";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// An epoch-millisecond instant in UTC, deliberately not the machine's local
// zone: this file crosses timezones the moment it is attached to a ticket, and
// a local stamp would make one session read as two different times to two
// readers. Same ruling as duplicateApplyLogDocument.js's own `iso`.
function iso(value) {
  const ms = safeNumber(value);
  if (ms === null) return "unknown";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "unknown";
  }
}

// Renders any value without ever producing "[object Object]" or the literal
// word this function exists to avoid printing.
function safeStr(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unreadable]";
  }
}

const RESERVED_EVENT_KEYS = new Set(["seq", "at", "t", "channel", "type"]);

function formatFields(event) {
  const parts = [];
  for (const key of Object.keys(event)) {
    if (RESERVED_EVENT_KEYS.has(key)) continue;
    if (event[key] === undefined) continue;
    parts.push(`${key}: ${safeStr(event[key])}`);
  }
  return parts.length ? parts.join(", ") : "(no further detail)";
}

function renderHeader(lines, snapshot) {
  const events = Array.isArray(snapshot.events) ? snapshot.events.filter(Boolean) : [];
  const installedAt = safeNumber(snapshot.installedAt);

  lines.push("# Activity log");
  lines.push("");
  lines.push(`- Schema: ${safeNumber(snapshot.schema) ?? 1}`);
  lines.push(`- Tab opened: ${iso(snapshot.startedAt)}`);
  lines.push(
    installedAt === null
      ? "- Recording started: never installed in this tab, so no automatic capture ran at all"
      : `- Recording started: ${iso(installedAt)}`,
  );
  lines.push(`- Events recorded: ${events.length}`);
  renderDropNotice(lines, snapshot);
  lines.push("");
}

function renderDropNotice(lines, snapshot) {
  const dropped = safeNumber(snapshot.dropped) ?? 0;
  if (dropped <= 0) return;
  const byChannel = isPlainObject(snapshot.droppedByChannel) ? snapshot.droppedByChannel : {};
  const names = Object.keys(byChannel)
    .sort()
    .map((channel) => `${channel} (${byChannel[channel]})`);
  const fragment = formatDroppedNames(names, { budget: DROP_NOTICE_NAME_BUDGET });
  const cap = safeNumber(snapshot.cap) ?? MAX_ACTIVITY_EVENTS;
  const kinds = fragment || `${names.length} kinds of event`;
  lines.push(
    `- ${dropped} older entries were dropped to stay under the ${cap}-event cap: ${kinds}. ` +
      `They covered ${iso(snapshot.droppedFrom)} to ${iso(snapshot.droppedTo)}.`,
  );
}

function renderScope(lines) {
  lines.push("## What this file contains");
  lines.push("");
  for (const channel of CAPTURED_CHANNELS) {
    const how = channel.how === "choke-point" ? "captured automatically" : "recorded by each feature";
    lines.push(`- **${channel.label}** (${how}) — ${channel.what}`);
  }
  lines.push("");

  lines.push("## What this file does NOT contain");
  lines.push("");
  for (const gap of UNCAPTURED_SURFACES) {
    lines.push(`- **${gap.what}.** ${gap.why}`);
  }
  lines.push("");

  lines.push("### Feature logs");
  lines.push("");
  lines.push(
    "This app keeps a separate log for several features. The ones marked included are folded into this file in full, further down; the rest have their own download control where the feature lives.",
  );
  lines.push("");
  for (const entry of FEATURE_LOG_LEDGER) {
    lines.push(entry.attached ? `- **${entry.label}** — included below.` : `- **${entry.label}** — not included. ${entry.why}`);
  }
  lines.push("");
}

function renderEvents(lines, snapshot) {
  const events = Array.isArray(snapshot.events) ? snapshot.events.filter(Boolean) : [];
  lines.push(`## Activity (${events.length})`);
  lines.push("");
  if (events.length === 0) {
    // The state this section exists to make legible. Read with the "Recording
    // started" line above, these two together are what tell a reader whether
    // this session was quiet or this file never watched it.
    lines.push("_No activity has been recorded in this session._");
    lines.push("");
    return;
  }
  for (const event of events) {
    const ordinal = safeNumber(event.seq);
    lines.push(
      `- [${iso(event.at)}] #${ordinal === null ? NONE : ordinal} ` +
        `\`${safeStr(event.channel)}\` **${safeStr(event.type)}** — ${formatFields(event)}`,
    );
  }
  lines.push("");
}

// Push every ATX heading in an attached log down the outline. Only a heading at
// the start of a line is touched, so a `#` inside a code fence or mid-sentence
// is left exactly as the feature wrote it.
const HEADING_RE = /^(#{1,6})(\s)/gm;

function demoteHeadings(markdown) {
  if (typeof markdown !== "string") return "";
  return markdown.replace(HEADING_RE, (_match, hashes, space) =>
    `${"#".repeat(Math.min(6, hashes.length + SECTION_HEADING_DEMOTION))}${space}`,
  );
}

function renderSections(lines, snapshot) {
  const sections = Array.isArray(snapshot.sections) ? snapshot.sections.filter(isPlainObject) : [];
  if (sections.length === 0) return;
  lines.push("## Feature logs folded in");
  lines.push("");
  for (const section of sections) {
    lines.push(`### ${safeStr(section.title) || safeStr(section.id) || "Feature log"}`);
    lines.push("");
    lines.push(demoteHeadings(safeStr(section.markdown)));
    lines.push("");
  }
}

function buildDocument(snapshot) {
  const lines = [];
  renderHeader(lines, snapshot);
  renderScope(lines);
  renderEvents(lines, snapshot);
  renderSections(lines, snapshot);
  return `${lines.join("\n")}\n`;
}

/**
 * renderActivityLog(snapshot) -> markdown string.
 *
 * `snapshot` is a createActivityLog().snapshot() output. Anything else degrades
 * field by field: the scope statement and the honest "nothing was recorded"
 * still render, because a reader holding a broken file needs to know what it
 * was supposed to be more than they need it to be blank.
 */
export function renderActivityLog(snapshot) {
  try {
    return buildDocument(isPlainObject(snapshot) ? snapshot : {});
  } catch {
    return "# Activity log\n\n_This log could not be rendered._\n";
  }
}

const FILE_STEM = "activity-log";

/**
 * activityLogFileName({ startedAt }) -> "activity-log-YYYY-MM-DD-HHMM.md".
 *
 * Built from the tab's OWN start instant, not the clock at download time, so
 * downloading the same session twice produces the same name. Nothing
 * caller-supplied is interpolated: a file name shows up in a download shelf, a
 * shared drive and a ticket's attachment list, so it is a timestamp and a
 * constant, leaving nothing to scrub. Same ruling, and the same UTC stamp, as
 * duplicateApplyLogFileName.
 */
export function activityLogFileName(snapshot) {
  const stamp = iso(isPlainObject(snapshot) ? snapshot.startedAt : undefined);
  if (stamp === "unknown") return `${FILE_STEM}-unknown-start.md`;
  // Sliced off the ISO string rather than re-derived from Date getters, so the
  // printed instant and the file name can never disagree about the minute.
  return `${FILE_STEM}-${stamp.slice(0, 10)}-${stamp.slice(11, 13)}${stamp.slice(14, 16)}.md`;
}
