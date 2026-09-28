// Pure run-outcome summariser for the auto-tailor cron (N60 S1).
//
// AC-R4: the cron's response must never report success-shaped output for a
// run that could not evaluate eligibility. Today a zero-job run is reported
// identically whether nothing was eligible or a flag column errored outright
// (a bare `break`, no reason recorded). `summarizeRun` is the one place that
// turns a raw per-user outcome into a machine-readable reason, and it always
// distinguishes "the column errored" from "nothing was eligible" -- that
// distinction is the whole point of R4.
//
// SKIP_REASONS names why an individual saved search or posting was skipped
// inside a run; the cron route imports it directly so a skip is always
// recorded under one of these strings rather than a silent `break`.
//
// ZERO_REASONS stays module-private: only `summarizeRun` consumes it, and
// exporting it here would create a test-only export that moves the
// reachability census (owner ruling 3 / plan §0.6).
//
// N60 S7 (AC-R5): `renderRunLogMarkdown`, `runLogFileName` and
// `describeRunReason` land here now that the persisted run record they
// format has a real consumer -- the AutoTailorRunLog component's download
// control. `describeRunReason` is the single place a machine reason
// (from either enum) turns into copy a user can read, so a run log never
// shows a raw snake_case token.

export const SKIP_REASONS = Object.freeze({
  PER_RUN_CAP: "per_run_cap_reached",
  PER_DAY_CEILING: "per_day_ceiling_reached",
  NO_RESUME: "no_resume_in_storage",
  ALREADY_TRACKED: "already_tracked",
  TAILOR_THREW: "tailor_threw",
  COUNTER_UNREADABLE: "spend_counter_unreadable",
  // N60 S4: a kill-switch-disabled run must not mislabel itself as "no new
  // postings" -- these are the two ways the feature switch stops a run.
  KILL_SWITCH: "disabled_by_kill_switch",
  KILL_SWITCH_UNREADABLE: "kill_switch_unreadable",
  // N60 second chunk (AC2-C4b) -- the per-search interval ("frequency") the
  // cron now actually honours: a search still inside its interval is skipped
  // for cadence, not for any of the reasons above, so it must not be
  // mislabelled as one of them.
  CADENCE_NOT_DUE: "cadence_not_due",
});

const ZERO_REASONS = Object.freeze({
  NO_ENABLED_SEARCH: "no_search_enabled",
  ELIGIBILITY_QUERY_FAILED: "eligibility_query_failed",
  NO_RESUME: "no_resume_in_storage",
  CEILING_REACHED: "per_day_ceiling_reached",
  NO_NEW_POSTINGS: "no_new_matching_postings",
  COUNTER_UNREADABLE: "spend_counter_unreadable",
  KILL_SWITCH: "disabled_by_kill_switch",
  KILL_SWITCH_UNREADABLE: "kill_switch_unreadable",
  // N60 S6: a paused account's zero-mail run must not mislabel itself as "no
  // new postings" either -- the same class of fix as the kill-switch pair
  // above, on the mail-only pause (AC-E4).
  PAUSED: "alerts_paused",
  // N60 second chunk (AC2-C4b/AC-R4): an all-not-due run is a cadence wait,
  // not an idle "no new postings" -- ranked in autoZeroReason below.
  CADENCE_NOT_DUE: "cadence_not_due",
});

// A broken/errored eligibility query always outranks every other zero-reason:
// it is the one case where the run genuinely could not tell whether there
// was work to do, as distinct from having checked and found none.
function autoZeroReason({ tailored, autoEligible, skipped, featureError }) {
  if (tailored > 0) return null;
  if (featureError) return ZERO_REASONS.ELIGIBILITY_QUERY_FAILED;
  const s = skipped || {};
  // A switched-off run outranks everything below except an eligibility
  // error: it explains a zero that "no new postings" would mislabel.
  if (s[SKIP_REASONS.KILL_SWITCH_UNREADABLE]) return ZERO_REASONS.KILL_SWITCH_UNREADABLE;
  if (s[SKIP_REASONS.KILL_SWITCH]) return ZERO_REASONS.KILL_SWITCH;
  if (!autoEligible) return ZERO_REASONS.NO_ENABLED_SEARCH;
  if (s[SKIP_REASONS.NO_RESUME]) return ZERO_REASONS.NO_RESUME;
  if (s[SKIP_REASONS.COUNTER_UNREADABLE]) return ZERO_REASONS.COUNTER_UNREADABLE;
  if (s[SKIP_REASONS.PER_DAY_CEILING]) return ZERO_REASONS.CEILING_REACHED;
  // N60 second chunk: ranked immediately above the idle fallback -- an
  // all-not-due run explains itself as a cadence wait, not "no new postings".
  if (s[SKIP_REASONS.CADENCE_NOT_DUE]) return ZERO_REASONS.CADENCE_NOT_DUE;
  return ZERO_REASONS.NO_NEW_POSTINGS;
}

// N60 S6: ranks, when emailed === 0, an eligibility error above the mail kill
// switch above the account pause above "nothing eligible" above "nothing
// new" -- so a switched-off or paused run is never mislabelled "no new
// postings", and neither one masks an actual eligibility outage.
function emailZeroReason({ emailed, emailEligible, featureError, killSwitch, paused }) {
  if (emailed > 0) return null;
  if (featureError) return ZERO_REASONS.ELIGIBILITY_QUERY_FAILED;
  if (killSwitch) return ZERO_REASONS.KILL_SWITCH;
  if (paused) return ZERO_REASONS.PAUSED;
  if (!emailEligible) return ZERO_REASONS.NO_ENABLED_SEARCH;
  return ZERO_REASONS.NO_NEW_POSTINGS;
}

/**
 * @param {{userId:string, autoEligible:number, autoProcessed:number, tailored:number,
 *   skipped:Record<string,number>, emailEligible:number, emailed:number,
 *   autoFeatureError:string|null, emailFeatureError:string|null,
 *   emailKillSwitch?:boolean, emailPaused?:boolean}} raw
 * @returns {{userId:string, autoEligible:number, autoProcessed:number, tailored:number,
 *   skipped:Record<string,number>, emailEligible:number, emailed:number,
 *   autoFeatureError:string|null, emailFeatureError:string|null,
 *   zeroReason:string|null, emailZeroReason:string|null}}
 *   zeroReason is non-null IFF tailored === 0; emailZeroReason is non-null
 *   IFF emailed === 0. Pure; takes no clock and reads no I/O.
 */
export function summarizeRun(raw) {
  const r = raw || {};
  const tailored = r.tailored || 0;
  const emailed = r.emailed || 0;
  const autoEligible = r.autoEligible || 0;
  const emailEligible = r.emailEligible || 0;
  return {
    userId: r.userId,
    autoEligible,
    autoProcessed: r.autoProcessed || 0,
    tailored,
    skipped: r.skipped || {},
    emailEligible,
    emailed,
    autoFeatureError: r.autoFeatureError || null,
    emailFeatureError: r.emailFeatureError || null,
    zeroReason: autoZeroReason({
      tailored,
      autoEligible,
      skipped: r.skipped,
      featureError: r.autoFeatureError,
    }),
    emailZeroReason: emailZeroReason({
      emailed,
      emailEligible,
      featureError: r.emailFeatureError,
      killSwitch: r.emailKillSwitch,
      paused: r.emailPaused,
    }),
  };
}

// N60 S7 (AC-R4/R5, brief item 5): one entry per value either enum can
// produce, so a reason added later with no entry here falls back to the
// GENERIC copy below rather than leaking its raw token -- and the
// legibility class guard in autoTailorRunLogMarkdown.test.js fails loudly
// when that happens, instead of the reader silently getting a code.
const REASON_COPY = Object.freeze({
  [SKIP_REASONS.PER_RUN_CAP]: "Reached this run's tailoring limit; the rest will be picked up next run.",
  [SKIP_REASONS.PER_DAY_CEILING]: "Reached today's tailoring limit for this account.",
  [SKIP_REASONS.NO_RESUME]: "No resume on file to tailor from.",
  [SKIP_REASONS.ALREADY_TRACKED]: "This posting was already queued from an earlier run.",
  [SKIP_REASONS.TAILOR_THREW]: "Tailoring failed unexpectedly for this posting.",
  [SKIP_REASONS.COUNTER_UNREADABLE]: "Could not read today's usage counter, so tailoring paused as a precaution.",
  [SKIP_REASONS.KILL_SWITCH]: "Auto-tailor is currently turned off for everyone.",
  [SKIP_REASONS.KILL_SWITCH_UNREADABLE]: "Could not check whether auto-tailor is turned on, so it paused as a precaution.",
  [SKIP_REASONS.CADENCE_NOT_DUE]: "Waiting for this search's next scheduled check; nothing to do yet.",
  [ZERO_REASONS.NO_ENABLED_SEARCH]: "No saved search has auto-tailor enabled yet.",
  [ZERO_REASONS.ELIGIBILITY_QUERY_FAILED]: "Could not check which searches are eligible, so this run was skipped as a precaution.",
  [ZERO_REASONS.NO_NEW_POSTINGS]: "No new postings matched this search yet.",
  [ZERO_REASONS.PAUSED]: "Email alerts are paused for this account.",
});

const GENERIC_REASON_COPY = "No further detail was recorded for this outcome.";

/**
 * Turns a machine reason (any SKIP_REASONS or ZERO_REASONS value) into copy a
 * user can read. An unrecognised reason -- including null/undefined -- falls
 * back to a generic, non-specific sentence rather than the raw token.
 * @param {string|null|undefined} reason
 * @returns {string}
 */
export function describeRunReason(reason) {
  return REASON_COPY[reason] || GENERIC_REASON_COPY;
}

function formatRanAt(ranAt) {
  const d = ranAt ? new Date(ranAt) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "Unknown time";
}

// Renders the skip-reason breakdown for one run as legible bullet lines,
// never the raw map keys -- the same class guard the zero-reason line obeys.
function renderSkippedLines(skipped) {
  const entries = Object.entries(skipped || {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return [];
  return entries.map(([reason, count]) => `  - ${describeRunReason(reason)} (${count})`);
}

function renderOneRun(row) {
  const payload = row?.payload || {};
  const lines = [`## Run at ${formatRanAt(row?.ran_at)}`];
  lines.push(`- Eligible searches: ${payload.autoEligible || 0}`);
  lines.push(`- Searches processed: ${payload.autoProcessed || 0}`);
  lines.push(`- Resumes tailored and queued: ${payload.tailored || 0}`);
  if (payload.zeroReason) lines.push(`- ${describeRunReason(payload.zeroReason)}`);
  lines.push(...renderSkippedLines(payload.skipped));
  lines.push(`- Email-eligible searches: ${payload.emailEligible || 0}`);
  lines.push(`- Emails sent: ${payload.emailed || 0}`);
  if (payload.emailZeroReason) lines.push(`- ${describeRunReason(payload.emailZeroReason)}`);
  if (payload.autoFeatureError) lines.push(`- Auto-tailor eligibility check failed: ${payload.autoFeatureError}`);
  if (payload.emailFeatureError) lines.push(`- Email eligibility check failed: ${payload.emailFeatureError}`);
  return lines.join("\n");
}

/**
 * Renders a list of persisted runs (as loadRecentRuns / the runs API return
 * them: `{ id, ran_at, payload }` where payload is summarizeRun's output)
 * into one markdown document. An empty list still produces a readable,
 * non-empty file rather than a blank one or a throw. No reason renders as
 * its raw enum token -- every one goes through describeRunReason.
 * @param {Array<{id?:string, ran_at?:string, payload?:object}>} runs
 * @param {{generatedAt?:string}} [o]
 * @returns {string}
 */
export function renderRunLogMarkdown(runs, o) {
  const list = Array.isArray(runs) ? runs : [];
  const generatedAt = (o && o.generatedAt) || new Date().toISOString();
  const header = `# Auto-Apply Run Log\n\nGenerated ${generatedAt}\n`;
  if (list.length === 0) {
    return `${header}\nNo automation runs yet. Once a saved search has auto-tailor enabled, its runs will appear here.\n`;
  }
  return `${header}\n${list.map(renderOneRun).join("\n\n")}\n`;
}

/**
 * @param {{generatedAt?:string}} [o]
 * @returns {string} a single .md filename, e.g. "auto-apply-runs-2026-09-27.md"
 */
export function runLogFileName(o) {
  const generatedAt = (o && o.generatedAt) || new Date().toISOString();
  const d = new Date(generatedAt);
  const day = Number.isNaN(d.getTime()) ? "unknown-date" : d.toISOString().slice(0, 10);
  return `auto-apply-runs-${day}.md`;
}
