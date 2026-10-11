// ---------------------------------------------------------------------------
// POST /api/study-plan -- build (or rebuild) and persist the study plan for one
// tracked application. See lib/studyPlan/studyPlanGenerate.js for the flow and
// the status table, and lib/studyPlan/studyPlanPrompt.js for the fence.
//
// THIS ROUTE IS PHASE 2 ONLY. Creating a plan is a two-request client
// orchestration: first make sure the company research exists (the existing
// /api/application-digest route, which is where the grounded search lives),
// then call this route. This route READS the already-persisted digest through
// the evidence seam and issues no grounded call of its own. It never POSTs
// /api/application-digest either: a grounded search plus a generation in one
// request exceeds the platform's maxDuration (rulings R-IP3-21), which is the
// same reason interview-prep keeps its research ensure out of its own handler.
//
// THE GATE ORDER IS LOAD-BEARING, numbered so a reviewer can walk it:
//
//   1 kill switch        -- before any client, so "off" stops the SPEND
//   2 identity           -- getAuth() -> auth.getUser(), never getSession()
//   3 body parse         -- 400
//   4 rate limit         -- keyed on the id step 2 resolved to
//   5 field validation   -- 400; no default id, a blank one is refused
//   6 tenant ownership   -- scoped in the QUERY; not the caller's own -> 404
//   7 engine gate        -- server config always beats a request-supplied engine
//   8 generate + persist -- the one non-grounded call this route makes
//
// SPEND, STATED HONESTLY. N157 migrated no spend ledger, so unlike
// interview-prep there is no recordModelCallIssued gate. The module-scope rate
// limiter below is the only bound, and on serverless it bounds a caller to
// `limit x instanceCount`, not `limit` (lib/rateLimit/adoption.test.js).
// ---------------------------------------------------------------------------

import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { listDigests } from "@/lib/supabase/applicationDigests";
import { postingFingerprint } from "@/lib/copilot/glossaryStore";
import { generateStudyPlan } from "@/lib/studyPlan/studyPlanGenerate";
import { readStudyPlan } from "@/lib/studyPlan/studyPlanStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Matches every sibling generation route. The call is non-grounded and made
// once, so there is no retry fan-out to budget for.
export const maxDuration = 120;

// BUILT AT MODULE SCOPE -- a limiter constructed inside a handler gets a
// brand-new store on every request and permits everything while looking
// correct (lib/rateLimit/index.js's own header). 12 per 10 minutes matches the
// cadence interview-prep is sized for: build, look at the result, maybe retry.
const studyPlanLimiter = createRateLimiter({
  limit: 12,
  windowMs: 600_000,
  prefix: "study-plan",
});

const DISABLED = { status: "disabled" };
const RATE_LIMITED_MESSAGE = "Too many study plan requests in a short window. Wait a moment and try again.";
const NO_KEY_REFUSAL = "Study plans need the Gemini API key to be configured.";
const UNAVAILABLE_MESSAGE = "The study plan could not be built.";

function idOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

// listDigests' contract is "keyed by application_id" -- Object.values() walks
// either that keyed object or a plain array the same way, matching
// app/api/interview-prep/route.js's own findDigest helper.
function findDigest(digests, applicationId) {
  return Object.values(digests || {}).find((d) => d && d.application_id === applicationId) || null;
}

export async function POST(request) {
  // GATE 1. Before any client, so "off" stops the SPEND, not merely the answer.
  if (process.env.STUDY_PLAN_DISABLED === "1") return Response.json(DISABLED, { status: 503 });

  // GATE 2. getUser(), never getSession() -- the cookie-only accessor makes
  // ZERO network requests, so gating on it is a total bypass, not a weak check.
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  // GATE 3.
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  // GATE 4. Keyed on the id gate 2 resolved to, ahead of field validation --
  // an invalid request is still a request, and a caller hammering this
  // endpoint with junk should exhaust its own allowance.
  const decision = await studyPlanLimiter.check(identify(request, { userId }));
  if (!decision.allowed) {
    return Response.json({ error: RATE_LIMITED_MESSAGE }, { status: 429, headers: rateLimitHeaders(decision) });
  }

  // GATE 5. No default: a blank id is refused, never carried forward as "".
  const applicationId = idOf(body?.applicationId);
  if (!applicationId) return badRequest("Missing applicationId.");

  // GATE 6. Scoped to the caller IN THE QUERY, not just checked after the fact
  // -- RLS would return nothing for someone else's row; a query that only
  // filtered by id would have to reproduce that check by hand.
  const { data: appRow, error: appErr } = await supabase
    .from("applications")
    .select("id, user_id, positions ( id, title, company, description )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (appErr) {
    console.error("study-plan: application read failed", { applicationId, error: appErr });
    return Response.json({ error: "Could not load this application." }, { status: 500 });
  }
  if (!appRow) return notFound("Application not found.");

  // GATE 7. The server's own configuration must ALWAYS beat a request-supplied
  // engine. The server-forced term is computed first and ORed in: an explicit
  // body engine of "gemini" is NOT honored by wantsEmbedded() when the
  // deployment has no Gemini key, so without the first term a key-less server
  // would take the unconfigured model path on a request's say-so.
  const serverForcesEmbedded = wantsEmbedded(undefined, process.env);
  const useEmbedded = serverForcesEmbedded || wantsEmbedded(body?.engine, process.env);
  const engine = useEmbedded ? "embedded" : "gemini";

  // GATE 8. Read the persisted digest through the evidence seam. A failed read
  // throws so gatherEvidence lands on its honest no-research refusal.
  const readDigest = async (digestApplicationId, digestUserId) => {
    const { digests, error } = await listDigests(supabase, digestUserId, [digestApplicationId]);
    if (error) throw new Error(error);
    return findDigest(digests, digestApplicationId);
  };

  let model = null;
  let generateContent = null;
  if (engine === "gemini") {
    try {
      model = getServerEnv().geminiModel;
      const client = getGeminiClient();
      generateContent = (params) => client.models.generateContent(params);
    } catch {
      return Response.json({ error: NO_KEY_REFUSAL }, { status: 503 });
    }
  }

  const position = appRow.positions || {};
  const result = await generateStudyPlan({
    supabase,
    readDigest,
    // The preserve-last-good guard's read seam (studyPlanGenerate.js). Passed
    // explicitly: an omitted seam is treated as unconfirmed and withholds the
    // write of an `unavailable` result, so a route that forgot it would never
    // persist a first failure.
    readExistingPlan: (args) => readStudyPlan(supabase, args),
    generateContent,
    model,
    engine,
    applicationId,
    userId,
    company: position.company,
    role: position.title,
    postingFingerprint: postingFingerprint(position),
    knobs: body?.knobs,
  });

  // A preserved result is a DELIBERATELY withheld write (a good or unconfirmed
  // stored plan was left alone), not a save failure, so it is checked BEFORE
  // `!written`: a 500 here would turn the protective outcome into a retry
  // signal. A not-preserved `written: false` is a genuine failure and keeps the
  // 500 + console.error below.
  if (result.preserved) {
    console.warn("study-plan: generation unavailable", {
      applicationId,
      engine,
      preservedReason: result.preservedReason,
      error: result.error,
    });
    return Response.json({
      status: "unavailable",
      partial: false,
      preserved: true,
      preservedReason: result.preservedReason,
      reason: result.evidence?.reason ?? null,
      error: UNAVAILABLE_MESSAGE,
    });
  }
  if (!result.written) {
    console.error("study-plan: persist failed", { applicationId, status: result.status, error: result.error });
    return Response.json({ error: "Could not save the study plan." }, { status: 500 });
  }
  if (result.status === "unavailable") {
    console.warn("study-plan: generation unavailable", { applicationId, engine, error: result.error });
  }

  // `partial` and `reason` are what the client branches on to flag an
  // unsourced or incomplete plan; `reason` is the evidence seam's own
  // vocabulary (null | "no-research" | "unsourced").
  const payload = {
    status: result.status,
    partial: result.status === "partial",
    reason: result.evidence?.reason ?? null,
  };
  if (result.status === "unavailable") payload.error = UNAVAILABLE_MESSAGE;
  return Response.json(payload);
}
