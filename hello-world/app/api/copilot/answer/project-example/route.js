// ---------------------------------------------------------------------------
// POST /api/copilot/answer/project-example -- Row 2 of the example-projects
// group: ONE invented project written for ONE question, fired by the client
// after the answer has already landed. Row 1 (the pre-warmed pool's best match)
// rides the answer route's own done-frame; this is the live counterpart, and
// the two never share a request, a cache or a failure.
//
// WHY A SEPARATE ROUTE and not another frame on the answer stream: the answer
// must finish and render without waiting on this call, and a done frame is
// terminal for the client (lib/copilot/answerClient.js stops reading at it). A
// second request also lets this one fail alone.
//
// ROW 2 IS ADDITIVE AND NEVER POISONS ANYTHING. Every failure after the auth
// and input gates (a missing key, a rejected or timed-out model call, a
// generation the number guard stripped away) is a 200 carrying
// { status: "failed" }, never a 5xx the client could turn into a torn-down card.
// Nothing here is persisted or cached on the server: a re-asked question gets a
// fresh project, and there is no stale one to replay.
//
// THIS ROUTE IS DELIBERATELY UNMETERED (owner ruling, 2026-10-08). It carried a
// per-user limiter until then; the owner removed it because the cap could only
// ever refuse a real person mid-interview, and the spend it bounded is one
// non-streaming call per drafted question, fired by a signed-in user's own
// session. The anti-stampede protection sits where the unattended fan-out is:
// the pool PREWARM route (app/api/application-project-pool) keeps its limiter
// and its cost gate. lib/rateLimit/adoption.test.js records this route under
// DEFERRED with that reason, so it is a stated decision and not an oversight.
//
// The embedded engine is answered { projectExample: null } without a model call
// (an invented project has no honest offline equivalent; absence is the render).
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { generateOnTheSpotProject } from "@/lib/copilot/projectExampleGen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One non-streaming call bounded inside generateOnTheSpotProject by
// ON_THE_SPOT_TIMEOUT_MS (30 s); 60 s covers the two reads around it with room.
export const maxDuration = 60;

// Same ceilings the answer route applies to the same two inputs. The question
// cap is a local copy on purpose: the shared constant lives in
// lib/copilot/questionVocabulary.js, which drags the tailoring library into
// this route's bundle for one number.
const MAX_APPLICATION_ID_CHARS = 100;
const MAX_QUESTION_CHARS = 2000;

const FAILED = { status: "failed" };

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();
  const userId = user.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const applicationId =
    typeof body?.applicationId === "string" ? body.applicationId.trim().slice(0, MAX_APPLICATION_ID_CHARS) : "";
  if (!applicationId) return badRequest("Missing applicationId.");
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
  if (!question) return badRequest("Missing question.");

  // Scoped to the caller in the query itself. salary_min / salary_max ride along
  // so the number guard sees a posting's structured salary band.
  const { data: appRow, error: appErr } = await supabase
    .from("applications")
    .select("id, user_id, positions ( id, title, company, location, description, salary_min, salary_max )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (appErr) return Response.json({ error: appErr.message || "Could not load this application." }, { status: 500 });
  if (!appRow) return notFound("Application not found.");

  if (wantsEmbedded(body?.engine)) return Response.json({ projectExample: null });

  const posting = appRow.positions || {};
  // Nothing to anchor a domain on: the model would write the generic skeleton
  // this feature exists to avoid, so say failed without paying for it.
  if (!posting.title && !posting.description) return Response.json({ projectExample: FAILED });

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ projectExample: FAILED });
  }

  try {
    const entry = await generateOnTheSpotProject({ client, model, posting, question });
    return Response.json({ projectExample: { status: "ready", ...entry, hypothetical: true, engine: "gemini" } });
  } catch (err) {
    // Logged without the question, the posting or the user: an invented example
    // is a nicety, and its failure is a state the card renders, not an incident.
    console.warn("copilot project-example: on-the-spot generation failed", err?.message || err);
    return Response.json({ projectExample: FAILED });
  }
}
