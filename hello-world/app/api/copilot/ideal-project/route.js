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

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user } = {},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return Response.json({ error: "Sign in to use the interview copilot." }, { status: 401 });
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
