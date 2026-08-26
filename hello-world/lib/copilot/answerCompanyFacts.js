// AC-V4 (Group V architecture doc §2, Evidence D). "What do you know about
// Purple Wave?" used to get answered with "My research indicates a strong
// focus on continuous improvement" — an invented claim about a company the
// model never researched. This module is the fix: the verified-company-facts
// search, its eager start, its bounded wait, and the fallback shape a request
// with no known employer always gets — moved out of
// app/api/copilot/answer/route.js.
//
// SCOPED TIGHTLY, and both gates matter: `mode !== "answer"` because
// buildAnswerPrompt (practice mode) is untouched by design, so building facts
// for it would have nowhere to go; `!wantsEmbedded(...)` because a
// company-facts SEARCH is itself a Gemini call with no deterministic
// equivalent, and this repo's established rule (every AI feature in this
// route already follows it) is that engine choice governs whether a feature
// calls a model at all — an embedded session gets exactly the "no prompt" it
// always had, never a background LLM call it did not ask for.
//
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { companyFactsBlock } from "@/lib/copilot/companyFacts";
import { buildCompanyFacts } from "@/lib/copilot/companyFactsSource";
import { isCompanyDirected } from "@/lib/copilot/companyDirected";
import { companyFactsCache, settleWithin } from "@/lib/copilot/answerSessionCache";

// AC-V4.6: how long a company-DIRECTED question
// (lib/copilot/companyDirected.js) waits for the search before answering
// honestly without it. A bounded 2.5s wait for the one question class where a
// factless answer is actively embarrassing; every OTHER question never waits
// at all — see `peek()` inside `startCompanyFacts` below.
export const FACTS_DEADLINE_MS = 2500;

// AC-V4.6/AC-V5.4: starts the search (or decides there is nothing to search
// for) and returns a THUNK — `null` when this request builds no facts at
// all, otherwise an async function that resolves the surviving facts for
// THIS question, honouring the deadline. *** THE SEARCH STARTS HERE; ONLY THE
// WAIT IS DEFERRED. ***
//
// THE ORDERING CONSTRAINT THAT MUST NOT MOVE, in two parts:
//
// 1. The three gates — mode, engine, employer known — are evaluated as the
//    FIRST statement, before `getServerEnv`/`getGeminiClient` are ever
//    touched. route.test.js, route.roleTermsUnbacked.test.js and
//    route.companyFacts.test.js all assert `getGeminiClient`/`getServerEnv`
//    were NEVER called on the embedded path; a module that constructs the
//    client and then decides is green on most fixtures and red on the one
//    fixture that reaches this gate at all: an embedded engine WITH an
//    employer on file (route.companyFacts.test.js's "the embedded engine
//    never triggers a company-facts search, even with an employer on file").
// 2. `companyFactsCache.get(...)` is called INSIDE this function,
//    synchronously — not deferred into the returned thunk. The returned
//    thunk closes over the resulting promise. Deferring the `.get()` into the
//    thunk would turn every question of a session into a cache miss
//    (route.latency.test.js's AC-V4.6/AC-V5.4 band pins the opposite: the
//    search is already running by the time a later question peeks at the
//    cache).
//
// The WAIT itself stays wherever each response path puts it — see
// `resolveCompanyFacts` below — never hoisted into a shared prologue ahead of
// the stream-vs-not branch, which is exactly the latency regression AC-V4.6
// exists to undo.
export function startCompanyFacts({ mode, engine, employer, question, cacheKey }) {
  const companyKnown = !!employer?.company;
  if (mode === "answer" || wantsEmbedded(engine) || !companyKnown) return null;

  let factsPromise = null;
  try {
    const { geminiModel: factsModel } = getServerEnv();
    const factsClient = getGeminiClient();
    // AC-V4.5: built ONCE per (user, application) and cached for the session
    // — `cacheKey` is the SAME string `answerContextCache` uses (a DIFFERENT
    // Map, so there is no collision risk in sharing it). Started EAGERLY, not
    // inside the thunk — see this function's own header, point 2.
    factsPromise = companyFactsCache.get(
      cacheKey,
      () =>
        buildCompanyFacts(
          { company: employer.company, jobTitle: employer.title },
          { client: factsClient, model: factsModel },
        ),
      { now: Date.now() },
    );
  } catch {
    // AC-V4.7: getServerEnv()/getGeminiClient() can throw synchronously (no
    // Gemini key configured) before there is even a promise to await.
    // buildCompanyFacts itself already never rejects (see its own header);
    // this catch covers the setup around it, so a missing key degrades to
    // "no facts" rather than a 500 on an otherwise answerable question.
    factsPromise = null;
  }

  return async () => {
    // No promise at all — the setup above threw. `settleWithin(null, …)`
    // would resolve to `null` rather than to its fallback, so this is
    // checked here instead of leaning on the deadline for it.
    if (!factsPromise) return [];
    // AC-V4.6: "start it, don't block on it, except for a company-directed
    // question." Only a question ABOUT the employer waits, bounded by
    // FACTS_DEADLINE_MS; every other question answers immediately with
    // whatever the cache already has — `[]` on the very first question of a
    // session (nothing has settled yet), the real facts on every question
    // after it, once the first question's search has had time to finish.
    if (!isCompanyDirected(question, { company: employer.company })) {
      return companyFactsCache.peek(cacheKey) || [];
    }
    return await settleWithin(factsPromise, FACTS_DEADLINE_MS, { fallback: [] });
  };
}

// Settles the thunk `startCompanyFacts` returned (or the `null` it returned
// when this request builds no facts at all) into the two values every
// response path needs: the raw Fact[] survivors (needed separately because
// `resolveFactSources` whitelists against the FACTS, not the text block built
// from them), and the rendered `companyFacts` block —
// `undefined | { companyKnown: true, block: string }`, the exact shape
// buildPointsPrompt's byte-identity guarantee depends on: `undefined` for "no
// employer known" takes neither of its branches. This is what preserves "a
// request that never had an employer sees exactly the response shape it
// always had" for `resolveCompanyFacts(null)`.
export async function resolveCompanyFacts(awaitCompanyFacts) {
  if (!awaitCompanyFacts) return { facts: [], companyFacts: undefined };
  const facts = await awaitCompanyFacts();
  return { facts, companyFacts: { companyKnown: true, block: companyFactsBlock(facts) } };
}
