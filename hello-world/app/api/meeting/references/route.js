// ---------------------------------------------------------------------------
// POST /api/meeting/references — verifiable reference links for ONE meeting
// discussion point (an insight already on screen).
//
// The entire value of this feature is "a URL that exists right now, that a
// user can open and read aloud in front of colleagues" — see
// lib/meeting/referenceContract.js's header for why a link earns its way
// onto the screen only by being corroborated against pages Google actually
// visited, and why an uncorroborated one is DROPPED rather than shown with
// a caveat. That premise is also why the embedded engine gets a flat
// refusal below instead of the deterministic fallback every other auxiliary
// AI feature in this repo has (lib/llm/featureEngine.js's own header):
// there is no offline way to prove a link is live right now, and pretending
// otherwise would mean emitting links from the model's memory — the exact
// failure this whole feature exists to prevent.
//
// Gate order mirrors app/api/techwatch/lifecycle/route.js, the other route
// in this repo that pays for a grounded search per request: auth, then body
// validity, then the embedded engine, then the Gemini key — cheapest checks
// first, the model call last.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

import { getAuth, unauthorized, badRequest } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { cached } from "@/lib/techwatch/cache";
import { extractGroundingSources } from "@/lib/llm/grounding";
import { normalizeReferences, MAX_REFERENCES_PER_INSIGHT } from "@/lib/meeting/referenceContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INSIGHT_CHARS = 4000;
const MAX_TOPIC_CHARS = 300;

// A reference link (official docs, a spec, a standard) does not move day to
// day the way a news article does — the fact "this is the page for X" is
// stable for a week at a time.
export const REFERENCES_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

// --- Cache key: a DIGEST of generic terms, never the meeting text ----------
//
// The key is global (no user id) for the same reason
// app/api/techwatch/lifecycle/route.js's key is global: a documentation URL
// for "Kubernetes HPA" is the same fact for every user, so scoping it per
// user would multiply model spend by the user count for zero benefit.
//
// What it is built FROM is deliberately not insightText/topic themselves,
// and not even the generic-looking terms extracted from them: it is a hash
// of those terms. Extracting significant words (lowercased, deduped,
// stopword-filtered, capped) is not enough on its own — "4+ characters and
// not a stopword" makes a word LONG, not generic. An employer name, a
// product codename, a colleague's surname or an unreleased project name
// clears that bar as easily as "kubernetes" does, so a key built from the
// terms THEMSELVES could still carry a meeting's actual content into a
// shared, non-user-scoped Redis entry. Hashing removes that risk entirely —
// nothing readable from anyone's meeting reaches shared storage, generic-
// looking or not — while preserving every property the terms were extracted
// for: SORTING them before hashing still means word order in the sentence
// can't fragment the cache, and two differently phrased points that reduce
// to the same term set still hash to the same bucket. A different term set
// hashes to a different bucket, which is all a cache key ever needed to do.
//
// TOKENIZING. The token that distinguishes one documentation page from
// another is very often SHORT — a version number or a negation — so a
// blanket "4+ characters" rule silently merges the pages that most need
// telling apart: "Java 17"/"Java 21", "Kubernetes 1.29"/"1.31", "React
// 18"/"React 19", "HTTP/2"/"HTTP/3", and worst of all "does support"/"does
// not support", because "not" is three characters. Being served the Java 17
// docs for a Java 21 migration — or links backing the OPPOSITE claim — out
// of a shared, week-long cache, presented as verified, is the failure this
// whole feature exists to prevent.
//
// So: letters keep a 3-character floor (with a short stopword list to absorb
// the noise that admits), a dotted version number is kept WHOLE as one token
// (1.29 must not become "1" and "29"), and the negations are matched
// explicitly ahead of both so two-letter "no" survives.
const CACHE_TERM_RE = /\b(?:no|not)\b|[a-z]{3,}|\d+(?:\.\d+)*/g;
const MAX_CACHE_TERMS = 12;
// "not" and "no" are deliberately absent: they invert the meaning of the
// point, which is exactly what a cache key must not throw away.
const CACHE_STOPWORDS = new Set([
  "about", "after", "again", "also", "already", "although", "always", "and", "another",
  "are", "around", "because", "before", "being", "between", "both", "but", "can", "could",
  "currently", "did", "does", "doing", "done", "down", "during", "each", "either", "every",
  "for", "from", "get", "got", "had", "has", "have", "her", "here", "him", "his", "how",
  "however", "into", "its", "just", "let", "like", "make", "makes", "many", "may", "meeting",
  "might", "more", "most", "much", "must", "need", "needs", "now", "off", "only", "other",
  "our", "out", "over", "own", "put", "really", "recently", "said", "same", "say", "see",
  "she", "should", "since", "some", "still", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "think", "this", "those", "through", "today", "too",
  "toward", "towards", "try", "under", "until", "use", "very", "want", "wants", "was", "way",
  "were", "what", "when", "where", "which", "while", "who", "why", "will", "with", "without",
  "would", "yet", "you", "your",
]);

// Lowercase, tokenize, drop stopwords, dedupe, then SELECT in document order
// and only then sort.
//
// The two steps are separate on purpose. Sorting BEFORE slicing meant the cap
// kept whichever 12 terms happened to sort first, so two long points that
// differ only in a term sorting past position 12 threw that difference away
// and collided. Selecting in document order keeps the terms the speaker
// actually led with; sorting the SELECTION afterwards is what still lets two
// differently-worded points with the same vocabulary land on one entry
// (word order in the sentence must not fragment the cache).
//
// `total` is the pre-cap distinct term count, returned so the digest can mix
// it in: two points whose first 12 terms agree but which differ in length are
// then still different keys.
function cacheTerms(text) {
  const words = String(text || "").toLowerCase().match(CACHE_TERM_RE) || [];
  const unique = [];
  const seen = new Set();
  for (const word of words) {
    if (CACHE_STOPWORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    unique.push(word);
  }
  return { terms: unique.slice(0, MAX_CACHE_TERMS).sort(), total: unique.length };
}

// A WIDE digest, deliberately not lib/meeting/insightContract.js's insightId.
// That one is 32-bit FNV-1a (≤8 hex chars); in a shared, global, week-long
// namespace the birthday bound is only ~77k distinct term sets before a
// collision becomes likely, and a collision here means one topic's links
// served as "verified" sources for an unrelated topic. insightId is left
// alone rather than widened because its output is an insight's persisted
// identity (clients send it back as knownInsightIds), so changing it would
// re-surface every insight in every live meeting. sha256 truncated to 128
// bits puts the birthday bound far beyond anything this cache can reach,
// and node:crypto is available here (runtime = "nodejs").
function digestTerms({ terms, total }) {
  return createHash("sha256").update(`${total}:${terms.join(",")}`).digest("hex").slice(0, 32);
}

// null when the point has no generic technical terms at all (e.g. pure
// small talk) — the caller must SKIP caching entirely in that case rather
// than hash an empty term list: every such point would then hash to the
// SAME digest, recreating the exact single-shared-bucket bug this whole
// key redesign exists to remove, only harder to notice.
export function cacheKeyFor(insightText, topic) {
  const counted = cacheTerms(`${topic} ${insightText}`);
  return counted.terms.length > 0 ? `meeting:references:${digestTerms(counted)}` : null;
}

function buildPrompt({ insightText, topic }) {
  return [
    "You are helping someone in a LIVE meeting back up a discussion point with a real, currently-live web page they can open and read aloud.",
    `Discussion point: ${insightText}`,
    topic ? `Meeting topic (for context only): ${topic}` : "",
    `Using Google Search, find up to ${MAX_REFERENCES_PER_INSIGHT} authoritative pages (official documentation, a standard/spec, or a reputable publication) that directly support this point.`,
    "Only include a page you actually found through search just now — never one recalled from memory.",
    'Respond with a JSON array and nothing else — no prose before or after it. Each element must be an object with exactly these keys: "title" (the page\'s own title) and "url" (the exact URL you found).',
    "If nothing genuinely supports the point, return an empty array rather than guess.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Extracts the first top-level JSON array out of a model response that may
// be fenced, wrapped in prose, or bare. Same defensive shape as
// lib/techwatch/lifecycleSearch.js's extractFirstJsonArray and
// app/api/company-research/route.js's parseArticles: googleSearch is
// incompatible with responseMimeType: "application/json" (this repo records
// that twice already), so the model is asked for JSON in prose and the
// reply is parsed defensively rather than requested as strict JSON.
function parseSuggestedLinks(rawText) {
  const text = typeof rawText === "string" ? rawText : "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ title: String(item.title || "").trim(), url: String(item.url || "").trim() }));
}

// Marks a failure that must never be written to the cache. cached() stores
// any truthy producer result, so the producer THROWS this instead of
// returning an `{ error }` object; a producer throw is explicitly not cached
// (see lib/techwatch/cache.js), while POST still answers 200 with the error.
class ReferenceLookupError extends Error {}

export async function POST(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const insightText =
    typeof body?.insightText === "string" ? body.insightText.trim().slice(0, MAX_INSIGHT_CHARS) : "";
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, MAX_TOPIC_CHARS) : "";
  if (!insightText) return badRequest("Missing insightText.");

  // Same refusal shape as app/api/experience/research/route.js and
  // app/api/techwatch/lifecycle/route.js: the embedded engine has no
  // offline equivalent for "a URL that exists right now", so this is
  // checked before any work — including the cache lookup below, which would
  // otherwise still cost a lookup key computation for a request that can
  // never be answered.
  if (wantsEmbedded(body?.engine)) {
    return Response.json(
      { error: "Reference links need the Gemini engine. Switch off the embedded engine and try again." },
      { status: 503 },
    );
  }

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ error: "Reference lookup needs the Gemini API key to be configured." }, { status: 503 });
  }

  // Global cache key, deliberately a DIGEST of generic terms rather than the
  // raw insight text (or the terms themselves) — see the "Cache key" block
  // above for why.
  const cacheKey = cacheKeyFor(insightText, topic);

  // cached() only reveals whether it has a value, never whether the
  // producer ran to get it — so the producer marks its own execution. That
  // is the one place "did we just pay for a model call" is observable from
  // out here, and it is what lets the response tell a client (and this
  // route's own tests) that a hit was served with no second search.
  let modelWasCalled = false;
  const lookup = async () => {
    modelWasCalled = true;
    const prompt = buildPrompt({ insightText, topic });

    let response;
    try {
      response = await client.models.generateContent({
        model,
        contents: prompt,
        tools: [{ googleSearch: {} }],
      });
    } catch (err) {
      console.error("Meeting reference lookup failed:", err);
      // THROWN, not returned. Returning an `{ error }` object here made
      // cached() write a transient upstream blip into a GLOBAL key with a
      // seven-day TTL: one failure poisoned that bucket for every user for a
      // week, and the client's Retry button re-served the cached failure. A
      // producer throw is never cached, and POST turns it back into the 200
      // below — this is still progressive enhancement over a meeting panel
      // that already rendered, so a 5xx (which would read as the whole
      // meeting copilot breaking) is still not the answer. Same rule as
      // app/api/techwatch/lifecycle/route.js.
      throw new ReferenceLookupError(err?.message || "Reference lookup failed. Please try again.");
    }

    const groundedSources = extractGroundingSources(response);
    const suggested = parseSuggestedLinks(response?.text);
    // normalizeReferences is the ONLY place a link is admitted or refused,
    // AND the only place a link's URL is decided. It resolves the grounded
    // URIs to their real destinations before corroborating against them, so
    // the URL it corroborates is the URL it returns; nothing here may rewrite
    // a survivor's `url` afterwards, because nothing here re-checks it.
    return await normalizeReferences(suggested, { grounded: groundedSources });
  };

  // No generic terms at all (e.g. pure small talk) → cacheKeyFor returns
  // null, and this SKIPS caching entirely rather than keying on "" — a
  // shared key of "" would serve one user's links to every such request.
  let result;
  try {
    result = cacheKey ? await cached(cacheKey, REFERENCES_CACHE_TTL_SECONDS, lookup) : await lookup();
  } catch (err) {
    return Response.json({
      references: [],
      dropped: 0,
      grounded: false,
      error:
        err instanceof ReferenceLookupError && err.message
          ? err.message
          : "Reference lookup failed. Please try again.",
    });
  }

  return Response.json({
    references: result?.references || [],
    dropped: result?.dropped || 0,
    grounded: !!result?.grounded,
    // No `error` branch here on purpose: a failed lookup returns above,
    // from the catch, and never reaches this (cacheable) path.
    ...(modelWasCalled ? {} : { cached: true }),
  });
}
