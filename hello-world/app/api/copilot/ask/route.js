import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
// THE FIRST RATE LIMIT ANYWHERE UNDER app/api/. Every route here
// authenticates; until this one, none of them counted. See the ordering note on
// `askLimiter` below for the one way to adopt this module wrongly.
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { answerContextKey, loadAnswerContext } from "@/lib/copilot/answerContext";
import { fetchTrackingRow } from "@/lib/copilot/askTracking";
import { buildAskBlocks, askSourceLine } from "@/lib/copilot/askContext";
import { ASK_SYSTEM, buildAskUserTurn } from "@/lib/copilot/askPrompt";
import { answerAskLocal } from "@/lib/copilot/askLocal";
import { buildKnowledgeBaseBlock, noAttachmentBytesNotice } from "@/lib/experience/knowledgeBase";
import { isEligiblePage } from "@/lib/copilot/projectStories";
// The SAME cap the copilot answer route and the chat route apply, imported
// rather than re-declared. Two private copies of 2000 already exist
// (app/api/experience/knowledge/question/route.js:44) alongside a 600 in
// app/api/copilot/critique/route.js:38; a third would let "how long a question
// this route accepts" drift from "how long a question the vocabulary gate will
// look at".
import { MAX_QUESTION_CHARS } from "@/lib/copilot/questionVocabulary";
// The shared link-residue recognisers, imported from the lib module both the
// knowledge routes reach them through -- not re-implemented, and not reached by
// importing a sibling route.
import { scanCitationResidue, removeResidue, storedMarkdownHasNoLinks } from "@/lib/tracking/citationResidue";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// THE SPEND CEILING.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. lib/rateLimit/index.js's header states
// this as the one way to adopt it catastrophically wrong, and this route's
// suite pins BOTH halves -- a behavioural case that fires 21 requests and
// expects the 21st to be denied (a per-request limiter would pass all 21), and
// a static case that this declaration precedes `POST`.
//
// 20 asks per 10 minutes, per authenticated user. The window matches
// answerContextCache's own 10-minute TTL (answerSessionCache.js:166), so a
// user's allowance and the warm-context window they are spending it inside
// expire together. A DENIED REQUEST STILL INCREMENTS (see the module's header):
// the bound is 20 ATTEMPTS, not 20 successes.
//
// HONEST ABOUT WHAT THIS BUYS: `createMemoryStore` is per-instance, so on
// serverless this bounds a caller to 20 x instanceCount, not 20. It is worth
// having anyway -- it turns an unbounded loop against a model-calling endpoint
// into a bounded one -- but it is not a fleet-wide guarantee and must not be
// described as one. Swapping in a Redis-backed store satisfying the same
// two-method interface needs no change here.
// ---------------------------------------------------------------------------
const askLimiter = createRateLimiter({ limit: 20, windowMs: 600_000, prefix: "copilot-ask" });

const MAX_APPLICATION_ID_CHARS = 100;
// Parity with the answer route's own knowledge-base budget, for the same
// reason: the candidate's own pages are primary evidence, not a footnote.
const MAX_PAGES_CHARS = 12000;

const DISABLED_MESSAGE =
  "The ask box is switched off on this server right now. Nothing was sent and nothing was charged.";
const RATE_LIMITED_MESSAGE =
  "You have asked a lot of questions in a short window. Wait a moment and ask again.";
const NOTHING_TO_ANSWER_FROM =
  "There is nothing to answer from yet: no tracked application is selected, no resume or cover letter was submitted for one, and your experience pages are empty. Pick an application, or add a page, and ask again.";
const RESIDUE_REFUSAL =
  "The answer came back with links or markup in it that could not be removed safely, so it was discarded rather than shown.";

// See step 8. `<` immediately followed by a letter or a slash — never a bare
// comparison like "latency < 100ms".
const HTML_TAG_RE = /<\/?[a-zA-Z]/;
const BARE_URL_RE = /\bhttps?:\/\//i;

function fail(message, status) {
  return Response.json({ error: message }, { status });
}

export async function POST(request) {
  try {
    // ORDER IS LOAD-BEARING BELOW, and each step states what it must precede.

    // 1. THE KILL SWITCH, before a Supabase client, before the fan-out and
    //    before any model client -- an operator turning this off must stop the
    //    spend, not merely hide the answer.
    if (process.env.COPILOT_ASK_DISABLED === "1") {
      return fail(DISABLED_MESSAGE, 503);
    }

    // 2. IDENTITY, from `auth.getUser()`. Never `getSession()`: that call makes
    //    ZERO network requests (app/api/health/route.js:204-210 records the
    //    measurement), so gating on it is not a weak check, it is a total
    //    bypass. Everything downstream is scoped by the id this resolves to and
    //    never by a body field.
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

    // 3. THE BOUND, keyed on the id step 2 resolved to -- never on the caller's
    //    access token, and never before the auth resolves. Checked ahead of
    //    validation on purpose: an invalid request is still a request, and a
    //    caller hammering this endpoint with junk should exhaust its own
    //    allowance rather than get an unmetered lane.
    const decision = await askLimiter.check(identify(request, { userId: user.id }));
    if (!decision.allowed) {
      return Response.json(
        { error: RATE_LIMITED_MESSAGE },
        { status: 429, headers: rateLimitHeaders(decision) },
      );
    }

    // 4. THE QUESTION. REFUSED when over the cap, never silently truncated --
    //    the knowledge question route's rule and its stated reason: silently
    //    answering a different question from the one that was asked is worse
    //    than saying no. (The copilot answer route slices instead, because
    //    there the "question" is machine-transcribed interviewer speech nobody
    //    typed; here a person typed it and is watching for the answer.)
    const question = (body?.question ?? "").toString().trim();
    if (!question) {
      return fail("Type a question first.", 400);
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return fail("That question is too long. Shorten it and ask again.", 400);
    }

    const applicationId = (body?.applicationId ?? "").toString().trim().slice(0, MAX_APPLICATION_ID_CHARS);
    const embedded = wantsEmbedded(body?.engine);

    // 5. THE FAN-OUT. `loadAnswerContext` is the answer route's own cached
    //    loader, called with the SAME `answerContextKey(user.id, applicationId)`
    //    so a live interview's warm cache serves this box too -- a hit skips all
    //    five Supabase round trips. The tracking scalars and interview stages it
    //    has no column for come from the one extra read beside it; the two run
    //    concurrently, so this costs one round trip of latency, not two.
    const [context, tracking] = await Promise.all([
      loadAnswerContext(supabase, {
        userId: user.id,
        applicationId,
        cacheKey: answerContextKey(user.id, applicationId),
      }),
      fetchTrackingRow(supabase, { applicationId, userId: user.id }),
    ]);

    const kb = buildKnowledgeBaseBlock({
      pages: context.pages,
      query: question,
      isEligible: isEligiblePage,
      budget: MAX_PAGES_CHARS,
      budgetLabel: "the ask box's context budget",
      attachmentNotice: noAttachmentBytesNotice("this answer"),
    });

    const { blocks, sources, empty } = buildAskBlocks({
      // The scraped half of the row is stitched on here: the description and
      // the employer name/title arrive from the cached fan-out already capped,
      // so nothing re-reads or re-caps them.
      tracking: tracking
        ? {
            ...tracking,
            company: context.employer?.company ?? "",
            title: context.employer?.title ?? "",
            description: context.posting ?? "",
          }
        : null,
      resume: context.resume,
      coverLetter: context.coverLetter,
      knowledge: {
        block: kb.block,
        includedCount: kb.includedPages.length,
        inScopeCount: Array.isArray(context.pages) ? context.pages.length : 0,
        truncated: !!kb.truncated,
      },
    });

    // 6. ZERO CONTEXT REFUSES, before any model client is constructed. A
    //    non-zero input becoming a zero output is a reportable anomaly, and
    //    calling the model with an empty context block would spend money to be
    //    told nothing is there.
    if (empty) {
      return Response.json({ answer: NOTHING_TO_ANSWER_FROM, sources, truncated: false, engine: embedded ? "embedded" : "gemini" });
    }

    const truncated = !!kb.truncated && sources.pagesInScope > sources.pagesIncluded;
    const sourceLine = askSourceLine(sources, { truncated });

    // 7a. THE EMBEDDED PATH. No `getServerEnv`, no `getGeminiClient`, no
    //     network call of any kind -- the route's suite asserts both mocks stay
    //     untouched on this branch.
    if (embedded) {
      const local = answerAskLocal({ question, blocks });
      return Response.json({
        answer: `${local}\n\n${sourceLine}`,
        sources,
        truncated,
        engine: "embedded",
      });
    }

    // 7b. THE GEMINI PATH. `config.systemInstruction` is a CONSTANT and every
    //     untrusted string rides the user turn inside one labelled fence -- see
    //     lib/copilot/askPrompt.js's header for the shape and for the
    //     pre-32a0626 chat route that shows what happens without it.
    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: buildAskUserTurn({ question, blocks }) }] }],
      config: { systemInstruction: ASK_SYSTEM },
    });

    const raw = typeof response?.text === "string" ? response.text.trim() : "";
    if (!raw) {
      return fail("The model returned nothing. Try asking again.", 502);
    }

    // 8. THE ANSWER IS PLAIN TEXT, and anything that survives as a link or a
    //    tag is a REFUSAL rather than something rendered. The link recognisers
    //    are the shared ones (lib/tracking/citationResidue.js); only the
    //    composition is local, matching what the knowledge route's
    //    `cleanModelMarkdown` does with the same three functions.
    //
    //    The two extra gates beside them are not a second link recogniser, they
    //    are this surface's own output constraint: nothing downstream renders
    //    HTML or follows a URL from this answer, so either one appearing means
    //    the model ignored its instructions and the safe move is to discard the
    //    whole answer rather than print a scrubbed one. `<` before a letter or
    //    a slash only -- "latency < 100ms" and "salary <150k" are prose and
    //    must not be refused.
    const residue = scanCitationResidue(raw);
    const cleaned = residue.count > 0 ? removeResidue(raw, residue.ranges) : raw;
    if (!storedMarkdownHasNoLinks(cleaned) || HTML_TAG_RE.test(cleaned) || BARE_URL_RE.test(cleaned)) {
      return fail(RESIDUE_REFUSAL, 502);
    }

    return Response.json({
      answer: `${cleaned.trim()}\n\n${sourceLine}`,
      sources,
      truncated,
      engine: "gemini",
    });
  } catch (err) {
    console.error("[copilot/ask] request failed:", err);
    return fail("That question could not be answered right now.", 500);
  }
}
