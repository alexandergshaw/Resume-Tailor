// lib/duplicateApply/verdictPresentation.js
//
// The pure surface decision. Takes the verdict object
// duplicateApplyVerdict.js's evaluatePriorApplications() (or mergeVerdicts())
// produces, plus a little run context, and returns EVERYTHING the DOM needs
// -- copy, severity, the evidence list, the dismissal fingerprint, the
// worst-first queue ordering, and the guarded "Open your applications"
// search seed. app/page.js and app/components/StatusBar.js contain no copy
// string, no severity decision and no partition logic; they render this
// module's output. AC-duplicate-apply-r4.md PART 2 (S-8a .. S-17);
// 3-plan-dupapply.md §2.4 / §3.4 / §4 (A-1..A-3) / §5 (S-3).
//
// Standing bias, carried from the evaluator: a false alarm is the expensive
// failure, but staying silent about a real uncertainty is its own failure.
// A CAPABILITY reason (the check had no key and examined zero rows) never
// raises a banner on its own -- it only ever captions one another signal
// raised. An EVIDENCE-BEARING reason (the check ran and found a real,
// ambiguous row) may raise a banner alone. Once ANY banner is raised, every
// non-clear signal is named -- including a capability or `unavailable`
// reason on the OTHER axis -- because silence on that axis, next to an
// active banner, would read as "that axis came back clean", which is
// exactly the conflation this module exists to prevent. `clear` is the one
// verdict this module never speaks: rendering nothing is not the same claim
// as "no previous application" (a hard-deleted row is invisible to any
// check, so the feature genuinely cannot know it is not under-reporting) --
// silence carries no assertion, which is why it is the correct output for
// `clear` AND for a lone `unavailable`/capability-`indeterminate` pairing.
//
// Only two imports, both already-shipped leaf modules the evaluator itself
// depends on (no new dependency): `parseStageInstant` formats an evidence
// row's raw `appliedAt` string for display, in the caller-supplied
// `timeZone`, with the exact same parsing rule the evaluator used to decide
// "undated" in the first place -- so a row this module renders as
// "date unknown" is guaranteed to be one the evaluator itself could not
// date, never a formatting disagreement between the two. `normalizeInterviewValue`
// is S-14's mandatory guard on the "Open your applications" search seed.
import { parseStageInstant, normalizeInterviewValue } from "@/lib/tracking/stages.js";

// ---------------------------------------------------------------------------
// The reason partition -- 3-plan-dupapply.md §3.3's ten-reason table,
// transcribed here rather than imported. duplicateApplyVerdict.js's own
// `CAPABILITY_REASONS` is a private module binding (not exported): that
// module uses the partition to decide merge ranking; this module uses the
// SAME partition to decide what may raise a banner alone versus what may
// only ever caption one that another signal raised. Two independent
// consumers of one frozen table, not a re-derivation of the evaluator's
// logic -- if a reason is ever added to the table, both files' copies must
// be updated together, and each has its own tests pinning its own copy.
// ---------------------------------------------------------------------------
const CAPABILITY_REASONS = new Set(["no-posting-identity", "no-company-key", "rows-unavailable", "check-threw"]);

function isCapabilityReason(reason) {
  return CAPABILITY_REASONS.has(reason);
}

// Does this ONE signal raise a banner on its own? Only `hit`, or an
// `indeterminate` whose reason is evidence-bearing. A capability
// `indeterminate` and every `unavailable` (both of its reasons are
// capability reasons, C-4/S-10d/S-10i) never raise alone.
function signalRaisesAlone(signal) {
  if (!signal || typeof signal.verdict !== "string") return false;
  if (signal.verdict === "hit") return true;
  if (signal.verdict === "indeterminate") return !isCapabilityReason(signal.reason);
  return false; // "clear", "unavailable"
}

// Does this signal have anything to say at all, once a banner already
// exists? Everything except `clear` -- `clear` is the one state this
// module never speaks, on either axis, in any position.
function signalHasClause(signal) {
  return !!signal && typeof signal.verdict === "string" && signal.verdict !== "clear";
}

// hit > evidence-bearing indeterminate > capability indeterminate >
// unavailable > clear -- the same total order duplicateApplyVerdict.js's
// own (private) verdictRank uses for merging, used here to rank a WHOLE
// verdict (both axes) against another whole verdict for the queue (S-10k).
function signalRank(signal) {
  if (!signal || typeof signal.verdict !== "string") return 0;
  switch (signal.verdict) {
    case "hit":
      return 4;
    case "indeterminate":
      return isCapabilityReason(signal.reason) ? 2 : 3;
    case "unavailable":
      return 1;
    default:
      return 0; // "clear"
  }
}

// --- copy -------------------------------------------------------------

const KICKER = {
  "same-position": { hit: "POSSIBLE DUPLICATE", other: "COULDN'T CHECK" },
  company: { hit: "APPLICATIONS AT THIS EMPLOYER", other: "COULDN'T CHECK" },
};

function kickerFor(axis, signal) {
  return signal.verdict === "hit" ? KICKER[axis].hit : KICKER[axis].other;
}

function samePositionSentence(signal) {
  if (signal.verdict === "hit") {
    return "Looks like you already applied to this posting";
  }
  switch (signal.reason) {
    case "undated-match":
      return "You have an application on file for this posting with no recorded date — it may or may not be a duplicate.";
    case "future-or-concurrent":
      // The evaluator does not retain WHICH row was future-dated for an
      // indeterminate verdict (only a boolean flag survives
      // findPriorSamePosting), so the AC's own worked copy -- which quotes
      // the row's {date} inline -- cannot be reproduced from this verdict
      // shape. Reported as a deviation; see this module's own report.
      return "You have an application on file for this posting dated after this run started — it may be a mistyped date or another tab's write.";
    case "unknown-status-match":
      return "You have an application on file for this posting at a status this check doesn't recognise.";
    case "stranded-applied-row":
      return "You may already have an application on file for this posting, under a status this check can't examine directly — it's neither confirmed nor ruled out.";
    case "no-posting-identity":
      return "Couldn't identify this specific posting well enough to check it against your applications.";
    case "rows-unavailable":
      return "Your application history hadn't finished loading, so this couldn't be checked.";
    case "check-threw":
      return "This check hit an unexpected problem and couldn't finish.";
    default:
      return "This couldn't be checked.";
  }
}

function companySentence(signal, candidateCompany) {
  const cand = candidateCompany || "this employer";
  if (signal.verdict === "hit") {
    const evidence = Array.isArray(signal.evidence) ? signal.evidence : [];
    const distinctCompanies = new Set(
      evidence.map((row) => (row && typeof row.company === "string" ? row.company.trim() : "")).filter(Boolean),
    );
    const k = distinctCompanies.size;
    const headline =
      k > 1
        ? `At least ${signal.count} applications in the past 30 days, recorded under ${k} different company names`
        : `At least ${signal.count} applications at ${cand} in the past 30 days`;
    const suffixes = [];
    if (signal.undatableCount > 0) suffixes.push(`Plus ${signal.undatableCount} with no recorded date.`);
    if (signal.futureCount > 0) suffixes.push(`Plus ${signal.futureCount} dated after this run started.`);
    return [headline, ...suffixes].join(" ");
  }
  if (signal.reason === "undated-company-rows" || signal.reason === "future-company-rows") {
    const clauses = [];
    if (signal.undatableCount > 0) clauses.push(`${signal.undatableCount} application(s) there have no recorded date`);
    if (signal.futureCount > 0) clauses.push(`${signal.futureCount} application(s) there are dated after this run started`);
    const body = clauses.length > 0 ? clauses.join(", and ") : "some applications there couldn't be dated";
    return `Couldn't count the past 30 days at ${cand} — ${body}.`;
  }
  if (signal.reason === "no-company-key") {
    return "Couldn't identify the employer well enough to check for other recent applications there.";
  }
  if (signal.reason === "rows-unavailable") {
    return "Your application history hadn't finished loading, so this couldn't be checked.";
  }
  if (signal.reason === "check-threw") {
    return "This check hit an unexpected problem and couldn't finish.";
  }
  return "This couldn't be checked.";
}

const SENTENCE_BUILDERS = {
  "same-position": (signal) => samePositionSentence(signal),
  company: (signal, candidateCompany) => companySentence(signal, candidateCompany),
};

// --- dates / evidence ---------------------------------------------------

// Mirrors lib/techwatch/hourBuckets.js's safeTimeZone(): constructing an
// Intl.DateTimeFormat with an unrecognised IANA zone throws synchronously,
// so an invalid `timeZone` is caught here and swapped for UTC rather than
// throwing out of a pure presentation function (AC: "an invalid zone falls
// back to UTC rather than throwing").
function safeTimeZone(timeZone) {
  const zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return "UTC";
  }
}

// "YYYY-MM-DD" of the row's raw appliedAt string, in `zone`, or the literal
// "date unknown" -- a required assertion target (S-14a), not a stylistic
// choice, because dropping an undatable row's date is how a floor count
// silently becomes a claim. Parsed with the SAME `parseStageInstant` the
// evaluator used to classify the row as dated/undated, so this can never
// disagree with the verdict about which rows are undated.
function formatDateOrUnknown(rawAppliedAt, zone) {
  const instant = parseStageInstant(rawAppliedAt);
  if (instant === null) return "date unknown";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function statusLabelFor(statusLabels, rawStatus) {
  if (rawStatus == null) return "unknown status";
  const label = statusLabels && typeof statusLabels === "object" ? statusLabels[rawStatus] : null;
  return label || rawStatus;
}

// One evidence row -> the shape the evidence LIST needs ({key, main, meta,
// dated}), plus two fields stripped before the value leaves this module:
// `__sortInstant` (evidence order: newest-dated first, undated last -- 1e
// V-5) and `__company` (the RAW company string, needed by the
// interviewSearchSeed guard below -- never the normalised key, C-22).
function evidenceEntry(row, zone, statusLabels, keyPrefix, index) {
  const company = row && typeof row.company === "string" && row.company.trim() ? row.company : "(unknown company)";
  const title = row && typeof row.title === "string" && row.title.trim() ? row.title : "(untitled role)";
  const dateText = formatDateOrUnknown(row?.appliedAt, zone);
  const dated = dateText === "date unknown" ? "unknown" : "known";
  const metaParts = [statusLabelFor(statusLabels, row?.status), dateText, row?.url || null].filter(Boolean);
  return {
    key: row && row.applicationId != null ? `app:${row.applicationId}` : `${keyPrefix}:${index}`,
    main: `${company} — ${title}`,
    meta: metaParts.join(" · "),
    dated,
    __sortInstant: dated === "known" ? parseStageInstant(row?.appliedAt)?.getTime() ?? null : null,
    __company: company,
  };
}

// The UNIFIED evidence list -- same-position's single matched row (if hit)
// first, then company's contributing rows (present on both `hit` and the
// undated-/future-company-rows indeterminate reasons; S-14a: undated and
// future-dated rows are LISTED, never dropped). Sorted newest-dated first,
// undated last (1e V-5); the sort is stable, so same-position's row keeps
// its natural lead when it ties on date with a company row.
function buildEvidenceEntries(verdict, zone, statusLabels) {
  const entries = [];
  if (verdict.samePosition?.verdict === "hit" && verdict.samePosition.match) {
    entries.push(evidenceEntry(verdict.samePosition.match, zone, statusLabels, "same-position", 0));
  }
  if (Array.isArray(verdict.company?.evidence)) {
    verdict.company.evidence.forEach((row, index) => {
      entries.push(evidenceEntry(row, zone, statusLabels, "company", index));
    });
  }
  entries.sort((a, b) => {
    if (a.__sortInstant == null && b.__sortInstant == null) return 0;
    if (a.__sortInstant == null) return 1;
    if (b.__sortInstant == null) return -1;
    return b.__sortInstant - a.__sortInstant;
  });
  return entries;
}

// --- exported surface ----------------------------------------------------

/**
 * shouldRenderBanner(verdict) -> boolean
 *
 * S-10d's partition, in ONE place: true iff at least one signal raises a
 * banner alone (a `hit`, or an evidence-bearing `indeterminate`). Both
 * `presentVerdict` and any caller that wants to check before doing other
 * work (e.g. deciding whether to log a "verdict raised" event) should call
 * this rather than re-implementing the partition.
 */
export function shouldRenderBanner(verdict) {
  if (!verdict || !verdict.samePosition || !verdict.company) return false;
  return signalRaisesAlone(verdict.samePosition) || signalRaisesAlone(verdict.company);
}

/**
 * presentVerdict({ verdict, jobId, jobTitle, candidateCompany, queueLength,
 *   timeZone, statusLabels }) -> null | { jobId, announcement, signals,
 *   evidence, queueLabel, interviewSearchSeed }
 *
 * `verdict` is evaluatePriorApplications()'s (or mergeVerdicts()'s) output
 * shape: `{ samePosition, company, checkedAt, diagnostics }`. `diagnostics`
 * is never read here -- it is duplicateApplyLog.js's input, not this
 * module's (the evaluator's own docblock: "NEVER rendered").
 *
 * Returns `null` when nothing should render at all: both signals `clear`,
 * both capability-`indeterminate`/`clear` in either order, or ANY
 * `unavailable` paired only with `clear`/capability-`indeterminate`/another
 * `unavailable` -- S-10c/g/h/i. Returns `null` rather than an object with
 * an empty `announcement` so "no banner" is one `null` check at the call
 * site, not a partition re-implemented in JSX; the call site is expected to
 * fall back to `""` for the always-mounted live region (S-11) when this
 * returns `null`.
 */
export function presentVerdict({
  verdict,
  jobId,
  jobTitle,
  candidateCompany,
  queueLength,
  timeZone,
  statusLabels,
} = {}) {
  if (!verdict || !verdict.samePosition || !verdict.company) return null;
  if (!shouldRenderBanner(verdict)) return null;

  const zone = safeTimeZone(timeZone);
  const cand = candidateCompany || "";
  const axes = [
    { axis: "same-position", signal: verdict.samePosition },
    { axis: "company", signal: verdict.company },
  ].filter(({ signal }) => signalHasClause(signal));

  // Stable sort: `hit` lines always first (1e V-2.2's "order" channel);
  // same-position before company on a tie, preserved by sort stability
  // from `axes`'s own construction order -- never re-derived per branch.
  axes.sort((a, b) => signalRank(b.signal) - signalRank(a.signal));

  const signals = axes.map(({ axis, signal }) => ({
    signal: axis,
    severity: signal.verdict,
    reason: signal.reason ?? null,
    kicker: kickerFor(axis, signal),
    sentence: SENTENCE_BUILDERS[axis](signal, cand),
  }));

  const richEvidence = buildEvidenceEntries(verdict, zone, statusLabels || {});
  const evidence = richEvidence.map(({ key, main, meta, dated }) => ({ key, main, meta, dated }));

  const announcementCore = signals.map((s) => `${s.kicker}: ${s.sentence}`).join(" ");
  const announcement = jobTitle ? `${jobTitle} — ${announcementCore}` : announcementCore;

  // S-14's mandatory guard: seed the "Open your applications" search with
  // the candidate's own company ONLY when every cited row's raw company
  // text contains it -- otherwise a merge whose evidence rows carry a
  // DIFFERENT spelling (exactly C-22's hazard) would have its own cited row
  // hidden by the filter it is meant to help the user find. `every()` on an
  // empty evidence list is vacuously true, which is correct here: "always
  // SET it, never leave a stale search in place" (S-14).
  const seedIsSafe = richEvidence.every((entry) => normalizeInterviewValue(entry.__company).includes(normalizeInterviewValue(cand)));
  const interviewSearchSeed = seedIsSafe ? cand : "";

  const queueLabel = Number(queueLength) > 1 ? `1 of ${queueLength}` : null;

  return { jobId, announcement, signals, evidence, queueLabel, interviewSearchSeed };
}

/**
 * dismissalFingerprint(verdict, jobId) -> string
 *
 * AC S-17: per-session, in-memory dismissal, keyed by job id + this
 * fingerprint -- so the SAME posting re-tailored with an unchanged verdict
 * stays dismissed (zero extra clicks on a repeat run), while a verdict that
 * has become MORE true (the count went up, a new prior application
 * appeared) produces a different fingerprint and the flag returns.
 */
export function dismissalFingerprint(verdict, jobId) {
  const samePosition = verdict?.samePosition || {};
  const company = verdict?.company || {};
  const matchedApplicationId = samePosition?.match?.applicationId ?? "";
  const evidenceIds = Array.isArray(company.evidence)
    ? company.evidence
        .map((row) => (row && row.applicationId != null ? row.applicationId : ""))
        .sort()
        .join(",")
    : "";
  return `${jobId}::${samePosition.verdict ?? ""}|${matchedApplicationId}|${company.verdict ?? ""}|${company.count ?? ""}|${evidenceIds}`;
}

function extractVerdict(entry) {
  if (entry && entry.samePosition && entry.company) return entry; // a bare verdict object
  if (entry && entry.verdict && entry.verdict.samePosition && entry.verdict.company) return entry.verdict; // { jobId, verdict }
  return null;
}

function verdictSeverityRank(entry) {
  const verdict = extractVerdict(entry);
  if (!verdict) return 0;
  return Math.max(signalRank(verdict.samePosition), signalRank(verdict.company));
}

/**
 * orderVerdicts(verdicts) -> array
 *
 * AC S-10k + 1e V-7.1b, union-ruled in 3-plan-dupapply.md §8 C-3: render the
 * WORST outstanding verdict first, `1 of N` when N > 1, and *Dismiss*
 * advances to the next-worst. Each element may be a bare verdict object
 * (`{samePosition, company, ...}`) or a queue entry shaped `{jobId,
 * verdict}` -- either way the ORIGINAL element is returned, only reordered.
 * A stable sort (guaranteed since ES2019) keeps equal-severity entries in
 * their original order, which is oldest-first because the queue this feeds
 * appends in arrival order -- no separate tie-break is written twice.
 */
export function orderVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) return [];
  return [...verdicts].sort((a, b) => verdictSeverityRank(b) - verdictSeverityRank(a));
}

/**
 * FORBIDDEN_STRINGS -- S-15.2's enumerated negatives. This module's own
 * composed copy is swept against this list (case-insensitively) by this
 * module's tests; a caller assembling additional copy around this module's
 * output (e.g. a heading) may reuse the same list.
 */
export const FORBIDDEN_STRINGS = Object.freeze(["you have not applied here", "no previous applications", "no duplicates found"]);
