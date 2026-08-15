// AC-Q1..Q4: "download a log of this session" — the pure recorder plus two
// renderers (Markdown transcript, raw JSON diagnostic). This module exists
// to explain the exact failure a user hit: a live session that started,
// looked live, and transcribed NOTHING, with no error on screen. So every
// function here is written to survive that session too — a log with zero
// transcript events is not a degenerate input to special-case away, it is
// the report this module was built to produce (AC-Q2.5).
//
// No DOM, no React, no network, no jszip, no `Date.now()` outside the `now`
// default argument — a later wave wires this into hooks and a download
// button; this half only ever records values and turns them into strings.

import { fmtClock } from "./clock.js";
import { speakerDisplayLabel } from "./speakerIdentity.js";

export const SESSION_LOG_SCHEMA = 1;

// AC-Q1.3: a long-running live session must not grow its log without bound,
// but the END of the session — where the user actually noticed the problem
// — has to survive. So the cap is a FIFO: oldest events are evicted first.
export const MAX_SESSION_LOG_EVENTS = 500;

// AC-Q1.5: a single oversized string field (a pasted job description, a raw
// provider error blob) must not blow up the log or the eventual download.
export const MAX_LOG_FIELD_CHARS = 4000;

const REDACTED = "[redacted]";

// AC-Q1.4 — key names treated as credential-shaped, after normalizing away
// case and separators so "apiKey", "api_key", "api-key" and "API_KEY" all
// collapse to the same check. Matched on the KEY only, never on the value,
// so an ordinary field like "keywords" is never caught just because it
// contains the substring "key".
const CREDENTIAL_KEYS = new Set([
  "token",
  "apikey",
  "authorization",
  "secret",
  "password",
  "credential",
]);

function isCredentialKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return CREDENTIAL_KEYS.has(normalized);
}

// AC-Q1.5: truncate a field value rather than dropping the whole event —
// the surrounding fields (type, id, code) are usually more diagnostically
// useful than the one oversized string, so they must survive intact.
function truncateString(str) {
  if (str.length <= MAX_LOG_FIELD_CHARS) return str;
  const droppedChars = str.length - MAX_LOG_FIELD_CHARS;
  return `${str.slice(0, MAX_LOG_FIELD_CHARS)} …[truncated ${droppedChars} chars]`;
}

// AC-Q1.4/Q1.5 — the single recursive pass that makes a value safe to keep:
// redact credential-shaped keys, truncate oversized strings, break cycles,
// and turn functions into a marker instead of leaving a value `event()`
// could not later hand to JSON.stringify. `seen` is a fresh WeakSet per
// top-level call and is entered/exited around each object so a DIAMOND
// reference (the same sub-object reached twice, but not a cycle) is still
// fully rendered — only an actual ancestor-of-itself trips "[circular]".
function sanitizeValue(value, seen, depth) {
  if (depth > 12) return "[max depth]";
  if (value === null || value === undefined) return value;

  const kind = typeof value;
  if (kind === "string") return truncateString(value);
  if (kind === "number" || kind === "boolean") return value;
  if (kind === "function") return "[function]";
  if (kind !== "object") return String(value); // symbol, bigint, ...

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => sanitizeValue(item, seen, depth + 1));
  } else {
    result = {};
    for (const key of Object.keys(value)) {
      if (isCredentialKey(key)) {
        result[key] = REDACTED;
        continue;
      }
      try {
        result[key] = sanitizeValue(value[key], seen, depth + 1);
      } catch {
        // A hostile getter can throw on read. AC-Q1.5: the field is lost,
        // never the event or the session.
        result[key] = "[unserializable]";
      }
    }
  }

  seen.delete(value);
  return result;
}

// The fields `event()` spreads onto the entry. Anything that is not a
// plain, non-array object contributes no fields rather than throwing or
// (worse) spreading a string's characters onto the event by index.
function sanitizePayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return sanitizeValue(data, new WeakSet(), 0);
}

// AC-Q1.1/Q1.2 — the recorder. `now` is injected so a timestamp is a value
// under test, not whatever the machine's wall clock says at the moment a
// test happens to run.
export function createSessionLog({ mode, source, provider, startedAt, now = Date.now } = {}) {
  const startedAtMs = Number.isFinite(startedAt) ? startedAt : 0;
  const events = [];
  let dropped = 0;

  function pushEntry(entry) {
    events.push(entry);
    if (events.length > MAX_SESSION_LOG_EVENTS) {
      // AC-Q1.3: drop the OLDEST, one at a time, so the tail of a long
      // session is always what survives.
      events.shift();
      dropped += 1;
    }
  }

  function computeT() {
    try {
      const t = now() - startedAtMs;
      return Number.isFinite(t) ? Math.round(t) : 0;
    } catch {
      return 0;
    }
  }

  function event(type, data) {
    const t = computeT();
    try {
      const safeType = sanitizeValue(type, new WeakSet(), 0);
      const payload = sanitizePayload(data);
      // `t`/`type` are the entry's own discriminators, not data fields — a
      // payload that happens to carry its own "type" key (e.g.
      // question.added's `{ type: "behavioral" }`) must not be able to
      // overwrite the event's category, so the canonical pair is spread
      // LAST and wins.
      pushEntry({ ...payload, t, type: safeType });
    } catch {
      // AC-Q1.5: a logging failure must never break a live interview — but
      // the moment it happened is itself worth a breadcrumb, so a minimal
      // fallback entry still records that SOMETHING happened here.
      try {
        pushEntry({ t, type: "log.error", note: "event could not be recorded" });
      } catch {
        // Even the fallback failed (e.g. `now()` itself throws every time).
        // Give up silently rather than let telemetry take the interview down.
      }
    }
  }

  function snapshot() {
    // AC-Q1.2: independent of further recording. Every stored event was
    // already sanitized to be JSON-safe at record time, so a stringify/parse
    // round trip is a cheap, reliable deep clone — later `event()` calls
    // mutate the live `events` array, never this returned copy.
    const raw = { schema: SESSION_LOG_SCHEMA, mode, source, provider, startedAt: startedAtMs, events, dropped };
    try {
      return JSON.parse(JSON.stringify(raw));
    } catch {
      return { schema: SESSION_LOG_SCHEMA, mode, source, provider, startedAt: startedAtMs, events: [], dropped };
    }
  }

  return { event, snapshot };
}

// Render any value for display without ever producing "[object Object]" or
// the literal word "undefined" (AC-Q2.6).
function safeStr(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatStartedAt(startedAt) {
  const d = new Date(typeof startedAt === "number" ? startedAt : NaN);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toISOString();
}

// AC-Q2.2 — reuses speakerDisplayLabel (never restates speaker-label
// resolution). Falls back to the raw "them"/"you" string the event was
// recorded with only when no numeric speakerTag could be resolved — e.g. an
// older log, or a transcript frame captured before diarization kicked in.
function transcriptLabel(evt, speakerSnapshot) {
  const resolved = speakerDisplayLabel(evt.speakerTag, speakerSnapshot);
  if (resolved && resolved !== "unknown") return resolved;
  if (evt.speaker === "you") return "You";
  if (evt.speaker === "them") return "Them";
  return "Unknown speaker";
}

function formatFields(evt) {
  const parts = [];
  for (const key of Object.keys(evt)) {
    if (key === "t" || key === "type") continue;
    if (evt[key] === undefined) continue;
    parts.push(`${key}: ${safeStr(evt[key])}`);
  }
  return parts.length ? parts.join(", ") : "(no additional detail)";
}

// AC-Q2 — the readable record. Three narrative sections (Transcript,
// Questions and drafted answers, Diagnostics) that partition the events:
// each event is rendered in exactly one place, so the one line explaining a
// silent failure never gets buried under turns already shown above it.
function buildMarkdown(snapshot, opts) {
  const mode = typeof snapshot.mode === "string" ? snapshot.mode : "unknown";
  const source = typeof snapshot.source === "string" ? snapshot.source : "unknown";
  const provider = typeof snapshot.provider === "string" ? snapshot.provider : "unknown";
  const events = Array.isArray(snapshot.events) ? snapshot.events.filter(Boolean) : [];
  const dropped = Number.isFinite(snapshot.dropped) ? snapshot.dropped : 0;
  const lastT = events.length ? events[events.length - 1].t : 0;
  const speakerSnapshot = opts.speakerSnapshot;

  const lines = [];
  lines.push(`# Interview session log — ${mode}`);
  lines.push("");
  lines.push(`- Mode: ${mode}`);
  lines.push(`- Source: ${source}`);
  lines.push(`- Provider: ${provider}`);
  lines.push(`- Started: ${formatStartedAt(snapshot.startedAt)}`);
  lines.push(`- Duration: ${fmtClock(lastT)}`);
  lines.push(
    `- Events recorded: ${events.length}${dropped ? ` (plus ${dropped} older events dropped)` : ""}`,
  );
  lines.push("");

  // AC-Q2.2: only a FINALIZED turn is a line here — an interim frame is not
  // a turn, it is the same words about to be re-sent, and would double
  // every line (and, per AC-Q2.6, its text must not appear ANYWHERE in the
  // document, not just be missing from this section).
  lines.push("## Transcript");
  lines.push("");
  const turns = events.filter((e) => e.type === "transcript" && e.isFinal === true);
  if (!turns.length) {
    // AC-Q2.5: the exact case this module exists to explain.
    lines.push("_No speech was transcribed during this session._");
  } else {
    for (const evt of turns) {
      const label = transcriptLabel(evt, speakerSnapshot);
      lines.push(`- [${fmtClock(evt.t)}] **${label}:** ${safeStr(evt.text)}`);
    }
  }
  lines.push("");

  lines.push("## Questions and drafted answers");
  lines.push("");
  const questions = events.filter((e) => e.type === "question.added");
  if (!questions.length) {
    lines.push("_No questions were detected._");
  } else {
    for (const q of questions) {
      const answer = events.find((e) => e.type === "answer.done" && e.id === q.id);
      lines.push(`### [${fmtClock(q.t)}] ${safeStr(q.question)}`);
      if (answer) {
        lines.push(`Drafted [${fmtClock(answer.t)}]:`);
        const points = Array.isArray(answer.points) ? answer.points : [];
        if (points.length) {
          for (const p of points) lines.push(`- ${safeStr(p)}`);
        } else {
          lines.push("_No answer drafted._");
        }
      } else {
        lines.push("_No answer drafted._");
      }
      lines.push("");
    }
  }

  // AC-Q2.4: everything not already carried by the two narrative sections
  // above — repeating transcript turns or question/answer pairs here would
  // bury the one diagnostic line (a close code, a provider error) that
  // actually explains a session that did nothing.
  lines.push("## Diagnostics");
  lines.push("");
  const diagnostics = events.filter(
    (e) => e.type !== "transcript" && e.type !== "question.added" && e.type !== "answer.done",
  );
  if (!diagnostics.length) {
    lines.push("_No additional diagnostic events were recorded._");
  } else {
    for (const evt of diagnostics) {
      lines.push(`- [${fmtClock(evt.t)}] **${safeStr(evt.type)}** — ${formatFields(evt)}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function renderSessionLogMarkdown(snapshot, opts) {
  try {
    return buildMarkdown(snapshot || {}, opts || {});
  } catch {
    // AC-Q2.6: never throw, whatever it was handed.
    return "# Interview session log\n\n_This log could not be rendered._\n";
  }
}

// AC-Q3 — the raw diagnostic record. A snapshot produced by createSessionLog
// is already JSON-safe, so this is a thin, defensive wrapper: it must never
// throw even when handed something that never went through that recorder.
export function renderSessionLogJson(snapshot) {
  try {
    return JSON.stringify(snapshot === undefined ? null : snapshot, null, 2);
  } catch {
    try {
      return JSON.stringify({ schema: SESSION_LOG_SCHEMA, error: "unserializable snapshot" });
    } catch {
      return "{}";
    }
  }
}

const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

function sanitizeForFilename(str) {
  const cleaned = String(str).replace(UNSAFE_FILENAME_CHARS, "-").replace(/\s+/g, " ").trim();
  return cleaned || "session";
}

// AC-Q4 — the download name, built from the session's OWN start time (not
// the machine clock at download time) so re-downloading the same session
// always produces the same filename.
export function sessionLogFileBase(snapshot) {
  const mode = sanitizeForFilename(
    snapshot && typeof snapshot.mode === "string" && snapshot.mode ? snapshot.mode : "session",
  );
  const startedAt = snapshot && Number.isFinite(snapshot.startedAt) ? snapshot.startedAt : Date.now();
  const d = new Date(startedAt);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}`;
  return `interview-log-${mode}-${stamp}`;
}
