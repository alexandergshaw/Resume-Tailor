// THE ONE PLACE THE GLOSSARY'S STATE IS VISIBLE -- AC-T8.
//
// The bullets themselves never change while a posting's glossary is absent,
// incomplete or failed: no spinner on a bullet, no placeholder underline, no
// "still working" caption. That is AC-T7, and it is not a style preference --
// the copilot is read DURING a live interview, and a bullet that changes shape
// under the reader's eyes is worse than a bullet with no marks.
//
// So the state has to be visible SOMEWHERE, and this is it: one plain-text line
// in a collapsed "Terms for this posting" section beside the answer. One line
// per state, never an icon and never a colour (WCAG 1.4.1), because the state
// is the only thing carrying the meaning and it has to survive being read
// aloud or printed in black and white.
//
// SIXTEEN STATES, ENUMERATED. Three of them exist because their absence is how
// this ships as a mystery: a rebuild limit with no line is a permanently dead
// button, a cooldown with no line is a button that does nothing for an hour,
// and a cron that is not running at all is invisible from the outside. A row
// that cannot act offers NO CONTROL rather than a control that will be refused.
//
// ONE DEVIATION FROM THE SPECIFIED WORDING, stated rather than slipped in. The
// specification's line for the "no row" state read "...have not been researched
// yet", and the same specification rules the word "researched" out of every
// user-facing string in this feature -- because a candidate who reads it thirty
// seconds before an interview may repeat a definition and say "I researched
// this", a claim about their own preparation that our label licensed and cannot
// support. A rule with an exception for the one line that happens to want the
// word is not a rule, so this says "collected", which is also what the `failed`
// line already said.

import { RESEARCH_FLOOR, WORKER_STALL_MS, GENERATION_COOLDOWN_MS } from "./glossaryConstants.js";

/** The four states a user can actually do something about. */
export const RETRY = "Retry";
export const REBUILD = "Rebuild";

/**
 * Every row state this panel can render, in the order they are decided.
 * Exported as data so a test can assert there are sixteen of them and that
 * every one is reachable, rather than counting branches by eye.
 */
export const GLOSSARY_PANEL_ROWS = Object.freeze([
  "none",
  "in-flight",
  "above-floor",
  "below-floor",
  "unsearched",
  "ready",
  "truncated-model",
  "truncated-ceiling",
  "truncated-bytes",
  "stale",
  "quotes-only",
  "unavailable",
  "failed",
  "call-cap",
  "cooldown",
  "worker-stalled",
]);

const state = (key, line, control = null) => Object.freeze({ key, row: GLOSSARY_PANEL_ROWS.indexOf(key) + 1, line, control });

function countOf(value) {
  return Number.isFinite(value) ? value : 0;
}

function dateText(value) {
  const at = Date.parse(value || "");
  if (!Number.isFinite(at)) return "an earlier date";
  return new Date(at).toISOString().slice(0, 10);
}

function timeText(value, cooldownMs) {
  const at = Date.parse(value || "");
  if (!Number.isFinite(at)) return "a short while";
  return new Date(at + cooldownMs).toISOString().slice(11, 16);
}

/**
 * The single line the panel renders for one glossary row.
 *
 * @param {object|null|undefined} row the stored row, or null when there is none
 * @param {{now?: number, staleFingerprint?: boolean, atCallCap?: boolean}} [options]
 *   `staleFingerprint` and `atCallCap` are INPUTS rather than derivations: the
 *   fingerprint is a server-side hash over the posting text and the call caps
 *   are compared against constants the browser has no business re-deriving, so
 *   both are supplied by whoever read the row. Defaulting them to `false` means
 *   a caller that cannot supply them gets a correct, if less specific, line
 *   rather than a wrong one.
 */
export function glossaryPanelState(row, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  if (!row || typeof row !== "object") {
    return state("none", "Terms for this posting have not been collected yet.");
  }

  const terms = Array.isArray(row.terms) ? row.terms.length : 0;
  const researched = countOf(row.researched_count);
  const recalled = countOf(row.recalled_count);
  const cursor = countOf(row.research_cursor);
  const total = countOf(row.research_total);

  if (row.status === "unavailable") {
    return state("unavailable", "This posting has no description text, so there was nothing to research.");
  }
  if (row.status === "quotes-only") {
    return state(
      "quotes-only",
      "The embedded engine quotes the posting instead of looking terms up. These are the terms this posting states, each with the sentence it appears in. Switch to the Gemini engine and press Rebuild to add definitions with sources.",
    );
  }

  // The cron detector, ahead of every other in-flight reading: a row queued
  // long ago that has not advanced ONE batch is not slow, it is unattended, and
  // that is a deployment fact rather than a user-visible wait.
  const queuedAt = Date.parse(row.queued_at || "");
  if (total > 0 && cursor === 0 && Number.isFinite(queuedAt) && now - queuedAt > WORKER_STALL_MS) {
    return state("worker-stalled", "Sources for this posting have not started being added. Something is wrong on our side.");
  }

  if (row.status === "failed") {
    return gated(state("failed", "Collecting the terms for this posting did not finish.", REBUILD), row, options, now);
  }

  // A row that stores NO terms says to a reader exactly what no row says:
  // there is nothing here yet. Reported after `failed`, `unavailable` and
  // `quotes-only` so it cannot swallow one of those, and before every line
  // that would otherwise print a count of zero out of zero.
  if (terms === 0) {
    return state("none", "Terms for this posting have not been collected yet.");
  }

  if (cursor < total) {
    return state("in-flight", `${terms} terms are ready. Sources are still being added — ${researched} of ${terms} so far.`);
  }

  if (options.staleFingerprint === true) {
    return gated(state("stale", "This posting has changed since these terms were collected.", REBUILD), row, options, now);
  }

  if (row.truncated_reason === "model") {
    return gated(
      state("truncated-model", "Some of the research for this posting was cut off. It will finish automatically, or you can retry now.", RETRY),
      row,
      options,
      now,
    );
  }
  if (row.truncated_reason === "ceiling") {
    return state(
      "truncated-ceiling",
      `${terms} terms on ${dateText(row.researched_at || row.updated_at)}. ${countOf(row.dropped_count)} further terms were found and not kept — this posting is at the 120-term limit.`,
    );
  }
  if (row.truncated_reason === "bytes") {
    return state(
      "truncated-bytes",
      `${terms} terms on ${dateText(row.researched_at || row.updated_at)}. ${countOf(row.dropped_count)} were dropped because the glossary hit its storage limit.`,
    );
  }

  if (row.status === "ready") {
    return state("ready", `${terms} terms, each with a source, on ${dateText(row.researched_at || row.updated_at)}.`);
  }

  // A completed generation in which NO batch ever searched is a mechanism
  // failure, not a sourcing one, and it reads differently: every definition is
  // general knowledge and a retry has a real chance of changing that.
  if (total > 0 && researched === 0 && countOf(row.research_batches) === 0) {
    return gated(
      state("unsearched", `The research step did not run for this posting. All ${terms} definitions are general knowledge with no source.`, RETRY),
      row,
      options,
      now,
    );
  }

  const graded = researched + recalled;
  const ratio = graded > 0 ? researched / graded : 0;
  if (ratio >= RESEARCH_FLOOR) {
    // The resting state of a healthy posting, and it says so plainly rather
    // than apologising: some terms -- coined internal process names, company
    // jargon -- have no findable source at all, and every one of them is
    // labelled on its own card.
    return state(
      "above-floor",
      `${researched} of ${graded} terms have a source. The other ${recalled} are general definitions with no source — they are labelled.`,
    );
  }
  return gated(
    state("below-floor", `Only ${researched} of ${graded} terms could be given a source. It will try again automatically, or you can retry now.`, RETRY),
    row,
    options,
    now,
  );
}

/**
 * Replaces a line that offers a control with the line explaining why that
 * control would be refused. A button that is guaranteed to do nothing is worse
 * than no button, and the reason is what the reader actually needs.
 */
function gated(base, row, options, now) {
  if (!base.control) return base;
  if (options.atCallCap === true) {
    return state("call-cap", "This posting has reached its rebuild limit and cannot be rebuilt again.");
  }
  const last = Date.parse(row.last_generation_at || "");
  if (Number.isFinite(last) && now - last < GENERATION_COOLDOWN_MS) {
    return state(
      "cooldown",
      `This posting was rebuilt in the last hour. You can rebuild it again after ${timeText(row.last_generation_at, GENERATION_COOLDOWN_MS)}.`,
    );
  }
  return base;
}
