// Turns a finished meeting into an ordinary Experience page.
//
// Pure on purpose: every timestamp (`startedAt`, `endedAt`) is an argument,
// never `Date.now()` or `new Date()` with no argument, so this module never
// reads a clock and the whole shape is testable without rendering anything.
// All date/duration math below is done in UTC, not local time, for the same
// reason — a builder that formats in the machine's timezone would put a
// different calendar date on the same meeting depending on where the server
// (or the test runner) happens to be running, and this repo's test suite
// pins an exact date string.
//
// --- The decision this file exists to carry -------------------------------
//
// The page this function returns is saved as an ORDINARY Experience page. It
// is deliberately NOT marked `generated_kind`. The user's instruction was
// that a recorded meeting is their own experience and must be used when
// tailoring a résumé and when answering in an interview — and both of those
// paths (lib/copilot/projectStories.js, lib/experience/tailorSources.js)
// skip any row with that column set. Marking this page `generated_kind`
// would have made the feature useless for its main purpose while still
// looking correct in every other view. So it is not marked, and that choice
// moves the honesty burden onto THIS FILE'S OUTPUT SHAPE instead: a
// transcript contains other people's words, and /api/copilot/answer
// instructs the model to speak project-page material as the candidate's own
// experience. If this page read like an ordinary first-person project page
// top to bottom, that instruction would make the model claim other people's
// sentences as the user's.
//
// The mitigation is structural, not a disclaimer buried at the bottom:
//   1. The body LEADS with the topic and the user's own discussion points —
//      the reusable part, and the part that is genuinely theirs.
//   2. The transcript comes after, under a heading ("## Transcript") that
//      says plainly it is a recording of several people. Nothing is
//      withheld — every finalized turn is kept, verbatim — it is labelled.
//   3. Insights carry their source attribution into the page. "From your
//      page: X" matters as much a week later as it did live: without it,
//      the page records a claim with no way to tell whose it was. An
//      insight the model composed (`source.kind === "model"`) is never
//      given an implied source — see `insightAttribution` below.
//
// See lib/meeting/insightContract.js for the insight shape and
// `meetingSpeakerLabel`, and lib/meeting/meetingNotices.js for the
// speaker-attribution reasoning this reuses (a single in-person room mic has
// no structural signal for who is talking, so a "room" turn gets no label —
// inventing one, e.g. "Room:", would put a false attribution into a page
// that later becomes interview material, which is the exact failure this
// whole feature has been built to avoid).

import { meetingSpeakerLabel } from "./insightContract.js";

// --- small formatting helpers, all pure, all UTC ---------------------------

// YYYY-MM-DD in UTC. Returns null on anything that isn't a real timestamp
// rather than throwing — a thin/aborted meeting can arrive with missing or
// malformed timestamps, and losing the whole page over a bad date field
// would be a worse outcome than a page that says the date is unknown.
function formatDateUTC(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Whole minutes between two epoch-millisecond timestamps. Rounded rather
// than floored/ceilinged because "42 min" read by a human is an estimate of
// wall-clock length, not a precise duration a downstream system parses back.
function durationMinutes(startedAt, endedAt) {
  if (typeof startedAt !== "number" || typeof endedAt !== "number") return null;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  const ms = endedAt - startedAt;
  if (ms < 0) return null;
  return Math.round(ms / 60000);
}

// How the meeting was captured, in the same vocabulary
// lib/meeting/meetingNotices.js uses for its consent copy: an in-person
// meeting is one shared room microphone picking up everyone, a call has two
// structurally separate audio streams (the user's own mic, the other side's
// audio). Any other/unknown `source` value is echoed back rather than
// guessed at, since this function has no basis to describe a capture method
// it doesn't recognise.
function describeCapture(source) {
  if (source === "inperson") return "in person, on a single shared room microphone";
  if (source === "tab") return "on a call, with your mic and the other side's audio captured separately";
  if (typeof source === "string" && source.trim()) return source.trim();
  return "an unspecified source";
}

// --- insights: the reusable, user-owned part of the page --------------------

// Defensive by design, same posture as insightContract.js's
// normalizeInsights: this runs against whatever a live meeting session
// happened to accumulate, including a session someone abandoned immediately,
// so it must survive any shape in the list without throwing rather than
// assume every entry is a well-formed insight.
function safeInsights(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.filter(
    (entry) => entry && typeof entry === "object" && typeof entry.text === "string" && entry.text.trim().length > 0,
  );
}

// The attribution clause for one insight, or "" when none is warranted.
//
// This is the other half of the honesty mitigation described at the top of
// the file: an insight whose `source.kind` is "page" or "attachment" names
// where it came from, because that is a real, checkable claim of
// provenance. An insight whose source is "model" (the model composed it
// itself, with nothing to point back to) or "transcript" gets NO
// attribution clause at all — appending "(from your page: ...)" to every
// line regardless of source would read as evidence for a claim that has
// none, which is worse than no claim, and is exactly the failure mode
// insightContract.js's `normalizeSource` was written to prevent one layer
// up from here. This function trusts that upstream normalization but does
// not re-derive it — it only ever prints what `source` already says.
function insightAttribution(source) {
  if (!source || typeof source !== "object") return "";
  if (source.kind === "page" && typeof source.pageTitle === "string" && source.pageTitle.trim()) {
    return ` (from your page: ${source.pageTitle.trim()})`;
  }
  if (source.kind === "attachment" && typeof source.attachmentName === "string" && source.attachmentName.trim()) {
    return ` (from your attachment: ${source.attachmentName.trim()})`;
  }
  return "";
}

function buildDiscussionPointsSection(rawInsights) {
  const valid = safeInsights(rawInsights);
  const lines = ["## Discussion points", ""];
  if (valid.length === 0) {
    // Explicit, not just an empty section: a reader (or the tailoring code
    // that later mines this page) needs to be able to tell "no points were
    // raised" apart from "this section failed to render".
    lines.push("No discussion points were captured for this meeting.");
    return lines.join("\n");
  }
  for (const insight of valid) {
    lines.push(`- ${insight.text.trim()}${insightAttribution(insight.source)}`);
  }
  return lines.join("\n");
}

// --- transcript: everyone's words, plainly labelled as such -----------------

// Only finalized turns belong in a saved page. Interim text is a live
// speech-to-text provider's half-heard guess that it may still revise a
// moment later — accurate for a screen that updates every second, actively
// wrong for a page meant to be permanent. A turn with no usable text is
// dropped for the same "survive junk without throwing" reason as
// `safeInsights` above.
function safeTurns(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter(
      (turn) =>
        turn &&
        typeof turn === "object" &&
        typeof turn.text === "string" &&
        turn.text.trim().length > 0 &&
        !turn.interim,
    )
    .slice()
    .sort((a, b) => {
      const aAt = typeof a.at === "number" ? a.at : 0;
      const bAt = typeof b.at === "number" ? b.at : 0;
      return aAt - bAt;
    });
}

// One transcript line. `meetingSpeakerLabel` already encodes the rule that
// matters here — "you"/"them" (a call's two structurally separate audio
// streams) resolve to "You"/"Others", while "room" (one shared in-person
// mic, no way to tell who spoke) resolves to "" — so this function only has
// to act on the label it's given, not re-derive when one is deserved. A
// falsy label means write the line with NO speaker prefix at all: not
// "Room:", not "Speaker:", nothing. Inventing either would put a false
// attribution into a page that later gets read back to the user as their
// own interview material, which is precisely the failure this feature has
// been built around avoiding.
function formatTurnLine(turn) {
  const label = meetingSpeakerLabel(turn.speaker);
  const text = turn.text.trim();
  return label ? `- **${label}:** ${text}` : `- ${text}`;
}

function buildTranscriptSection(rawTurns) {
  const valid = safeTurns(rawTurns);
  const lines = [
    "## Transcript",
    "",
    // THE honesty mitigation for the transcript half of the page: this is a
    // recording of everyone in the room or on the call, not a first-person
    // account, and /api/copilot/answer speaks project-page material as the
    // candidate's own experience. Every word below is kept — nothing is
    // withheld — this sentence just makes sure a later reader (human or
    // model) can tell these are several people's words before treating any
    // of them as the user's own.
    // Deliberately written for the person who opens this page months later,
    // not for the code that reads it. An earlier draft named the tailoring
    // and interview-copilot internals here; that is true but it is not the
    // reader's problem, and a page in someone's own knowledge base should
    // not explain itself in terms of the machinery that consumes it. The
    // fact that matters to BOTH audiences is the same one either way: these
    // are several people's words.
    "This is a recording of everyone in the room or on the call, so it contains several people's words, not only yours. Nothing has been removed — the speakers are labelled so that anything later drawn from this page can tell whose words are whose.",
    "",
  ];
  if (valid.length === 0) {
    lines.push("No turns were captured for this meeting.");
    return lines.join("\n");
  }
  for (const turn of valid) {
    lines.push(formatTurnLine(turn));
  }
  return lines.join("\n");
}

// --- the page itself ---------------------------------------------------------

/**
 * Build the `{ title, body }` of the Experience page a finished meeting is
 * saved as. Pure: every timestamp is an argument, so this never reads a
 * clock. Never throws — a meeting that was started and abandoned seconds
 * later (no topic, no turns, no insights) still produces a coherent page
 * rather than losing whatever there was because the last step failed.
 *
 * See the file-level comment for why the page this returns is intentionally
 * NOT marked `generated_kind` by its caller, and why the body is shaped the
 * way it is instead.
 */
export function buildMeetingPage({ topic, insights, turns, startedAt, endedAt, source } = {}) {
  const day = formatDateUTC(startedAt) || formatDateUTC(endedAt) || "an unknown date";
  const cleanTopic = typeof topic === "string" ? topic.trim() : "";

  // A page tree full of bare "Meeting" entries is unusable a month later, so
  // the topic leads the title whenever one was ever worked out. When it
  // wasn't — a short meeting, or one that ended before the first read
  // landed — the title still needs to be usable on its own, so it falls
  // back to a plain "Meeting notes" label rather than being topic-shaped
  // with a hole in it.
  const title = cleanTopic ? `${cleanTopic} — Meeting notes (${day})` : `Meeting notes (${day})`;

  const minutes = durationMinutes(startedAt, endedAt);
  const durationText = minutes === null ? "an unknown length of time" : `${minutes} min`;
  const captureText = describeCapture(source);

  const headerLines = [`## ${cleanTopic || "Meeting"}`, "", `Held ${day}, ran ${durationText}, captured ${captureText}.`];

  const body = [headerLines.join("\n"), buildDiscussionPointsSection(insights), buildTranscriptSection(turns)].join(
    "\n\n",
  );

  return { title, body };
}
