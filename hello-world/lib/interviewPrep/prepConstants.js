// Budget and lifecycle constants for interview-prep research (IP3). Single
// source of truth for every cap, timeout and rate-limit window this feature
// enforces in application code. SQL cannot import a JS constant, so the
// migration's own CHECK constraints and `claim_prep_pack_slot`'s plpgsql body
// carry the numeric values of PREP_MAX_ATTEMPTS/PREP_MODEL_CALLS_MAX as
// literals too -- see supabase/migrations/<TS>_interview_prep.sql. Values are
// 1-0-contract.r8.md's own concrete-noun table (Named JS constants),
// unchanged from r7 through r8.

/** `interview_prep_spend.attempts`'s CHECK upper bound -- a retry-opportunity
 *  counter, not consumed by the route's own `23514` handling. */
export const PREP_MAX_ATTEMPTS = 6;

/** The value `claim_prep_pack_slot` compares `interview_prep_spend.model_calls`
 *  against to refuse a new claim. A spend counter, incremented unconditionally
 *  whenever a model call is issued -- whichever of this cap or
 *  PREP_MAX_ATTEMPTS is hit first is terminal. */
export const PREP_MODEL_CALLS_MAX = 12;

/** IP3's own generation call is issued at most once per attempt. This is a
 *  structural property of the shared Gemini client's own construction
 *  (`lib/llm/geminiClient.js` sets no retry option), not a settable per-call
 *  flag -- 1-0-contract.r8.md §10.6. */
export const PREP_GENERATION_MAX_ATTEMPTS = 1;

/** How long a claimed lease is valid before a later attempt may reclaim the
 *  row (`claim_prep_pack_slot`'s `p_lease_until`). */
export const PREP_LEASE_MS = 150_000;

/** `app/api/interview-prep/route.js`'s declared Vercel function duration. */
export const PREP_ROUTE_MAX_DURATION_S = 120;

/** Rate limit for `app/api/interview-prep/route.js`, matched to the
 *  grounded-call cadence `application-digest` is already sized for
 *  (`lib/rateLimit/adoption.test.js`'s `BOUNDED_ROUTES` entry). */
export const PREP_RATE_LIMIT = 12;
export const PREP_RATE_WINDOW_MS = 600_000;

/** `interview_prep_packs_pack_size_check`'s byte cap on the stored `pack`
 *  JSONB document. */
export const PREP_PACK_MAX_BYTES = 262_144;

/** Per-attempt timeout for IP3's own (non-grounded) generation call. Must be
 *  passed as `config.httpOptions.timeout` on `client.models.generateContent`
 *  -- a second bare `{ timeout }` argument is silently discarded on this
 *  transport (1-0-contract.r8.md §10.6). */
export const PREP_GENERATION_TIMEOUT_MS = 45_000;

/** The floor PREP_GENERATION_TIMEOUT_MS must never be reduced below. */
export const PREP_GENERATION_TIMEOUT_FLOOR_MS = 30_000;

/** Time reserved, beyond the generation call itself, for auth, the rate
 *  limiter, the application/digest reads, the claim RPC,
 *  `recordModelCallIssued`, the terminal write (plus its CHECK-safe
 *  fallback), `recordPrepEvent` and the response -- 7 round trips on the
 *  happy path, 8 on the CHECK-violation path (1-0-contract.r8.md §8, its
 *  round-trip count corrected against design-operate.r1.md §5.1). */
export const PREP_ROUTE_RESERVE_MS = 20_000;

/** Slack subtracted from a lease's remaining time before a caller treats it
 *  as usably expired, so a lease is never raced by reading `now()` a moment
 *  before the database does. */
export const PREP_LEASE_SLACK_MS = 30_000;
