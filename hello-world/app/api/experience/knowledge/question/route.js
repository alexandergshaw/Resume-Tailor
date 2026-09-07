import { getAuth, unauthorized, badRequest } from "@/lib/experience/apiAuth";
import { insertQuestion, deleteQuestion, clearQuestions } from "@/lib/supabase/experienceKnowledge";
import { scopeKeyFor, resolveCitedPageIds } from "@/lib/experience/knowledgeScope";
import { buildScopeAnswerPrompt, parseAnswerEnvelope } from "@/lib/experience/knowledgePrompts";
import {
  openScopeRequest,
  buildScopeContext,
  callKnowledgeModel,
  readModelText,
  cleanModelMarkdown,
  outcomeFor,
  readScopePageId,
} from "../route.js";

export const runtime = "nodejs";
export const maxDuration = 60;

// Re-exported so a test can assert this route holds the SAME FUNCTION OBJECT
// as the summary route rather than an equivalent-looking copy — the identity
// check is the only thing that can catch a later "small local version" of the
// empty-versus-refusal rule being introduced here.
export { readModelText };

// EVERYTHING SHARED WITH THE SUMMARY ROUTE IS IMPORTED, NOT RESTATED —
// `openScopeRequest` (session, body, scope shape, engine gate, key check, page
// load, the 404-never-403 scope resolution), `callKnowledgeModel` (the
// one-argument call and its measured per-call timeout), `readModelText` (the
// five-causes-one-value branch), `cleanModelMarkdown` (residue plus the
// terminal proof) and `outcomeFor` (the two count chains). The two routes
// share an engine gate, an auth shape, a status vocabulary and a
// retrieval_outcome builder, and a second copy of any of them would be green
// against its own tests while disagreeing with the first — the exact "second
// recogniser" defect the shared-seam wave exists to close.
//
// The precedent for a route module exporting a non-handler symbol so a sibling
// can share the FUNCTION OBJECT rather than a copy of it is
// app/api/experience/research/route.js, which re-exports extractGroundingSources
// for the same stated reason.

// The draft the client is allowed to hold is capped at 2000 characters, so a
// longer body is a caller that bypassed the field rather than a user who typed
// too much. Refused rather than truncated: silently answering a different
// question from the one that was asked is worse than saying no.
const MAX_QUESTION_CHARS = 2000;

const EMBEDDED_REFUSAL =
  "Answering from your pages needs the Gemini engine. Switch off the embedded engine and try again.";
const NO_KEY_REFUSAL = "Answering from your pages needs the Gemini API key to be configured.";

const FAILURE = Object.freeze({
  MODEL_CALL: "The model call did not complete.",
  NO_TEXT_PART: "The model returned no text at all.",
  EMPTY_TEXT: "The model returned an empty text response.",
  ENVELOPE: "The model's reply was not in the expected format.",
  RESIDUE: "The model's reply contained links that could not be removed safely.",
  ZERO_OUT: "No page in this scope could be included in the model's context.",
});

const NEVER_CALLED = Object.freeze({
  called: false,
  responseTextKind: null,
  finishReason: null,
  blockReason: null,
  envelopeParsed: null,
  answerChars: 0,
});

// POST — one grounded answer over one scope. Rows here are APPENDED, never
// upserted: the history is intentionally many-valued, and there is deliberately
// NO stored-row spend gate, because every ask is a new ask the user just made.
export async function POST(request) {
  const opened = await openScopeRequest(request, {
    embeddedRefusal: EMBEDDED_REFUSAL,
    noKeyRefusal: NO_KEY_REFUSAL,
  });
  if (opened.response) return opened.response;

  const { supabase, userId, body, client, model, scopePageId, scopeKey, pageRowCount, truncatedRead, scopePages, scopeLabel } =
    opened;

  const raw = typeof body?.question === "string" ? body.question : "";
  const question = raw.trim();
  // The refusal never echoes the question back. It is the one string in this
  // pipeline that exists nowhere else — not in the pages, not in the answer —
  // so it does not travel into an error body, a log line or the downloadable
  // log.
  if (question === "") return badRequest("Missing question.");
  if (question.length > MAX_QUESTION_CHARS) return badRequest("That question is too long.");

  const built = buildScopeContext({ scopePages, query: question, scopeLabel });
  const counts = built.counts;

  const writeRow = ({ status, answer, citations, answeredFromPages, error, outcome, httpStatus }) =>
    finishQuestion({
      supabase,
      userId,
      scopePageId,
      scopeKey,
      modelName: model,
      question,
      answer,
      citations,
      answeredFromPages,
      status,
      error,
      outcome,
      httpStatus,
    });

  const failure = (message, modelRecord, extra = {}) =>
    writeRow({
      status: "failed",
      answer: "",
      citations: [],
      // NULL, NEVER FALSE. `false` is the model's own explicit "I cannot
      // answer from these pages" — a verdict. A run that failed before the
      // model gave one has no verdict to report, and reporting `false` would
      // invent a fact about the user's knowledge base out of a transport
      // error.
      answeredFromPages: null,
      error: message,
      outcome: outcomeFor({ counts, pageRowCount, truncatedRead, model: modelRecord, ...extra }),
      httpStatus: 502,
    });

  // Same refusal as the summary path, for the same reason: a non-zero input
  // becoming a zero output is a reportable anomaly, and calling the model with
  // an empty block would spend money to be told nothing is there.
  if (counts.pagesIncluded === 0) {
    return failure(FAILURE.ZERO_OUT, NEVER_CALLED);
  }

  const prompt = buildScopeAnswerPrompt({ block: built.block, scopeLabel, question });

  let response;
  try {
    response = await callKnowledgeModel({ client, model, prompt });
  } catch (err) {
    console.error(`[knowledge] answer model call failed for scope ${scopeKey}:`, err);
    return failure(FAILURE.MODEL_CALL, { ...NEVER_CALLED, called: true });
  }

  const read = readModelText(response);
  const baseModelRecord = {
    called: true,
    responseTextKind: read.kind,
    finishReason: read.finishReason,
    blockReason: read.blockReason,
    envelopeParsed: null,
    answerChars: 0,
  };
  // Emptiness is tested HERE, on response.text, before the parser — which
  // collapses six distinct inputs to one failure and would report "the model
  // said nothing" as "the model wrote prose".
  if (read.kind !== "text") {
    return failure(read.kind === "missing" ? FAILURE.NO_TEXT_PART : FAILURE.EMPTY_TEXT, baseModelRecord);
  }

  let parsed;
  let cleaned;
  let citations;
  try {
    parsed = parseAnswerEnvelope(read.text);
    if (!parsed.ok) {
      return failure(FAILURE.ENVELOPE, { ...baseModelRecord, envelopeParsed: parsed.reason });
    }
    cleaned = cleanModelMarkdown(parsed.answer);
    // CITATIONS RESOLVE BY PAGE ID, AGAINST THE EXACT WHITELIST OF PAGES THIS
    // GENERATION'S PROMPT ACTUALLY CONTAINED — never by index, never against
    // source_pages (which holds the ineligible pages the model was never
    // shown), never against the live tree.
    citations = resolveCitedPageIds(parsed.citedPageIds, built.includedPageIds);
  } catch (err) {
    console.error(`[knowledge] answer post-processing failed for scope ${scopeKey}:`, err);
    return failure(FAILURE.ENVELOPE, { ...baseModelRecord, envelopeParsed: "not-json" });
  }

  if (!cleaned.proven) {
    return failure(FAILURE.RESIDUE, { ...baseModelRecord, envelopeParsed: parsed.reason }, { residueRemoved: cleaned.removed });
  }

  return writeRow({
    status: "ready",
    answer: cleaned.cleaned,
    citations: citations.citations,
    answeredFromPages: parsed.answeredFromPages,
    error: null,
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
    httpStatus: 200,
  });
}

// DELETE — one row by id, or a whole scope's history.
//
// Both are scoped by the SESSION user, on top of RLS. Neither reads the
// caller's own `user_id`.
export async function DELETE(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const id = typeof body?.id === "string" && body.id.trim() !== "" ? body.id.trim() : null;
  if (id) {
    const { error } = await deleteQuestion(supabase, userId, id);
    if (error) return Response.json({ error }, { status: 500 });
    return Response.json({ deleted: 1 });
  }

  if (body?.all === true) {
    const scope = readScopePageId(body?.scopePageId);
    if (!scope.ok) return badRequest("Invalid scope.");
    const { cleared, error } = await clearQuestions(supabase, userId, scopeKeyFor(scope.scopePageId));
    if (error) return Response.json({ error }, { status: 500 });
    return Response.json({ cleared });
  }

  // Neither one row nor a whole scope. Refused rather than guessed at: the
  // guess that would be "convenient" here is clearing everything.
  return badRequest("Nothing to delete.");
}

// The one place a question row is written, on EVERY path that got as far as a
// validly-asked question — success, model failure, unparsable envelope,
// residue refusal and the never-called zero-out alike. A failed attempt that
// vanished would leave the history looking like the question was never asked.
//
// A FAILED WRITE gets a console.error naming the SCOPE KEY and nothing else:
// not the question, not the answer.
async function finishQuestion({
  supabase,
  userId,
  scopePageId,
  scopeKey,
  modelName,
  question,
  answer,
  citations,
  answeredFromPages,
  status,
  error,
  outcome,
  httpStatus,
}) {
  const { question: row, error: writeError } = await insertQuestion(supabase, userId, {
    scopePageId,
    question,
    answer,
    citations,
    // Three states, written explicitly: true, false and null are all real and
    // distinct, and a whitelist gated on truthiness would silently drop the
    // model's own "no".
    answered_from_pages: answeredFromPages,
    retrieval_outcome: outcome,
    model: outcome?.model?.called ? modelName : null,
    engine: "gemini",
    status,
    error,
  });

  if (writeError) {
    console.error(`[knowledge] could not write the question row for scope ${scopeKey}: ${writeError}`);
    return Response.json({ error: "Could not save this question." }, { status: 500 });
  }
  if (httpStatus === 200) return Response.json({ question: row });
  return Response.json({ error, question: row }, { status: httpStatus });
}
