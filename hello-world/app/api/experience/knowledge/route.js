import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { loadScopeInput } from "@/lib/experience/knowledgeLoad";
import { getSummary, upsertSummary, listQuestions, QUESTION_PAGE_SIZE } from "@/lib/supabase/experienceKnowledge";
import {
  scopeKeyFor,
  collectScopePages,
  classifyScopePages,
  isScopePageEligible,
  resolveCitedPageIds,
  buildRetrievalOutcome,
} from "@/lib/experience/knowledgeScope";
import {
  KNOWLEDGE_BUDGET,
  KNOWLEDGE_BUDGET_LABEL,
  buildScopeSummaryPrompt,
  parseAnswerEnvelope,
} from "@/lib/experience/knowledgePrompts";
import {
  buildKnowledgeBaseBlock,
  noAttachmentBytesNotice,
  MAX_LISTED_ATTACHMENTS,
} from "@/lib/experience/knowledgeBase";
import { scanCitationResidue, removeResidue, storedMarkdownHasNoLinks } from "@/lib/tracking/citationResidue";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";

export const runtime = "nodejs";

// THE PLATFORM CEILING HAS TO OUTLIVE THE DEADLINE THIS ROUTE SETS ITSELF.
// No route under app/api/experience/ sets a maxDuration today, so the platform
// default governs — and a kill mid-call runs no `catch`, writes no row, and
// leaves the scope in the one state that re-arms a paid call on every future
// view. 60 > 2 x KNOWLEDGE_MODEL_TIMEOUT_MS/1000, so even a call that runs the
// per-call timeout out in full still lands in the catch below with time to
// write its row.
export const maxDuration = 60;

// PER-CALL, AND IT IS MEASURED TO WORK. Against @google/genai 2.6.0:
// `config.httpOptions.timeout` aborts a hanging request with an AbortError at
// 409 ms when set to 400 ms.
//
// WHAT IS DELIBERATELY ABSENT, AND WHY IT IS NOT AN OMISSION:
//
//  * A SECOND ARGUMENT. `models.generateContent.length === 1` and the SDK's
//    parameter transformer reads only `model`, `contents` and `config`. A
//    second options object — the `{ timeout, maxRetries }` shape
//    app/api/application-digest/route.js passes — is SILENTLY DISCARDED here:
//    measured, the call was still pending at 4 s with no abort and the server
//    saw one request. That route calls `client.interactions.create`, a
//    DIFFERENT API with a different transport; its shape does not transfer.
//
//  * RETRIES. `config.httpOptions.retryOptions` is IGNORED per call — the SDK
//    reads the CONSTRUCTOR's `httpOptions.retryOptions`, so a per-call value
//    cannot reach it. Measured: with `retryOptions: { attempts: 3 }` set in
//    `config`, the probe server saw exactly ONE request, identical to no
//    retryOptions at all. Configuring it here would be a claim the transport
//    does not honour. Setting it on the constructor instead is refused for a
//    different reason: `getGeminiClient()` memoises one client that seven
//    other features share, so a retry policy set there is not this feature's
//    to set — and it would retry the client-side timeout itself.
//
//    So: NOTHING RETRIES, AND THERE IS NO BACKOFF. That is a decision, stated,
//    not a gap. A failed call writes a `failed` row and the user's Regenerate
//    button is the retry.
export const KNOWLEDGE_MODEL_TIMEOUT_MS = 30_000;

// The failure vocabulary, as sentences rather than codes, because this string
// is stored in the row's `error` column and rendered to the user.
//
// NO_TEXT_PART AND EMPTY_TEXT ARE TWO DIFFERENT SENTENCES ON PURPOSE, and
// keeping them apart is the whole reason this route branches on
// `typeof response.text` before coercing. Measured against @google/genai
// 2.6.0, FIVE distinct causes reach this code as one value:
//
//     no candidates at all (a prompt-level safety block)   -> undefined
//     candidates: []                                       -> undefined
//     a candidate with no `content` (MAX_TOKENS)           -> undefined
//     `content` with no `parts`                            -> undefined
//     `parts: []`                                          -> undefined
//     a genuinely empty text part                          -> ""
//
// and BOTH of this repo's coercion idioms — `String(response.text || "")`
// (app/api/experience/research/route.js) and `response.text ?? ""` — collapse
// all six to `""`. `undefined` means no text part was produced AT ALL; `""`
// means one was produced and it was empty. They are different failures with
// different causes, and the finish reason plus the prompt-level block reason
// are what separate the five undefined-producers from each other afterwards.
const FAILURE = Object.freeze({
  MODEL_CALL: "The model call did not complete.",
  NO_TEXT_PART: "The model returned no text at all.",
  EMPTY_TEXT: "The model returned an empty text response.",
  ENVELOPE: "The model's reply was not in the expected format.",
  RESIDUE: "The model's reply contained links that could not be removed safely.",
  ZERO_OUT: "No page in this scope could be included in the model's context.",
});

const EMBEDDED_REFUSAL =
  "A scope summary needs the Gemini engine. Switch off the embedded engine and try again.";
const NO_KEY_REFUSAL = "A scope summary needs the Gemini API key to be configured.";

/**
 * readModelText(response) -> { kind, text, finishReason, blockReason }
 *
 * THE ONE RECOGNISER OF THE EMPTY-VERSUS-REFUSAL RULE, exported so the sibling
 * question route uses this function object rather than a second copy of it.
 * (app/api/experience/research/route.js already exports a non-handler symbol
 * from a route module for the same "one function object, not two" reason.)
 * Two copies would both be green against their own tests while disagreeing
 * about which of the five undefined-producing shapes is a refusal.
 *
 * `kind`:
 *   "text"    — a text part with content.
 *   "empty"   — a text part that was produced and was the empty string.
 *   "missing" — no text part at all: `typeof response.text === "undefined"`.
 *
 * `blockReason` is carried alongside `finishReason` because a PROMPT-level
 * safety block produces no candidates at all, so it has no finish reason to
 * report — without `promptFeedback.blockReason` a refusal would be stored as
 * indistinguishable from a model that simply produced nothing. Nothing in this
 * repo reads either field today; storing them is what makes the five causes
 * separable after the fact instead of at 2am with no evidence.
 */
export function readModelText(response) {
  const raw = response?.text;
  const finishReason = response?.candidates?.[0]?.finishReason ?? null;
  const blockReason = response?.promptFeedback?.blockReason ?? null;
  if (typeof raw !== "string") {
    return { kind: "missing", text: "", finishReason, blockReason };
  }
  return { kind: raw === "" ? "empty" : "text", text: raw, finishReason, blockReason };
}

/**
 * The single-argument model call, shared with the question route for the same
 * reason `readModelText` is. Throws on transport failure and on the per-call
 * abort; the caller's `catch` is what writes the row.
 */
export async function callKnowledgeModel({ client, model, prompt }) {
  return client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
      // No `tools`, no `googleSearch`: this feature answers from the user's
      // own pages and nothing else, which is also its only anti-exfiltration
      // property. See this file's KNOWLEDGE_MODEL_TIMEOUT_MS comment for why
      // there is no retry key here.
      httpOptions: { timeout: KNOWLEDGE_MODEL_TIMEOUT_MS },
    },
  });
}

/**
 * `scopePageId` off a request body or query string, as the three-way value the
 * rest of the pipeline expects: a non-empty string, or `null` for the whole
 * knowledge base. Anything else — a number, an object, an array — is a
 * malformed request rather than a root-scope request, because silently
 * treating a dropped or corrupted key as "summarise everything" is how a
 * caller ends up billing a whole-base generation it never asked for.
 */
export function readScopePageId(value) {
  if (value === null || value === undefined) return { ok: true, scopePageId: null };
  if (typeof value !== "string") return { ok: false, scopePageId: null };
  const trimmed = value.trim();
  return { ok: true, scopePageId: trimmed === "" ? null : trimmed };
}

// Attachments belonging to this scope that the model was NOT shown.
//
// Exactly derivable from what buildKnowledgeBaseBlock returns, and no further:
// every attachment on a page that did not make the block, plus the overflow
// past MAX_LISTED_ATTACHMENTS on the pages that did. An attachment whose
// FORMATTED line was dropped by the builder's own character cap is not visible
// from its return value and is therefore NOT counted here — stated rather than
// silently folded in, because a disclosure number that quietly guesses is
// worse than one with a known, named boundary.
export function attachmentsSkippedFor(scopePages, includedPageIds) {
  const included = new Set(includedPageIds || []);
  let skipped = 0;
  for (const page of scopePages) {
    const count = Array.isArray(page?.attachments) ? page.attachments.length : 0;
    if (count === 0) continue;
    skipped += included.has(page?.id) ? Math.max(0, count - MAX_LISTED_ATTACHMENTS) : count;
  }
  return skipped;
}

/**
 * Residue removal plus the terminal proof, shared by both routes.
 *
 * The scan/remove pair enumerate syntaxes; `storedMarkdownHasNoLinks` parses
 * what is ACTUALLY about to be stored and is the one assertion that cannot be
 * defeated by a syntax nobody enumerated. It runs on the post-removal string,
 * never on the raw model text.
 *
 * The removal count is returned as a refusal so it reaches
 * `retrieval_outcome.refused` and can be said in words: BARE_URL_RE removes
 * every `https?://…`, so a summary legitimately quoting a URL the user wrote
 * loses it, and that belongs in the disclosure rather than only in a jsonb
 * column.
 */
export function cleanModelMarkdown(rawAnswer) {
  const residue = scanCitationResidue(rawAnswer);
  const cleaned = residue.count > 0 ? removeResidue(rawAnswer, residue.ranges) : rawAnswer;
  return { cleaned, removed: residue.count, proven: storedMarkdownHasNoLinks(cleaned) };
}

/**
 * The block build + classification both routes share. `query` is "" on the
 * summary path (an empty query scores every page 0, so BM25's stable sort
 * leaves the pre-order collectScopePages produced untouched) and the user's
 * question on the answer path.
 *
 * KNOWN AND ACCEPTED, on the answer path only: `classifyScopePages` assigns
 * `rank` in SCOPE order, which equals ranked order only for the empty query.
 * On the question path `rank` is therefore a scope-order index, not a BM25
 * rank. `included` and `reason` are unaffected — they are decided by
 * membership of the builder's own `includedPages` — so the disclosure the user
 * reads stays exactly true; only the "why this one first" ordinal is
 * approximate, and re-deriving it here would mean a second copy of the ranker.
 */
export function buildScopeContext({ scopePages, query, scopeLabel }) {
  const built = buildKnowledgeBaseBlock({
    pages: scopePages,
    query,
    // The SAME function object knowledgeScope classifies with. `isEligible`
    // has no default inside the builder and falls back to `() => false`, which
    // returns a byte-identical object to an empty scope on every field.
    isEligible: isScopePageEligible,
    budget: KNOWLEDGE_BUDGET,
    budgetLabel: KNOWLEDGE_BUDGET_LABEL,
    attachmentNotice: noAttachmentBytesNotice(scopeLabel),
  });
  const { sourcePages, counts } = classifyScopePages({
    scopePages,
    includedPages: built.includedPages,
  });
  return {
    ...built,
    sourcePages,
    counts: { ...counts, attachmentsSkipped: attachmentsSkippedFor(scopePages, built.includedPageIds) },
  };
}

/**
 * The `retrieval_outcome` record, assembled the same way on every path — the
 * success path, the two empty-response paths, the parse failure, the residue
 * refusal and the never-called zero-out — so a reader comparing two rows is
 * comparing the same shape.
 */
export function outcomeFor({
  counts,
  pageRowCount,
  truncatedRead,
  claimed = 0,
  resolved = 0,
  rendered = 0,
  refused = [],
  residueRemoved = 0,
  model,
}) {
  const refusedAll = residueRemoved > 0 ? [...refused, { reason: "residue-removed", count: residueRemoved }] : refused;
  return buildRetrievalOutcome({
    // pagesFetched is the loader's own INDEPENDENT head count, never
    // `pages.length`: a chain that begins at a number the feature re-measured
    // from the array it already has cannot detect a truncated read, and a
    // truncated read produces an internally consistent record describing the
    // wrong knowledge base.
    counts: { pagesFetched: pageRowCount, ...counts },
    citationCounts: {
      citationsClaimed: claimed,
      citationsResolved: resolved,
      citationsRendered: rendered,
    },
    model,
    refused: refusedAll,
    truncatedRead,
  });
}

// The scope's own label for the prompt and the attachment notice. A page
// scope is named by its title; the root scope is named generically, and never
// by a page.
function scopeLabelFor(scopePageId, scopePages) {
  if (!scopePageId) return "this knowledge base";
  const self = scopePages.find((p) => p && p.id === scopePageId);
  const title = typeof self?.title === "string" ? self.title.trim() : "";
  return title ? `“${title}” and everything beneath it` : "this page and everything beneath it";
}

/**
 * The shared preamble both routes run before they are allowed to spend
 * anything: session, body, scope shape, engine, client, page load, scope
 * resolution. Returns either `{ response }` — already-final, hand it back — or
 * the loaded, resolved context.
 *
 * THE ORDER IS LOAD-BEARING. The engine gate and the key check run BEFORE any
 * data is loaded and before a client is constructed (the ordering
 * app/api/experience/research/route.js uses), so a user on the embedded engine
 * never pays for three Supabase reads to be told no. The scope 404 runs before
 * the stored-row read, so a caller cannot probe another user's page ids by
 * timing. Neither of those two refusals writes a row: they are runs that did
 * not run and cost nothing, and a `failed` row written for a misconfiguration
 * would suppress auto-generation forever after the configuration was fixed.
 */
export async function openScopeRequest(request, { embeddedRefusal, noKeyRefusal }) {
  const { supabase, userId } = await getAuth();
  if (!userId) return { response: unauthorized() };

  let body;
  try {
    body = await request.json();
  } catch {
    return { response: badRequest("Invalid JSON body.") };
  }

  const scope = readScopePageId(body?.scopePageId);
  if (!scope.ok) return { response: badRequest("Invalid scope.") };

  if (wantsEmbedded(body?.engine)) {
    return { response: Response.json({ error: embeddedRefusal }, { status: 503 }) };
  }

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return { response: Response.json({ error: noKeyRefusal }, { status: 503 }) };
  }

  const { pages, pageRowCount, truncatedRead, error: loadError } = await loadScopeInput(supabase, userId);
  // A FAILED READ IS NEVER AN EMPTY KNOWLEDGE BASE. Reporting it as one would
  // summarise "you have nothing" over a base that is merely unreachable.
  if (loadError) return { response: Response.json({ error: loadError }, { status: 500 }) };

  const { scopePages, scopeExists } = collectScopePages(pages, scope.scopePageId);
  // 404, NEVER 403, and the message never echoes the id: "that page is gone"
  // and "that page is not yours" must be one answer, or the error itself
  // becomes the enumeration oracle the status code was chosen to deny.
  if (!scopeExists) return { response: notFound("That page could not be found.") };

  return {
    supabase,
    userId,
    body,
    client,
    model,
    scopePageId: scope.scopePageId,
    scopeKey: scopeKeyFor(scope.scopePageId),
    pages,
    pageRowCount,
    truncatedRead,
    scopePages,
    scopeLabel: scopeLabelFor(scope.scopePageId, scopePages),
  };
}

// GET — one round trip on panel mount. A READ, NEVER A WRITE: this feature
// introduces no GET that writes, which is the one request shape SameSite=Lax
// does not cover.
export async function GET(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const url = new URL(request.url);
  const scope = readScopePageId(url.searchParams.get("scopePageId"));
  if (!scope.ok) return badRequest("Invalid scope.");
  const scopeKey = scopeKeyFor(scope.scopePageId);

  const [{ summary, error: summaryError }, { questions, hasMore, error: questionsError }] = await Promise.all([
    getSummary(supabase, userId, scopeKey),
    listQuestions(supabase, userId, scopeKey, { limit: QUESTION_PAGE_SIZE }),
  ]);

  // Both reads 500 on error rather than degrading to "nothing here". A failed
  // read presented as an empty scope is what makes the client's durable
  // auto-generation gate — the stored row's existence — fire a paid call.
  if (summaryError) return Response.json({ error: summaryError }, { status: 500 });
  if (questionsError) return Response.json({ error: questionsError }, { status: 500 });

  return Response.json({ summary: summary || null, questions: questions || [], hasMore: !!hasMore });
}

// POST — generate / regenerate one scope's summary.
export async function POST(request) {
  const opened = await openScopeRequest(request, {
    embeddedRefusal: EMBEDDED_REFUSAL,
    noKeyRefusal: NO_KEY_REFUSAL,
  });
  if (opened.response) return opened.response;

  const {
    supabase,
    userId,
    body,
    client,
    model,
    scopePageId,
    scopeKey,
    pageRowCount,
    truncatedRead,
    scopePages,
    scopeLabel,
  } = opened;
  const force = body?.force === true;

  // THE SPEND GATE, and it reads the ERROR as well as the row. A failed cache
  // read is not a cache miss: reading only `summary` would make a transient
  // PostgREST failure indistinguishable from "no summary yet" and bill a full
  // model call on every view until the read recovered. It runs BEFORE the
  // block is built, whose synchronous pass is 239 ms p95 at 5000 pages.
  //
  // Only a `ready` row short-circuits. A `failed` row does not: the durable
  // suppression of AUTO-generation is the row's EXISTENCE, which the client
  // learns from the GET above, and an explicit regenerate must always be able
  // to retry a scope that failed.
  const { summary: existing, error: readError } = await getSummary(supabase, userId, scopeKey);
  if (readError) return Response.json({ error: readError }, { status: 500 });
  if (existing && existing.status === "ready" && !force) {
    return Response.json({ summary: existing, cached: true });
  }

  const built = buildScopeContext({ scopePages, query: "", scopeLabel });
  const counts = built.counts;

  const writeFailure = (message, modelRecord, extra = {}) =>
    finishSummary({
      supabase,
      userId,
      scopePageId,
      scopeKey,
      modelName: model,
      status: "failed",
      summary: "",
      sourcePages: built.sourcePages,
      outcome: outcomeFor({ counts, pageRowCount, truncatedRead, model: modelRecord, ...extra }),
      error: message,
      httpStatus: 502,
    });

  // A NON-ZERO INPUT BECOMING A ZERO OUTPUT IS A REPORTABLE ANOMALY, not a
  // normal empty — and buildKnowledgeBaseBlock returns a byte-identical object
  // for three different causes (an empty scope, a forgotten `isEligible`, an
  // all-ineligible scope). Refusing here spends nothing and stores the stage
  // that ate everything.
  if (counts.pagesInScope > 0 && counts.pagesIncluded === 0) {
    return writeFailure(FAILURE.ZERO_OUT, { called: false, responseTextKind: null, finishReason: null, blockReason: null, envelopeParsed: null, answerChars: 0 });
  }

  // A genuinely empty scope: the input was zero, so the output being zero is
  // not an anomaly and there is nothing to summarise. It still WRITES A ROW —
  // `ready`, with an empty summary — because the auto-generation gate is the
  // row's existence, and a scope that never writes one re-fires on every view
  // forever.
  if (counts.pagesInScope === 0) {
    return finishSummary({
      supabase,
      userId,
      scopePageId,
      scopeKey,
      modelName: model,
      status: "ready",
      summary: "",
      sourcePages: built.sourcePages,
      outcome: outcomeFor({
        counts,
        pageRowCount,
        truncatedRead,
        model: { called: false, responseTextKind: null, finishReason: null, blockReason: null, envelopeParsed: null, answerChars: 0 },
      }),
      error: null,
      generatedAt: new Date().toISOString(),
      httpStatus: 200,
    });
  }

  const prompt = buildScopeSummaryPrompt({
    block: built.block,
    scopeLabel,
    pagesInScope: counts.pagesInScope,
    pagesIncluded: counts.pagesIncluded,
  });

  let response;
  try {
    response = await callKnowledgeModel({ client, model, prompt });
  } catch (err) {
    // The transport's own message is NOT stored and NOT returned — it is a
    // string this app did not author. The server log keeps it.
    console.error(`[knowledge] summary model call failed for scope ${scopeKey}:`, err);
    return writeFailure(FAILURE.MODEL_CALL, {
      called: true,
      responseTextKind: null,
      finishReason: null,
      blockReason: null,
      envelopeParsed: null,
      answerChars: 0,
    });
  }

  // BRANCH ON THE TYPE BEFORE COERCING, and test for emptiness BEFORE parsing.
  // parseAnswerEnvelope collapses six distinct inputs to one failure, so an
  // emptiness test on its RETURN value would report "the model said nothing"
  // as "the model wrote prose" and the finish reason would explain nothing.
  const read = readModelText(response);
  const baseModelRecord = {
    called: true,
    responseTextKind: read.kind,
    finishReason: read.finishReason,
    blockReason: read.blockReason,
    envelopeParsed: null,
    answerChars: 0,
  };
  if (read.kind !== "text") {
    return writeFailure(read.kind === "missing" ? FAILURE.NO_TEXT_PART : FAILURE.EMPTY_TEXT, baseModelRecord);
  }

  // Parsing, residue removal and the terminal proof all sit here rather than
  // outside a try, so a vendor shape change lands on the failure path and
  // WRITES A ROW instead of escaping as a 500 that leaves none.
  let parsed;
  let cleaned;
  try {
    parsed = parseAnswerEnvelope(read.text);
    if (!parsed.ok) {
      return writeFailure(FAILURE.ENVELOPE, { ...baseModelRecord, envelopeParsed: parsed.reason });
    }
    cleaned = cleanModelMarkdown(parsed.answer);
  } catch (err) {
    console.error(`[knowledge] summary post-processing failed for scope ${scopeKey}:`, err);
    return writeFailure(FAILURE.ENVELOPE, { ...baseModelRecord, envelopeParsed: "not-json" });
  }

  if (!cleaned.proven) {
    return writeFailure(FAILURE.RESIDUE, { ...baseModelRecord, envelopeParsed: parsed.reason }, { residueRemoved: cleaned.removed });
  }

  // The summary prompt never asks for citations, so the citation chain is
  // legitimately all zeros here. It is recorded anyway, as its own chain, so
  // the two row shapes stay comparable.
  const citations = resolveCitedPageIds(parsed.citedPageIds, built.includedPageIds);

  return finishSummary({
    supabase,
    userId,
    scopePageId,
    scopeKey,
    modelName: model,
    status: "ready",
    summary: cleaned.cleaned,
    sourcePages: built.sourcePages,
    outcome: outcomeFor({
      counts,
      pageRowCount,
      truncatedRead,
      claimed: citations.claimed,
      resolved: citations.resolved,
      rendered: citations.citations.length,
      refused: citations.refused,
      residueRemoved: cleaned.removed,
      model: { ...baseModelRecord, envelopeParsed: parsed.reason, answerChars: cleaned.cleaned.length },
    }),
    error: null,
    generatedAt: new Date().toISOString(),
    httpStatus: 200,
  });
}

// The one place a summary row is written, on EVERY path.
//
// `summary`, `source_pages`, `retrieval_outcome` and `generated_at` move
// together as one generation — the upsert is column-wise, so an omitted key
// keeps its stored value and a write that mixed them would attach fresh prose
// to a previous run's derived data. `generated_at` is the deliberate
// exception: it is passed ONLY on a successful generation, so a failure write
// leaves the last successful generation time standing while `updated_at`
// keeps its honest "row last written" meaning.
//
// A FAILED FAILURE-WRITE IS THE ONE STATE THAT LEAVES NO ROW, which is exactly
// the state that re-arms a paid call on every view forever. It gets a
// console.error naming the scope key — never the summary, never a question —
// because that is the line a 2am ticket is about.
async function finishSummary({
  supabase,
  userId,
  scopePageId,
  scopeKey,
  modelName,
  status,
  summary,
  sourcePages,
  outcome,
  error,
  generatedAt,
  httpStatus,
}) {
  const payload = {
    scopePageId,
    summary,
    source_pages: sourcePages,
    retrieval_outcome: outcome,
    // The model NAME, and null when no call was made at all — so a row can
    // never claim a model produced something no model was asked for.
    model: outcome?.model?.called ? modelName : null,
    engine: "gemini",
    status,
    error,
  };
  if (generatedAt) payload.generated_at = generatedAt;

  const { summary: row, error: writeError } = await upsertSummary(supabase, userId, payload);
  if (writeError) {
    console.error(`[knowledge] could not write the summary row for scope ${scopeKey}: ${writeError}`);
    return Response.json({ error: "Could not save this summary." }, { status: 500 });
  }
  if (httpStatus === 200) return Response.json({ summary: row });
  return Response.json({ error, summary: row }, { status: httpStatus });
}
