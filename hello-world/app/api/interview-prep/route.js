// ---------------------------------------------------------------------------
// POST /api/interview-prep -- generate (or regenerate) a candidate's prep pack
// for one application: tell-me-about-yourself framing, why-this-position
// framing, questions to ask, and the company's interview stages with likely
// questions and recommended answers. O-11 dropped interviewer research
// entirely; O-15 permits a real person's name ONLY as the subject of a cited
// company fact, never as a prediction about who will be in the room --
// enforced at `lib/interviewPrep/prepParse.js`'s normalizePack, which every
// write and read of `pack` already passes through (design-structure.r1.md §9).
//
// DELETE /api/interview-prep -- O-16's per-application delete control. A real
// row DELETE (O-17), never a tombstone, and it must survive a PREP_DISABLED
// spend outage -- the candidate's own content stays theirs to remove even
// while generation is switched off.
// ---------------------------------------------------------------------------
// THE GATE ORDER ON POST IS LOAD-BEARING, numbered so a reviewer can walk it:
//
//   1 kill switch        -- before any client, so "off" stops the SPEND
//   2 identity            -- getAuth() -> auth.getUser(), never getSession()
//   3 body parse          -- 400
//   4 rate limit          -- keyed on the id step 2 resolved to
//   5 field validation    -- 400
//   6 tenant ownership    -- the application must be the caller's own -> 404
//   7 O-14's engine gate   -- server config always beats a request-supplied one
//   8 O-7's digest ensure  -- fire-and-forget, never blocks this attempt
//   9 claim                -- serializes concurrent attempts, enforces the caps
//  10 no postable content  -- writes 'unavailable', no model call
//  11 embedded path        -- deterministic, zero outbound
//  12 spend gate           -- recordModelCallIssued MUST gate the paid call
//  13 generation           -- the one non-grounded provider call this route makes
//
// WHY ONE ROUTE DOES NOT DO BOTH O-7's RESEARCH AND ITS OWN GENERATION: the
// arithmetic in rulings.md R-IP3-21 refuses it (a grounded search plus a
// generation exceeds the platform's own maxDuration), so the ensure is a
// separate, un-awaited POST to the already-migrated /api/application-digest
// route -- that route owns its own idempotency (an existing `ready` digest is
// returned as-is), so firing it unconditionally when no ready digest exists
// costs nothing extra on a cache hit.
// ---------------------------------------------------------------------------
// TRANSPORT: `client.models.generateContent(...)` via the shared
// `getGeminiClient()`, NEVER `client.interactions.create(...)` -- this call
// carries no `tools`/`googleSearch` (PI-4), so the citation problem
// Interactions was adopted for does not apply here. The timeout goes at
// `config.httpOptions.timeout`; a second bare `{ timeout }` argument is
// silently discarded on this transport (measured, see
// app/api/experience/knowledge/route.js's own header). PREP_GENERATION_MAX_ATTEMPTS
// = 1 is a structural property of `getGeminiClient()`'s construction (no retry
// option set anywhere near it) -- IP3 adds no retry configuration of its own,
// per-call or client-level, and a `{ maxRetries: 0 }` literal here would be a
// decorative no-op (silently discarded, same as the bare timeout).
// ---------------------------------------------------------------------------
// SCOPE, STATED HONESTLY. No binding IP3 document names a module or a table
// that resolves the résumé/cover-letter content, or their ids, for a given
// application -- résumé/cover-letter personalization of the generated pack,
// and `resume_id`/`cover_letter_id` on the stored row, are therefore left
// `null` by this wave rather than guessing a module name or a schema this
// checkout cannot confirm (guessing wrong would fail the whole route on an
// import mismatch instead of on the O-15/spend-gate behaviour this file
// exists to prove -- the same caution app/prepTriggerSeams.test.js's own
// header states for the trigger sites). The generation prompt is built from
// the position's own posting text and the application's company digest (if
// one is on file); a later wave that locates the résumé/cover-letter store
// can widen `buildPrepPrompt` and start passing `resumeId`/`coverLetterId`
// without any change to the write/read/claim/spend mechanics below.
//
// The `outcome` value written to `interview_prep_events` for an 'attempt'
// event is decided by `outcomeForStatus` in lib/interviewPrep/finishAttempt.js
// -- see that function's own header for the member-by-member reachability
// table, which is the authority.
//
// This comment previously claimed the vocabulary "needs only four members"
// and that "no binding document enumerates
// `interview_prep_events_outcome_check`'s exact members". BOTH WERE FALSE.
// The migration states the vocabulary outright -- seven members for an
// 'attempt' event, at supabase/migrations/20260914000000_interview_prep.sql
// :413-418 -- and it was confirmed byte-identical on the live project on
// 2026-09-14, along with every other constraint on these three tables (no
// drift in either direction). 'failed' is itself a permitted outcome, so
// the blanket 'failed' -> 'error' rewrite this comment used to describe was
// collapsing a distinction the schema deliberately keeps; it is gone
// (backlog N10).

import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { listDigests } from "@/lib/supabase/applicationDigests";
import { postingFingerprint } from "@/lib/copilot/glossaryStore";
import {
  claimPrepPack,
  deletePrepPackContent,
  recordModelCallIssued,
  recordPrepEvent,
} from "@/lib/interviewPrep/prepStore";
import { finishAttempt } from "@/lib/interviewPrep/finishAttempt";
import { PREP_RATE_LIMIT, PREP_RATE_WINDOW_MS, PREP_GENERATION_TIMEOUT_MS } from "@/lib/interviewPrep/prepConstants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Matches PREP_ROUTE_MAX_DURATION_S (prepConstants.js) -- a literal here,
// matching every sibling grounded/non-grounded route in this repo, since
// Next.js's own route-segment config is the thing reading this export.
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// THE SPEND CEILING for interview-prep generation.
//
// BUILT AT MODULE SCOPE -- a limiter constructed inside a handler gets a
// brand-new store on every request and permits everything while looking
// correct (lib/rateLimit/index.js's own header). 12 per 10 minutes matches
// the grounded-call cadence application-digest is already sized for
// (lib/rateLimit/adoption.test.js), even though this route's own generation
// call is not grounded -- the cadence a candidate legitimately needs (attempt,
// look at the result, maybe retry once) is the same either way.
// ---------------------------------------------------------------------------
const prepLimiter = createRateLimiter({
  limit: PREP_RATE_LIMIT,
  windowMs: PREP_RATE_WINDOW_MS,
  prefix: "interview-prep",
});

const DISABLED = { status: "disabled" };
const RATE_LIMITED_MESSAGE = "Too many prep attempts in a short window. Wait a moment and try again.";
const NO_KEY_REFUSAL = "Interview prep needs the Gemini API key to be configured.";

function idOf(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "";
}

function triggerClassOf(value) {
  return value === "B3" ? "B3" : "B1";
}

// listDigests' contract is "keyed by application_id" -- Object.values() walks
// either that keyed object or a plain array the same way, matching
// application-digest/route.js's own findDigest helper.
function findDigest(digests, applicationId) {
  return Object.values(digests || {}).find((d) => d && d.application_id === applicationId) || null;
}

// O-7's ensure. A SEPARATE fire-and-forget POST, never awaited: one route
// doing both this and its own generation exceeds maxDuration (R-IP3-21). The
// target route owns its own idempotency, so firing this unconditionally when
// no ready digest exists costs nothing extra on a cache hit. Three refusals,
// the same shape as lib/copilot/glossaryTrigger.js's void trigger: never
// awaitable, swallows every failure, refuses a blank id before spending
// anything.
function ensureCompanyDigest(request, applicationId) {
  const application = idOf(applicationId);
  if (!application) return;
  try {
    if (typeof fetch !== "function") return;
    const target = new URL("/api/application-digest", request.url);
    const started = fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Server-to-server: the caller's own session cookie is forwarded so
        // the target route's getUser() resolves the SAME candidate, never a
        // service-role bypass.
        cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify({ applicationId: application }),
      keepalive: true,
    });
    if (started && typeof started.catch === "function") started.catch(() => {});
  } catch {
    // Synchronous throw. Nothing downstream is waiting to be told, and this
    // attempt's own generation must proceed unaffected.
  }
}

// The deterministic, zero-outbound path (engine: "embedded"). No model call,
// so no spend gate applies -- matches app/api/copilot/glossary/route.js's own
// GATE 14 posture: zero outbound, zero client.
function buildEmbeddedPack({ position, digest }) {
  const title = String(position?.title || "").trim() || "this position";
  const company = String(position?.company || "").trim() || "the company";
  const hasDigest = digest?.status === "ready" && typeof digest.markdown === "string" && digest.markdown.trim();
  const digestNote = hasDigest
    ? "Company research is already on file in the tracking table's digest -- read it for specifics before your interview."
    : "No company research is on file yet for this posting.";

  return {
    tellMeAboutYourself: `Lead with the experience most relevant to the ${title} role at ${company}.`,
    whyThisPosition: `Explain what draws you to the ${title} role at ${company} specifically, not to the field in general.`,
    questionsToAsk: [
      `What does success look like in the first 90 days as ${title}?`,
      "How is this team's work measured?",
    ],
    sections: {
      stages: [
        {
          name: "Overview",
          questions: ["Tell me about yourself.", `Why ${company}?`],
          recommendedAnswer: digestNote,
          support: null,
        },
      ],
    },
    claims: {},
  };
}

// The prompt for IP3's own (non-grounded) generation call. No tools, no
// googleSearch (PI-4) -- a live person search during generation is exactly
// what O-11/O-15 forbid, and the model-level instruction below is the
// prompt-level primary defense 1g's threat model relies on; the structural
// backstop for when a model ignores it is normalizePack (prepParse.js), which
// every write of `pack` already passes through.
function buildPrepPrompt({ position, digest }) {
  const title = String(position?.title || "").trim() || "this position";
  const company = String(position?.company || "").trim() || "this company";
  const description = String(position?.description || "").trim() || "(no description provided)";
  const hasDigest = digest?.status === "ready" && typeof digest.markdown === "string" && digest.markdown.trim();
  const digestBlock = hasDigest ? `Company research already on file:\n${digest.markdown.trim()}` : "No company research is on file yet.";

  return [
    `You are preparing a candidate for an interview for the ${title} role at ${company}.`,
    "Respond with ONLY a JSON object (no prose, no markdown fences) shaped exactly like:",
    '{"tellMeAboutYourself": string, "whyThisPosition": string, "questionsToAsk": string[], "sections": {"stages": [{"name": string, "questions": string[], "recommendedAnswer": string}]}}',
    "Never name, describe, or predict which specific person will conduct or attend any interview, however confident you are -- that is forbidden.",
    "Base every claim about the company on the research below; never invent a fact you cannot support.",
    `Posting:\n${description}`,
    digestBlock,
  ].join("\n\n");
}

function parsePrepResponse(response) {
  const raw = response?.text;
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "The model returned no text." };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The model's reply was not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "The model's reply was not a pack object." };
  return { ok: true, pack: parsed };
}

// finishAttempt (the one place an attempt's terminal write AND its durable
// event row happen together, including design-structure.r1.md §8.4's
// CHECK-safe fallback retry) lives in lib/interviewPrep/finishAttempt.js,
// not here -- extracted so it can be given real runtime test coverage
// without a mocked Next.js route (see that file's own header, and this
// file's own header on why route.test.js is a source-text-only instrument).

function writeFailureResponse(write) {
  if (write.reason === "stale-token") return Response.json({ status: "stale" });
  return Response.json({ error: write.error || "Could not save this attempt." }, { status: 500 });
}

// The spend gate's own refusal, factored out so the guard above it is a
// single `return` -- OP-9's requirement is that the guard's OWN condition
// tests `.recorded` and is immediately followed by the early exit, not merely
// co-occurs with one.
async function refuseRecordingFailure(supabase, ctx) {
  await finishAttempt(supabase, { ...ctx, status: "failed", reason: "spend-record-failed" });
  return Response.json({ error: "Could not record this attempt. Try again." }, { status: 500 });
}

export async function POST(request) {
  // GATE 1. Before any client, so "off" stops the SPEND, not merely the answer.
  if (process.env.PREP_DISABLED === "1") return Response.json(DISABLED, { status: 503 });

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
  // endpoint with junk should exhaust its own allowance rather than get an
  // unmetered lane.
  const decision = await prepLimiter.check(identify(request, { userId }));
  if (!decision.allowed) {
    return Response.json({ error: RATE_LIMITED_MESSAGE }, { status: 429, headers: rateLimitHeaders(decision) });
  }

  // GATE 5.
  const applicationId = idOf(body?.applicationId);
  if (!applicationId) return badRequest("Missing applicationId.");
  const triggerClass = triggerClassOf(body?.triggerClass);

  // GATE 6. Scoped to the caller IN THE QUERY, not just checked after the
  // fact -- RLS would return nothing for someone else's row; a query that
  // only filtered by id would have to reproduce that check by hand.
  const { data: appRow, error: appErr } = await supabase
    .from("applications")
    .select("id, user_id, positions ( id, title, company, description )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (appErr) return Response.json({ error: appErr.message || "Could not load this application." }, { status: 500 });
  if (!appRow) return notFound("Application not found.");

  // GATE 7. O-14: the server's own configuration must ALWAYS beat a
  // request-supplied engine. The server-forced term is computed first, ORed
  // in, and never the request-scoped call alone (SEC-1 owns the shared
  // resolver's own repo-wide fix; this is IP3's defence in depth).
  const serverForcesEmbedded = wantsEmbedded(undefined, process.env);
  const useEmbedded = serverForcesEmbedded || wantsEmbedded(body?.engine, process.env);
  const engine = useEmbedded ? "embedded" : "gemini";

  // GATE 8. See ensureCompanyDigest's own header for why this is unawaited.
  const { digests: existingDigests } = await listDigests(supabase, userId, [applicationId]);
  const digest = findDigest(existingDigests, applicationId);
  if (!digest || digest.status !== "ready") {
    ensureCompanyDigest(request, applicationId);
  }

  // GATE 9. Serializes concurrent attempts on this row and enforces both
  // spend caps -- see lib/interviewPrep/prepStore.js's claimPrepPack.
  const claim = await claimPrepPack(supabase, { applicationId, userId });
  if (!claim.claimed) {
    return Response.json({ status: "refused", reason: claim.reason }, { status: 409 });
  }

  const position = appRow.positions || {};
  const fingerprint = postingFingerprint(position);
  const digestResearchedAt =
    digest?.status === "ready" && typeof digest.researched_at === "string" ? digest.researched_at : null;
  const description = String(position.description || "").trim();
  const attemptCtx = { applicationId, userId, leaseToken: claim.leaseToken, triggerClass, engine };

  // GATE 10. Nothing to research: a deliberate, terminal row with NO model call.
  if (!description) {
    const { write, status } = await finishAttempt(supabase, {
      ...attemptCtx,
      status: "unavailable",
      reason: "refused-posting",
      postingFingerprint: fingerprint,
      digestResearchedAt,
    });
    if (!write.written) return writeFailureResponse(write);
    return Response.json({ status });
  }

  // GATE 11. The embedded path.
  if (useEmbedded) {
    const pack = buildEmbeddedPack({ position, digest });
    const { write, status } = await finishAttempt(supabase, {
      ...attemptCtx,
      status: "ready",
      pack,
      postingFingerprint: fingerprint,
      digestResearchedAt,
      researchedAt: new Date().toISOString(),
    });
    if (!write.written) return writeFailureResponse(write);
    return Response.json({ status });
  }

  let client;
  let model;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ error: NO_KEY_REFUSAL }, { status: 503 });
  }

  // GATE 12. THE SPEND GATE. Awaited, and its result checked, BEFORE the
  // provider call it precedes is issued: recordModelCallIssued(...) records
  // the spend before the money is spent, and `recorded: false` aborts the
  // call outright -- a counter that can silently fall behind the calls
  // actually issued is not a bound on those calls (design-operate.r1.md §6).
  const recordResult = await recordModelCallIssued(supabase, { applicationId, userId });
  if (!recordResult.recorded) {
    return await refuseRecordingFailure(supabase, {
      ...attemptCtx,
      postingFingerprint: fingerprint,
      digestResearchedAt,
      error: recordResult.error,
    });
  }

  // GATE 13. THE GENERATION CALL. See this file's header for the transport
  // and timeout-position discipline.
  let response;
  let generationError = null;
  try {
    response = await client.models.generateContent({
      model,
      contents: buildPrepPrompt({ position, digest }),
      config: {
        responseMimeType: "application/json",
        httpOptions: { timeout: PREP_GENERATION_TIMEOUT_MS },
      },
    });
  } catch (err) {
    generationError = err;
  }

  if (generationError) {
    const timedOut =
      generationError?.name === "AbortError" || /timeout/i.test(String(generationError?.message || ""));
    const { write, status } = await finishAttempt(supabase, {
      ...attemptCtx,
      status: "failed",
      reason: timedOut ? "provider-timeout" : "provider-error",
      error: generationError?.message || "The model call did not complete.",
      postingFingerprint: fingerprint,
      digestResearchedAt,
    });
    if (!write.written) return writeFailureResponse(write);
    return Response.json({ status });
  }

  const parsed = parsePrepResponse(response);
  if (!parsed.ok) {
    const { write, status } = await finishAttempt(supabase, {
      ...attemptCtx,
      status: "failed",
      reason: "provider-error",
      error: parsed.error,
      postingFingerprint: fingerprint,
      digestResearchedAt,
    });
    if (!write.written) return writeFailureResponse(write);
    return Response.json({ status });
  }

  const { write, status } = await finishAttempt(supabase, {
    ...attemptCtx,
    status: "ready",
    pack: parsed.pack,
    postingFingerprint: fingerprint,
    digestResearchedAt,
    researchedAt: new Date().toISOString(),
  });
  if (!write.written) return writeFailureResponse(write);
  return Response.json({ status });
}

// NEVER kill-switch-gated (O-16) -- the clear/delete control must survive a
// PREP_DISABLED spend outage. applicationId travels as a body field or a
// query parameter, never a path segment (unchanged from every contract round).
export async function DELETE(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const url = new URL(request.url);
  const applicationId = idOf(body?.applicationId) || idOf(url.searchParams.get("applicationId"));
  if (!applicationId) return badRequest("Missing applicationId.");

  const result = await deletePrepPackContent(supabase, { applicationId, userId });
  if (result.error) return Response.json({ error: result.error }, { status: 500 });

  await recordPrepEvent(supabase, {
    applicationId,
    userId,
    eventType: "delete",
    outcome: result.reason,
  });

  if (!result.deleted && result.reason === "in-flight") {
    return Response.json({ status: "in-flight" }, { status: 409 });
  }
  return Response.json({ status: result.deleted ? "deleted" : "not-found" });
}
