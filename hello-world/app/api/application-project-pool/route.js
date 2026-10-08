// ---------------------------------------------------------------------------
// POST /api/application-project-pool -- the lazy prewarm of the invented
// "example projects" the interview copilot shows beside a drafted answer. One
// pool per application, generated once and read back (by the answer route, per
// question) as a row; see lib/copilot/projectExampleGen.js for the prompt and
// the number guard, lib/copilot/projectPoolPrewarm.js for the cost gate that
// decides who calls this, and lib/supabase/applicationProjectPool.js for storage.
//
// The gate order mirrors app/api/application-digest/route.js, and every gate is
// there to avoid a model call that is not needed: auth, then the spend ceiling,
// then a missing id, then someone else's application, then the embedded engine
// (an invented project has no honest offline equivalent -- refused, never a
// canned template), then a pool read that FAILED (a failed read is not a miss),
// then the short-circuits (an already-ready or failed pool, or one another
// request is generating right now). Only after all of that is a model asked
// anything.
//
// THE 'pending' ROW IS WRITTEN BEFORE THE MODEL IS CALLED, and that ordering is
// the point of this route. The answer route reads the row to tell a pool that is
// still being built (WARMING) from one that crashed (FAILED), and it can only do
// that if a generation in flight is visible as a timestamped row. A generation
// that dies mid-call (the function killed, the connection dropped) therefore
// leaves a pending row that outlives POOL_PENDING_MAX_AGE, which both the answer
// route (reads it as failed) and the cost gate (retries it) understand. Without
// the marker a crash leaves no row at all and every page load re-fires a billed
// call at the same stuck application.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { getProjectPool, upsertProjectPool } from "@/lib/supabase/applicationProjectPool";
import { generateProjectPool } from "@/lib/copilot/projectExampleGen";
import { isStalePending } from "@/lib/copilot/projectExampleSelect";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One non-streaming generateContent call, which makes ONE attempt (unlike the
// digest's Interactions call, which retries twice), bounded inside
// generateProjectPool by POOL_GENERATION_TIMEOUT_MS (60 s). 120 s leaves room
// for the two reads and three writes around it, and the timeout ends the call
// well before the platform could kill the function mid-call and skip the
// catch below -- the failure that would leave a pending row and no failed one.
export const maxDuration = 120;

// Longest failure message stored on the row. The model client's error text can
// carry request detail; the row only needs enough to say why.
const MAX_ERROR_CHARS = 300;
const GENERIC_FAILURE = "Example projects could not be prepared. Please try again.";
const NO_POSTING_TEXT = "This application has no posting text to base example projects on.";
const MAX_APPLICATION_ID_CHARS = 100;

// ---------------------------------------------------------------------------
// THE SPEND CEILING for application-project-pool.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING: a limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request and the bound counts nothing. The behavioural
// case (fire past the limit, the last is denied) and the static case in
// lib/rateLimit/adoption.test.js (this declaration precedes the handler) both
// pin it.
//
// 12 per 10 minutes, per authenticated user, the digest's own number: each miss
// is one model call, the tracking table re-renders on every load, and the
// stored pool serves every re-render after the first. A DENIED REQUEST STILL
// INCREMENTS, so the bound is 12 ATTEMPTS, not 12 successes. The store is per
// instance, so on serverless this bounds a caller to 12 x instanceCount; it is
// worth having anyway and must not be described as a fleet-wide guarantee.
// Owner-tunable: the number is a flagged guess.
// ---------------------------------------------------------------------------
const projectPoolLimiter = createRateLimiter({ limit: 12, windowMs: 600_000, prefix: "application-project-pool" });

const rateLimitedMessage = "Too many example-project requests in a short window. Wait a moment and try again.";

function failureMessage(err) {
  const message = typeof err?.message === "string" ? err.message.trim() : "";
  return (message || GENERIC_FAILURE).slice(0, MAX_ERROR_CHARS);
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();
  const userId = user.id;

  // Keyed on the id the auth gate above resolved and checked ahead of body
  // validation, so a caller hammering this endpoint with junk exhausts its own
  // allowance rather than getting an unmetered lane.
  const rateLimit = await projectPoolLimiter.check(identify(request, { userId }));
  if (!rateLimit.allowed) {
    return Response.json({ error: rateLimitedMessage }, { status: 429, headers: rateLimitHeaders(rateLimit) });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const applicationId =
    typeof body?.applicationId === "string" ? body.applicationId.trim().slice(0, MAX_APPLICATION_ID_CHARS) : "";
  if (!applicationId) return badRequest("Missing applicationId.");

  // Scoped to the caller in the query itself, not just checked after the fact.
  // salary_min / salary_max ride along so the number guard can see a posting's
  // structured salary band, not only the band it can read out of the text.
  const { data: appRow, error: appErr } = await supabase
    .from("applications")
    .select("id, user_id, positions ( id, title, company, location, description, salary_min, salary_max )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (appErr) return Response.json({ error: appErr.message || "Could not load this application." }, { status: 500 });
  if (!appRow) return notFound("Application not found.");

  // An invented project has no honest offline equivalent, so the embedded engine
  // is refused outright rather than answered with a canned template.
  if (wantsEmbedded(body?.engine)) {
    return Response.json(
      { error: "Example projects need the Gemini engine. Switch off the embedded engine and try again." },
      { status: 503 },
    );
  }

  const force = body?.force === true;

  // A FAILED POOL READ IS NOT A MISS. getProjectPool returns `{ pool: null,
  // error }` on a transient PostgREST failure; reading only `pool` made that
  // indistinguishable from "this application has no pool", and the consequence
  // is a billed generation on an application that already had a ready one.
  const { pool: existing, error: readErr } = await getProjectPool(supabase, userId, applicationId);
  if (readErr) return Response.json({ error: readErr }, { status: 500 });

  if (existing) {
    // ready and failed are final until someone asks again. A failed pool is NOT
    // retried on load -- that is what `force` (the Try again control) is for --
    // or every page load would bill another call against the same stuck row.
    if (!force && (existing.status === "ready" || existing.status === "failed")) {
      return Response.json({ pool: existing });
    }
    // A pending row younger than POOL_PENDING_MAX_AGE is another request that is
    // genuinely generating. Never double-fire, `force` included; an older one
    // crashed, and falls through to be regenerated.
    if (existing.status === "pending" && !isStalePending(existing)) {
      return Response.json({ pool: existing });
    }
  }

  const posting = appRow.positions || {};
  // A posting with neither a title nor a description gives the model nothing to
  // anchor a domain on, and an unanchored pool is the generic skeleton this
  // feature exists to avoid. Recorded as failed without a billed call, so the
  // card says so instead of showing a pool that is not about this role.
  if (!posting.title && !posting.description) {
    const { pool } = await upsertProjectPool(supabase, userId, applicationId, {
      status: "failed",
      error: NO_POSTING_TEXT,
      engine: "gemini",
    });
    return Response.json({ pool });
  }

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ error: "Example projects need the Gemini API key to be configured." }, { status: 503 });
  }

  // The marker, before the model. If it cannot be written the billed call is not
  // made: a generation that no row can see is the stampede this ordering closes.
  // `projects` is omitted, so a regeneration marks the row in flight without
  // wiping the pool it is replacing.
  const marked = await upsertProjectPool(supabase, userId, applicationId, { status: "pending", error: null });
  if (marked.error) return Response.json({ error: marked.error }, { status: 500 });

  let projects;
  try {
    ({ projects } = await generateProjectPool({ client, model, posting }));
  } catch (err) {
    // Persisted, not just returned: a failed attempt that vanished would leave
    // the card reading "preparing" until the pending row aged out, and the cost
    // gate relies on a stored failed row to NOT auto-retry this application.
    // `projects` is again omitted, so a failed REGENERATION never wipes the last
    // good pool -- it only changes what the row says about it.
    const { pool: failedPool, error: failedSaveErr } = await upsertProjectPool(supabase, userId, applicationId, {
      status: "failed",
      error: failureMessage(err),
      engine: "gemini",
    });
    if (failedSaveErr) console.error("application-project-pool: could not record a failed pool", failedSaveErr);
    // 200, not 5xx: the failure is the answer here, not a broken route -- the
    // caller needs a normal response it can render as "try again".
    return Response.json({ pool: failedPool });
  }

  const { pool, error: saveErr } = await upsertProjectPool(supabase, userId, applicationId, {
    status: "ready",
    projects,
    engine: "gemini",
    error: null,
  });
  if (saveErr) return Response.json({ error: saveErr }, { status: 500 });

  return Response.json({ pool });
}
