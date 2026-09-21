// Budget and lifecycle constants for interview-prep research (IP3). Single
// source of truth for every cap, timeout and rate-limit window this feature
// enforces in application code. Values are 1-0-contract.r8.md's own
// concrete-noun table (Named JS constants), unchanged from r7 through r8,
// except where a later owner ruling superseded that table (see below).
//
// N41 (owner decision, 2026-09-20): both interview-prep spend caps were
// REMOVED, not merely raised -- `interview_prep_spend.attempts`'s own CHECK
// upper bound (supabase/migrations/20260922000000_interview_prep_remove_spend_caps.sql)
// and `claim_prep_pack_slot`'s `model_calls >= 12` guard (same migration).
// `PREP_MAX_ATTEMPTS`/`PREP_MODEL_CALLS_MAX` -- the JS-side ceiling values
// this module used to export for lib/interviewPrep/prepStore.js's own
// `isAttemptsExhausted` to compare against -- are deleted along with the
// ceilings they described, not left behind as dead exports: nothing in this
// codebase compares a counter to either value any more. The two COUNTERS
// themselves (`interview_prep_spend.attempts`/`.model_calls`) remain,
// unbounded, per N41(d)'s own text.

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

/** The byte cap `lib/interviewPrep/prepStore.js`'s `checkPackByteBudget`
 *  enforces on the stored `pack` JSONB document, in JS rather than as a
 *  database CHECK -- the migration's own "NOT ADDED, deliberately" note
 *  (supabase/migrations/20260914000000_interview_prep.sql) explains why: a
 *  CHECK built on `pg_column_size` would not be IMMUTABLE, which is a
 *  dump/restore hazard. No `interview_prep_packs_pack_size_check` constraint
 *  exists in that migration. */
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

/** N45/N46: the most revision rows `pruneSectionRevisions` keeps per
 *  (application, section) -- an owner-set tuning number (plan §12), not a
 *  correctness bound; AC-RET.1's exact counts are written against this
 *  value. */
export const PREP_SECTION_REVISIONS_MAX = 10;

/** N45/N46: the byte cap `appendSectionRevisions` enforces on ONE section's
 *  `{content, claims}` before any statement runs, measured with
 *  `TextEncoder` (never `Buffer`) -- the same browser-safe discipline
 *  `checkPackByteBudget` (prepStore.js) already uses. A per-section bound,
 *  not a count bound -- N49 can add many claims to one `stages` revision
 *  without a migration. */
export const PREP_SECTION_REVISION_MAX_BYTES = 65_536;
