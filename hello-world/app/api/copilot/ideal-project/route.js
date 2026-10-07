import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { answerContextKey, loadAnswerContext } from "@/lib/copilot/answerContext";
import { enrichIdealProject } from "@/lib/copilot/answerAids";
import { settleWithin } from "@/lib/copilot/answerSessionCache";
import { idealProject as idealProjectFor } from "@/lib/copilot/idealProject";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import {
  idealPoolFor,
  idealProjectTailoredKey,
  resolveTailoredIdealProject,
} from "@/lib/copilot/idealProjectResolver";
import { MAX_QUESTION_CHARS } from "@/lib/copilot/questionVocabulary";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";

// N125: the worked example's single server home, in its two tiers. The answer
// route no longer generates a per-question example at all (a model call on the
// path that serves an answer is out); the client's useIdealProject hook asks
// THIS endpoint, once per tier, from the surface that renders the example.
//
//   POST { applicationId, question, engine, tailored? }
//
//   READY (`tailored` falsy)  A synchronous cache peek of the posting-only
//       POOL example, falling to idealProjectFor()'s deterministic archetype
//       on a miss — zero model calls on the serve. It also STARTS the pool
//       generation (the same start-then-peek the answer route does), so a
//       surface that renders before any answer request still warms the pool
//       for the next ask. Always present once a posting is selected.
//   TAILORED (`tailored: true`)  A live model call for THIS exact question,
//       bounded by TAILORED_DEADLINE_MS and degrading to `idealProject: null`
//       on a timeout, a failure or the embedded engine — never an error, never
//       an awaited dependency of READY. READY is already on screen by the time
//       the client asks, which is what makes seconds acceptable here.
//
// The READY tier also answers `tailoredAvailable`, the server's own
// !wantsEmbedded(engine): whether the client should go on to ask for TAILORED at
// all (see the response below for why the client cannot work that out).
//
// Both tiers answer `{ tier, source, idealProject }`, where `idealProject` is
// the SAME aid shape the answer route returns ({ shape, summary, metrics,
// project }) built by the SAME enrichIdealProject, and both examples already
// passed normalizeIdealProject (inside generateIdealProjectExample) — every
// guard, the compensation-shaped digit rule included, sits on this path.
//
// The embedded engine never reaches a model from here: the resolver's functions
// gate on it before the Gemini client is constructed, and idealPoolFor does not
// read the pool at all for it, so a pool a Gemini request warmed earlier in the
// session cannot leak a model example to an embedded one.

// Tunable in this ONE place. It is a backstop against a hung model call, NOT a
// latency budget, and it is generous on purpose. The client shows the cached
// READY example in milliseconds and aborts the TAILORED request on any
// question / posting / engine change (useIdealProject's AbortController), so a
// long wait here never strands anyone: the only thing the deadline protects
// against is a call that truly never returns. The first value, 6000, did the
// opposite of protecting — a live activity log showed every TAILORED request
// ending at ~6.2s (the cap plus request overhead), so the generation was
// abandoned and `idealProject: null` returned almost every time, and the
// candidate never saw the tailored example at all. It has to sit well above
// what a real per-question Gemini call takes; retune it against production
// latency, upward only if a real call is seen to need it.
const TAILORED_DEADLINE_MS = 20000;

// The deadline above only works if the platform lets the function live that
// long: with no segment config the host's default governs, which on some plans
// is 10s and would kill the request mid-wait (the client reads that as a failed
// request, the very outcome the longer deadline exists to avoid). 30s clears
// the 20s deadline plus the auth and context round trips ahead of it.
export const maxDuration = 30;

// The answer route's own cap on `applicationId` (a private constant there).
const MAX_APPLICATION_ID_CHARS = 100;

// ---------------------------------------------------------------------------
// THE SPEND CEILING for copilot-ideal-project (N126).
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it (lib/rateLimit/index.js's header). Both
// halves are pinned -- a behavioural case that fires 41 requests and expects
// the last to be denied (route.rateLimit.test.js), and the static case in
// lib/rateLimit/adoption.test.js that this declaration precedes the handler.
//
// 40 per 10 minutes, per authenticated user. The client (useIdealProject) asks
// TWICE per question it shows -- READY, a cache peek, then TAILORED, the one
// tier that is a model call -- and a question, posting or engine change aborts
// the in-flight pair and fires a fresh one; an aborted request has still
// arrived, so it still counts. 40 is twenty questions' worth of pairs in ten
// minutes, far past a person answering them and far below a scripted loop.
// Repeats of ONE question already cost no extra model call (the tailored cache
// and its shared in-flight call), so the bound's real target is a loop over
// DISTINCT questions. A DENIED REQUEST STILL INCREMENTS (see the module's
// header): the bound is 40 ATTEMPTS, not 40 successes.
//
// A denial reaches the client as a non-2xx, which fetchIdealProject resolves
// to `null` -- "no example", never an error mid-question.
//
// HONEST ABOUT WHAT THIS BUYS: createMemoryStore is per-instance, so on
// serverless this bounds a caller to 40 x instanceCount, not 40. It is worth
// having anyway -- it turns an unbounded loop against a model-calling endpoint
// into a bounded one -- but it is not a fleet-wide guarantee and must not be
// described as one. The number is the owner's to tune: change it here AND in
// the BOUNDED table in lib/rateLimit/adoption.test.js, which pins the pair.
// ---------------------------------------------------------------------------
const idealProjectLimiter = createRateLimiter({ limit: 40, windowMs: 600_000, prefix: "copilot-ideal-project" });

const idealProjectRateLimitedMessage =
  "You have asked for a lot of worked examples in a short window. Wait a moment and try again.";

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user } = {},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return Response.json({ error: "Sign in to use the interview copilot." }, { status: 401 });
    }

    // THE BOUND, keyed on the id the auth gate above resolved -- never on the
    // caller's access token, and never before the auth resolves. Checked ahead
    // of the body read and the posting load on purpose: a denied request spends
    // nothing, and an invalid one is still a request that counts.
    const rateLimit = await idealProjectLimiter.check(identify(request, { userId: user.id }));
    if (!rateLimit.allowed) {
      return Response.json(
        { error: idealProjectRateLimitedMessage },
        { status: 429, headers: rateLimitHeaders(rateLimit) },
      );
    }

    const body = await request.json();
    // Capped exactly as the answer route caps them, before anything reads them.
    const question = (body?.question ?? "").toString().trim().slice(0, MAX_QUESTION_CHARS);
    const applicationId = (body?.applicationId ?? "").toString().trim().slice(0, MAX_APPLICATION_ID_CHARS);
    const engine = body?.engine;
    const tailored = body?.tailored === true;

    // The posting through the SAME cache the answer route loads it from, so
    // after a session's first answer this costs no Supabase round trip.
    const { posting } = await loadAnswerContext(supabase, {
      userId: user.id,
      applicationId,
      cacheKey: answerContextKey(user.id, applicationId),
    });
    const deterministic = idealProjectFor(posting, { question });

    if (tailored) {
      // Nothing to tailor to without a question, and a blank one must not
      // reach the resolver, where it would share a single tailored key.
      const live = question
        ? await settleWithin(
            resolveTailoredIdealProject({
              engine,
              description: posting,
              question,
              cacheKey: idealProjectTailoredKey(user.id, applicationId, question),
            }),
            TAILORED_DEADLINE_MS,
            { fallback: null },
          )
        : null;
      return Response.json({
        tier: "tailored",
        source: live ? "model" : null,
        idealProject: live ? enrichIdealProject(deterministic, live) : null,
      });
    }

    // Peeked first, then primed: this serve is the cold-pool deterministic
    // example however fast the generation it starts settles (see idealPoolFor).
    const { generatedProject: model, prime } = idealPoolFor({
      userId: user.id,
      applicationId,
      engine,
      description: posting,
    });
    prime();
    return Response.json({
      tier: "ready",
      source: model ? "model" : "fallback",
      idealProject: enrichIdealProject(deterministic, model),
      // The server's own verdict on whether a TAILORED request can ever be
      // served, computed from the SAME gate resolveTailoredIdealProject applies
      // (wantsEmbedded: the user's pick, the server's RESUME_ENGINE, key
      // presence). The client cannot compute it, and gating on its own engine
      // string alone fires a TAILORED request that can only come back empty on a
      // server-forced embedded deployment — see useIdealProject.
      tailoredAvailable: !wantsEmbedded(engine),
    });
  } catch (err) {
    return Response.json({ error: err?.message || "Ideal project request failed." }, { status: 500 });
  }
}
