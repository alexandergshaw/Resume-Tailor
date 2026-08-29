import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { pointsFromPartialJson } from "@/lib/copilot/answerStream";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { draftAnswerLocal, deriveAnswerFromPoints } from "@/lib/copilot/answerLocal";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal";
// The two system instructions and the three prompt builders, moved to
// lib/copilot/answerPrompts.js purely to keep this file under the project's
// 1000-line cap — see that module's own header. They are pure string
// assembly and are imported back unchanged; nothing about either prompt
// moved with them.
import {
  POINTS_SYSTEM,
  ANSWER_SYSTEM,
  buildPointsPrompt,
  buildAnswerPrompt,
} from "@/lib/copilot/answerPrompts";
// normalizeModelPoints/generateIdealProjectExample/answerAids, moved to
// lib/copilot/answerAids.js for the identical reason answerPrompts.js was
// split out of this same file earlier — see that module's own header, and
// this one's.
import { normalizeModelPoints, generateIdealProjectExample, answerAids } from "@/lib/copilot/answerAids";
import { normalizeInterviewType, interviewType } from "@/lib/copilot/interviewTypes";
import { deriveCues, resolveCues } from "@/lib/copilot/answerCues";
import {
  buildKnowledgeBaseBlock,
  stripLinePrefixes,
  noAttachmentBytesNotice,
} from "@/lib/experience/knowledgeBase";
import { resolvePageSources } from "@/lib/copilot/pageCitations";
import { selectBestStory, isEligiblePage } from "@/lib/copilot/projectStories";
import { resolveFactSources } from "@/lib/copilot/factCitations";
// AC-V5.2/C7/C8 (Group V architecture doc): the per-session Supabase fan-out
// — résumé/cover letter/posting/employer/pages — its cache key, and its
// `answerContextCache` wiring live in their own module for the same reason
// answerPrompts.js/answerAids.js were split out of this file earlier — see
// that module's own header for what it deliberately does and does not cache.
import { answerContextKey, loadAnswerContext } from "@/lib/copilot/answerContext";
// AC-V4 (Group V record, Evidence D / architecture doc §2): the
// verified-company-facts search — its two gates, its eager start, and its
// bounded wait — lives in its own module for the identical reason. See that
// module's own header for the ordering constraints it exists to protect.
import { startCompanyFacts, resolveCompanyFacts } from "@/lib/copilot/answerCompanyFacts";
// The recruiter-vocabulary gate and its per-engine honesty flag
// (recruiter-vocab design, revision 3, §4c/§4d), the latter moved to its own
// module (lib/copilot/roleTermsFlag.js) for the same reason — see that
// module's own header for why it exports two functions rather than one.
// `question` is untrusted, third-party input — machine-transcribed
// interviewer speech in live mode — so it is capped with the SAME constant
// `roleTerms` itself caps against, rather than a private one here, so "how
// long a question this route accepts" and "how long a question the gate will
// look at" can never drift apart.
import { roleTerms, MAX_QUESTION_CHARS } from "@/lib/copilot/questionVocabulary";
import { geminiRoleTermsFlag, embeddedRoleTermsFlag } from "@/lib/copilot/roleTermsFlag";
import { normalizeCodeLanguageChoice } from "@/lib/copilot/codeLanguages";
import { startCodeLanguageResolution, peekCodeLanguage } from "@/lib/copilot/answerCodeLanguage";

// Two modes on one route (AC-G2-D-1). "points" (default, and the only mode
// live mode ever sends — CopilotClient/QuestionFeed call draftAnswer with no
// mode at all) keeps today's glanceable bullet points, grounded in the
// candidate's prep context and, once a posting with submitted documents is
// selected, the résumé and cover letter actually submitted for it (AC-H4) —
// never the posting description (AC-H7.27). "answer" is practice mode's
// sample answer: bullet points, each a complete sentence a candidate could
// actually say out loud, sized to the interview type's length target and
// STAR-labeled for a behavioral/leadership shape (AC-H9) — grounded in their
// prep notes and the résumé/cover letter they actually submitted for the
// selected application (lib/copilot/applicationDocs.js). An unknown or
// missing mode is always treated as "points" — nothing about live mode's
// REQUEST shape changes.
//
// AC-K1: both modes now also return reading aids alongside the answer,
// because both are read under exactly the same pressure — mid-question, in
// one glance:
//   cues         one short prompt per point (lib/copilot/answerCues.js). The
//                full `points` are unchanged and still what `answer` is
//                derived from; the cues are what the UI actually renders.
//   buzzwords    terms from the posting the candidate should work in
//                (lib/copilot/postingBuzzwords.js). The posting description
//                feeds THIS and nothing else — it still never reaches either
//                prompt (AC-H7.27).
//   resumeAnchor which of their own roles the answer came out of, and a
//                project from it (lib/copilot/resumeAnchor.js).
//   idealProject the kind of project a recruiter for THIS posting would
//                consider ideal, and the metrics they'd want to hear — a
//                BENCHMARK, never a claim (lib/copilot/idealProject.js). Same
//                posting-description-only input as `buzzwords`; never reaches
//                either prompt either. AC-N3: on the Gemini path, `project`
//                inside it is now the MODEL'S OWN worked example when one
//                survives lib/copilot/idealProjectPrompt.js's validator —
//                idealProject.js's hand-authored archetype is the fallback,
//                not the answer, for every other case (embedded engine, no
//                posting, a network error, a malformed or rejected
//                response). See answerAids' own comment, in
//                lib/copilot/answerAids.js.
// This is the one part of the response shape that did move for live mode: it
// gained keys, and every existing key kept its meaning.

const MAX_CONTEXT_CHARS = 4000;
const MAX_PROFILE_CHARS = 8000;
// AC-2.1: parity with the résumé, not a fraction of it. At the old 6000-char
// budget (minus its own notice reserve) two 2800-char pages exhausted the
// whole knowledge base while the résumé got 12000 and the posting got
// 20000 — the candidate's own project pages are the PRIMARY evidence for a
// behavioral/leadership answer (AC-3.1), so they get at least what the
// résumé gets. (The résumé/cover-letter/posting caps themselves now live in
// lib/copilot/answerContext.js, beside the fetches they cap — this one stays
// here because it bounds `kb`, below, not anything answerContext.js loads.)
const MAX_PAGES_CHARS = 12000;
const MAX_ANSWER_CHARS = 6000;
const MAX_ANSWER_POINTS = 6;
const MAX_APPLICATION_ID_CHARS = 100;
const VALID_TYPES = ["behavioral", "technical", "general"];

// AC-P2.3-P2.5: the streaming half of this route — Gemini only (the embedded
// branch never reaches this; see POST's own stream-flag check) and an
// ADDITION to the route, not a rewrite: the prompt builders, system
// instructions, cues/answer derivation and answerAids (imported above, from
// lib/copilot/answerAids.js) are the exact same functions the non-streaming
// branches call, so the two can never drift on what an answer IS, only on
// how it's delivered.
//
// Wraps a NDJSON body around `producer`, which writes `{t:"points",...}` /
// `{t:"done",...}` / `{t:"error",...}` frames via `write`.
//
// WHAT THIS DOES AND DOES NOT PROMISE. `ReadableStream` calls `start()`
// synchronously from its own constructor and does not await it, so this
// function returns its Response as soon as `producer` reaches its first
// await: the CONNECTION opens immediately, with no posting lookup and no
// worked-example call ahead of it. That is the whole of the guarantee. It
// says nothing about when the first `points` frame arrives, and the caller
// is what decides that — `streamAnswer` deliberately does its
// company-facts wait (up to lib/copilot/answerCompanyFacts.js's deadline)
// inside the producer.
//
// The sentence this replaces claimed the first points frame "is never sat
// behind anything but the model call itself". That stopped being true the
// moment AC-V4's facts deadline was awaited in POST, ahead of the
// stream-vs-not branch — by up to 2.5s, on the request a candidate is
// actively staring at. Moving the wait in here is what makes the connection
// half true again; overstating the frame half is what let the regression go
// unnoticed, so the two are now stated apart.
function ndjsonResponse(producer) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (frame) => controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      try {
        await producer(write);
      } catch (err) {
        // Safety net only — `producer` below already catches its own
        // failures and writes an `error` frame itself. This guards against a
        // bug in producer leaving the stream open with no terminal frame.
        write({ t: "error", error: err?.message || "Answer request failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

// Streams the Gemini call for either mode, emitting a `points` frame every
// time pointsFromPartialJson reports a longer prefix than the last one sent
// (so every frame is a strict superset of the one before it), then a single
// terminal `done` (full payload, same shape the non-streaming branch
// returns) or `error` frame.
//
// AC-N3/AC-P3.2: the Gemini-generated worked example (generateIdealProject
// Example) normally rides ALONGSIDE the main call so its latency is the
// slower of the two requests, not their sum — but here there is no later
// point in the wire protocol for it to land on without either blocking the
// first points frame on it (forbidden, see this route's own streaming
// tests) or inventing a THIRD frame type nothing downstream reads. The
// streaming path settles for the same deterministic idealProjectFor()
// result every OTHER failure mode of that call already falls back to
// (no posting, a network error, a rejected response) — never the
// Gemini-enriched one. See this function's own report for why.
async function streamAnswer({
  mode,
  question,
  context,
  profile,
  descriptor,
  resume,
  coverLetter,
  posting,
  grounding,
  story,
  kb,
  // §B.8: `{ override, resolved } | undefined` — computed once in POST (the
  // peek that started it lives there too) and handed down unchanged, exactly
  // like `questionRoleTerms` below.
  codeLanguage,
  // §4d: this route's own gate, computed once in POST from the (already
  // capped) question and handed down — streamAnswer is Gemini-only, so the
  // role-terms flag below always gets `geminiRoleTermsFlag` with `kb.block`
  // as its `pagesBlock`.
  questionRoleTerms,
  // AC-V4/AC-V5.4: `awaitCompanyFacts` is a THUNK (or null), not a settled
  // result. POST starts the search and hands the WAIT over unresolved,
  // because awaiting it there put the facts deadline — 2.5s — in front of
  // the response itself, first streamed bullet included. Settled below, inside
  // the producer, so the connection is already open by the time anything
  // waits on it. Null for answer mode and whenever no employer is known:
  // POST only ever builds facts for points mode (V4.3's own scoping —
  // buildAnswerPrompt is untouched), so `isAnswerMode` below never sees a
  // truthy `companyFacts` in practice, but nothing here assumes that; it is
  // simply never given one.
  awaitCompanyFacts,
}) {
  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();
  const isAnswerMode = mode === "answer";
  const systemInstruction = isAnswerMode ? ANSWER_SYSTEM : POINTS_SYSTEM;
  const pointsCap = isAnswerMode ? MAX_ANSWER_POINTS : 6;

  return ndjsonResponse(async (write) => {
    // The facts wait, and the prompt build that depends on it. Both are
    // INSIDE the producer deliberately: everything above this line is
    // synchronous, so `ndjsonResponse` returns its Response before any of
    // this runs and the client has an open connection while the deadline
    // (at most) elapses. See lib/copilot/answerCompanyFacts.js's own header
    // for why the wait belongs here and not in a shared prologue.
    const { facts, companyFacts } = await resolveCompanyFacts(awaitCompanyFacts);
    const promptText = isAnswerMode
      ? buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor, pagesBlock: kb.block, codeLanguage })
      : buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter, kb.block, companyFacts, codeLanguage);

    let stream;
    try {
      stream = await client.models.generateContentStream({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        // AC-V5.1: this is the streaming points call — the path a candidate
        // is actively staring at mid-interview (Group V record, Evidence E).
        // `gemini-2.5-flash` defaults to DYNAMIC THINKING, which burns time
        // before the first token even though the response is a fixed JSON
        // shape that needs no reasoning chain to produce. Verified against
        // Google's own documentation for the Generate Content API this route
        // calls (client.models.generateContentStream):
        // https://ai.google.dev/gemini-api/docs/generate-content/thinking —
        // `config.thinkingConfig.thinkingBudget`, range 0-24576 for this
        // model, 0 documented as turning thinking off and reducing latency.
        // The newer Interactions API's `thinking_level` is a DIFFERENT API
        // with no "off" value for this model; do not substitute it here.
        // Deliberately scoped to THIS call only — the non-streaming
        // generateContent calls below (practice/"answer" mode) are left
        // exactly as they are, per the record's own scoping of AC-V5.1.
        config: { systemInstruction, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      });
    } catch (err) {
      write({ t: "error", error: err?.message || "Could not generate an answer." });
      return;
    }

    let raw = "";
    let lastCount = 0;
    try {
      for await (const chunk of stream) {
        raw += chunk?.text || "";
        const partial = pointsFromPartialJson(raw);
        if (partial.length > lastCount) {
          lastCount = partial.length;
          write({ t: "points", points: partial });
        }
      }
    } catch (err) {
      write({ t: "error", error: err?.message || "Could not generate an answer." });
      return;
    }

    const parsed = parseModelJson(raw.trim());
    const { points, pageIds, factIds } = normalizeModelPoints(parsed, pointsCap);
    if (points.length === 0) {
      write({ t: "error", error: "Could not generate an answer." });
      return;
    }
    const type = VALID_TYPES.includes(parsed?.type) ? parsed.type : "general";
    const aids = await answerAids({ postingDescription: posting, resume, profile, question, points, story });
    // AC-6.2/§4e: `pageSources` rides the `done` frame ONLY — the same rule
    // `cues`/`buzzwords`/`resumeAnchor`/`idealProject` already follow on this
    // path — for BOTH modes now (points mode gained it alongside its own
    // `pageIds` prompt request; see buildPointsPrompt). Never on the
    // incremental `points` frames above: a citation cannot be resolved from
    // a partial points array, since resolvePageSources' pairing is
    // all-or-nothing on length, so emitting one early would be a guess.
    const pageSources = resolvePageSources(pageIds, { includedPages: kb.includedPages, pointCount: points.length });
    // AC-V4.4: `factSources` follows the identical "terminal frame only"
    // rule, and is included at all ONLY when `companyFacts` was actually
    // computed for this request — i.e. points mode, Gemini engine, employer
    // known. Omitted entirely (not even as `[]`) otherwise, so a caller that
    // never asked about a company sees exactly the response shape it always
    // has.
    // §4d: Gemini path, so this is always `geminiRoleTermsFlag` with
    // `kb.block` — the pages actually put in this prompt (streamAnswer never
    // runs for the embedded engine; see POST's own stream-flag check).
    const roleTermsFlag = geminiRoleTermsFlag({
      terms: questionRoleTerms,
      points,
      profile,
      resume,
      coverLetter,
      pagesBlock: kb.block,
    });
    const done = isAnswerMode
      ? {
          points,
          cues: resolveCues(parsed?.cues, points),
          answer: deriveAnswerFromPoints(points).slice(0, MAX_ANSWER_CHARS),
          type,
          grounding,
          pageSources,
          ...aids,
          ...roleTermsFlag,
        }
      : {
          points,
          cues: deriveCues(points),
          type,
          pageSources,
          ...(companyFacts
            ? { factSources: resolveFactSources(factIds, { includedFacts: facts, pointCount: points.length }) }
            : {}),
          ...aids,
          ...roleTermsFlag,
        };
    write({ t: "done", ...done });
  });
}

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user } = {},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return Response.json(
        { error: "Sign in to use the interview copilot." },
        { status: 401 },
      );
    }

    const body = await request.json();
    // AC-4.1 (recruiter-vocab design, revision 3, §8.7): capped here, at the
    // one place every branch below reads `question` from — this used to be
    // the only unbudgeted string on this path (no `.slice()`, unlike
    // context/profile/resume/coverLetter/posting just below), sitting at
    // character 0 of both prompt builders ahead of a 12,000-character
    // knowledge base and a 12,000-character résumé. In live mode it is
    // machine-transcribed interviewer speech, so an uncapped question is
    // reachable by a transcription runaway, not just a hostile caller.
    //
    // ITEM 9 OF THE ADVERSARIAL REVIEW, DOCUMENTED RATHER THAN CHANGED: this
    // cap applies before EVERY consumer of `question` below, not only the two
    // prompt builders it was introduced for. A question longer than
    // MAX_QUESTION_CHARS silently loses its tail — mid-word, wherever the cap
    // lands — for every one of these, not just the prompt:
    //   rankingQuery       (below) — the KB relevance query; a term past the
    //                        cap cannot promote or demote a page.
    //   selectBestStory    (below) — the embedded story picker; a term past
    //                        the cap cannot win or lose the honesty gate.
    //   isCompanyDirected  (lib/copilot/answerCompanyFacts.js, inside the
    //                        thunk `startCompanyFacts` below returns) —
    //                        whether this question waits on the facts search
    //                        at all.
    //   answerAids         (idealProject/resumeAnchor/buzzwords all take the
    //                        capped `question`) and `draftAnswerLocal`/
    //                        `draftSampleAnswerLocal` (the embedded drafters).
    // 2000 characters is a defensible number for a spoken interview question
    // (§8.7); the point recorded here is that the number's REACH is the whole
    // route, not a private budget for one prompt line, and a future reader
    // narrowing or relocating this cap should know every one of these moves
    // with it.
    const question = (body?.question ?? "").toString().trim().slice(0, MAX_QUESTION_CHARS);
    if (!question) {
      return Response.json({ error: "No question provided." }, { status: 400 });
    }
    // The gate (recruiter-vocab design §4c/§4d): the interviewer's own
    // taxonomy terms this question named, literally, and nothing else. Pure
    // and cheap enough to compute unconditionally on every request — never
    // gated on engine or mode, because `roleTermsUnbacked` below is computed
    // on every branch (embedded included; see that flag's own comment) even
    // though the PROMPT change it also gates (buildPointsPrompt/
    // buildAnswerPrompt, which re-derive this same value from `question`)
    // only ever takes effect on the Gemini path.
    const questionRoleTerms = roleTerms(question);
    const context = (body?.context ?? "").toString().slice(0, MAX_CONTEXT_CHARS);
    const profile = (body?.profile ?? "").toString().slice(0, MAX_PROFILE_CHARS);
    const interviewTypeValue = normalizeInterviewType(body?.interviewType);
    const descriptor = interviewType(interviewTypeValue);
    const mode = body?.mode === "answer" ? "answer" : "points";
    // AC-C24b: any client-supplied value normalizes to a stored slug before
    // it reaches the resolver's gate or the prompt below — never a bare
    // `"auto"` default and never the raw body value.
    const codeLanguageChoice = normalizeCodeLanguageChoice(body?.codeLanguage);
    // AC-H4.16: the route fetches the submitted documents ITSELF from
    // `applicationId` — any client-supplied resume/coverLetter field in the
    // request body is never read (there is nothing above that reads
    // `body.resume`/`body.coverLetter`), so a client cannot inject arbitrary
    // text labelled "submitted resume" into either prompt. Fetched once,
    // ahead of the mode branch, since both "points" (AC-H4) and "answer"
    // (AC-H9) ground in the same two documents; fetchApplicationDocs itself
    // short-circuits to empty docs (no Supabase round trip) when
    // `applicationId` is empty, so this costs nothing when no posting is
    // selected — the same case AC-H4.17/AC-H4.18's byte-identity guarantees
    // cover.
    const applicationId = (body?.applicationId ?? "").toString().trim().slice(0, MAX_APPLICATION_ID_CHARS);
    // AC-K1.2: the posting description is fetched alongside the documents but
    // through its OWN call, deliberately — see fetchPostingDescription's doc
    // in lib/copilot/applicationDocs.js. It is passed only to answerAids
    // below; no prompt builder in this file ever receives it.
    //
    // AC-V5.2 (Group V record, Evidence E): this fan-out — the documents, the
    // posting description, the employer name/title, and the caller's own
    // "Professional Experience" project pages plus their attachment
    // inventory — does not change during an interview, so it runs through
    // lib/copilot/answerContext.js's cache instead of on every question. The
    // cache key is computed HERE, after `supabase.auth.getUser()` above has
    // already resolved — never before, and never on the caller's access
    // token instead of the id it resolved to (see answerSessionCache.js's
    // own header on why auth.getUser() itself is never the thing being
    // cached). A cache miss (first question of a session, or a TTL expiry)
    // runs the module's Promise.all; a hit skips every one of its five
    // Supabase round trips.
    const contextCacheKey = answerContextKey(user.id, applicationId);
    const { resume, coverLetter, posting, employer, pages } = await loadAnswerContext(supabase, {
      userId: user.id,
      applicationId,
      cacheKey: contextCacheKey,
    });

    // AC-V4 (Group V record, Evidence D). "What do you know about Purple
    // Wave?" used to get answered with "My research indicates a strong
    // focus on continuous improvement" — an invented claim about a company
    // the model never researched. lib/copilot/answerCompanyFacts.js is the
    // fix; `startCompanyFacts` evaluates its own mode/engine/employer gates
    // before touching a Gemini client — see that module's own header. `null`
    // when this request builds no facts at all; otherwise a thunk that
    // resolves the surviving facts for THIS question, honouring the
    // deadline. *** THE SEARCH STARTS HERE; ONLY THE WAIT IS DEFERRED. ***
    // The wait used to be `await`ed right here, ahead of the `stream ===
    // true` branch below, which made the facts deadline a hard 2.5s ceiling
    // on the whole POST — including the first streamed bullet, on the one
    // question class (company-directed) this group was asked to speed up,
    // against a guaranteed-empty cache on question one. Handing the
    // streaming branch a thunk lets it open the connection first and wait
    // inside its own producer; see route.latency.test.js's AC-V4.6/V5.4
    // band, which asserts the ordering against a search that has not
    // settled rather than against a clock.
    const awaitCompanyFacts = startCompanyFacts({
      mode,
      engine: body?.engine,
      employer,
      question,
      cacheKey: contextCacheKey,
    });

    // The per-application code-language resolver (§D-31: its reasoning lives
    // in lib/copilot/answerCodeLanguage.js's own header, not here). Same
    // shape as the search just above — a different cache, the same call
    // site — started eagerly, never awaited, and PEEKED (never `|| fallback`)
    // so a cold cache costs this answer nothing (AC-C13). The four gates that
    // decide whether it does anything live inside that module, not here
    // (AC-C11b: `mode` is not one of them).
    startCodeLanguageResolution({
      engine: body?.engine,
      descriptor,
      override: codeLanguageChoice,
      applicationId,
      description: posting,
      title: employer?.title,
      cacheKey: contextCacheKey,
    });
    const codeLanguage = { override: codeLanguageChoice, resolved: peekCodeLanguage(contextCacheKey) };

    // AC-1.1/AC-1.5/ARCH §1.1/§6.6: the RANKING query is built from the
    // question plus the transcript context WITH ITS SPEAKER LABELS
    // STRIPPED — the model itself still sees the labelled context below,
    // unchanged. significantTerms tokenises /[a-z0-9]{4,}/, so an unstripped
    // "Them: ..." turns "them" into the single most frequent token in the
    // whole query and scores every page containing the word "them" above
    // zero. A poisoned ranking still returns pages — just the wrong ones —
    // which is exactly why this needs its own test rather than trusting
    // that a broken ranking would fail loudly (no other test would catch
    // it).
    const rankingQuery = `${question}\n${stripLinePrefixes(context)}`;
    const kb = buildKnowledgeBaseBlock({
      pages,
      query: rankingQuery,
      isEligible: isEligiblePage,
      budget: MAX_PAGES_CHARS,
      budgetLabel: "interview copilot's context budget",
      attachmentNotice: noAttachmentBytesNotice("this answer"),
    });

    // The embedded engine's own story picker (lib/copilot/projectStories.js's
    // selectBestStory), selected ONCE here and handed down to every
    // consumer below — the structural fix for D7's asymmetry (ARCH §3.6/§4e):
    // the deterministic builders' full-narrative override used to run
    // selectBestStory(pages, {question}) and answerAids' resumeAnchor
    // fallback ran a SECOND, separate selectBestStory(pages, {question,
    // points}) — two calls, two possible answers for one request. `points:
    // []` because this now runs before any points exist on every branch
    // (the embedded engine needs it to draft points at all). EVERY consumer
    // gates on `matched` being true — the deterministic builders (AC-5.2) and
    // answerAids' resumeAnchor fallback alike; see that fallback's own comment
    // for the aid that used to name an unmatched page anyway.
    const story = selectBestStory(pages, { question, points: [] });

    // Built HERE rather than beside `docs` above, because it needs both `kb`
    // and `story`.
    //
    // THE BUG THIS PREVENTS: `grounding` was exactly `{ resume, coverLetter }`
    // and was never widened when the knowledge base became a source, so
    // practice mode's SampleAnswer panel could print "From your Payments
    // migration page." above a caption reading "…from your prep context ONLY
    // — no submitted resume or cover letter was found for this posting." One
    // panel, two contradictory claims about one draft, the false one in the
    // smaller type.
    //
    // THE BUG THIS *ALSO* PREVENTS, which the first fix left standing:
    // `pages` was `kb.includedPages.length > 0` unconditionally, and the
    // EMBEDDED branch never reads `kb` at all. It drafts from `story`. So with
    // the embedded engine, one eligible page, and nothing from that page in
    // the answer, the caption still read "…and your own project pages." The
    // flag has to be derived from what the branch that actually answers USED,
    // and the two branches use two different mechanisms:
    //   Gemini:   the pages put into the prompt (`kb.includedPages`).
    //   Embedded: whether a drafted point actually carries page text
    //             (`pageSources`), which is why the embedded branches below
    //             build their own grounding AFTER drafting.
    //
    // THE BUG THIS PREVENTS IN TURN, because the embedded reading above was
    // `!!story?.matched` and that is still an over-claim: `matched` is the
    // gate on page SELECTION, not evidence that any page text reached the
    // answer. Every embedded consumer reads `story.bullets[0]` or
    // `starPointsFromStory`, and projectStories.js's bulletsFromBody mines
    // MARKDOWN BULLET LINES ONLY — so a page of plain prose yields
    // `bullets: []`. Verified:
    //
    //   Q: "Tell me about the payments migration you led."
    //   page: title "Payments migration", body three prose sentences, no bullets
    //   -> matched: true, bullets: 0, starPointsFromStory: null
    //
    // Zero page text in the answer, `pageSources` all-null, and the caption
    // still said "…and your own project pages." Prose-only pages are the
    // common case; bullet lists are the exception. Derived from the DRAFT
    // instead, which is true by construction.
    //
    // On the Gemini side this stays derived from `kb.includedPages` and never
    // from the `pageSources` the model returns: an answer can be grounded in
    // pages the model drew on without citing, and this flag is about what
    // went INTO the prompt, not what came back out of it. A caption that
    // under-claims is as wrong as one that over-claims — which is exactly why
    // the embedded side cannot borrow this reading, and the embedded side's
    // own reading cannot be borrowed back.
    // `resume`/`coverLetter` here are the already-sliced strings above, not
    // `answerContext`'s raw ones — truthiness is unaffected by the slice
    // (MAX_RESUME_CHARS/MAX_COVER_LETTER_CHARS are both far larger than
    // "empty"), so this reads identically to before the cache existed.
    const groundingWithPages = (pages) => ({
      resume: !!resume,
      coverLetter: !!coverLetter,
      pages,
    });
    // The GEMINI reading. The embedded answer branch below overrides `pages`
    // with its own post-draft value; the embedded points branch returns no
    // `grounding` at all (it is answer mode's alone).
    const grounding = groundingWithPages(kb.includedPages.length > 0);

    // AC-P2.3/AC-P2.4: streaming is opt-in and Gemini-only — the embedded
    // engine ignores `stream` entirely and answers on-device exactly as it
    // does today (its branches below never call a model at all, so there is
    // nothing in them to stream), and a request with no `stream: true` falls
    // straight through to the untouched JSON branches beneath this.
    if (body?.stream === true && !wantsEmbedded(body?.engine)) {
      return streamAnswer({
        mode,
        question,
        context,
        profile,
        descriptor,
        resume,
        coverLetter,
        posting,
        grounding,
        story,
        kb,
        codeLanguage,
        questionRoleTerms,
        // AC-V5.4: the THUNK, not an already-awaited result — streamAnswer
        // opens the NDJSON body first and settles this inside its own
        // producer, so the facts deadline can no longer sit in front of the
        // connection itself.
        awaitCompanyFacts,
      });
    }

    // The NON-streaming branches build one whole JSON body and have nothing
    // to open early, so this is where their facts wait belongs — the same
    // deadline, in the only place it can go on a path with no first frame to
    // be late for.
    const { facts, companyFacts } = await resolveCompanyFacts(awaitCompanyFacts);

    if (mode === "answer") {
      // Embedded engine: assemble the spoken answer on-device — no LLM.
      if (wantsEmbedded(body?.engine)) {
        const { points, answer, type, pageSources } = draftSampleAnswerLocal({
          question,
          profile,
          resume,
          coverLetter,
          interviewType: interviewTypeValue,
          story,
        });
        if (points.length === 0) {
          return Response.json({ error: "Could not generate an answer." }, { status: 502 });
        }
        return Response.json({
          points,
          // No model to ask on this path, so the cues are always the
          // deterministic shortening of the points just drafted.
          cues: deriveCues(points),
          // AC-5.4: clamped here like every other producer — the embedded
          // story-override branch used to be the one unclamped path (D7's
          // second asymmetry).
          answer: answer.slice(0, MAX_ANSWER_CHARS),
          type,
          // Derived AFTER the draft, from the draft itself: `pageSources` is
          // non-null exactly where a point carries text taken off a page, so
          // "this answer was grounded in your project pages" is true by
          // construction rather than inferred from the selection gate. See
          // `groundingWithPages` above for the prose-only page that made
          // `!!story?.matched` an over-claim.
          grounding: groundingWithPages(pageSources.some(Boolean)),
          // AC-6/§4e: reported straight from `story`, never whitelist-
          // validated the way the Gemini path's `pageIds` are below — it
          // doesn't need to be. It quotes a bullet verbatim out of a page
          // this engine read itself, so it is true by construction; the
          // whitelist exists to catch a MODEL inventing a citation, which
          // cannot happen on a path with no model.
          pageSources,
          // Embedded engine: no model call at all, on either aid — the
          // established rule for every AI feature in this repo is that
          // engine choice governs whether a feature calls a model, and
          // idealProjectFor's deterministic path is this one's.
          ...(await answerAids({ postingDescription: posting, resume, profile, question, points, story })),
          // §4d/§9: embedded, so this is `embeddedRoleTermsFlag` with
          // `story` — the pages this draft actually quoted from — never
          // `kb.block` (see roleTermsFlag.js's own header for why that would
          // be a false accusation on this path).
          ...embeddedRoleTermsFlag({
            terms: questionRoleTerms,
            points,
            profile,
            resume,
            coverLetter,
            story,
          }),
        });
      }

      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const responsePromise = client.models.generateContent({
        model: geminiModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildAnswerPrompt({
                  question,
                  context,
                  profile,
                  resume,
                  coverLetter,
                  descriptor,
                  pagesBlock: kb.block,
                  codeLanguage,
                }),
              },
            ],
          },
        ],
        config: { systemInstruction: ANSWER_SYSTEM, responseMimeType: "application/json" },
      });
      // Started before `responsePromise` is awaited, so the two requests are
      // actually concurrent — see generateIdealProjectExample's own comment.
      const generatedProjectPromise = generateIdealProjectExample({
        client,
        geminiModel,
        description: posting,
        question,
      });
      const response = await responsePromise;

      const parsed = parseModelJson(response.text?.trim() || "");
      const { points, pageIds } = normalizeModelPoints(parsed, MAX_ANSWER_POINTS);
      if (points.length === 0) {
        return Response.json({ error: "Could not generate an answer." }, { status: 502 });
      }
      const type = VALID_TYPES.includes(parsed?.type) ? parsed.type : "general";
      // AC-H9.33: `answer` is derived here, from the same `points` just
      // returned to the caller — never a second field asked of the model.
      const answer = deriveAnswerFromPoints(points).slice(0, MAX_ANSWER_CHARS);
      return Response.json({
        points,
        // The model's own cues when it returned one per point; otherwise the
        // same deterministic shortening the embedded path uses.
        cues: resolveCues(parsed?.cues, points),
        answer,
        type,
        grounding,
        // AC-6: the model's own `pageIds`, validated against the whitelist
        // of pages the prompt actually included — anything else (an
        // invented id, or a citation for a page never shown) is dropped to
        // null (lib/copilot/pageCitations.js's resolvePageSources).
        pageSources: resolvePageSources(pageIds, { includedPages: kb.includedPages, pointCount: points.length }),
        ...(await answerAids({
          postingDescription: posting,
          resume,
          profile,
          question,
          points,
          generatedProjectPromise,
          story,
        })),
        // §4d: Gemini path, so this is `geminiRoleTermsFlag` with `kb.block`
        // — the pages actually put into this prompt.
        ...geminiRoleTermsFlag({
          terms: questionRoleTerms,
          points,
          profile,
          resume,
          coverLetter,
          pagesBlock: kb.block,
        }),
      });
    }

    // "points" mode — live mode's glanceable bullets, unchanged in shape
    // (AC-H9.34). Grounded in the submitted résumé/cover letter in addition
    // to the prep context (AC-H4.15); byte-identical to today when neither
    // was found (AC-H4.17/AC-H4.18). AC-6.2: live mode's response now also
    // carries `pageSources` — the exact-key-set assertions in route.test.js
    // that used to pin this branch's key list have been updated to include
    // it, per their own comment: the rule those assertions protect is that
    // `answer`/`grounding` stay answer-mode-only, not a freeze on the key
    // set (cues/buzzwords/resumeAnchor/idealProject were each added the same
    // way). Per-point page citations for live mode were previously deferred
    // as a client-surfacing concern (ARCH §7.11); this is that concern
    // resolved.
    if (wantsEmbedded(body?.engine)) {
      // draftAnswerLocal already computes `pageSources` the same way
      // draftSampleAnswerLocal does for answer mode (a citation quoted
      // verbatim out of a page this engine read itself, true by
      // construction — no whitelist needed, unlike the Gemini path below).
      const { points, type, pageSources } = draftAnswerLocal({
        question,
        profile,
        resume,
        coverLetter,
        interviewType: interviewTypeValue,
        story,
      });
      if (points.length === 0) {
        return Response.json({ error: "Could not generate an answer." }, { status: 502 });
      }
      return Response.json({
        points,
        cues: deriveCues(points),
        type,
        pageSources,
        // Embedded engine: no model call at all — see the answer-mode
        // branch above for the same rule stated once already.
        ...(await answerAids({ postingDescription: posting, resume, profile, question, points, story })),
        // §4d/§9: embedded — `story`, not `kb.block`. See the answer-mode
        // embedded branch above for why.
        ...embeddedRoleTermsFlag({
          terms: questionRoleTerms,
          points,
          profile,
          resume,
          coverLetter,
          story,
        }),
      });
    }

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    const responsePromise = client.models.generateContent({
      model: geminiModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildPointsPrompt(
                question,
                context,
                profile,
                descriptor,
                resume,
                coverLetter,
                kb.block,
                companyFacts,
                codeLanguage,
              ),
            },
          ],
        },
      ],
      config: { systemInstruction: POINTS_SYSTEM, responseMimeType: "application/json" },
    });
    // Started before `responsePromise` is awaited — see generateIdealProjectExample's own comment.
    const generatedProjectPromise = generateIdealProjectExample({
      client,
      geminiModel,
      description: posting,
      question,
    });
    const response = await responsePromise;

    const parsed = parseModelJson(response.text?.trim() || "");
    const { points, pageIds, factIds } = normalizeModelPoints(parsed, 6);
    if (points.length === 0) {
      return Response.json({ error: "Could not generate an answer." }, { status: 502 });
    }
    const type = VALID_TYPES.includes(parsed?.type) ? parsed.type : "general";

    // Points mode's PROMPT still carries R-095's byte-identity guarantee for
    // a caller with none of resume/coverLetter/pagesBlock — buildPointsPrompt
    // only ever adds a block when it has something to add — the model
    // is not asked for cues here, so they are always derived.
    return Response.json({
      points,
      cues: deriveCues(points),
      type,
      // AC-6.2: the model's own `pageIds` (buildPointsPrompt now asks for
      // one whenever pagesBlock is non-empty), validated against the same
      // whitelist the answer-mode branch above uses — an invented id or a
      // citation for a page never shown is dropped to null.
      pageSources: resolvePageSources(pageIds, { includedPages: kb.includedPages, pointCount: points.length }),
      // AC-V4.4: `factSources` is present at ALL only when `companyFacts`
      // was actually computed for this request (points mode, Gemini engine,
      // employer known) — a request that never had an employer to research
      // gets exactly the response shape it always has, key for key.
      ...(companyFacts
        ? { factSources: resolveFactSources(factIds, { includedFacts: facts, pointCount: points.length }) }
        : {}),
      ...(await answerAids({ postingDescription: posting, resume, profile, question, points, generatedProjectPromise, story })),
      // §4d: Gemini path, so `geminiRoleTermsFlag` with `kb.block`.
      ...geminiRoleTermsFlag({ terms: questionRoleTerms, points, profile, resume, coverLetter, pagesBlock: kb.block }),
    });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Answer request failed." },
      { status: 500 },
    );
  }
}
