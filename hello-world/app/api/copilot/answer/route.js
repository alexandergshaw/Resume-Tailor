import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { pointsFromPartialJson } from "@/lib/copilot/answerStream";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { draftAnswerLocal, deriveAnswerFromPoints } from "@/lib/copilot/answerLocal";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal";
import { fetchApplicationDocs, fetchPostingDescription } from "@/lib/copilot/applicationDocs";
import { submittedDocsPromptParts } from "@/lib/copilot/applicationDocsPrompt";
import { normalizeInterviewType, interviewType } from "@/lib/copilot/interviewTypes";
import { deriveCues, resolveCues, shortenToCue } from "@/lib/copilot/answerCues";
import { postingBuzzwords } from "@/lib/copilot/postingBuzzwords";
import { resumeAnchor, MAX_PROJECT_WORDS } from "@/lib/copilot/resumeAnchor";
import { idealProject as idealProjectFor } from "@/lib/copilot/idealProject";
import { buildIdealProjectPrompt, IDEAL_PROJECT_SYSTEM, normalizeIdealProject } from "@/lib/copilot/idealProjectPrompt";
import { listPages } from "@/lib/supabase/experiencePages";
import {
  buildProjectStoriesBlock,
  selectBestStory,
  starPointsFromStory,
  PROJECT_PAGE_SOURCE,
} from "@/lib/copilot/projectStories";

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
const POINTS_SYSTEM = [
  "You are an interview coach helping a candidate answer questions during a LIVE interview.",
  "Given the question the interviewer just asked, produce concise talking points the candidate can glance at and speak from — NOT a script to read aloud.",
  "Return 3-5 short bullet points; each is one phrase or short sentence, specific and substantive.",
  "When a CANDIDATE BACKGROUND section or a YOUR OWN PROJECT PAGES section is provided, ground the points in it — reference their real companies, projects, metrics, and skills rather than inventing generic ones. For a \"tell me about a time...\" question, prefer a concrete story from YOUR OWN PROJECT PAGES when one is provided — it is the candidate's own account of a real project, more specific than a resume bullet. Never fabricate experience the background does not support; if it is thin, give strong generic points instead.",
  "For behavioral questions (\"tell me about a time...\"), prefix each point with its STAR label — \"Situation:\", \"Task:\", \"Action:\", \"Result:\".",
  "Keep every point skimmable — a person on camera must absorb it in a glance.",
].join(" ");

// AC-H9: the sample answer is a sequence of complete, speakable sentences —
// never glanceable fragments — built only from what was actually submitted
// (or the prep context, when nothing was submitted). `answer` is never asked
// of the model here: it is always derived server-side from `points`
// (deriveAnswerFromPoints, AC-H9.33).
const ANSWER_SYSTEM = [
  "You are an interview coach drafting the sample answer a candidate could actually say out loud in a real interview, as a sequence of complete sentences — never glanceable fragments.",
  "The answer must be built only from the material provided below — the candidate's prep notes, their own project pages, and, when available, the résumé and cover letter they actually submitted for this application — never invented.",
  "Return 3-6 points; each point is one complete, natural spoken sentence, first person, and together they are the whole answer — no headings, no stage directions, nothing that isn't meant to be spoken aloud.",
  "For behavioral questions (\"tell me about a time...\"), prefix each point with its STAR label — \"Situation:\", \"Task:\", \"Action:\", \"Result:\".",
  // AC-K1.1: the cue is what the candidate actually reads mid-question; the
  // point behind it is the sentence they say. Asked of the model rather than
  // trimmed from the point afterwards because a model that knows which few
  // words carry the beat phrases them better than any mechanical shortener
  // can — but the shortener still runs over whatever comes back (resolveCues),
  // so a "cue" returned as a full sentence is trimmed rather than trusted.
  "Also return `cues`: exactly one per point, in the same order — each a 2-6 word prompt naming what that point is about, carrying the same STAR label where the point has one. A cue is a reminder, not a sentence: no verbs the point does not have, no punctuation at the end.",
].join(" ");

const MAX_CONTEXT_CHARS = 4000;
const MAX_PROFILE_CHARS = 8000;
const MAX_RESUME_CHARS = 12000;
const MAX_COVER_LETTER_CHARS = 6000;
const MAX_ANSWER_CHARS = 6000;
const MAX_ANSWER_POINTS = 6;
const MAX_APPLICATION_ID_CHARS = 100;
// The posting description is mined for buzzwords only, never interpolated
// into a prompt, so this cap exists purely to bound the keyword extractor's
// work on a pathologically long description.
const MAX_POSTING_CHARS = 20000;
const VALID_TYPES = ["behavioral", "technical", "general"];

function interviewFormatLines(descriptor) {
  return [
    "--- INTERVIEW FORMAT ---",
    `This is a ${descriptor.label} interview. ${descriptor.guidance}`,
    `Emphasize: ${descriptor.emphasis.join(", ")}.`,
  ];
}

// AC-H4.15: grounds live mode's talking points in the résumé and cover
// letter actually submitted for the selected application, in addition to
// the prep context — but never the posting description (AC-H7.27), which
// this function never receives at all. AC-H4.17: with neither `resume` nor
// `coverLetter` (no applicationId, or no documents found for it), this must
// produce byte-for-byte what it produced before grounding existed as a
// source — so the submitted-docs block below is only ever added when at
// least one of the two is actually present. It deliberately does NOT reuse
// applicationDocsPrompt.js's "no submitted resume or cover letter was
// available" note for the neither-found case: that note exists for
// answer-mode's framing (see buildAnswerPrompt) and adding any such note
// here would itself break this exact byte-identity requirement — see that
// module's own comment on checking groundingFlags and simply not calling
// submittedDocsPromptParts when it doesn't apply.
// `projectStories` (lib/copilot/projectStories.js's buildProjectStoriesBlock
// output) is "" whenever the caller has no eligible project pages, in which
// case the block below is never added and this function's output is
// byte-identical to what it produced before project pages existed as a
// source (mirroring AC-H4.17's byte-identity guarantee for the submitted-docs
// block above it).
function buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter, projectStories) {
  const parts = [`The interviewer asked: "${question}"`, "", ...interviewFormatLines(descriptor)];
  if (profile) {
    parts.push(
      "",
      "--- CANDIDATE BACKGROUND (their resume / target role / prep notes; use to personalize) ---",
      profile,
    );
  }
  if (resume || coverLetter) {
    parts.push(...submittedDocsPromptParts({ resume, coverLetter }));
  }
  if (projectStories) {
    parts.push(
      "",
      "--- YOUR OWN PROJECT PAGES (real projects they've documented; may ground a concrete story) ---",
      projectStories,
    );
  }
  if (context) {
    parts.push("", "Recent conversation (most recent last), for context:", context);
  }
  parts.push(
    "",
    'Return ONLY JSON of this exact shape: { "points": string[], "type": "behavioral" | "technical" | "general" }',
    "points: 3-5 concise talking points as described above.",
  );
  return parts.join("\n");
}

// How the spoken answer should be shaped for this format (AC-G2-D-4): a
// behavioral or leadership format wants a STAR narrative, a technical or
// system-design format wants approach-then-trade-offs, and a phone screen
// wants brevity over a story.
function answerShapeInstruction(descriptor) {
  const groups = descriptor.questionGroups;
  if (groups.includes("behavioral") || groups.includes("leadership")) {
    return "Shape it as a STAR narrative: briefly set the situation and task, describe the actions the candidate personally took, and close with the result.";
  }
  if (groups.includes("technical") || groups.includes("system-design")) {
    return "Shape it as approach-then-trade-offs: state the approach first, then the trade-offs considered and how the candidate would validate the result.";
  }
  if (descriptor.value === "phone-screen") {
    return "Keep it a crisp, concise summary — a recruiter screen calls for brevity, not a long story.";
  }
  return "Shape it naturally for the question: lead with the point, then the concrete evidence behind it.";
}

// AC-H9.32: asks the model for `points` — 3-6 complete, speakable
// sentences, STAR-labeled for a behavioral/leadership shape — never a single
// prose `answer` field. The route derives `answer` from those points itself
// (deriveAnswerFromPoints, AC-H9.33); the model is never asked to generate
// prose separately.
// `projectStories` (lib/copilot/projectStories.js's buildProjectStoriesBlock
// output) is "" whenever the caller has no eligible project pages. Every
// place it changes this function's output — the block itself, the "no
// submitted resume or cover letter" notice, and the authority sentence naming
// where a claim may come from — is gated on it being truthy, so with no
// eligible pages this function's output is byte-identical to what it
// produced before project pages existed as a source.
function buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor, projectStories }) {
  const parts = [`The interviewer asked: "${question}"`, "", ...interviewFormatLines(descriptor)];
  if (profile) {
    parts.push("", "--- CANDIDATE PREP NOTES (their own notes on background / target role) ---", profile);
  }
  if (resume) {
    parts.push("", "--- SUBMITTED RESUME (for this application) ---", resume);
  }
  if (coverLetter) {
    parts.push("", "--- SUBMITTED COVER LETTER (for this application) ---", coverLetter);
  }
  if (projectStories) {
    parts.push("", "--- YOUR OWN PROJECT PAGES (real projects they've documented) ---", projectStories);
  }
  if (context) {
    parts.push("", "Recent conversation (most recent last), for context:", context);
  }
  if (!resume && !coverLetter) {
    parts.push(
      "",
      projectStories
        ? "No submitted resume or cover letter was available for this application — build the answer from the candidate prep notes, YOUR OWN PROJECT PAGES above, and conversation context."
        : "No submitted resume or cover letter was available for this application — build the answer from the candidate prep notes and conversation context alone.",
    );
  }
  const authoritySources = projectStories
    ? "CANDIDATE PREP NOTES, SUBMITTED RESUME, SUBMITTED COVER LETTER, or YOUR OWN PROJECT PAGES"
    : "CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER";
  parts.push(
    "",
    `Write the actual spoken answer the candidate should give, as 3-6 points — each one a complete, speakable sentence, not a fragment — together totalling roughly ${descriptor.lengthTarget.minWords}-${descriptor.lengthTarget.maxWords} words.`,
    "Each point is first person, spoken register — no bullet markers beyond the STAR label where it applies, no headings, no stage directions, nothing but words meant to be said out loud.",
    answerShapeInstruction(descriptor),
    `Every claim must come from the ${authoritySources} above — select, order, and phrase freely, but never invent an employer, project, metric, or credential that isn't there. If the material is thin, give a shorter, honest answer rather than inventing detail.`,
    'Return ONLY JSON of this exact shape: { "points": string[], "cues": string[], "type": "behavioral" | "technical" | "general" }',
    "cues: exactly one per point, same order — a 2-6 word prompt for that point, with the same STAR label where the point has one.",
  );
  return parts.join("\n");
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
async function answerAids({ postingDescription, resume, profile, question, points, generatedProjectPromise, pages }) {
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
  // `company`, or `description`: AnswerAids.js's roleLabel() falls back to
  // wording a role "on your resume" for any `source` other than "prep", and
  // its bare `role` fallback renders the hardcoded string "From your resume"
  // whenever `description` is non-empty — both would mislabel page-derived
  // material as résumé material with no way to override them from here. Only
  // `project` is set, which AnswerAids.js renders under the source-agnostic
  // "Project to talk about" label, so a page-derived project can never be
  // shown as if it came from a résumé the candidate never wrote it on.
  let resumeAnchorAid = anchor ? { ...anchor, source: resume ? "resume" : "prep" } : null;
  if (!resumeAnchorAid) {
    const story = selectBestStory(pages, { question, points });
    if (story) {
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
  pages,
  projectStories,
}) {
  const { geminiModel } = getServerEnv();
  const client = getGeminiClient();
  const isAnswerMode = mode === "answer";
  const promptText = isAnswerMode
    ? buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor, projectStories })
    : buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter, projectStories);
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
    const points = Array.isArray(parsed?.points)
      ? parsed.points
          .filter((p) => typeof p === "string" && p.trim())
          .map((p) => p.trim())
          .slice(0, pointsCap)
      : [];
    if (points.length === 0) {
      write({ t: "error", error: "Could not generate an answer." });
      return;
    }
    const type = VALID_TYPES.includes(parsed?.type) ? parsed.type : "general";
    const aids = await answerAids({ postingDescription: posting, resume, profile, question, points, pages });
    const done = isAnswerMode
      ? {
          points,
          cues: resolveCues(parsed?.cues, points),
          answer: deriveAnswerFromPoints(points).slice(0, MAX_ANSWER_CHARS),
          type,
          grounding,
          ...aids,
        }
      : { points, cues: deriveCues(points), type, ...aids };
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
    // The caller's own "Professional Experience" project pages are fetched
    // the same way — server-side, scoped to `user.id` (never a client-
    // supplied id, for the same injection reason applicationId's own comment
    // above gives for resume/coverLetter) — and joined into this SAME
    // Promise.all rather than awaited afterward: this route fires mid-
    // question, so a sequential fetch here would be latency the candidate
    // feels directly. lib/supabase/experiencePages.js's listPages never
    // throws (it degrades to `{ pages: null, error }` on any failure), so a
    // broken or empty pages table never breaks the request that depends on
    // this.
    const [docs, postingDescription, pagesResult] = await Promise.all([
      fetchApplicationDocs(supabase, { applicationId, userId: user.id }),
      fetchPostingDescription(supabase, { applicationId, userId: user.id }),
      listPages(supabase, user.id),
    ]);
    const grounding = { resume: !!docs.resume, coverLetter: !!docs.coverLetter };
    const resume = docs.resume.slice(0, MAX_RESUME_CHARS);
    const coverLetter = docs.coverLetter.slice(0, MAX_COVER_LETTER_CHARS);
    const posting = postingDescription.slice(0, MAX_POSTING_CHARS);
    const pages = Array.isArray(pagesResult?.pages) ? pagesResult.pages : [];
    // buildProjectStoriesBlock's own contract: "" (never a header with
    // nothing under it) whenever there is nothing eligible, which is what
    // keeps every prompt below byte-identical to today for a caller with no
    // project pages (lib/copilot/projectStories.js's own tests pin this).
    const { block: projectStories } = buildProjectStoriesBlock(pages);

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
        pages,
        projectStories,
      });
    }

    if (mode === "answer") {
      // Embedded engine: assemble the spoken answer on-device — no LLM.
      if (wantsEmbedded(body?.engine)) {
        // `points`/`answer` are reassigned below when a project page's own
        // STAR story replaces them.
        let { points, answer, type } = draftSampleAnswerLocal({
          question,
          profile,
          resume,
          coverLetter,
          interviewType: interviewTypeValue,
        });
        // The embedded engine has no model to weave project pages into a
        // narrative with (draftSampleAnswerLocal above never sees them), so
        // this is deliberately narrow rather than an attempt at the same
        // grounding the Gemini path gets: for a behavioral "tell me about a
        // time..." question, pick the ONE best-matching project page and
        // speak its own title as the Situation beat and its own bullets as
        // Action/Result — real, user-authored text, never a paraphrase.
        // Requires an actual bulleted story (starPointsFromStory returns null
        // for a title with no bullets), so a page that cannot support a real
        // STAR shape never displaces draftSampleAnswerLocal's own result.
        if (type === "behavioral") {
          const story = selectBestStory(pages, { question });
          const storyPoints = starPointsFromStory(story);
          if (storyPoints) {
            points = storyPoints;
            answer = deriveAnswerFromPoints(points);
          }
        }
        if (points.length === 0) {
          return Response.json({ error: "Could not generate an answer." }, { status: 502 });
        }
        return Response.json({
          points,
          // No model to ask on this path, so the cues are always the
          // deterministic shortening of the points just drafted.
          cues: deriveCues(points),
          answer,
          type,
          grounding,
          // Embedded engine: no model call at all, on either aid — the
          // established rule for every AI feature in this repo is that
          // engine choice governs whether a feature calls a model, and
          // idealProjectFor's deterministic path is this one's.
          ...(await answerAids({ postingDescription: posting, resume, profile, question, points, pages })),
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
              { text: buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor, projectStories }) },
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
      const points = Array.isArray(parsed?.points)
        ? parsed.points
            .filter((p) => typeof p === "string" && p.trim())
            .map((p) => p.trim())
            .slice(0, MAX_ANSWER_POINTS)
        : [];
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
        ...(await answerAids({ postingDescription: posting, resume, profile, question, points, generatedProjectPromise, pages })),
      });
    }

    // "points" mode — live mode's glanceable bullets, unchanged in shape
    // (AC-H9.34). Grounded in the submitted résumé/cover letter in addition
    // to the prep context (AC-H4.15); byte-identical to today when neither
    // was found (AC-H4.17/AC-H4.18).
    if (wantsEmbedded(body?.engine)) {
      const { points, type } = draftAnswerLocal({ question, profile, resume, coverLetter, interviewType: interviewTypeValue });
      if (points.length === 0) {
        return Response.json({ error: "Could not generate an answer." }, { status: 502 });
      }
      return Response.json({
        points,
        cues: deriveCues(points),
        type,
        // Embedded engine: no model call at all — see the answer-mode
        // branch above for the same rule stated once already.
        ...(await answerAids({ postingDescription: posting, resume, profile, question, points, pages })),
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
            { text: buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter, projectStories) },
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
    const points = Array.isArray(parsed?.points)
      ? parsed.points
          .filter((p) => typeof p === "string" && p.trim())
          .map((p) => p.trim())
          .slice(0, 6)
      : [];
    if (points.length === 0) {
      return Response.json({ error: "Could not generate an answer." }, { status: 502 });
    }
    const type = VALID_TYPES.includes(parsed?.type) ? parsed.type : "general";

    // Points mode's PROMPT still carries R-095's byte-identity guarantee for
    // a caller with none of resume/coverLetter/projectStories — buildPoints
    // Prompt only ever adds a block when it has something to add — the model
    // is not asked for cues here, so they are always derived.
    return Response.json({
      points,
      cues: deriveCues(points),
      type,
      ...(await answerAids({ postingDescription: posting, resume, profile, question, points, generatedProjectPromise, pages })),
    });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Answer request failed." },
      { status: 500 },
    );
  }
}
