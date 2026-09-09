// ---------------------------------------------------------------------------
// POST /api/techwatch/lifecycle — grounded top-up for the technologies chunk
// A's deterministic briefing could not find a public lifecycle feed for.
//
// This is the only Tech Watch endpoint that calls a model, and it is a SECOND
// request the panel issues after the briefing has already rendered (a
// grounded search takes tens of seconds — GET /api/techwatch must never wait
// on this). Every gate below exists to avoid paying that cost, or to avoid
// ever showing an unproven claim: auth, then malformed body, then the
// embedded engine (no offline equivalent for "what does live search say right
// now"), then an empty technology list, then a missing key — only after all
// of those does a model get asked anything.
// ---------------------------------------------------------------------------

import { getAuth, unauthorized, badRequest } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { cached } from "@/lib/techwatch/cache";
import { extractGroundingSources } from "@/lib/llm/grounding";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import {
  buildLifecyclePrompt,
  parseLifecycleAnswer,
  LIFECYCLE_CACHE_TTL_SECONDS,
} from "@/lib/techwatch/lifecycleSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A grounded call per technology is the entire cost of this feature — cap the
// request rather than the prompt, so the caller learns what got dropped.
const MAX_TECHNOLOGIES_PER_REQUEST = 4;

function isUsableTechnology(t) {
  return !!t && typeof t.id === "string" && !!t.id && typeof t.label === "string" && !!t.label;
}

// ---------------------------------------------------------------------------
// THE SPEND CEILING for techwatch-lifecycle.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. lib/rateLimit/index.js's header states
// this as the one way to adopt it catastrophically wrong, and both halves are
// pinned -- a behavioural case that fires 11 requests and expects the last to
// be denied (a per-request limiter would pass all 11), and the static case in
// lib/rateLimit/adoption.test.js that this declaration precedes the handler.
//
// 10 per 10 minutes, per authenticated user. Up to
// MAX_TECHNOLOGIES_PER_REQUEST grounded lookups per request. The cache key
// here is GLOBAL, so a loop on one technology list is already nearly free --
// but a loop over VARYING lists misses every time, and that is the case this
// bounds.
// A DENIED REQUEST STILL INCREMENTS (see the module's header): the bound is
// 10 ATTEMPTS, not 10 successes.
//
// HONEST ABOUT WHAT THIS BUYS: createMemoryStore is per-instance, so on
// serverless this bounds a caller to 10 x instanceCount, not 10. It is worth
// having anyway -- the global cache only helps a caller that repeats itself,
// and an abusive one does not.
// It is not a fleet-wide guarantee and must not be described as one. Swapping
// in a Redis-backed store satisfying the same two-method interface needs no
// change here.
// ---------------------------------------------------------------------------
const lifecycleLimiter = createRateLimiter({ limit: 10, windowMs: 600_000, prefix: "techwatch-lifecycle" });

const lifecycleRateLimitedMessage =
  "Too many lifecycle lookups in a short window. Wait a moment and try again.";

export async function POST(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  // THE BOUND, keyed on the id the auth gate above resolved -- never on the
  // caller's access token, and never before the auth resolves. Checked ahead of
  // body validation on purpose: an invalid request is still a request, and a
  // caller hammering this endpoint with junk should exhaust its own allowance
  // rather than get an unmetered lane.
  const rateLimit = await lifecycleLimiter.check(identify(request, { userId }));
  if (!rateLimit.allowed) {
    return Response.json(
      { error: lifecycleRateLimitedMessage },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  // Same refusal shape as app/api/experience/research/route.js: the embedded
  // engine has no offline equivalent for a live-search-grounded answer, so
  // this is checked before the technology list is even read.
  if (wantsEmbedded(body?.engine)) {
    return Response.json(
      { error: "Lifecycle lookup needs the Gemini engine. Switch off the embedded engine and try again." },
      { status: 503 },
    );
  }

  const requested = Array.isArray(body?.technologies) ? body.technologies : [];
  const usable = requested.filter(isUsableTechnology);

  // Chunk A's briefing already renders without this route — asking a model
  // about an empty gap list is pure cost with nothing to show for it.
  if (usable.length === 0) {
    return Response.json({ rows: [], dropped: [], skipped: [], generatedAt: new Date().toISOString() });
  }

  const technologies = usable.slice(0, MAX_TECHNOLOGIES_PER_REQUEST);
  const skipped = usable.slice(MAX_TECHNOLOGIES_PER_REQUEST).map((t) => t.id);

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ error: "Lifecycle lookup needs the Gemini API key to be configured." }, { status: 503 });
  }

  // Global cache key, deliberately without a user id: TypeScript's support
  // status is the same fact for every user, so keying it per-user would
  // multiply the model spend by the user count for zero benefit.
  const cacheKey = `techwatch:lifecycle:${technologies.map((t) => t.id).sort().join(",")}`;

  const result = await cached(cacheKey, LIFECYCLE_CACHE_TTL_SECONDS, async () => {
    const prompt = buildLifecyclePrompt(technologies);

    let response;
    try {
      response = await client.models.generateContent({
        model,
        contents: prompt,
        // `tools` LIVES INSIDE `config`. DO NOT FLATTEN IT BACK OUT.
        // `GenerateContentParameters` has exactly THREE properties — `model`,
        // `contents`, `config` — and `tools` belongs to
        // `GenerateContentConfig`. The SDK's parameter transformer reads only
        // those three keys and DISCARDS everything else before building the
        // request body, with no warning, so a top-level `tools` never reaches
        // Google. The failure is total and silent: no search -> no
        // groundingMetadata -> parseLifecycleAnswer drops every row as
        // ungrounded, so the panel shows nothing and caches that emptiness
        // globally for the full TTL. Pinned by route.wire.test.js.
        config: { tools: [{ googleSearch: {} }] },
      });
    } catch (err) {
      console.error("Tech Watch lifecycle search failed:", err);
      // Deliberately not rethrown into a 5xx: this call is progressive
      // enhancement over a briefing that already rendered successfully. A
      // 500 here would surface in the panel as the whole feature breaking,
      // when the deterministic table beside it is untouched and correct.
      return { rows: [], dropped: [], error: err?.message || "Lifecycle lookup failed. Please try again." };
    }

    const rawText = String(response?.text || "");
    const grounded = extractGroundingSources(response);
    const { rows, dropped } = parseLifecycleAnswer(rawText, { technologies, grounded, now: new Date() });

    // Nothing parsed and nothing was even rejected — the model's reply
    // wasn't usable JSON at all. Same "never a broken briefing" reasoning
    // as the throw above, just for an answer that came back malformed
    // instead of not coming back.
    if (rows.length === 0 && dropped.length === 0) {
      return { rows: [], dropped: [], error: "The lifecycle search came back with nothing usable." };
    }

    return { rows, dropped };
  });

  return Response.json({
    rows: result?.rows || [],
    dropped: result?.dropped || [],
    skipped,
    generatedAt: new Date().toISOString(),
    ...(result?.error ? { error: result.error } : {}),
  });
}
