import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { parseModelJson } from "@/lib/llm/extractEmployment";
// The shared bound. See the ordering note on `expandLimiter` below for the one
// way to adopt this module catastrophically wrong.
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { answerContextKey, loadAnswerContext } from "@/lib/copilot/answerContext";
import { answerRequestFields, MAX_APPLICATION_ID_CHARS } from "@/lib/copilot/answerRequestPrologue";
import { selectBestStory } from "@/lib/copilot/projectStories";
import { stripStarLabel } from "@/lib/copilot/answerPoints";
import {
  MAX_PARENT_POINT_CHARS,
  expansionCaption,
  normalizeSubBullets,
} from "@/lib/copilot/expansionContract";
import { draftExpansionLocal } from "@/lib/copilot/answerExpansionLocal";
import { filterExpansionCandidates } from "@/lib/copilot/expansionHonesty";
import { EXPANSION_SYSTEM, buildExpansionUserTurn } from "@/lib/copilot/expansionPrompt";

export const runtime = "nodejs";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// THE SPEND CEILING.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. This route's suite pins BOTH halves, a
// behavioural case that fires past the bound and a static case that this
// declaration precedes `POST`.
//
// 40 expansions per 10 minutes, per authenticated user. An answer carries at
// most six bullets, so this is a handful of fully-expanded answers inside one
// warm-context window (which is answerContextCache's own 10-minute TTL, so a
// user's allowance and the window they spend it inside expire together). A
// DENIED REQUEST STILL INCREMENTS: the bound is 40 ATTEMPTS, not 40 successes.
//
// HONEST ABOUT WHAT THIS BUYS: the memory store is per-instance, so on
// serverless this bounds a caller to 40 x instanceCount, not 40. It is worth
// having anyway, because it turns an unbounded loop against a model-calling
// endpoint into a bounded one, but it is not a fleet-wide guarantee and must
// not be described as one. Swapping in a Redis-backed store satisfying the
// same two-method interface needs no change here.
// ---------------------------------------------------------------------------
const expandLimiter = createRateLimiter({ limit: 40, windowMs: 600_000, prefix: "copilot-expand" });

// Mirrors the answer route's own ceiling on how many points an answer has. It
// is private there, so this is a second copy; it is here rather than inlined
// so the copy is at least named, and the route's suite pins the behaviour.
const MAX_ANSWER_POINTS = 6;

// How much of the cited page may enter the prompt. The answer route assembles
// roughly 42KB of material per question; six expansions of one answer at that
// size would be up to 7 x 42KB per question, on the one surface whose latency
// is measured against a live interviewer.
const MAX_SOURCE_CHARS = 4000;

// Deliberately asymmetric with the client's own 6000ms budget, so that when
// both fire it is the SERVER's diagnosis that wins the race and the reader is
// told what actually happened.
const MODEL_TIMEOUT_MS = 4000;

const DISABLED_MESSAGE =
  "More detail is switched off on this server right now. Nothing was sent and nothing was charged.";
const RATE_LIMITED_MESSAGE =
  "You have opened a lot of bullets in a short window. Wait a moment and try again.";
const TIMEOUT_MESSAGE = "That took too long to look up.";
const FAILED_MESSAGE = "Could not get more detail for this point.";
const INVALID_MESSAGE = "That request did not describe a bullet of the current answer.";

function fail(message, status, code) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export async function POST(request) {
  try {
    // ORDER IS LOAD-BEARING BELOW, and each step states what it must precede.

    // 1. THE KILL SWITCH, before a Supabase client and before any model client.
    //    An operator turning this off must stop the spend, not merely hide the
    //    result. `wantsEmbedded` is NOT this switch and must never be used as
    //    one: lib/llm/featureEngine.js returns on the client's own
    //    `body.engine` BEFORE it reads env.RESUME_ENGINE, so a client sending
    //    engine "gemini" gets a model call whatever the server default says.
    if (process.env.COPILOT_EXPANSION_DISABLED === "1") {
      return fail(DISABLED_MESSAGE, 503, "disabled");
    }

    // 2. IDENTITY, from `auth.getUser()`. Never `getSession()`: that call makes
    //    ZERO network requests, so gating on it is not a weak check, it is a
    //    total bypass. Everything downstream is scoped by the id this resolves
    //    to and never by a body field.
    const supabase = await createSupabaseServerClient();
    const {
      data: { user } = {},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return fail("Sign in to use the interview copilot.", 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return fail("Invalid request body.", 400);
    }

    // 3. THE BOUND, keyed on the id step 2 resolved to. Checked ahead of
    //    validation on purpose: an invalid request is still a request, and a
    //    caller hammering this endpoint with junk should exhaust its own
    //    allowance rather than get an unmetered lane.
    const decision = await expandLimiter.check(identify(request, { userId: user.id }));
    if (!decision.allowed) {
      return Response.json(
        { error: RATE_LIMITED_MESSAGE },
        { status: 429, headers: rateLimitHeaders(decision) },
      );
    }

    // 4. VALIDATION, before a single Supabase data read and before any model
    //    client. Every field REFUSES rather than coerces: `.toString()` on an
    //    object yields "[object Object]", which validates, caches and prompts
    //    perfectly happily.
    const fields = answerRequestFields(body);
    if (!fields.question) return fail("No question provided.", 400);
    if (typeof body?.question === "string" && body.question.trim().length > fields.question.length) {
      return fail("That question is too long.", 400);
    }
    if (typeof body?.applicationId !== "string" || !fields.applicationId) {
      // NOT merely a cache miss. Without it the context key becomes
      // `${userId}::`, a DIFFERENT and also-cacheable entry carrying an empty
      // resume, cover letter and posting, so the detail would be drafted with
      // no resume at all and nothing on screen would say so.
      return fail("Pick the application this answer belongs to first.", 400);
    }
    if (body.applicationId.trim().length > MAX_APPLICATION_ID_CHARS) {
      return fail(INVALID_MESSAGE, 400);
    }

    const rawParent = typeof body?.parentPoint === "string" ? body.parentPoint.trim() : null;
    if (!rawParent) return fail(INVALID_MESSAGE, 400);
    if (rawParent.length > MAX_PARENT_POINT_CHARS) {
      return fail("That bullet is too long to expand.", 400);
    }

    const points = body?.points;
    if (!isStringArray(points) || points.length === 0 || points.length > MAX_ANSWER_POINTS) {
      return fail(INVALID_MESSAGE, 400);
    }

    const pointIndex = body?.pointIndex;
    if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= points.length) {
      return fail(INVALID_MESSAGE, 400);
    }

    // THE INDEX SELF-CHECK, and the reason it strips the label.
    //
    // `points` is the RAW drafted array, STAR labels included; `parentPoint` is
    // the rendered line's own text, which answerLines has ALREADY stripped. A
    // raw comparison therefore fails for every labelled point, which is most
    // points on the behavioural path, so every real expansion 400s while a
    // fixture of unlabelled points passes. The strip uses the same exported
    // function answerLines itself calls, never a second copy of the regex
    // (questionVocabulary.js declares a different, module-private one, so an
    // implementer who greps rather than imports finds two).
    //
    // What the check buys: whichever array the client indexed, the server
    // confirms that index really names that sentence. Without it a client
    // sending the RENDERED line index elaborates the wrong bullet, silently,
    // with the right count and the right citation shape.
    if (stripStarLabel(points[pointIndex]) !== rawParent) {
      return fail(INVALID_MESSAGE, 400);
    }

    const embedded = wantsEmbedded(body?.engine);

    // 5. THE FAN-OUT, through the answer route's own cached loader with the
    //    SAME cache key, so a live interview's warm cache serves this too: a
    //    hit skips every Supabase round trip. Never a second createTtlCache --
    //    a second instance is always cold, so every expansion would miss
    //    forever, and the route suites that clear the shared one would stop
    //    isolating it.
    const context = await loadAnswerContext(supabase, {
      userId: user.id,
      applicationId: fields.applicationId,
      cacheKey: answerContextKey(user.id, fields.applicationId),
    });

    if (embedded) {
      // 6a. THE DETERMINISTIC PATH. No getServerEnv, no getGeminiClient, no
      //     network call of any kind. This is a first-class engine, not a
      //     degraded one: every sentence it returns is a line the candidate
      //     wrote on one of their own pages, quoted whole.
      const local = draftExpansionLocal({
        question: fields.question,
        parentPoint: rawParent,
        points,
        pages: context.pages,
      });
      return respond(local.subBullets, local.sources, true, storyPages(context.pages, fields.question));
    }

    // 6b. THE GEMINI PATH. One call, one source.
    const story = selectBestStory(context.pages, { question: fields.question, points: [] });
    if (!story || story.matched !== true || !Array.isArray(story.bullets) || story.bullets.length === 0) {
      return respond([], [], false, []);
    }

    const sourceLines = story.bullets;
    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    let response;
    try {
      response = await client.models.generateContent({
        model: geminiModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildExpansionUserTurn({
                  parentPoint: rawParent,
                  siblingPoints: points.map((p) => stripStarLabel(p)),
                  source: {
                    label: `Your ${story.title} page`,
                    text: sourceLines.join("\n").slice(0, MAX_SOURCE_CHARS),
                  },
                }),
              },
            ],
          },
        ],
        config: {
          systemInstruction: EXPANSION_SYSTEM,
          // The single highest-likelihood way this feature ships slow. The
          // answer route sets it on its own latency-critical call and nothing
          // else in the app does.
          thinkingConfig: { thinkingBudget: 0 },
          // Deliberately shorter than the client's own budget, so the server's
          // diagnosis wins the race and the reader is told what happened.
          abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        },
      });
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        return fail(TIMEOUT_MESSAGE, 504, "expansion_timeout");
      }
      // NO SILENT DEGRADATION TO THE LOCAL DRAFTER. The route template this
      // otherwise follows does exactly that and reports it only as a source
      // label, which makes the caption above the sub-bullets LIE about which
      // engine produced them. A visible error the reader can retry is the
      // honest outcome.
      console.error("[copilot/expand] model call failed:", err);
      return fail(FAILED_MESSAGE, 502, "http");
    }

    const parsed = parseModelJson(typeof response?.text === "string" ? response.text : "");
    const offered = Array.isArray(parsed?.subBullets) ? parsed.subBullets : [];
    const kept = filterExpansionCandidates(offered, {
      parentPoint: rawParent,
      unit: { kind: "page", pageId: story.pageId, pageTitle: story.title, lines: sourceLines },
    });

    return respond(
      kept,
      kept.length ? [{ kind: "page", pageId: story.pageId, pageTitle: story.title }] : [],
      false,
      [{ id: story.pageId, title: story.title }],
    );

    function respond(entries, sources, isEmbedded, includedPages) {
      const subBullets = normalizeSubBullets(entries, { parentPoint: rawParent, includedPages });
      return Response.json({
        subBullets,
        caption: subBullets.length ? expansionCaption({ isEmbedded, sources }) : "",
        // AN EMPTY RESULT IS A 200, not a 5xx. Four sites in the answer route
        // return `502 { error: "Could not generate an answer." }` on an empty
        // points array, and on two of them -- the embedded branches -- nothing
        // had failed. Copying that would paint an error alert over a truthful
        // "there is nothing more here", which the reader cannot tell apart
        // from a broken feature.
        empty: subBullets.length === 0,
      });
    }
  } catch (err) {
    // A FIXED STRING. The answer route returns `err?.message ||` here and the
    // route template's own outer catch does the same; a provider's message can
    // carry request ids, model names and quoted prompt fragments, none of
    // which belongs in a browser.
    console.error("[copilot/expand] request failed:", err);
    return fail(FAILED_MESSAGE, 500);
  }
}

// The page whitelist this request is allowed to cite: the one page the
// deterministic drafter is permitted to have mined. Derived server-side from
// the same call the drafter makes, never echoed from the client.
function storyPages(pages, question) {
  const story = selectBestStory(pages, { question, points: [] });
  if (!story || story.matched !== true || !story.pageId) return [];
  return [{ id: story.pageId, title: story.title }];
}
