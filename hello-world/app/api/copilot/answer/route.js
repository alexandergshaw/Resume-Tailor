import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { pointsFromPartialJson } from "@/lib/copilot/answerStream";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { draftAnswerLocal, deriveAnswerFromPoints } from "@/lib/copilot/answerLocal";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal";
import { fetchApplicationDocs, fetchPostingDescription } from "@/lib/copilot/applicationDocs";
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
import { normalizeInterviewType, interviewType } from "@/lib/copilot/interviewTypes";
import { deriveCues, resolveCues, shortenToCue } from "@/lib/copilot/answerCues";
import { postingBuzzwords } from "@/lib/copilot/postingBuzzwords";
import { resumeAnchor, MAX_PROJECT_WORDS } from "@/lib/copilot/resumeAnchor";
import { idealProject as idealProjectFor } from "@/lib/copilot/idealProject";
import { buildIdealProjectPrompt, IDEAL_PROJECT_SYSTEM, normalizeIdealProject } from "@/lib/copilot/idealProjectPrompt";
import { listPages } from "@/lib/supabase/experiencePages";
import { listAttachmentsByPage } from "@/lib/supabase/experienceAttachments";
import { withDerivedKind } from "@/lib/experience/attachments";
import {
  buildKnowledgeBaseBlock,
  stripLinePrefixes,
  noAttachmentBytesNotice,
} from "@/lib/experience/knowledgeBase";
import { resolvePageSources } from "@/lib/copilot/pageCitations";
import { selectBestStory, isEligiblePage, PROJECT_PAGE_SOURCE } from "@/lib/copilot/projectStories";

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
//                response). See answerAids' own comment below.
// This is the one part of the response shape that did move for live mode: it
// gained keys, and every existing key kept its meaning.

const MAX_CONTEXT_CHARS = 4000;
const MAX_PROFILE_CHARS = 8000;
const MAX_RESUME_CHARS = 12000;
// AC-2.1: parity with the résumé, not a fraction of it. At the old 6000-char
// budget (minus its own notice reserve) two 2800-char pages exhausted the
// whole knowledge base while the résumé got 12000 and the posting got
// 20000 — the candidate's own project pages are the PRIMARY evidence for a
// behavioral/leadership answer (AC-3.1), so they get at least what the
// résumé gets.
const MAX_PAGES_CHARS = 12000;
const MAX_COVER_LETTER_CHARS = 6000;
const MAX_ANSWER_CHARS = 6000;
const MAX_ANSWER_POINTS = 6;
const MAX_APPLICATION_ID_CHARS = 100;
// The posting description is mined for buzzwords only, never interpolated
// into a prompt, so this cap exists purely to bound the keyword extractor's
// work on a pathologically long description.
const MAX_POSTING_CHARS = 20000;
const VALID_TYPES = ["behavioral", "technical", "general"];

// The model's `points` and its `pageIds`, normalised TOGETHER.
//
// THE BUG THIS PREVENTS: `points` was filtered for blanks and sliced to the
// cap while `parsed.pageIds` was passed to resolvePageSources untouched. That
// function's pairing is all-or-nothing on length — correctly so, since a
// citation against the wrong beat is worse than no citation — so one
// whitespace-only point among four cost the user EVERY citation on the answer,
// silently. The rule is right; normalising only one of the two arrays was the
// bug.
//
// Pairs each raw point with its raw id BY INDEX first, then filters and slices
// the PAIRS, then splits them — the same shape lib/copilot/sampleAnswerLocal.js
// already uses for its own index bookkeeping, rather than a second one.
//
// `pageIds` comes back as null, not [], when the model returned no array at
// all: resolvePageSources must still see "nothing supplied" and fall to its
// own all-nulls path, which is not the same thing as an empty array of the
// wrong length.
function normalizeModelPoints(parsed, cap) {
  const rawPoints = Array.isArray(parsed?.points) ? parsed.points : [];
  const rawPageIds = Array.isArray(parsed?.pageIds) ? parsed.pageIds : null;
  const paired = rawPoints
    .map((point, index) => ({ point, pageId: rawPageIds ? rawPageIds[index] : null }))
    .filter((entry) => typeof entry.point === "string" && entry.point.trim())
    .slice(0, cap);
  return {
    points: paired.map((entry) => entry.point.trim()),
    pageIds: rawPageIds ? paired.map((entry) => entry.pageId) : null,
  };
}

// AC-N3: asks the model for a worked example grounded in the actual posting,
// instead of always handing back one of idealProjectNarrative.js's seven
// archetypes. Rides ALONGSIDE the points/answer call rather than after it —
// both call sites below start this before awaiting the main response, so the
// added latency is the slower of the two requests, not their sum, which
// matters because this fires while the candidate is mid-question.
//
// Resolves to null, never rejects, on every failure mode: no posting to
// build a prompt from, a network error, unparseable JSON, or a response
// normalizeIdealProject won't vouch for. This has to be true unconditionally
// — a broken worked example is an aid beside the answer, not the answer, and
// must never be able to fail the request it rides beside or surface an
// error the candidate would see mid-question.
async function generateIdealProjectExample({ client, geminiModel, description, question }) {
  const prompt = buildIdealProjectPrompt({ description, question });
  if (!prompt) return null;
  try {
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: IDEAL_PROJECT_SYSTEM, responseMimeType: "application/json" },
    });
    const parsed = parseModelJson(response.text?.trim() || "");
    return normalizeIdealProject(parsed, { description });
  } catch {
    return null;
  }
}

// AC-K1.2/AC-K1.3: the two aids that sit BESIDE a drafted answer rather than
// inside it — the posting's own vocabulary to work in, and which of the
// candidate's own roles (and which project inside it) the answer came out of.
// Computed identically for both modes and both engines, from the same two
// pure modules, so live and practice can never show different aids for the
// same question and the aids never depend on who drafted the answer.
//
// `postingDescription` reaches ONLY this function — never buildPointsPrompt
// or buildAnswerPrompt (AC-H7.27 is unchanged: the posting description still
// never grounds an answer). See lib/copilot/postingBuzzwords.js for why a
// list the candidate reads and chooses from is a different thing from
// material an answer is generated out of.
//
// The résumé is preferred over the prep notes for the role/project because
// that is what the user asked to be told about — "the job title and company
// from my resume". The prep context is the fallback only when no résumé was
// submitted for this application, since it is often résumé-shaped text
// pasted in by hand.
//
// Async now, for exactly one reason: `generatedProjectPromise`, the in-flight
// call started by the caller (only on the Gemini path — the embedded path
// never has one), is awaited here rather than started here, so it and the
// main points/answer call are genuinely concurrent instead of one waiting on
// the other.
//
// `story` (ARCH §3.6/§4e) is lib/copilot/projectStories.js's selectBestStory
// return, selected ONCE by the caller (POST, below) and handed down here —
// this function used to run a SECOND, independent selectBestStory call of
// its own, scored against {question, points}, which could disagree with the
// embedded engine's own override (scored against {question} alone) about
// which page was "the" match for the same request (D7). One selection, one
// answer, on every call site.
async function answerAids({ postingDescription, resume, profile, question, points, generatedProjectPromise, story }) {
  const anchorText = resume || profile;
  const anchor = resumeAnchor(anchorText, { question, points });
  // The FALLBACK, computed exactly as it always has been — never skipped,
  // because a missing or rejected model response must still leave the
  // candidate with an example rather than nothing.
  const deterministicProject = idealProjectFor(postingDescription, { question, points });
  const generatedProject = generatedProjectPromise ? await generatedProjectPromise : null;
  // Page-derived fallback for the résumé-anchor aid: only reachable when
  // `anchor` above is null — i.e. neither a submitted résumé nor prep notes
  // yielded anything to name a role from — so an eligible project page never
  // displaces real résumé/prep material, it only fills a gap that would
  // otherwise be `resumeAnchor: null`. Deliberately does NOT populate `title`,
  // `company`, or `description` — and NOT because the aid would mislabel them.
  // AnswerAids.js reads a SOURCE_WHERE map keyed on `source` (it knows
  // PROJECT_PAGE_SOURCE and renders "on a project page") from both roleLabel()
  // and the no-role label, so page material is attributed honestly wherever it
  // appears. Leaving these empty was once a workaround for that; it is not one
  // now. They stay empty on their own merits:
  //
  //   - `title`/`company` model a job ROLE — AnswerAids renders them as
  //     "Closest role" / "Most recent role". A project page's title is a
  //     PROJECT name and it has no employer at all, so filling them would
  //     present a project as a role: a different category error, not a fix.
  //   - `description` has no already-computed second value here; the route
  //     derives exactly one shortened line, and it goes to `project`.
  //
  // So only `project` is set, rendered under the source-neutral "Project to
  // talk about" label. If you are here because you want richer page-derived
  // aids, that is a content feature (choosing and shortening more bullets),
  // not a matter of deleting this restraint.
  //
  // Gated on `story.matched`, exactly like the deterministic answer builders.
  //
  // THE BUG THIS PREVENTS: this used to read `if (!resumeAnchorAid && story)`,
  // and the comment here claimed the unmatched case was "honestly labelled via
  // `matched`". It was not. AnswerAids.js consults `matched` only inside its
  // role-row branch, and the shape built below (`title: ""`, `company: ""`,
  // `description: []`) never takes that branch — so the honest label was
  // unreachable and the candidate read "Project to talk about: We spent time
  // each spring checking the hives" beside an answer about disagreeing with
  // their manager. It fired on both engines, in both modes, on all three
  // surfaces, whenever there was no submitted résumé and no prep-context text:
  // the ordinary live-mode cold start. An unmatched page is the first eligible
  // one on file, not the one this question is about, so there is nothing here
  // for the aid to honestly say.
  let resumeAnchorAid = anchor ? { ...anchor, source: resume ? "resume" : "prep" } : null;
  if (!resumeAnchorAid && story?.matched) {
    const projectText = story.bullets[0] || story.title;
    resumeAnchorAid = {
      title: "",
      company: "",
      matched: story.matched,
      project: shortenToCue(projectText, MAX_PROJECT_WORDS),
      description: [],
      source: PROJECT_PAGE_SOURCE,
    };
  }
  return {
    buzzwords: postingBuzzwords(postingDescription, { question, points }),
    // AC-K1.3 correction: `anchor` is mined from whichever of `resume` /
    // `profile` was actually non-empty — with no posting selected (the
    // common live-mode case), that is the free-text prep-context textarea,
    // not a résumé. `source` reports which one so the UI can word the label
    // honestly instead of always claiming "on your resume". A third value,
    // PROJECT_PAGE_SOURCE, marks the page-derived fallback above — never
    // "resume", never "prep" (lib/copilot/projectStories.js's own contract).
    resumeAnchor: resumeAnchorAid,
    // BUG: `generatedProject` is `normalizeIdealProject`'s return value — the
    // shape of `idealProjectFor()`'s `project` FIELD ({ title, sections,
    // outcomes }), never the shape of the aid itself ({ shape, summary,
    // metrics, project }). `generatedProject || deterministicProject` used
    // to substitute the field's shape for the whole aid's shape, so on the
    // accept path `shape`/`summary`/`metrics` vanished, AnswerAids.js's
    // `hasIdealRow` computed false, and the entire block — row, disclosure,
    // worked example — rendered as nothing. The feature reached the user
    // only when the model call failed or was rejected. A valid generated
    // example must ENRICH the deterministic aid, not replace it: keep
    // `deterministicProject`'s `shape`/`summary`/`metrics` and swap only its
    // `project` for the model's. If there is no deterministic aid at all (no
    // posting, or no shape term survived — idealProjectFor returns null),
    // there is nothing for a generated example to sit beside, so the result
    // stays null rather than shipping a `project`-only object — that bare
    // shape is exactly the broken state this bug produced.
    idealProject: deterministicProject
      ? (generatedProject ? { ...deterministicProject, project: generatedProject } : deterministicProject)
      : null,
  };
}

// AC-P2.3-P2.5: the streaming half of this route — Gemini only (the embedded
// branch never reaches this; see POST's own stream-flag check) and an
// ADDITION to the route, not a rewrite: the prompt builders, system
// instructions, cues/answer derivation and answerAids above are the exact
// same functions the non-streaming branches call, so the two can never drift
// on what an answer IS, only on how it's delivered.
//
// Wraps a NDJSON body around `producer`, which writes `{t:"points",...}` /
// `{t:"done",...}` / `{t:"error",...}` frames via `write`. `start()` runs
// with nothing awaited ahead of it — no posting lookup, no worked-example
// call — so the very first points frame is never sat behind anything but the
// model call itself.
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
}) {
  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();
  const isAnswerMode = mode === "answer";
  const promptText = isAnswerMode
    ? buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor, pagesBlock: kb.block })
    : buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter, kb.block);
  const systemInstruction = isAnswerMode ? ANSWER_SYSTEM : POINTS_SYSTEM;
  const pointsCap = isAnswerMode ? MAX_ANSWER_POINTS : 6;

  return ndjsonResponse(async (write) => {
    let stream;
    try {
      stream = await client.models.generateContentStream({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        config: { systemInstruction, responseMimeType: "application/json" },
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
    const { points, pageIds } = normalizeModelPoints(parsed, pointsCap);
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
    const done = isAnswerMode
      ? {
          points,
          cues: resolveCues(parsed?.cues, points),
          answer: deriveAnswerFromPoints(points).slice(0, MAX_ANSWER_CHARS),
          type,
          grounding,
          pageSources,
          ...aids,
        }
      : { points, cues: deriveCues(points), type, pageSources, ...aids };
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
    const question = (body?.question ?? "").toString().trim();
    if (!question) {
      return Response.json({ error: "No question provided." }, { status: 400 });
    }
    const context = (body?.context ?? "").toString().slice(0, MAX_CONTEXT_CHARS);
    const profile = (body?.profile ?? "").toString().slice(0, MAX_PROFILE_CHARS);
    const interviewTypeValue = normalizeInterviewType(body?.interviewType);
    const descriptor = interviewType(interviewTypeValue);
    const mode = body?.mode === "answer" ? "answer" : "points";
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
    // The caller's own "Professional Experience" project pages, and their
    // attachment inventory, are fetched the same way — server-side, scoped
    // to `user.id` (never a client-supplied id, for the same injection
    // reason applicationId's own comment above gives for resume/coverLetter)
    // — and joined into this SAME Promise.all rather than awaited
    // afterward: this route fires mid-question, so a sequential fetch here
    // would be latency the candidate feels directly. ONE extra query for
    // the whole knowledge base (AC-4.1) — listAttachmentsByPage, not one
    // listAttachments call per page — mirroring
    // app/api/meeting/insights/route.js's own fetch. Neither
    // lib/supabase/experiencePages.js's listPages nor
    // lib/supabase/experienceAttachments.js's listAttachmentsByPage ever
    // throws (each degrades to an empty/error result on any failure), so a
    // broken or empty table never breaks a request that has everything else
    // it needs to answer (AC-4.5).
    const [docs, postingDescription, pagesResult, attachmentsResult] = await Promise.all([
      fetchApplicationDocs(supabase, { applicationId, userId: user.id }),
      fetchPostingDescription(supabase, { applicationId, userId: user.id }),
      listPages(supabase, user.id),
      listAttachmentsByPage(supabase, user.id),
    ]);
    const resume = docs.resume.slice(0, MAX_RESUME_CHARS);
    const coverLetter = docs.coverLetter.slice(0, MAX_COVER_LETTER_CHARS);
    const posting = postingDescription.slice(0, MAX_POSTING_CHARS);
    const rawPages = Array.isArray(pagesResult?.pages) ? pagesResult.pages : [];
    // Graft the attachment inventory onto its page — exactly
    // app/api/meeting/insights/route.js:127-131's own pattern, using the
    // same shared withDerivedKind (AC-4.4: no second private copy of the
    // kind derivation).
    const attachmentsByPageId = attachmentsResult.byPageId;
    const pages = rawPages.map((page) => {
      const rows = attachmentsByPageId.get(page?.id) || [];
      if (rows.length === 0) return page;
      return { ...page, attachments: rows.map(withDerivedKind) };
    });

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
    const groundingWithPages = (pages) => ({
      resume: !!docs.resume,
      coverLetter: !!docs.coverLetter,
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
      });
    }

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
            { text: buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter, kb.block) },
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
    const { points, pageIds } = normalizeModelPoints(parsed, 6);
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
      ...(await answerAids({ postingDescription: posting, resume, profile, question, points, generatedProjectPromise, story })),
    });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Answer request failed." },
      { status: 500 },
    );
  }
}
