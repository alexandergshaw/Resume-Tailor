// THE SESSION-WIDE ACTIVITY LEDGER -- the recorder half.
//
// ---------------------------------------------------------------------------
// AGGREGATE, DO NOT DUPLICATE
// ---------------------------------------------------------------------------
// This repo already has three feature logs built to one standing rule (every
// feature that can carry a log gets one, plus a clearly visible download
// button, one shared primitive, a single .md, surviving Clear):
// lib/duplicateApply/duplicateApplyLog.js + duplicateApplyLogDocument.js,
// lib/experience/knowledgeLog.js, and lib/copilot/sessionLog.js +
// sessionLogArchive.js. Each already knows how to render ITS OWN feature
// faithfully, and each has its own suite pinning that rendering.
//
// So this module does NOT re-record what they record. It does two things:
//
//   1. It records what NO feature log owns -- the app-wide event stream
//      (network, errors, navigation, feature actions), captured at choke
//      points so a subsystem nobody thought about is captured anyway.
//
//   2. It ATTACHES the feature logs. `attachSection(id, { title, render })` is
//      the entire seam: a feature calls it once, in one line, from wherever it
//      already holds its own ledger, and the app-wide document folds that
//      feature's own markdown into the same file. Nothing is re-implemented,
//      nothing is threaded through app/page.js, and the feature keeps sole
//      authority over how its own records read.
//
// `render` is a FUNCTION, not a string, and that is load-bearing: a feature
// hook attaches once at mount and the closure reads its refs when the user
// actually clicks download, so a section can never be a stale copy of what the
// feature held at mount time.
//
// ---------------------------------------------------------------------------
// NO PROP THREADING
// ---------------------------------------------------------------------------
// The default log is a module singleton and the writers are module-level
// functions, so a feature reaches the log with an import instead of a prop
// chain through app/page.js. That is a deliberate constraint, not convenience:
// app/page.js is a god component under an enforced line ceiling, and a logging
// facility whose adoption cost is "add a prop to page.js" is a facility that
// stops being adopted.
//
// ---------------------------------------------------------------------------
// PURITY
// ---------------------------------------------------------------------------
// `createActivityLog` is pure and injectable -- `now` is an argument, matching
// lib/copilot/sessionLog.js's own idiom, so no test depends on a wall clock. No
// DOM, no network, no globals: patching `fetch` and friends is
// activityInstrumentation.js's job, and it is a separate module precisely so
// this one stays testable without a browser.

import { redactSecretsDeep, redactSecretText } from "./activityRedaction.js";

export const ACTIVITY_LOG_SCHEMA = 1;

// A long-lived tab must not grow its log without bound, and the END of the
// session -- where the user actually noticed the problem -- has to survive, so
// the cap is a FIFO that evicts the oldest. Same reasoning as
// sessionLog.js's MAX_SESSION_LOG_EVENTS and duplicateApplyLogDocument.js's
// MAX_DUPE_LOG_ENTRIES; a larger number here because this stream carries every
// status poll in the app, not one feature's verdicts.
export const MAX_ACTIVITY_EVENTS = 800;

// How many feature logs may fold in. Not a memory bound (a section is a
// closure, not data) but a bound on the DOCUMENT: past a couple of dozen the
// file stops being readable, and a runaway attach loop would otherwise be
// invisible until someone opened the download.
export const MAX_ACTIVITY_SECTIONS = 16;

// A whole feature log, folded in. Generous -- the point of aggregation is that
// the fold-in is faithful -- but finite.
const MAX_SECTION_CHARS = 200_000;

// Channel and type are the entry's discriminators, and they are code names
// (`net`, `console.error`, `tailor.finished`), never free text. A value this
// long is being used as a smuggling channel, not a label.
const MAX_DISCRIMINATOR_CHARS = 120;

function safeDiscriminator(value) {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  return redactSecretText(value.slice(0, MAX_DISCRIMINATOR_CHARS)) || "unknown";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * createActivityLog({ now, startedAt }) -> { record, markInstalled,
 * attachSection, snapshot }
 *
 * Every method is total: none throws, whatever it is handed. A logging failure
 * must never break the thing being logged, and an error handler is one of this
 * module's own callers.
 */
export function createActivityLog({ now = Date.now, startedAt } = {}) {
  const clock = typeof now === "function" ? now : Date.now;
  const startedAtMs = Number.isFinite(startedAt) ? startedAt : 0;

  const events = [];
  const sections = new Map();
  let seq = 0;
  let installedAt = null;

  // The cap's bookkeeping. Silent truncation in a LOG is self-defeating, so
  // what went is recorded in the same breath as the eviction: how many, of
  // which kind, and over what stretch of time.
  let dropped = 0;
  const droppedByChannel = Object.create(null);
  let droppedFrom = null;
  let droppedTo = null;

  function readClock() {
    try {
      const value = clock();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  function pushEntry(entry) {
    events.push(entry);
    while (events.length > MAX_ACTIVITY_EVENTS) {
      const evicted = events.shift();
      dropped += 1;
      const channel = evicted && typeof evicted.channel === "string" ? evicted.channel : "unknown";
      droppedByChannel[channel] = (droppedByChannel[channel] || 0) + 1;
      if (droppedFrom === null) droppedFrom = evicted ? evicted.at : null;
      droppedTo = evicted ? evicted.at : droppedTo;
    }
  }

  function record(channel, type, fields) {
    const at = readClock();
    try {
      const payload = isPlainObject(fields) ? redactSecretsDeep(fields) : {};
      seq += 1;
      // The canonical five are spread LAST and win: a payload carrying its own
      // `type` (a question's `{ type: "behavioral" }`) must not be able to
      // overwrite the event's category. Same ruling as sessionLog.js's event().
      pushEntry({
        ...payload,
        seq,
        at,
        t: Math.round(at - startedAtMs),
        channel: safeDiscriminator(channel),
        type: safeDiscriminator(type),
      });
    } catch {
      // Even the redactor failed. A breadcrumb still beats a hole -- and the
      // seq keeps advancing so the gap is visible as a gap.
      try {
        seq += 1;
        pushEntry({
          seq,
          at,
          t: Math.round(at - startedAtMs),
          channel: "log",
          type: "log.error",
          note: "an event could not be recorded",
        });
      } catch {
        // Give up silently rather than let telemetry take the app down.
      }
    }
  }

  // The FIRST install is the boundary a reader needs ("nothing before this
  // instant is in this file"), so a later call cannot move it.
  function markInstalled(at) {
    if (installedAt === null && Number.isFinite(at)) installedAt = at;
  }

  function attachSection(id, { title, render } = {}) {
    const key = safeDiscriminator(id);
    try {
      if (typeof render !== "function") return () => {};
      if (!sections.has(key) && sections.size >= MAX_ACTIVITY_SECTIONS) return () => {};
      sections.set(key, { title: safeDiscriminator(title), render });
      return () => {
        // Only detach the entry still owned by this attach call, so a
        // remount's cleanup cannot remove its successor's section.
        if (sections.get(key)?.render === render) sections.delete(key);
      };
    } catch {
      return () => {};
    }
  }

  function renderSections() {
    const out = [];
    for (const [id, { title, render }] of sections) {
      let markdown;
      try {
        const raw = render();
        markdown = truncateBigString(redactSecretText(typeof raw === "string" ? raw : String(raw ?? "")));
      } catch {
        // Never the thrown text: an exception message is unvetted content and
        // this file is a disclosure surface.
        markdown = "_This feature log could not be rendered._";
      }
      out.push({ id, title, markdown });
    }
    return out;
  }

  function truncateBigString(str) {
    if (typeof str !== "string" || str.length <= MAX_SECTION_CHARS) return str;
    return `${str.slice(0, MAX_SECTION_CHARS)}\n\n_…[truncated ${str.length - MAX_SECTION_CHARS} characters]_`;
  }

  // Deliberately carries NO "taken at" clock read. The document is therefore a
  // pure function of what was recorded, so downloading an unchanged session
  // twice produces byte-identical files -- the same property
  // duplicateApplyLogFileName was built for, extended from the name to the
  // contents. The instant of the last event already bounds the session.
  function snapshot() {
    const raw = {
      schema: ACTIVITY_LOG_SCHEMA,
      startedAt: startedAtMs,
      installedAt,
      events,
      dropped,
      droppedByChannel: { ...droppedByChannel },
      droppedFrom,
      droppedTo,
      cap: MAX_ACTIVITY_EVENTS,
    };
    let cloned;
    try {
      // Every stored event was already made JSON-safe at record time, so a
      // stringify/parse round trip is a cheap, reliable deep clone -- later
      // record() calls mutate the live array, never this returned copy.
      cloned = JSON.parse(JSON.stringify(raw));
    } catch {
      cloned = { ...raw, events: [] };
    }
    // Sections are rendered AFTER the clone and are not part of it: they are
    // produced fresh at snapshot time by design (see the header).
    cloned.sections = renderSections();
    return cloned;
  }

  return { record, markInstalled, attachSection, snapshot };
}

// ---------------------------------------------------------------------------
// THE DEFAULT LOG.
//
// One per tab, created when the bundle loads. `startedAt` is therefore the
// instant this JavaScript began running, which is NOT the instant recording
// begins -- installActivityInstrumentation() does that, and stamps
// `installedAt` so the document can state the gap instead of implying there
// was none.
// ---------------------------------------------------------------------------
const defaultLog = createActivityLog({ startedAt: Date.now() });

export function recordActivity(channel, type, fields) {
  defaultLog.record(channel, type, fields);
}

export function attachActivitySection(id, options) {
  return defaultLog.attachSection(id, options);
}

export function markActivityLogInstalled(at) {
  defaultLog.markInstalled(at);
}

export function activityLogSnapshot() {
  return defaultLog.snapshot();
}
