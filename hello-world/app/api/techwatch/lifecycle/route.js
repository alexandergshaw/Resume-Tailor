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

export async function POST(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

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
        tools: [{ googleSearch: {} }],
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
