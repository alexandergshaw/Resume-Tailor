// ---------------------------------------------------------------------------
// /api/cron/position-glossary -- Phase 2 of the per-posting interview glossary.
//
// A THIN SHELL over lib/copilot/glossaryWorker.js. Everything decidable lives in
// that module behind an injected clock and an injected store, which is what
// makes the whole schedule testable with no timer, no network and no database --
// including the test that walks a 120-term posting all the way to
// `status: 'ready'`. A design nobody has walked to its own success state is how
// an unreachable status ships.
//
// WHY A CRON JOB AT ALL: one research batch's worst case is ~92 seconds and a
// full generation is ten of them, which do not fit one serverless invocation at
// any maxDuration this platform offers. Progress lives in a Postgres cursor, so
// no single invocation has to finish the job and a killed worker loses nothing
// it has already paid for.
//
// THIS IS A SECOND AUTHORISATION SURFACE AND IT IS WORTH BEING EXPLICIT ABOUT.
// This route makes paid model calls and is NOT behind a signed-in user. Its only
// gate is the shared cron secret. What makes that acceptable is that IT CANNOT
// BE AIMED: it reads no request body, takes no parameters, and selects its own
// work from the queue query. Someone who guessed the secret could make the
// worker do work it was already going to do, sooner. That is the whole blast
// radius, and it is by construction rather than by care -- so the route's suite
// asserts the construction, not merely the 401.
//
// It is deliberately NOT rate limited, and the absence is stated here so it is
// not read later as an oversight: it is not user-triggered, it takes no
// parameters, and its spend is bounded by row-level caps the database enforces.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { createGlossaryStore } from "@/lib/copilot/glossaryStore";
import { runGlossaryWorker } from "@/lib/copilot/glossaryWorker";

export const runtime = "nodejs";
// 300s -- the value both live cron routes use, and the number the worker's
// deadline arithmetic is derived from.
//
// A LITERAL, NOT THE IMPORTED CONSTANT, AND THAT IS FORCED. Next evaluates route
// segment config exports STATICALLY at build time; an imported identifier here
// fails the build with "Invalid segment configuration export detected". So the
// number is written twice by necessity, and this route's suite asserts the two
// copies agree rather than leaving the duplication unguarded.
export const maxDuration = 300;

/**
 * Returns true if the request is authorized for cron access.
 * Mirrors /api/cron/tailor:
 *   - `Authorization: Bearer ${CRON_SECRET}` (manual / Vercel cron with secret)
 *   - Vercel cron auto-header `x-vercel-cron: 1` when CRON_SECRET is unset
 *
 * CHARACTER-IDENTICAL to app/api/cron/feed-ingest/route.js:13-20 and
 * app/api/cron/tailor/route.js:44-51, and a test asserts that byte for byte.
 * There is no shared cron-auth helper in this repo: those two are themselves
 * byte-identical private copies, and feed-ingest's own comment says it mirrors
 * tailor. A third copy is what the established precedent actually is; the test
 * is what stops it drifting, which is the hazard lib/tracking/citationHref.js
 * names for allow-lists and the reason that module re-exports rather than
 * re-implements.
 */
function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") || "";
    return header === `Bearer ${secret}`;
  }
  return request.headers.get("x-vercel-cron") === "1";
}

export async function POST(request) {
  // THE KILL SWITCH IS THE FIRST STATEMENT, before the authorization gate and
  // before any client of any kind. An operator turning this off must STOP THE
  // SPEND, not merely hide the answer -- and a kill switch that needs a deploy
  // to a code file is not a kill switch.
  if (process.env.GLOSSARY_DISABLED === "1") {
    return Response.json({ status: "disabled" }, { status: 503 });
  }

  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return Response.json({ error: `admin client unavailable: ${err.message}` }, { status: 500 });
  }

  let client;
  let model;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    // No key configured: there is no offline equivalent of a grounded search, so
    // the worker has nothing honest to do. A 200 rather than a 5xx because
    // nothing is broken -- there is simply no work this deployment can perform.
    return Response.json({ status: "no-engine", postings: 0, batches: 0 });
  }

  try {
    const summary = await runGlossaryWorker({
      store: createGlossaryStore(admin),
      client,
      model,
    });
    if (summary.reason) {
      console.warn("position-glossary worker stopped early", { reason: summary.reason });
    }
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

// Vercel cron sends GETs in some configurations; accept both verbs.
export const GET = POST;
