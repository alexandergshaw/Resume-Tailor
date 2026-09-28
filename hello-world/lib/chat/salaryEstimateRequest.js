// ---------------------------------------------------------------------------
// N65 — the client orchestrator for a salary estimate request.
//
// Fires ONE request to /api/salary-estimate, appends the two transcript
// turns (one click => a user turn then an assistant turn carrying the
// structured estimate, S12), and RECORDS the decision for EVERY outcome --
// acted, skipped, refused, or failed -- never only success. The owner's
// original hole was a decision that stopped before its first network call
// and left no trace; the withhold / refuse / fail paths recording their
// outcome is the entire point of this seam (S10).
//
// THIS FILE IS THE DECISION_LEDGER `module` FOR THE "salary-estimate" ENTRY
// (lib/activityLog/activityChannels.js). The ledger entry and this file's
// recordDecision( call must land together, or decisionCoverage.sweep.test.js
// goes red in one direction.
//
// The recorded field set carries NO estimated number, company, URL or
// title -- only a canned reason code, the surviving citation count, and the
// basis discriminator (privacy, activityChannels.js's N77 precedent: this
// log is downloaded and shared onward).
// ---------------------------------------------------------------------------

import { recordDecision } from "@/lib/activityLog/appActivityLog";

const ESTIMATE_ENDPOINT = "/api/salary-estimate";

// App-authored framing per status -- never the model's prose (the structured
// range/basis/citations render from `salaryEstimate` itself, in ChatPanel).
const FRAMING_BY_STATUS = {
  estimated: "Estimated compensation for this role, based on web sources:",
  insufficient_sources: "I couldn't find enough salary data to estimate a range for this role right now.",
  failed: "I couldn't retrieve salary sources right now — try again in a moment.",
  refused_stated: "This posting already states its pay, so there's nothing to estimate.",
  unavailable_embedded: "A salary estimate needs the AI engine and isn't available on the embedded (offline) engine.",
};

// S10: the withhold / refuse / fail paths each record their own outcome.
const OUTCOME_BY_STATUS = {
  estimated: "acted",
  insufficient_sources: "skipped",
  refused_stated: "refused",
  unavailable_embedded: "refused",
  failed: "failed",
};

// The route's own shape for a provider failure (S14) -- reused here so a
// network/parse failure the route never got to see still degrades to the
// exact same "couldn't check" state, never a $0 or a confident negative.
const NETWORK_FAILURE_ESTIMATE = {
  status: "failed",
  reason: "provider_error",
  range: null,
  basisKind: "none",
  sourceCount: 0,
  citations: [],
  searched: false,
  truncated: false,
};

function framingFor(status) {
  return FRAMING_BY_STATUS[status] || FRAMING_BY_STATUS.failed;
}

function outcomeFor(status) {
  return OUTCOME_BY_STATUS[status] || "failed";
}

async function fetchSalaryEstimate({ posting, engine }) {
  try {
    const res = await fetch(ESTIMATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine,
        title: posting?.title || "",
        company: posting?.company || "",
        location: posting?.location || "",
        salaryStated: false,
      }),
    });
    if (!res.ok) return NETWORK_FAILURE_ESTIMATE;
    const json = await res.json();
    return json?.salaryEstimate || NETWORK_FAILURE_ESTIMATE;
  } catch {
    return NETWORK_FAILURE_ESTIMATE;
  }
}

/**
 * Fires the salary-estimate request for a pinned posting and appends the two
 * transcript turns. `posting` is `{ title, company, location, salaryStated }`
 * -- the request always sends `salaryStated: false` regardless, since this is
 * only ever called for a posting the caller already knows states no pay.
 */
export async function requestSalaryEstimate({ posting, engine, setChatMessages, setChatError }) {
  setChatError?.("");
  setChatMessages((prev) => [...prev, { role: "user", content: "Estimate the salary for this role." }]);

  const salaryEstimate = await fetchSalaryEstimate({ posting, engine });

  setChatMessages((prev) => [
    ...prev,
    { role: "assistant", content: framingFor(salaryEstimate.status), salaryEstimate },
  ]);

  recordDecision("salary-estimate", outcomeFor(salaryEstimate.status), {
    reason: salaryEstimate.reason,
    citationCount: salaryEstimate.sourceCount,
    basisKind: salaryEstimate.basisKind,
  });
}
