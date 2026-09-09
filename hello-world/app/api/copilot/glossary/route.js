// ---------------------------------------------------------------------------
// /api/copilot/glossary
//
//   GET  -- the read the copilot performs ONCE when a posting is selected. Not
//           per answer, not per question, not per hover: the whole glossary is
//           held in memory and a hover is an in-memory lookup, which is why the
//           hover surface makes zero outbound requests.
//   POST -- Phase 1. Makes AT MOST ONE ungrounded harvest call and returns. It
//           NEVER makes a grounded call: those live in the cron worker, because
//           ten of them at ~92 s worst case do not fit one invocation.
//
// ---------------------------------------------------------------------------
// THE GATE ORDER IS LOAD-BEARING, AND EACH STEP STATES WHAT IT MUST PRECEDE
// ---------------------------------------------------------------------------
// A module that constructs the model client and THEN decides is green on most
// fixtures and red only on the one that reaches the gate at all. Every gate
// below refuses before `getGeminiClient` is constructed, and the suite walks
// them in order to prove it.
//
//    1 kill switch           -- before any client, so "off" stops the SPEND
//    2 identity              -- getUser(), never the cookie-only accessor
//    3 body parse            -- 400
//    4 rate limit            -- keyed on the id step 2 resolved to
//    5 field validation      -- 400
//    6 authorization         -- the caller must hold an application here -> 403
//    7 downgrade refusal     -- an embedded row may not overwrite a researched one
//    8 ready, same posting   -- nothing a retry could add
//    9 generation in flight  -- the worker owns it, force INCLUDED
//   10 complete and adequate -- a second call hits the same missing sources
//   11 generation cooldown   -- one generation per POSTING per hour, force INCLUDED
//   12 call caps             -- per fingerprint and for life
//   13 no description        -- writes `unavailable`, no model call
//   14 embedded engine       -- the quoting path, zero outbound
//
// ---------------------------------------------------------------------------
// WHY GATE 9 EXISTS AND WHY IT IGNORES `force`
// ---------------------------------------------------------------------------
// A generation already in flight is owned by the worker. A rebuild press
// mid-research would re-roll the harvest and roll the term list out from under
// the cursor, so the batch the worker is about to write lands on positions that
// now hold different terms.
//
// ---------------------------------------------------------------------------
// FORCE MUST NOT MINT BUDGET
// ---------------------------------------------------------------------------
// A rebuild increments both call counters, does NOT reset `attempts`, and is
// refused at either cap and inside the cooldown. An earlier design reset
// `attempts` on every press, re-arming three automatic generations per press, on
// a SHARED row, from a button rendered for every user.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { HARVEST_SYSTEM_PROMPT } from "@/lib/copilot/glossaryPrompt";
import {
  prepareHarvest,
  parseHarvestTerms,
  buildHarvestFields,
} from "@/lib/copilot/glossaryHarvest";
import { buildQuotesOnlyTerms } from "@/lib/copilot/glossaryLocal";
import {
  GLOSSARY_TABLE,
  buildGlossaryRow,
  computeStatus,
  postingFingerprint,
  readGlossaryForPosition,
} from "@/lib/copilot/glossaryStore";
import {
  MAX_ID_CHARS,
  MAX_LIFETIME_MODEL_CALLS,
  MAX_ABSOLUTE_MODEL_CALLS,
  GENERATION_COOLDOWN_MS,
  GENERATION_RATE_LIMIT,
  GENERATION_RATE_WINDOW_MS,
  RESEARCH_FLOOR,
  HARVEST_TIMEOUT_MS,
  HARVEST_MAX_OUTPUT_TOKENS,
  MAX_AUTO_ATTEMPTS,
} from "@/lib/copilot/glossaryConstants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One ungrounded call worst case, in the same shape and for the same reason as
// the four sibling routes that set a duration.
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// THE SPEND CEILING.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. Both halves are pinned -- a behavioural
// case that fires five requests and expects the fifth to be denied (a
// per-request limiter would pass all five), and a static case asserting this
// declaration precedes the handler.
//
// CALIBRATED ON SPEND COMMITTED, NOT ON CALLS IN FLIGHT. The POST makes ONE
// call, but it commits a full generation of grounded work to the worker, so
// calibrating on the immediate call would be calibrating on the cheap half.
//
// A DENIED REQUEST STILL INCREMENTS: the bound is four ATTEMPTS, not four
// successes. Stated so nobody later "fixes" it.
//
// A CAP THAT COSTS LATENCY, NOT COVERAGE: a user applying to more than four
// postings in an hour still gets all of them, because the lazy backstop picks
// the rest up the next time each posting is opened.
//
// HONEST ABOUT WHAT THIS BUYS: the in-memory store is per-instance, so on
// serverless this bounds a caller to four times the instance count, not four. It
// is worth having anyway -- it is the difference between a runaway client
// costing thousands of grounded searches and costing a few. It is NOT a
// fleet-wide guarantee and must not be described as one. Swapping in a
// Redis-backed store satisfying the same two-method interface needs no change
// here, and that dependency is already installed.
// ---------------------------------------------------------------------------
const glossaryLimiter = createRateLimiter({
  limit: GENERATION_RATE_LIMIT,
  windowMs: GENERATION_RATE_WINDOW_MS,
  prefix: "position-glossary",
});

const DISABLED = { status: "disabled" };
const RATE_LIMITED_MESSAGE =
  "You have started a lot of posting glossaries in a short window. Wait a moment and try again.";

function fail(message, status) {
  return Response.json({ error: message }, { status });
}

function idOf(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= MAX_ID_CHARS ? text : "";
}

/**
 * Resolves the caller's own application on a posting. Scoped to the caller IN
 * THE QUERY on the USER-SCOPED client, so `applications`' own row-level security
 * applies to the lookup rather than being reproduced by hand afterwards.
 *
 * 403 rather than 404 when there is no row: the existence of a posting is not a
 * secret, and the sibling route that writes this shared catalogue makes the same
 * call for the same reason.
 */
async function resolveAuthorizedPosition(supabase, userId, { positionId, applicationId }) {
  if (applicationId) {
    const { data } = await supabase
      .from("applications")
      .select("id, position_id")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    return data?.position_id ? { positionId: data.position_id } : { positionId: null };
  }
  const { data } = await supabase
    .from("applications")
    .select("id")
    .eq("position_id", positionId)
    .eq("user_id", userId)
    .limit(1);
  return { positionId: Array.isArray(data) && data.length > 0 ? positionId : null };
}

export async function GET(request) {
  if (process.env.GLOSSARY_DISABLED === "1") return Response.json(DISABLED, { status: 503 });

  const supabase = await createClient();
  const {
    data: { user } = {},
  } = await supabase.auth.getUser();
  if (!user?.id) return fail("Sign in to use the interview copilot.", 401);

  const url = new URL(request.url);
  const positionId = idOf(url.searchParams.get("positionId"));
  const applicationId = idOf(url.searchParams.get("applicationId"));
  if (!positionId && !applicationId) return fail("Missing positionId or applicationId.", 400);

  const resolved = await resolveAuthorizedPosition(supabase, user.id, { positionId, applicationId });
  if (!resolved.positionId) return fail("No application on this posting.", 403);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return fail("The glossary store is not configured.", 503);
  }

  const { row, error } = await readGlossaryForPosition(admin, resolved.positionId);
  if (error) return fail(error, 500);
  // A MISSING ROW IS NOT AN ERROR. It is the sixth, implicit state -- never
  // attempted -- and the caller renders a line for it rather than a failure.
  return Response.json({ glossary: row });
}

export async function POST(request) {
  // GATE 1. Before a Supabase client and before any model client: an operator
  // turning this off must stop the SPEND, not merely hide the answer.
  if (process.env.GLOSSARY_DISABLED === "1") return Response.json(DISABLED, { status: 503 });

  // GATE 2. From `auth.getUser()`, and from nothing else. The cookie-only
  // session accessor makes ZERO network requests -- measured, and recorded in
  // this repo's health route -- so gating on it is not a weak check, it is a
  // total bypass. A source sweep in this route's suite pins the absence.
  const supabase = await createClient();
  const {
    data: { user } = {},
  } = await supabase.auth.getUser();
  if (!user?.id) return fail("Sign in to use the interview copilot.", 401);

  // GATE 3.
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body.", 400);
  }

  // GATE 4. Keyed on the id gate 2 resolved to -- never on the caller's access
  // token, and never before the auth resolves. Ahead of field validation on
  // purpose: an invalid request is still a request, and a caller hammering this
  // endpoint with junk should exhaust its own allowance rather than get an
  // unmetered lane.
  const decision = await glossaryLimiter.check(identify(request, { userId: user.id }));
  if (!decision.allowed) {
    return Response.json(
      { error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

  // GATE 5.
  const positionId = idOf(body?.positionId);
  const applicationId = idOf(body?.applicationId);
  if (!positionId && !applicationId) return fail("Missing positionId or applicationId.", 400);

  // GATE 6.
  const resolved = await resolveAuthorizedPosition(supabase, user.id, { positionId, applicationId });
  if (!resolved.positionId) return fail("No application on this posting.", 403);
  const targetId = resolved.positionId;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return fail("The glossary store is not configured.", 503);
  }

  const { data: position } = await supabase
    .from("positions")
    .select("id, title, company, description")
    .eq("id", targetId)
    .maybeSingle();

  // A FAILED READ IS NOT A CACHE MISS. Reading only the row made the two
  // indistinguishable, and the consequence is a full billed generation on a row
  // that already had one, on every load until the read recovers.
  const { row: existing, error: readError } = await readGlossaryForPosition(admin, targetId);
  if (readError) return fail(readError, 500);

  const force = body?.force === true;
  const embedded = wantsEmbedded(body?.engine);
  const fingerprint = postingFingerprint(position || {});
  const sameFingerprint = Boolean(existing) && existing.posting_fingerprint === fingerprint;

  const refuse = (reason) => Response.json({ glossary: existing ?? null, reason });

  if (existing) {
    // GATE 7. The ONE rank rule that is NOT scoped to a fingerprint, and the
    // asymmetry is deliberate. Rank monotonicity in general compares two rows
    // describing the SAME posting text, so across a fingerprint change it does
    // not apply -- a different posting deserves a fresh row. But a `quotes-only`
    // write is a DOWNGRADE OF KIND, not of freshness: it would replace every
    // researched definition on a SHARED row with a handful of posting quotes, on
    // behalf of every other applicant, through a button rendered for all of
    // them. A different fingerprint does not make that acceptable.
    if (embedded && (existing.status === "ready" || existing.status === "partial")) {
      return refuse("would-downgrade");
    }

    // GATE 8. `ready` means fully researched; there is nothing a retry could
    // add, so `force` is refused here too.
    if (existing.status === "ready" && sameFingerprint) return refuse("already-ready");

    // GATE 9. The worker owns an unfinished generation. `force` INCLUDED.
    if (existing.research_cursor < existing.research_total) return refuse("in-flight");

    // GATE 10. A completed generation at or above the floor is as good as this
    // posting gets: a second run hits the same terms with no findable source.
    // The floor is evaluated ONLY on a completed generation -- applying it to a
    // row still in flight is what turns "incomplete" into "permanently stable".
    const graded = (existing.researched_count || 0) + (existing.recalled_count || 0);
    const ratio = graded > 0 ? (existing.researched_count || 0) / graded : 0;
    if (existing.status === "partial" && sameFingerprint && ratio >= RESEARCH_FLOOR && !force) {
      return refuse("above-floor");
    }

    // GATE 11. One new generation per POSTING per hour, no matter how many users
    // press rebuild. `force` INCLUDED. Without it, four rebuilds inside one hour
    // is a full fingerprint budget spent on one shared row in one sitting.
    const last = Date.parse(existing.last_generation_at || "");
    if (Number.isFinite(last) && Date.now() - last < GENERATION_COOLDOWN_MS) {
      return refuse("cooldown");
    }

    // GATE 12. Both caps, and neither is negotiable by `force`. The
    // per-fingerprint counter resets when the posting text changes; the absolute
    // one never does, and it is what stops that reset being an unbounded spend
    // bypass for anyone who can rewrite a shared posting's description.
    const fingerprintCalls = sameFingerprint ? existing.model_calls_fingerprint || 0 : 0;
    if (
      fingerprintCalls >= MAX_LIFETIME_MODEL_CALLS ||
      (existing.model_calls_total || 0) >= MAX_ABSOLUTE_MODEL_CALLS
    ) {
      return refuse("call-cap");
    }

    if (sameFingerprint && !force && (existing.attempts || 0) >= MAX_AUTO_ATTEMPTS) {
      return refuse("attempt-cap");
    }
  }

  const nowIso = new Date().toISOString();
  const carriedCalls = existing && sameFingerprint ? existing.model_calls_fingerprint || 0 : 0;
  const carriedTotal = existing ? existing.model_calls_total || 0 : 0;
  const base = {
    position_id: targetId,
    posting_fingerprint: fingerprint,
    attempts: (existing?.attempts || 0) + 1,
    queued_at: nowIso,
    last_generation_at: nowIso,
    lease_until: null,
    engine: embedded ? "embedded" : "gemini",
  };

  const write = async (fields) => {
    const row = buildGlossaryRow({ ...base, ...fields });
    const { error } = await admin.from(GLOSSARY_TABLE).upsert(row, { onConflict: "position_id" });
    return error ? error.message || String(error) : null;
  };

  const description = String(position?.description || "").trim();

  // GATE 13. No text to mine: a deliberate, terminal row with NO model call.
  if (!description) {
    const error = await write({
      status: "unavailable",
      reason: "no-posting-text",
      terms: [],
      explicit_count: 0,
      anticipated_count: 0,
      researched_count: 0,
      recalled_count: 0,
      research_cursor: 0,
      research_total: 0,
      model_calls_fingerprint: carriedCalls,
      model_calls_total: carriedTotal,
    });
    if (error) return fail(error, 500);
    return Response.json({ status: "unavailable" });
  }

  // GATE 14. The embedded path. ZERO OUTBOUND, ZERO CLIENT -- no server env is
  // read and no model client is constructed, which is a property the suite
  // asserts rather than infers.
  if (embedded) {
    const terms = buildQuotesOnlyTerms(description);
    const error = await write({
      status: "quotes-only",
      reason: "embedded-engine",
      terms,
      explicit_count: terms.length,
      anticipated_count: 0,
      researched_count: 0,
      // 0, not terms.length: a `quotes-only` row is finished by construction and
      // must never look to the worker like research waiting to happen.
      recalled_count: 0,
      research_cursor: 0,
      research_total: 0,
      model_calls_fingerprint: carriedCalls,
      model_calls_total: carriedTotal,
    });
    if (error) return fail(error, 500);
    return Response.json({ status: "quotes-only", terms: terms.length });
  }

  let client;
  let model;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return fail("The posting glossary needs the Gemini API key to be configured.", 503);
  }

  const prepared = prepareHarvest(position);
  const calls = { model_calls_fingerprint: carriedCalls + 1, model_calls_total: carriedTotal + 1 };

  let raw = "";
  try {
    const response = await client.models.generateContent({
      model,
      contents: prepared.userTurn,
      // `tools` would live INSIDE `config` on this surface, and the harvest uses
      // none: it is deliberately UNGROUNDED. The grounded call is the research
      // pass and it lives in the cron worker, on a DIFFERENT API whose request
      // shape inverts every rule this one follows.
      config: {
        systemInstruction: HARVEST_SYSTEM_PROMPT,
        // `0` is documented DISABLED. The model defaults to dynamic thinking and
        // thinking tokens bill at the OUTPUT rate, so leaving it unset is a
        // silent multiplier on the cheap half of the bill.
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: HARVEST_MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
      },
    }, { timeout: HARVEST_TIMEOUT_MS });
    raw = response?.text ?? "";
  } catch (err) {
    // Persisted, not just returned. A failed attempt that vanished would leave
    // the row looking like nobody had ever tried, which is the state that
    // re-arms an automatic retry on every future page load -- and the call was
    // billed either way, so both counters move.
    const error = await write({
      status: "failed",
      reason: String(err?.message || "harvest-failed").slice(0, 300),
      terms: existing?.terms ?? [],
      research_cursor: 0,
      research_total: 0,
      ...calls,
    });
    if (error) console.error("position-glossary: could not record a failed harvest", error);
    return Response.json({ status: "failed" });
  }

  const { fields, rejectedByRule } = buildHarvestFields({
    prepared,
    candidates: parseHarvestTerms(raw),
    previousTerms: sameFingerprint ? existing?.terms : null,
  });

  const status = computeStatus({
    hasDescription: true,
    embedded: false,
    harvestFailed: false,
    termCount: fields.terms.length,
    recalledCount: fields.recalled_count,
    researchCursor: fields.research_cursor,
    researchTotal: fields.research_total,
  });

  if (status === "failed") {
    console.warn("position-glossary: harvest produced no storable terms", { rejectedByRule });
  }

  const error = await write({ status, reason: null, ...fields, ...calls });
  if (error) return fail(error, 500);

  return Response.json({
    status,
    terms: fields.terms.length,
    researchTotal: fields.research_total,
  });
}
