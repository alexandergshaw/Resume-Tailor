// Every number the per-posting interview glossary spends money against, in one
// module, so that a change to any one of them fails an arithmetic test rather
// than a production invoice. `glossaryConstants.test.js` asserts the RELATIONS
// between these, not the literals: a test that restates a constant is a second
// copy of it and goes green on any coordinated edit.
//
// THE ONE FACT THAT GOVERNS EVERY NUMBER BELOW: the grounded charge dominates
// the bill and it scales with the number of research CALLS, not with tokens. The
// batch size, the retry policy and the term budget are therefore all levers on
// call count and only weakly on tokens.

// ---------------------------------------------------------------------------
// TERM BUDGET
// ---------------------------------------------------------------------------
/** The upper bound the owner named for anticipated terms ("50-100"). */
export const MAX_ANTICIPATED_TERMS = 100;
/** Terms the posting states outright. Separate ceiling, separate provenance. */
export const MAX_EXPLICIT_TERMS = 40;
/**
 * The hard total, enforced by a database CHECK. Deliberately BELOW
 * MAX_EXPLICIT_TERMS + MAX_ANTICIPATED_TERMS: the two per-kind ceilings are each
 * reachable alone, never together.
 */
export const MAX_TERMS_PER_POSTING = 120;

// ---------------------------------------------------------------------------
// ANCHORING (section 3.5). These bound VOLUME and force SPREAD. They do not
// detect relevance, and nothing in this repository can: the bundled taxonomy has
// zero conceptual terms, so there is no knowledge base against which "MVCC is
// irrelevant to lifecycle marketing" could be evaluated.
// ---------------------------------------------------------------------------
export const MAX_CHILDREN_PER_ANCHOR = 8;
export const MAX_ROLE_ANCHORED = 20;
export const MAX_TERMS_PER_ANCHOR_QUOTE = 6;
/** A verbatim span of the posting, stored on every anticipated term. */
export const MAX_ANCHOR_QUOTE_CHARS = 160;
/** A verbatim span of the posting containing the term, on every explicit term. */
export const MAX_EVIDENCE_CHARS = 200;

// ---------------------------------------------------------------------------
// THE RESEARCH BATCH
// ---------------------------------------------------------------------------
/**
 * Three bounds meet near twelve: the response must stay small enough that
 * per-block byte offsets remain dense and attributable; a batch must fit inside
 * the 45 s call timeout with search latency for every term; and
 * MAX_TERMS_PER_POSTING / RESEARCH_BATCH_SIZE must be an integer that the call
 * count and the `research_total` CHECK can both be derived from.
 */
export const RESEARCH_BATCH_SIZE = 12;
/** 120 / 12. The database CHECK's `research_total <= 10` is THIS number. */
export const RESEARCH_TOTAL_MAX = MAX_TERMS_PER_POSTING / RESEARCH_BATCH_SIZE;

// ---------------------------------------------------------------------------
// THE PREDICATE (section 2)
// ---------------------------------------------------------------------------
/**
 * A CHOSEN floor with a stated rationale, not a derivation: four
 * `significantTerms`-shaped tokens (/[a-z0-9]{4,}/) plus separators. The real
 * work is done by CITATION_PRECISION_MIN, not by this.
 */
export const MIN_CITATION_OVERLAP_CHARS = 20;
/**
 * COMPARED STRICTLY GREATER, and that is what makes "a citation may be the
 * source for at most ONE definition" a theorem rather than a hope. Definition
 * ranges are pairwise disjoint, so two qualifying overlaps would each exceed
 * W/2 and sum to more than W while both are disjoint subsets of a span of width
 * W. Contradiction.
 */
export const CITATION_PRECISION_MIN = 0.5;
/**
 * Closes the residue the theorem does not: one very long definition among eleven
 * short ones lets a near-whole-document citation exceed 0.5 precision on the
 * long one. Two rather than one, so the ordinary
 * one-definition-plus-a-bleed shape still keeps its CORRECT attribution --
 * refusing the citation outright would lose that too, and under-claiming a
 * correct source feeds straight into RESEARCH_FLOOR.
 */
export const MAX_CITATION_DEFINITIONS = 2;
export const MAX_SOURCE_TITLE_CHARS = 120;

// ---------------------------------------------------------------------------
// RETRY AND SPEND
// ---------------------------------------------------------------------------
/**
 * Evaluated ONLY on a generation whose cursor is exhausted. Applying it to a row
 * still in flight is what turned "incomplete" into "permanently stable at ~50%"
 * in the predecessor design. Some terms have no findable source at all --
 * coined internal process names, company jargon -- so "retry until ready" would
 * spend three full generations on a row that can never reach it, on a SHARED row,
 * on behalf of every applicant.
 */
export const RESEARCH_FLOOR = 0.5;
export const MAX_AUTO_ATTEMPTS = 3;
/** Mechanism failures only (a batch that did not search), never sourcing ones. */
export const MAX_BATCH_RETRIES_PER_GENERATION = 3;

/** 1 harvest + ceil(120 / 12) research + the three bounded mechanism retries. */
export const MAX_CALLS_PER_GENERATION =
  1 + MAX_TERMS_PER_POSTING / RESEARCH_BATCH_SIZE + MAX_BATCH_RETRIES_PER_GENERATION;
/**
 * PER FINGERPRINT, and it RESETS when `posting_fingerprint` changes: a genuinely
 * different posting deserves a fresh budget, and the fingerprint is the
 * definition of "genuinely different". Three generations = the first attempt
 * plus two recoveries (one automatic, one explicit Rebuild).
 */
export const MAX_LIFETIME_MODEL_CALLS = MAX_AUTO_ATTEMPTS * MAX_CALLS_PER_GENERATION;
/**
 * NEVER reset, gates nothing but its own database CHECK, and exists so that
 * resetting the counter above cannot be used as an unbounded spend bypass by
 * anyone who can rewrite `positions.description` -- which, until the
 * positions-hardening migration is APPLIED, is any authenticated account.
 * A policy figure, not a derivation.
 */
export const MAX_ABSOLUTE_MODEL_CALLS = 3 * MAX_LIFETIME_MODEL_CALLS;
/**
 * One new generation per POSTING per hour, no matter how many users press
 * Rebuild. Without it, four force rebuilds against the same row inside one hour
 * is 44 calls against one shared row. The rate limiter bounds a USER across many
 * postings and is not comparable.
 */
export const GENERATION_COOLDOWN_MS = 3_600_000;
/** A new generation over a completed, poor row waits a day. Continuations do not. */
export const NEW_GENERATION_MIN_AGE_MS = 24 * 3_600_000;

/** Generations per user per hour. Each commits roughly $0.42 of worker spend. */
export const GENERATION_RATE_LIMIT = 4;
export const GENERATION_RATE_WINDOW_MS = 3_600_000;

// ---------------------------------------------------------------------------
// THE SCHEDULE (section 1)
// ---------------------------------------------------------------------------
/** The value both live cron routes use. */
export const CRON_MAX_DURATION_S = 300;
export const INVOCATION_BUDGET_MS = CRON_MAX_DURATION_S * 1000;
/** Lease UPDATE, row read, final write, response. */
export const INVOCATION_RESERVE_MS = 25_000;
/** application-digest/route.js's own figure for one grounded call. */
export const RESEARCH_TIMEOUT_MS = 45_000;
/**
 * RequestOptions.maxRetries counts RETRIES, not attempts: 1 means TWO attempts.
 * Passed PER CALL and never on the client -- getGeminiClient memoises a module
 * singleton whose next-gen transport is memoised on it, so a client-level
 * setting would reach seven other features.
 */
export const RESEARCH_MAX_RETRIES = 1;
/** 45 s + backoff + 45 s, the digest route's own derivation. */
export const BATCH_WORST_CASE_MS = 2 * RESEARCH_TIMEOUT_MS + 2_000;
/** Outlives the invocation it covers, so a killed worker's lease still expires. */
export const LEASE_MS = INVOCATION_BUDGET_MS + 30_000;
/** Bounds the SELECT, not the work. The deadline does that. */
export const MAX_POSTINGS_PER_RUN = 20;
export const BATCHES_PER_INVOCATION_WORST_CASE = Math.floor(
  (INVOCATION_BUDGET_MS - INVOCATION_RESERVE_MS) / BATCH_WORST_CASE_MS,
);
/**
 * Two minutes, not one: the worker holds a lease for the length of its own
 * invocation, so a faster cadence buys nothing and only multiplies no-op
 * invocations. R-370 pins the vercel.json entry against this number.
 */
export const CRON_CADENCE_MINUTES = 2;
export const CRON_INVOCATIONS_PER_DAY = (60 / CRON_CADENCE_MINUTES) * 24;
/**
 * An ESTIMATE from the traffic model, not a measurement. The capacity test pins
 * the ARITHMETIC; production logging is what replaces the estimate.
 */
export const EXPECTED_POSTINGS_PER_DAY = 23;
/** A row queued this long ago that has not advanced at all: the cron is not running. */
export const WORKER_STALL_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// THE CIRCUIT BREAKER (AC-C19). Stops a response-shape surprise from spending a
// full generation on every posting to rediscover the same fact. Honest limit: it
// fires only after ten postings, so the worst case is ~$4.60 of learning.
// ---------------------------------------------------------------------------
export const CIRCUIT_SAMPLE = 10;

// ---------------------------------------------------------------------------
// THE HARVEST
// ---------------------------------------------------------------------------
/**
 * The answer route uses 20,000 for its own purpose; 12,000 here because the tail
 * of a job description is boilerplate (EEO, benefits) that yields no terms.
 */
export const MAX_POSTING_CHARS = 12_000;
export const HARVEST_TIMEOUT_MS = 45_000;
export const HARVEST_MAX_RETRIES = 0;
/** Headroom over the ~17,300 output tokens 120 terms with definitions cost. */
export const HARVEST_MAX_OUTPUT_TOKENS = 22_000;

// ---------------------------------------------------------------------------
// THE DEFINITION CONTRACT (AC-Q5)
// ---------------------------------------------------------------------------
export const DEFINITION_TARGET_MIN_WORDS = 25;
export const DEFINITION_TARGET_MAX_WORDS = 55;
export const DEFINITION_HARD_MIN_WORDS = 10;
export const DEFINITION_HARD_MAX_WORDS = 80;
/** Distinct significant tokens that must survive stripping the term's own words. */
export const DEFINITION_MIN_RESIDUAL_TERMS = 8;

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------
/**
 * Enforced in JS before the write, NOT as a database CHECK: `pg_column_size` is
 * not IMMUTABLE and a CHECK containing a non-immutable function is a
 * dump/restore hazard. In JS it can also report WHICH term overflowed.
 */
export const MAX_TERMS_BYTES = 262_144;
export const MAX_ID_CHARS = 100;
