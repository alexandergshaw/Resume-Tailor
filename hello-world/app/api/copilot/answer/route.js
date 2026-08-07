import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { draftAnswerLocal, deriveAnswerFromPoints } from "@/lib/copilot/answerLocal";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal";
import { fetchApplicationDocs, fetchPostingDescription } from "@/lib/copilot/applicationDocs";
import { submittedDocsPromptParts } from "@/lib/copilot/applicationDocsPrompt";
import { normalizeInterviewType, interviewType } from "@/lib/copilot/interviewTypes";
import { deriveCues, resolveCues } from "@/lib/copilot/answerCues";
import { postingBuzzwords } from "@/lib/copilot/postingBuzzwords";
import { resumeAnchor } from "@/lib/copilot/resumeAnchor";
import { idealProject as idealProjectFor } from "@/lib/copilot/idealProject";
import { buildIdealProjectPrompt, IDEAL_PROJECT_SYSTEM, normalizeIdealProject } from "@/lib/copilot/idealProjectPrompt";

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
  "When a CANDIDATE BACKGROUND section is provided, ground the points in it — reference their real companies, projects, metrics, and skills rather than inventing generic ones. Never fabricate experience the background does not support; if it is thin, give strong generic points instead.",
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
  "The answer must be built only from the material provided below — the candidate's prep notes and, when available, the résumé and cover letter they actually submitted for this application — never invented.",
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
function buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter) {
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
function buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor }) {
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
  if (context) {
    parts.push("", "Recent conversation (most recent last), for context:", context);
  }
  if (!resume && !coverLetter) {
    parts.push(
      "",
      "No submitted resume or cover letter was available for this application — build the answer from the candidate prep notes and conversation context alone.",
    );
  }
  parts.push(
    "",
    `Write the actual spoken answer the candidate should give, as 3-6 points — each one a complete, speakable sentence, not a fragment — together totalling roughly ${descriptor.lengthTarget.minWords}-${descriptor.lengthTarget.maxWords} words.`,
    "Each point is first person, spoken register — no bullet markers beyond the STAR label where it applies, no headings, no stage directions, nothing but words meant to be said out loud.",
    answerShapeInstruction(descriptor),
    "Every claim must come from the CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER above — select, order, and phrase freely, but never invent an employer, project, metric, or credential that isn't there. If the material is thin, give a shorter, honest answer rather than inventing detail.",
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
async function answerAids({ postingDescription, resume, profile, question, points, generatedProjectPromise }) {
  const anchorText = resume || profile;
  const anchor = resumeAnchor(anchorText, { question, points });
  // The FALLBACK, computed exactly as it always has been — never skipped,
  // because a missing or rejected model response must still leave the
  // candidate with an example rather than nothing.
  const deterministicProject = idealProjectFor(postingDescription, { question, points });
  const generatedProject = generatedProjectPromise ? await generatedProjectPromise : null;
  return {
    buzzwords: postingBuzzwords(postingDescription, { question, points }),
    // AC-K1.3 correction: `anchor` is mined from whichever of `resume` /
    // `profile` was actually non-empty — with no posting selected (the
    // common live-mode case), that is the free-text prep-context textarea,
    // not a résumé. `source` reports which one so the UI can word the label
    // honestly instead of always claiming "on your resume".
    resumeAnchor: anchor ? { ...anchor, source: resume ? "resume" : "prep" } : null,
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
    const [docs, postingDescription] = await Promise.all([
      fetchApplicationDocs(supabase, { applicationId, userId: user.id }),
      fetchPostingDescription(supabase, { applicationId, userId: user.id }),
    ]);
    const grounding = { resume: !!docs.resume, coverLetter: !!docs.coverLetter };
    const resume = docs.resume.slice(0, MAX_RESUME_CHARS);
    const coverLetter = docs.coverLetter.slice(0, MAX_COVER_LETTER_CHARS);
    const posting = postingDescription.slice(0, MAX_POSTING_CHARS);

    if (mode === "answer") {
      // Embedded engine: assemble the spoken answer on-device — no LLM.
      if (wantsEmbedded(body?.engine)) {
        const { points, answer, type } = draftSampleAnswerLocal({
          question,
          profile,
          resume,
          coverLetter,
          interviewType: interviewTypeValue,
        });
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
          ...(await answerAids({ postingDescription: posting, resume, profile, question, points })),
        });
      }

      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const responsePromise = client.models.generateContent({
        model: geminiModel,
        contents: [
          {
            role: "user",
            parts: [{ text: buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor }) }],
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
        ...(await answerAids({ postingDescription: posting, resume, profile, question, points, generatedProjectPromise })),
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
        ...(await answerAids({ postingDescription: posting, resume, profile, question, points })),
      });
    }

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    const responsePromise = client.models.generateContent({
      model: geminiModel,
      contents: [
        { role: "user", parts: [{ text: buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter) }] },
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

    // Points mode's PROMPT is untouched (AC-H4.17/R-095's byte-identity
    // requirement still holds — nothing above this line changed) — the model
    // is not asked for cues here, so they are always derived.
    return Response.json({
      points,
      cues: deriveCues(points),
      type,
      ...(await answerAids({ postingDescription: posting, resume, profile, question, points, generatedProjectPromise })),
    });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Answer request failed." },
      { status: 500 },
    );
  }
}
