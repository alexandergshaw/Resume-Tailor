import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { draftAnswerLocal } from "@/lib/copilot/answerLocal";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal";
import { fetchApplicationDocs } from "@/lib/copilot/applicationDocs";
import { normalizeInterviewType, interviewType } from "@/lib/copilot/interviewTypes";

// Two modes on one route (AC-G2-D-1). "points" (default, and the only mode
// live mode ever sends — CopilotClient/QuestionFeed call draftAnswer with no
// mode at all) keeps today's glanceable bullet points, unchanged. "answer"
// is practice mode's new sample answer: one paragraph of spoken, first-person
// prose the candidate could actually say, grounded in their prep notes and
// the résumé/cover letter they actually submitted for the selected
// application (lib/copilot/applicationDocs.js). An unknown or missing mode
// is always treated as "points" — nothing about live mode's request or
// response shape changes.
const POINTS_SYSTEM = [
  "You are an interview coach helping a candidate answer questions during a LIVE interview.",
  "Given the question the interviewer just asked, produce concise talking points the candidate can glance at and speak from — NOT a script to read aloud.",
  "Return 3-5 short bullet points; each is one phrase or short sentence, specific and substantive.",
  "When a CANDIDATE BACKGROUND section is provided, ground the points in it — reference their real companies, projects, metrics, and skills rather than inventing generic ones. Never fabricate experience the background does not support; if it is thin, give strong generic points instead.",
  "For behavioral questions (\"tell me about a time...\"), prefix each point with its STAR label — \"Situation:\", \"Task:\", \"Action:\", \"Result:\".",
  "Keep every point skimmable — a person on camera must absorb it in a glance.",
].join(" ");

// AC-G2-D-3 / AC-G2-D-4: the answer must be built only from what was actually
// submitted (or the prep context, when nothing was submitted), and must read
// as something a person says out loud, not an essay.
const ANSWER_SYSTEM = [
  "You are an interview coach drafting ONE sample answer a candidate could actually say out loud in a real interview.",
  "The answer must be built only from the material provided below — the candidate's prep notes and, when available, the résumé and cover letter they actually submitted for this application — never invented.",
  "Write natural spoken language: first person, no bullet points, no headings, no stage directions, nothing that isn't meant to be spoken aloud.",
].join(" ");

const MAX_CONTEXT_CHARS = 4000;
const MAX_PROFILE_CHARS = 8000;
const MAX_RESUME_CHARS = 12000;
const MAX_COVER_LETTER_CHARS = 6000;
const MAX_ANSWER_CHARS = 6000;
const MAX_APPLICATION_ID_CHARS = 100;
const VALID_TYPES = ["behavioral", "technical", "general"];

function interviewFormatLines(descriptor) {
  return [
    "--- INTERVIEW FORMAT ---",
    `This is a ${descriptor.label} interview. ${descriptor.guidance}`,
    `Emphasize: ${descriptor.emphasis.join(", ")}.`,
  ];
}

function buildPointsPrompt(question, context, profile, descriptor) {
  const parts = [`The interviewer asked: "${question}"`, "", ...interviewFormatLines(descriptor)];
  if (profile) {
    parts.push(
      "",
      "--- CANDIDATE BACKGROUND (their resume / target role / prep notes; use to personalize) ---",
      profile,
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
    `Write the actual spoken answer the candidate should give, roughly ${descriptor.lengthTarget.minWords}-${descriptor.lengthTarget.maxWords} words.`,
    "First person, spoken register — no bullet markers, no headings, no stage directions, nothing but words meant to be said out loud.",
    answerShapeInstruction(descriptor),
    "Every claim must come from the CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER above — select, order, and phrase freely, but never invent an employer, project, metric, or credential that isn't there. If the material is thin, give a shorter, honest answer rather than inventing detail.",
    'Return ONLY JSON of this exact shape: { "answer": string, "type": "behavioral" | "technical" | "general" }',
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
    const applicationId = (body?.applicationId ?? "").toString().trim().slice(0, MAX_APPLICATION_ID_CHARS);

    if (mode === "answer") {
      const docs = await fetchApplicationDocs(supabase, { applicationId, userId: user.id });
      const grounding = { resume: !!docs.resume, coverLetter: !!docs.coverLetter };
      const resume = docs.resume.slice(0, MAX_RESUME_CHARS);
      const coverLetter = docs.coverLetter.slice(0, MAX_COVER_LETTER_CHARS);

      // Embedded engine: assemble the spoken answer on-device — no LLM.
      if (wantsEmbedded(body?.engine)) {
        const { answer, type } = draftSampleAnswerLocal({
          question,
          profile,
          resume,
          coverLetter,
          interviewType: interviewTypeValue,
        });
        if (!answer) {
          return Response.json({ error: "Could not generate an answer." }, { status: 502 });
        }
        return Response.json({ answer, type, grounding });
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
      const answer = typeof parsed?.answer === "string" ? parsed.answer.trim().slice(0, MAX_ANSWER_CHARS) : "";
      if (!answer) {
        return Response.json({ error: "Could not generate an answer." }, { status: 502 });
      }
      const type = VALID_TYPES.includes(parsed?.type) ? parsed.type : "general";
      return Response.json({ answer, type, grounding });
    }

    // "points" mode — live mode's glanceable bullets, unchanged in shape.
    if (wantsEmbedded(body?.engine)) {
      const { points, type } = draftAnswerLocal({ question, profile, interviewType: interviewTypeValue });
      if (points.length === 0) {
        return Response.json({ error: "Could not generate an answer." }, { status: 502 });
      }
      return Response.json({ points, type });
    }

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: buildPointsPrompt(question, context, profile, descriptor) }] }],
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
