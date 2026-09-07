// Data access for the knowledge-page scope summary and its question history
// (public.experience_page_summaries / public.experience_page_questions — see
// supabase/migrations/20260906010000_experience_knowledge.sql, which this
// module's every claim below is re-stated from, never invented independently
// of it). One module, not two, because both tables key on the identical
// (user_id, scope_key) shape and duplicating the whitelist discipline and the
// never-throws contract across two files is two places for either to drift
// apart.
//
// Shaped like lib/supabase/applicationDigests.js: every function takes the
// caller's own authenticated `supabase` client and `userId` (never resolves
// its own session) and scopes every query by `user_id` EXPLICITLY, in
// addition to RLS — defense in depth, not a substitute for it. Nothing here
// throws — every function returns a result object, so a failed call is data
// the route branches on rather than an exception that could tear down it.
//
// `scope_key` IS NEVER IN ANY WRITE PAYLOAD, ANYWHERE IN THIS FILE, ON
// PURPOSE. It is `GENERATED ALWAYS AS (...) STORED` on both tables — the
// migration's own header, "scope_key MUST NEVER BE WRITTEN TO" — and Postgres
// refuses ANY value supplied for a generated column, even the exact value it
// would itself have derived. Every write below sends `scope_page_id` alone
// and lets Postgres derive `scope_key`; a caller that wants to LOOK UP a row
// by scope computes the identical value with
// `lib/experience/knowledgeScope.js`'s `scopeKeyFor` and passes it in as
// `scopeKey` to `getSummary`/`listQuestions`/`clearQuestions` below — this
// module never derives it itself, so there is exactly one place in the whole
// feature that knows the coalesce-to-sentinel rule.
//
// THE WHITELIST IS EXHAUSTIVE FOR EVERY WRITABLE COLUMN — deliberately NOT
// exhaustive for every column the migration declares. AC-3.9's "exhaustive
// for every column it may write" would mandate writing `scope_key`, which
// Postgres rejects on every single write; the migration's header spells this
// out and asks this file to say it again, so: `scope_key` is the one
// deliberate, permanent exception, and the only thing this repo's fake
// harness can prove about it is that it is ABSENT from the sent payload —
// never that Postgres would have rejected its presence, which nothing short
// of a live database can prove.
//
// COLUMN-WISE UPSERT, NOT ROW-WISE — copied from
// lib/supabase/applicationDigests.js's own header (`upsertDigest`, re-read),
// and the hazard it names applies again here without change: `.upsert(row,
// { onConflict })` sends only the keys `row` actually has, so on the UPDATE
// branch an OMITTED column keeps its EXISTING stored value. A column-wise
// upsert can therefore mix generations — a write that supplies fresh
// `summary` text but omits `source_pages`/`retrieval_outcome` would attach
// new prose to a PREVIOUS run's derived data, which is exactly the failure
// applicationDigests.js's header warns its own caller against for
// `citation_outcome`. This module does not and cannot enforce "write these
// four together" from inside a single call whose whole contract is "write
// only what you were given" — that discipline belongs to the CALLER (the
// route), which must pass `summary`, `source_pages`, `retrieval_outcome` and
// `generated_at` together on every write that could plausibly produce a
// summary. What this module DOES guarantee: any of those four fields, when
// supplied, reaches the row; `error` is written EXPLICITLY including as
// `null` (`typeof null === "object"` is the exact trap
// applicationDigests.js's header names); and `generated_at` has NO null arm
// at all — omitting it, never nulling it, is the only way a failure write
// can leave a prior success's generation time standing while `updated_at`
// (stamped unconditionally, every write) goes on meaning "row last written".

export const SUMMARY_TABLE = "experience_page_summaries";
export const QUESTION_TABLE = "experience_page_questions";
export const SUMMARY_CONFLICT = "user_id,scope_key";
export const QUESTION_PAGE_SIZE = 50;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// A jsonb column this feature deliberately allows to be written as SQL NULL
// — see the migration's own comment on `retrieval_outcome`: NULL means "no
// retrieval outcome was ever computed for this row" (a hard failure before
// the pipeline reached the counting stage), a DIFFERENT fact from a populated
// record whose counts are themselves zero. Written explicitly either way,
// exactly like applicationDigests.js's `citation_outcome` handling, for the
// identical `typeof null === "object"` reason.
function withOutcomeField(row, fields) {
  if (fields.retrieval_outcome === null || isPlainObject(fields.retrieval_outcome)) {
    row.retrieval_outcome = fields.retrieval_outcome;
  }
}

// getSummary(supabase, userId, scopeKey) -> { summary: row|null, error }.
//
// A FAILED READ IS NOT A CACHE MISS. `error` is populated only when the
// query itself failed (a transient PostgREST error, a dropped connection);
// "no row exists yet for this scope" is `{ summary: null, error: null }`,
// the genuinely different, much more common case. Conflating the two would
// make a transient read failure indistinguishable from "nothing has ever
// been generated here" and bill a fresh model call for a row that already
// had content — the caller (the route) is expected to 500 on a non-null
// `error` rather than treat it as an invitation to regenerate.
export async function getSummary(supabase, userId, scopeKey) {
  try {
    const { data, error } = await supabase
      .from(SUMMARY_TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("scope_key", scopeKey)
      .maybeSingle();
    if (error) return { summary: null, error: error.message || "Could not load this summary." };
    return { summary: data || null, error: null };
  } catch (err) {
    return { summary: null, error: err?.message || "Could not load this summary." };
  }
}

// upsertSummary(supabase, userId, { scopePageId, ...fields }) -> { summary: row|null, error }.
//
// The ONLY writer of experience_page_summaries. `scopePageId` may be `null`
// (the root scope) or a page id; it is always sent as `scope_page_id`, and
// `scope_key` never appears in the payload regardless of what `fields`
// contains — even a caller that (incorrectly) tries to pass `scope_key` or
// `scopeKey` directly has it silently dropped, the same "unknown field is
// silently discarded" discipline `applicationDigests.js`'s own header names
// as this repo's signature failure mode, deliberately used here IN FAVOUR of
// correctness rather than against it.
//
// Every write that could plausibly succeed OR fail is expected to pass
// `status` ('ready' | 'failed', enforced by the migration's own CHECK) and,
// on a failure, `error` — writing SOME row on every attempt, ready or
// failed, is what stops a "no row exists yet" auto-generation gate from
// re-firing a paid model call on every view forever the moment a write
// itself starts failing.
export async function upsertSummary(supabase, userId, { scopePageId, ...fields } = {}) {
  try {
    const row = {
      user_id: userId,
      scope_page_id: scopePageId ?? null,
      updated_at: new Date().toISOString(),
    };
    if (typeof fields.summary === "string") row.summary = fields.summary;
    if (Array.isArray(fields.source_pages)) row.source_pages = fields.source_pages;
    withOutcomeField(row, fields);
    if (typeof fields.model === "string" || fields.model === null) row.model = fields.model;
    if (typeof fields.engine === "string" || fields.engine === null) row.engine = fields.engine;
    if (typeof fields.status === "string") row.status = fields.status;
    if (typeof fields.error === "string" || fields.error === null) row.error = fields.error;
    // NO null arm, deliberately — see this module's header. Omitting the
    // key on a failure write keeps the last SUCCESSFUL generation time
    // standing; `updated_at` above is stamped unconditionally instead.
    if (typeof fields.generated_at === "string" && fields.generated_at !== "") {
      row.generated_at = fields.generated_at;
    }

    const { data, error } = await supabase
      .from(SUMMARY_TABLE)
      .upsert(row, { onConflict: SUMMARY_CONFLICT })
      .select()
      .maybeSingle();
    if (error) return { summary: null, error: error.message || "Could not save this summary." };
    return { summary: data || null, error: null };
  } catch (err) {
    return { summary: null, error: err?.message || "Could not save this summary." };
  }
}

// listQuestions(supabase, userId, scopeKey, { limit }) -> { questions, hasMore, error }.
//
// Newest-first. Fetches ONE more row than requested to compute `hasMore`
// without a second round trip (a second `count` query would double the read
// cost of every panel mount for a number the caller only needs as a
// boolean), then trims back to the requested page.
export async function listQuestions(supabase, userId, scopeKey, { limit } = {}) {
  try {
    const pageSize = Number.isInteger(limit) && limit > 0 ? limit : QUESTION_PAGE_SIZE;
    const { data, error } = await supabase
      .from(QUESTION_TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("scope_key", scopeKey)
      .order("created_at", { ascending: false })
      .limit(pageSize + 1);
    if (error) return { questions: null, hasMore: false, error: error.message || "Could not load questions." };
    const rows = Array.isArray(data) ? data : [];
    const hasMore = rows.length > pageSize;
    return { questions: hasMore ? rows.slice(0, pageSize) : rows, hasMore, error: null };
  } catch (err) {
    return { questions: null, hasMore: false, error: err?.message || "Could not load questions." };
  }
}

// insertQuestion(supabase, userId, { scopePageId, ...fields }) -> { question: row|null, error }.
//
// APPENDS, NEVER UPSERTS — experience_page_questions carries no unique key at
// all (the migration's own comment: "history is intentionally many-valued,
// and rows here are inserted, never upserted"), so this is a plain
// `.insert()`, unlike `upsertSummary` above. A failed attempt is still worth
// writing as a `status: 'failed'` row when the caller supplies one, for the
// identical "leave no row and the retry loop bills forever" reason
// `upsertSummary` names.
export async function insertQuestion(supabase, userId, { scopePageId, ...fields } = {}) {
  try {
    if (typeof fields.question !== "string" || fields.question.trim() === "") {
      return { question: null, error: "Missing question text." };
    }

    const row = {
      user_id: userId,
      scope_page_id: scopePageId ?? null,
      question: fields.question,
    };
    if (typeof fields.answer === "string") row.answer = fields.answer;
    if (Array.isArray(fields.citations)) row.citations = fields.citations;
    // THREE STATES, NOT TWO (the migration's own comment on this column):
    // true, false and null are all written explicitly. A whitelist gated on
    // mere truthiness (`if (fields.answered_from_pages)`) would silently
    // drop `false` — the model's own explicit "I cannot answer from these
    // pages" — leaving the column NULL and reporting a hard failure that
    // never happened.
    if (
      fields.answered_from_pages === true ||
      fields.answered_from_pages === false ||
      fields.answered_from_pages === null
    ) {
      row.answered_from_pages = fields.answered_from_pages;
    }
    withOutcomeField(row, fields);
    if (typeof fields.model === "string" || fields.model === null) row.model = fields.model;
    if (typeof fields.engine === "string" || fields.engine === null) row.engine = fields.engine;
    if (typeof fields.status === "string") row.status = fields.status;
    if (typeof fields.error === "string" || fields.error === null) row.error = fields.error;

    const { data, error } = await supabase.from(QUESTION_TABLE).insert(row).select().maybeSingle();
    if (error) return { question: null, error: error.message || "Could not save this question." };
    return { question: data || null, error: null };
  } catch (err) {
    return { question: null, error: err?.message || "Could not save this question." };
  }
}

// deleteQuestion(supabase, userId, id) -> { ok, error }.
//
// Tenancy is enforced twice over: RLS, and this explicit `.eq("user_id",
// userId)` alongside the id filter, so a caller cannot delete another user's
// row even if `id` leaked from somewhere it should not have.
export async function deleteQuestion(supabase, userId, id) {
  try {
    if (typeof id !== "string" || id === "") return { ok: false, error: "Missing question id." };
    const { error } = await supabase.from(QUESTION_TABLE).delete().eq("user_id", userId).eq("id", id);
    if (error) return { ok: false, error: error.message || "Could not delete this question." };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not delete this question." };
  }
}

// clearQuestions(supabase, userId, scopeKey) -> { cleared, error }.
//
// `cleared` is the number of rows the DELETE actually removed, read off the
// same statement's own RETURNING projection (`.select("id")` chained onto
// `.delete()`) rather than a separate count query.
export async function clearQuestions(supabase, userId, scopeKey) {
  try {
    const { data, error } = await supabase
      .from(QUESTION_TABLE)
      .delete()
      .eq("user_id", userId)
      .eq("scope_key", scopeKey)
      .select("id");
    if (error) return { cleared: 0, error: error.message || "Could not clear this history." };
    return { cleared: Array.isArray(data) ? data.length : 0, error: null };
  } catch (err) {
    return { cleared: 0, error: err?.message || "Could not clear this history." };
  }
}
