// ---------------------------------------------------------------------------
// POST /api/copilot/answer/tech-terms -- the GENERATION half of the
// tech-buzzwords row: a short list of technical terms relevant to ONE question
// for ONE role, fired by the client after the answer has already landed. Each
// term is later opened on demand through the sibling detail route
// (app/api/copilot/answer/tech-term-detail), and the two never share a request,
// a cache or a failure.
//
// WHY A SEPARATE ROUTE and not another frame on the answer stream: the answer
// must finish and render without waiting on this call, and a done frame is
// terminal for the client (lib/copilot/answerClient.js stops reading at it). A
// second request also lets this one fail alone.
//
// THE ROW IS ADDITIVE AND NEVER POISONS ANYTHING. Every failure after the auth
// and input gates (a missing key, a rejected or timed-out model call, a list
// that came back empty) is a 200 carrying { status: "failed" }, never a 5xx the
// client could turn into a torn-down card. Nothing here is persisted or cached
// on the server: a re-asked question gets fresh terms, and there is no stale
// list to replay.
//
// THE CANDIDATE'S MATERIALS ARE NEVER READ. A term absent from the candidate's
// own record is exactly what this row exists to surface, so there is no
// materials filter anywhere on this path. The one read is the posting, scoped to
// the caller in the query itself, and it names only the posting's own columns.
// It selects no pay figures either: a term list carries no invented numbers, so
// there is nothing to guard against a posting's.
//
// THIS ROUTE IS DELIBERATELY UNMETERED (owner ruling, 2026-10-08), for the
// reason the Row-2 example route is: the spend is one non-streaming call per
// drafted question, fired by a signed-in user's own session after the answer has
// landed, and a cap on that could only ever refuse a real person mid-interview.
// Its repeatable per-click sibling (the detail route) IS bounded.
// lib/rateLimit/adoption.test.js records this route under DEFERRED with that
// reason, so it is a stated decision and not an oversight.
//
// The embedded engine is answered { techTerms: null } without a model call (a
// model-chosen vocabulary list has no honest offline equivalent; absence is the
// render).
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { generateTechTerms } from "@/lib/copilot/techTermsGen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One non-streaming call bounded inside generateTechTerms by
// TECH_TERMS_GEN_TIMEOUT_MS (20 s); 60 s covers the read around it with room.
export const maxDuration = 60;

// Same ceilings the answer route applies to the same two inputs. The question
// cap is a local copy on purpose: the shared constant lives in
// lib/copilot/questionVocabulary.js, which drags the tailoring library into this
// route's bundle for one number.
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

  // Scoped to the caller in the query itself. The posting's own text columns and
  // nothing else: no pay columns, and no table that holds the candidate's
  // documents.
  const { data: appRow, error: appErr } = await supabase
    .from("applications")
    .select("id, user_id, positions ( id, title, company, location, description )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (appErr) return Response.json({ error: appErr.message || "Could not load this application." }, { status: 500 });
  if (!appRow) return notFound("Application not found.");

  if (wantsEmbedded(body?.engine)) return Response.json({ techTerms: null });

  const posting = appRow.positions || {};
  // Nothing to anchor a domain on: the list would be generic vocabulary for any
  // role, so say failed without paying for it.
  if (!posting.title && !posting.description) return Response.json({ techTerms: FAILED });

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ techTerms: FAILED });
  }

  try {
    const terms = await generateTechTerms({ client, model, posting, question });
    // An empty list is a failed generation, not a ready row with nothing in it.
    if (!Array.isArray(terms) || terms.length === 0) return Response.json({ techTerms: FAILED });
    return Response.json({ techTerms: { status: "ready", terms, engine: "gemini" } });
  } catch (err) {
    // Logged without the question, the posting or the user: a vocabulary list is
    // a nicety, and its failure is a state the card renders, not an incident.
    console.warn("copilot tech-terms: generation failed", err?.message || err);
    return Response.json({ techTerms: FAILED });
  }
}
