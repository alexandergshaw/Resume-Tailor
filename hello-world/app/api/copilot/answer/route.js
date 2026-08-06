import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { draftAnswerLocal, deriveAnswerFromPoints } from "@/lib/copilot/answerLocal";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal";
import { fetchApplicationDocs } from "@/lib/copilot/applicationDocs";
import { submittedDocsPromptParts } from "@/lib/copilot/applicationDocsPrompt";
import { normalizeInterviewType, interviewType } from "@/lib/copilot/interviewTypes";

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
// request or response shape changes.
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
].join(" ");

const MAX_CONTEXT_CHARS = 4000;
const MAX_PROFILE_CHARS = 8000;
const MAX_RESUME_CHARS = 12000;
const MAX_COVER_LETTER_CHARS = 6000;
const MAX_ANSWER_CHARS = 6000;
const MAX_ANSWER_POINTS = 6;
const MAX_APPLICATION_ID_CHARS = 100;
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
    'Return ONLY JSON of this exact shape: { "points": string[], "type": "behavioral" | "technical" | "general" }',
  );
  return parts.join("\n");
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
    const docs = await fetchApplicationDocs(supabase, { applicationId, userId: user.id });
    const grounding = { resume: !!docs.resume, coverLetter: !!docs.coverLetter };
    const resume = docs.resume.slice(0, MAX_RESUME_CHARS);
    const coverLetter = docs.coverLetter.slice(0, MAX_COVER_LETTER_CHARS);

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
        return Response.json({ points, answer, type, grounding });
      }

      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [
          {
            role: "user",
            parts: [{ text: buildAnswerPrompt({ question, context, profile, resume, coverLetter, descriptor }) }],
          },
        ],
        config: { systemInstruction: ANSWER_SYSTEM, responseMimeType: "application/json" },
      });

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
      return Response.json({ points, answer, type, grounding });
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
      return Response.json({ points, type });
    }

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [
        { role: "user", parts: [{ text: buildPointsPrompt(question, context, profile, descriptor, resume, coverLetter) }] },
      ],
      config: { systemInstruction: POINTS_SYSTEM, responseMimeType: "application/json" },
    });

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

    return Response.json({ points, type });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Answer request failed." },
      { status: 500 },
    );
  }
}
