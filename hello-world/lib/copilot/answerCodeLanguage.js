// The per-application code-language RESOLVER: the model call, its four
// start gates, and the peek. Reconciliation AMENDMENT (binding): this module
// is server-only BECAUSE it imports the Gemini client, and that is the whole
// reason the observation log (AC-C28b constraints 2/3, CONF-9) may live here
// and nowhere else in `lib/copilot/`. `lib/copilot/` has no `server-only`
// guard anywhere in this repo — 52 client components (files whose first line
// is `"use client";`) anywhere under `app/` import from this directory — a
// wider count than `codeLanguages.js`'s own comment, which is scoped to
// `app/copilot/` only and counts every importing file, not just the ones
// marked client — so the module BOUNDARY, not a bundler check, is what keeps
// the user's own posting text and the system instruction out of the browser.
// `codeLanguages.js` and `codeLanguagePrompt.js` are pure and client-reachable
// on purpose; this file is the one place that may cross into the server-only
// side, and nothing it exports leaks that boundary back out.
//
// THREE THINGS THIS FILE EXISTS FOR:
//
//  1. THE RESOLVER MUST BE OBSERVABLE (BL-2 / AC-C8d3 / AC-C28b constraint 2).
//     Behind a working validator, a fabricating resolver and an abstaining
//     one are indistinguishable post-validation — both produce no token. The
//     RAW pre-validation answer is recorded in a single `console.info` line,
//     immediately after validation, so an abstention and a rejected
//     fabrication leave different, reviewable records.
//  2. THE `|| fallback` IDIOM IS BANNED AT THE PEEK SITE (CONF-5/BL-4).
//     `"none"` is truthy; a peek that copies `companyFactsCache.peek(key) ||
//     []` would send a cached abstention straight into the answer prompt's
//     precedence chain as if it were a real language. `peekCodeLanguage`
//     checks `hit.language === NONE` explicitly instead.
//  3. THE GATES RUN FIRST, AND `mode` IS NOT ONE OF THEM. The precedent this
//     mirrors, `answerCompanyFacts.js`, returns early for `mode === "answer"`
//     because `buildAnswerPrompt` had nowhere to put the result. Practice
//     mode IS answer mode here — AC-C1 puts the control on both tabs — so
//     there is no `mode` parameter anywhere below, structurally, and copying
//     the precedent's gate would silently ship a live-only feature.
//
// `generateCodeLanguage` resolves to `NONE`, never `null`, and never
// rejects, on every exit: an empty prompt, a thrown or rejected client,
// unparseable JSON, or a validator rejection (D-12). `createTtlCache` never
// caches a rejection, so a rejecting loader would mean a fresh Gemini call on
// every code-bearing `Auto` question of an application, and AC-C11's
// at-most-one-call-per-TTL cost bound would be false.
//
// `startCodeLanguageResolution`'s loader WRAPS the resolved token into
// `{ language, resolvedAt }` (D-11) — passing `generateCodeLanguage` to
// `codeLanguageCache.get` directly would leave `peekCodeLanguage`'s
// `hit.language` `undefined` on every hit, forever.

import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { codeLanguageCache } from "./answerSessionCache.js";
import { AUTO, NONE } from "./codeLanguages.js";
import { CODE_LANGUAGE_SYSTEM, buildCodeLanguagePrompt, validateResolvedLanguage } from "./codeLanguagePrompt.js";

// How much of a quote the observation log keeps, deliberately ABOVE the
// validator's 200-character bound (§B.9.3 step 4) — so a rejected, over-long
// quote still reads as over-long in the record rather than as exactly at the
// limit.
const MAX_LOGGED_EVIDENCE_CHARS = 240;

// Starts (at most) one resolution per application per cache TTL, and returns
// nothing — a void start is what makes an `await` on this path unwritable
// (CONF-4). The four gates below are the FIRST statement, before
// `getServerEnv`/`getGeminiClient` are ever touched — the ordering
// `answerCompanyFacts.js` records and three route suites assert for its own
// gates: a module that constructs the client and then decides is green on
// most fixtures and red on the one that reaches the gate at all.
export function startCodeLanguageResolution({
  engine,
  descriptor,
  override,
  applicationId,
  description,
  title,
  cacheKey,
} = {}) {
  if (wantsEmbedded(engine)) return; // AC-C21
  if (!descriptor?.codeBearing) return; // CONF-6 — the registry's own field, never a hand-rolled predicate
  if (override !== AUTO) return; // AC-C11c — an explicit choice is never second-guessed by a model call
  if (!applicationId || !String(description || "").trim()) return; // AC-C14 — also keeps the shared `${userId}::` bucket unwritten

  // One try/catch around BOTH the client setup and the `.get()` call
  // (BL-2): `getServerEnv()`/`getGeminiClient()` throw synchronously with no
  // Gemini key configured, before there is even a promise to await, and this
  // path must degrade to "nothing resolved" rather than escape to a 500 on
  // an otherwise answerable question. The catch body is empty, deliberately
  // — a void start leaves nothing downstream holding a reference.
  try {
    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();

    // Called SYNCHRONOUSLY, right here — never deferred into a thunk.
    // Deferring it would turn every question of a session into a cache
    // miss, the same defect `answerCompanyFacts.js` records for its own
    // eager start.
    codeLanguageCache.get(
      cacheKey,
      async () => ({
        language: await generateCodeLanguage({ client, geminiModel, description, title, applicationId }),
        resolvedAt: Date.now(),
      }),
      { now: Date.now() },
    );
  } catch {
    // Swallowed. No key configured, or a synchronous client-construction
    // failure — either way, nothing resolved and nothing thrown.
  }
}

// The model call itself (AC-C6). Mirrors `generateIdealProjectExample`
// (`answerAids.js`) exactly in shape — a JSON-mode Gemini call, no `tools`,
// no `thinkingConfig`, this call searches nothing and needs no reasoning
// chain. `applicationId` is a fifth argument that exists only to reach the
// log line below (test-round ruling 4) — it is never sent to the model, and
// the cache is already keyed on it; a log recording a resolved language with
// no way to say which posting was read is not reviewable, which is
// AC-C28b constraint 2's whole point.
export async function generateCodeLanguage({ client, geminiModel, description, title, applicationId } = {}) {
  const prompt = buildCodeLanguagePrompt({ description, title });
  if (!prompt) return NONE; // AC-C14's empty-prompt exit — nothing to ask, no model call made

  // `parsed` stays `null` on any failure to reach or read the model — a
  // thrown client, a rejected promise, or unparseable JSON all converge
  // here, and `validateResolvedLanguage(null, ...)` already returns `null`
  // for that shape, so no duplicate error handling is needed below.
  let parsed = null;
  try {
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: CODE_LANGUAGE_SYSTEM, responseMimeType: "application/json" },
    });
    parsed = parseModelJson(response.text?.trim() || "");
  } catch {
    parsed = null;
  }

  const isPlainObject = parsed && typeof parsed === "object" && !Array.isArray(parsed);
  // The RAW, pre-validation answer — the only place AC-C7b's abstention is
  // observable, since post-validation a fabricating resolver and an
  // abstaining one both produce `NONE`.
  const rawLanguage = isPlainObject && typeof parsed.language === "string" ? parsed.language : NONE;
  const rawEvidence = isPlainObject && typeof parsed.evidence === "string" ? parsed.evidence : "";

  const validated = validateResolvedLanguage(parsed, { description });
  const language = validated ?? NONE; // D-12 — never `null` leaves this function
  const admitted = validated !== null; // true for BOTH an admitted language and an honest "none"

  // Exactly one `console.info` line, in this module and nowhere else
  // (§B.7). Logs the evidence SPAN, never the description; carries no user
  // id; carries `applicationId` so the record is correlatable to the
  // posting that was read.
  console.info("[copilot:code-language]", {
    applicationId,
    rawLanguage,
    language,
    admitted,
    evidence: rawEvidence.slice(0, MAX_LOGGED_EVIDENCE_CHARS),
    evidenceLength: rawEvidence.length,
    resolvedAt: Date.now(),
  });

  return language;
}

// Pure. Starts nothing. Never returns `"none"`, `"auto"`, or a promise. The
// `|| fallback` idiom is banned here (CONF-5/BL-4): `hit.language` may be
// `NONE`, which is truthy, so the check below is explicit rather than a
// truthiness test.
export function peekCodeLanguage(cacheKey) {
  const hit = codeLanguageCache.peek(cacheKey);
  if (!hit) return null;
  if (hit.language === NONE) return null; // an honest abstention peeks as a miss, on purpose
  return hit.language;
}
