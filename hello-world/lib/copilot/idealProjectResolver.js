// N125: the worked-example RESOLVER — the three keys, the READY (pool) start +
// peek, and the TAILORED per-question call. Server-only, for the same reason
// answerCodeLanguage.js is: it imports the Gemini client, so the module
// BOUNDARY (not a bundler check) is what keeps the posting text and the model
// call out of the browser. Nothing client-reachable imports it.
//
// The two examples a candidate sees beside an answer, and why they are
// resolved differently:
//
//  READY    a posting-grounded example built with an EMPTY question, so it is
//           question-INDEPENDENT and can be prefetched. `startIdealProject
//           Resolution` kicks the model call off (at most one per pool key per
//           cache TTL) and returns nothing — a void start makes an `await` on
//           this path unwritable, which is the whole latency point: the model
//           call is never on a path that SERVES an example. `peekIdealProject`
//           is the serve: a synchronous cache read that returns the model's
//           project or null (a miss, or still in flight), never a promise, so
//           a cold pool costs a serve nothing and falls to the deterministic
//           archetype in the caller.
//  TAILORED a live call for THAT exact question, `await`ed only by its own
//           non-blocking channel (the ideal-project endpoint, behind a
//           deadline). Seconds are acceptable there because READY is already
//           on screen. Its result is cached under a key that INCLUDES the
//           question, so "answer question two with question one's example" is
//           structurally unconstructible, and its eviction is harmless.
//
// The embedded engine gets neither: both gates run FIRST, before the Gemini
// client is so much as constructed, the ordering answerCodeLanguage.js records
// for its own gates (a module that builds the client and then decides is green
// on most fixtures and red on the one that reaches the gate at all).
//
// `generateIdealProjectExample` (answerAids.js) is the loader body for both and
// resolves to null, never rejects. For the POOL that null is cached as
// `{ project: null }`: a deliberate cost bound — at most one pool attempt per
// TTL, the posture answerCodeLanguage.js takes for its `NONE` — and it costs
// nothing visible, since a null pool peeks as a miss and the deterministic
// example is always there. For TAILORED the null is NOT kept (N130): the loader
// turns it into a rejection, which the TTL cache never retains, so a retry of
// the same question re-attempts the model instead of reading a cached null for
// the rest of the TTL.

import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { normalizeQuestion } from "./questions.js";
import { MAX_QUESTION_CHARS } from "./questionVocabulary.js";
import { idealProjectPoolCache, idealProjectTailoredCache } from "./answerSessionCache.js";
import { generateIdealProjectExample } from "./answerAids.js";

// The pool key: posting-only. No question ever enters it, which is what makes
// the READY example question-independent and its cache entry safe under
// answerSessionCache.js's header rule.
export function idealProjectPoolKey(userId, applicationId) {
  return `${userId}::${applicationId}::ip`;
}

// The question half of the TAILORED key. `normalizeQuestion` already lowercases,
// trims and collapses whitespace runs, and never deletes or merges a non-space
// character, so two questions that differ in any interior token keep distinct
// keys; stripping TRAILING separators only makes "…a project." and "…a
// project?" one question, which is correct. The cap is the route's own question
// cap (the route trims `question` to it before this ever runs), so it can only
// re-truncate an already-capped string and is never the binding constraint on a
// real interview question.
export function idealProjectQuestionKey(question) {
  return normalizeQuestion(question)
    .replace(/[\s?.!,;:—–-]+$/u, "")
    .slice(0, MAX_QUESTION_CHARS);
}

export function idealProjectTailoredKey(userId, applicationId, question) {
  return `${userId}::${applicationId}::ipq:${idealProjectQuestionKey(question)}`;
}

// Starts (at most) one POOL generation per key per cache TTL and returns
// nothing. `question` is "" here, ALWAYS. One try/catch around the client setup
// AND the `.get()` call: `getServerEnv()`/`getGeminiClient()` throw
// synchronously with no key configured, before there is a promise to await, and
// this path must degrade to "nothing resolved" rather than escape to a 500 on
// an otherwise answerable question. `.get()` is called SYNCHRONOUSLY, never
// deferred into a thunk — deferring it would turn every ask into a miss.
export function startIdealProjectResolution({ engine, description, cacheKey } = {}) {
  if (wantsEmbedded(engine)) return;
  if (!String(description || "").trim()) return;
  try {
    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    idealProjectPoolCache.get(
      cacheKey,
      async () => ({
        project: await generateIdealProjectExample({ client, geminiModel, description, question: "" }),
        resolvedAt: Date.now(),
      }),
      { now: Date.now() },
    );
  } catch {
    // No key configured, or a synchronous client-construction failure: nothing
    // resolved, nothing thrown. A void start leaves nothing downstream holding
    // a reference.
  }
}

// The READY serve. Pure: starts nothing, waits for nothing. `project` is an
// object or null (never a truthy sentinel), so `|| null` is safe here — the
// `|| fallback` ban that bites answerCodeLanguage's `NONE` does not apply.
export function peekIdealProject(cacheKey) {
  const hit = idealProjectPoolCache.peek(cacheKey);
  return hit?.project || null;
}

// How ONE request reads the READY pool: the answer route and the ideal-project
// endpoint both come through here, so they cannot disagree about it. Returns the
// pool's example (`generatedProject`, null on a cold pool) and a `prime` thunk
// that starts the generation — the same start-then-peek shape as
// answerCodeLanguage.js, for the same reason: a model call is started eagerly,
// off the request's path, and only a synchronous peek is ever read, so a miss
// serves the deterministic archetype now AND warms the pool for the next ask.
// The key is posting-only, so what is read is question-INDEPENDENT.
//
// PEEKED here, once, on the request's tick, before anything is started — so a
// cold pool is cold for that whole request, whichever branch answers and however
// fast the model call settles — and the caller hands this one value to every
// answerAids call. STARTED later, by the caller invoking `prime` once its own
// answer call has been issued: the prefetch must never be the first model call a
// request makes, or it would sit ahead of the answer the candidate is waiting on.
//
// The embedded engine neither reads nor primes, not even a pool a Gemini request
// warmed earlier in the session: "embedded makes no model call" would otherwise
// hold only by the cache happening to be empty. `generatedProject` is null for
// it, and `prime` is a no-op by `startIdealProjectResolution`'s own gate.
export function idealPoolFor({ userId, applicationId, engine, description }) {
  const cacheKey = idealProjectPoolKey(userId, applicationId);
  return {
    generatedProject: wantsEmbedded(engine) ? null : peekIdealProject(cacheKey),
    prime: () => startIdealProjectResolution({ engine, description, cacheKey }),
  };
}

// The TAILORED call: a live, per-question model example, resolved through its
// own cache so an exact repeat is served at once and two concurrent identical
// asks collapse to one call. Never rejects — a failed call is null, which the
// endpoint turns into "READY stands alone".
//
// Only a REAL example is kept. The cache stores the loader's promise and drops
// a rejected one the moment it settles, so the loader rejects on a null result
// (a model failure, an unparseable reply, or one normalizeIdealProject refuses):
// the entry is evicted, a retry of that question re-attempts the model, and
// concurrent identical asks that were already sharing the in-flight call all
// receive the same null via the catch below. A success is untouched: it caches
// for the full TTL and a concurrent twin still shares its one call.
export async function resolveTailoredIdealProject({ engine, description, question, cacheKey } = {}) {
  if (wantsEmbedded(engine)) return null;
  if (!String(description || "").trim()) return null;
  try {
    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    const hit = idealProjectTailoredCache.peek(cacheKey);
    if (hit?.project) return hit.project;
    const entry = await idealProjectTailoredCache.get(
      cacheKey,
      async () => {
        const project = await generateIdealProjectExample({ client, geminiModel, description, question });
        if (!project) throw new Error("no tailored ideal-project example resolved");
        return { project, resolvedAt: Date.now() };
      },
      { now: Date.now() },
    );
    return entry?.project || null;
  } catch {
    return null;
  }
}
