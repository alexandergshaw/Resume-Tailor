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
// reachability census (owner ruling 3 / plan §0.6). `renderRunLogMarkdown`
// and `runLogFileName` (AC-R5) are deferred to S7, where the persisted run
// record they format finally has a consumer.

export const SKIP_REASONS = Object.freeze({
  PER_RUN_CAP: "per_run_cap_reached",
  PER_DAY_CEILING: "per_day_ceiling_reached",
  NO_RESUME: "no_resume_in_storage",
  ALREADY_TRACKED: "already_tracked",
  TAILOR_THREW: "tailor_threw",
  COUNTER_UNREADABLE: "spend_counter_unreadable",
});

const ZERO_REASONS = Object.freeze({
  NO_ENABLED_SEARCH: "no_search_enabled",
  ELIGIBILITY_QUERY_FAILED: "eligibility_query_failed",
  NO_RESUME: "no_resume_in_storage",
  CEILING_REACHED: "per_day_ceiling_reached",
  NO_NEW_POSTINGS: "no_new_matching_postings",
  COUNTER_UNREADABLE: "spend_counter_unreadable",
});

// A broken/errored eligibility query always outranks every other zero-reason:
// it is the one case where the run genuinely could not tell whether there
// was work to do, as distinct from having checked and found none.
function autoZeroReason({ tailored, autoEligible, skipped, featureError }) {
  if (tailored > 0) return null;
  if (featureError) return ZERO_REASONS.ELIGIBILITY_QUERY_FAILED;
  if (!autoEligible) return ZERO_REASONS.NO_ENABLED_SEARCH;
  const s = skipped || {};
  if (s[SKIP_REASONS.NO_RESUME]) return ZERO_REASONS.NO_RESUME;
  if (s[SKIP_REASONS.COUNTER_UNREADABLE]) return ZERO_REASONS.COUNTER_UNREADABLE;
  if (s[SKIP_REASONS.PER_DAY_CEILING]) return ZERO_REASONS.CEILING_REACHED;
  return ZERO_REASONS.NO_NEW_POSTINGS;
}

function emailZeroReason({ emailed, emailEligible, featureError }) {
  if (emailed > 0) return null;
  if (featureError) return ZERO_REASONS.ELIGIBILITY_QUERY_FAILED;
  if (!emailEligible) return ZERO_REASONS.NO_ENABLED_SEARCH;
  return ZERO_REASONS.NO_NEW_POSTINGS;
}

/**
 * @param {{userId:string, autoEligible:number, autoProcessed:number, tailored:number,
 *   skipped:Record<string,number>, emailEligible:number, emailed:number,
 *   autoFeatureError:string|null, emailFeatureError:string|null}} raw
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
    }),
  };
}
