import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { critiqueAnswerLocal, buildDeliveryNotes, normalizeMetrics } from "@/lib/copilot/critiqueLocal";
import { buildBodyLanguageFacts } from "@/lib/copilot/critiqueBodyLanguage";
import { normalizeInterviewType, interviewType as resolveInterviewType } from "@/lib/copilot/interviewTypes";
import { fetchApplicationDocs } from "@/lib/copilot/applicationDocs";
import { clampDocs, groundingFlags, submittedDocsPromptParts } from "@/lib/copilot/applicationDocsPrompt";

// Judges what a practice-mode candidate actually SAID in one recorded
// answer — C4, layered on top of C3's delivery metrics
// (lib/copilot/answerMetrics.js, lib/copilot/videoStats.js). Mirrors
// app/api/copilot/answer/route.js's shape: auth, caps, the wantsEmbedded
// branch, and a Gemini call with a system instruction. See AC-C4-1 for the
// exact response contract both paths must return.
//
// G2: `body.interviewType` (the selected practice format — see
// lib/copilot/interviewTypes.js) is normalized ONCE, alongside every other
// input, and threaded into both the embedded rubric and the Gemini prompt so
// a strong system-design answer and a strong phone-screen answer are judged
// against different bars (AC-G2-B-2, AC-G2-B-3, AC-G2-B-4).
//
// AC-H5: `body.applicationId` (the selected posting's own id — see
// PracticeClient's onDoneAnswer) is used to fetch the résumé/cover letter
// actually SUBMITTED for that application, server-side, via the same
// fetchApplicationDocs the answer route already uses — the client never
// sends document text, and any client-supplied `resume`/`coverLetter` field
// in the body is simply never read, so it cannot inject text labelled
// "submitted resume" into the prompt. With no applicationId, or when
// fetchApplicationDocs finds nothing (wrong user, no matching row, no
// document id), `docs` comes back `{ resume: "", coverLetter: "" }` and
// every code path below that reads `resume`/`coverLetter` degrades to
// exactly what it did before this existed (AC-H5.21) — see buildPrompt and
// critiqueAnswerLocal's own doc comments for how each keeps that promise.

const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 8000;
const MAX_PROFILE_CHARS = 8000;
const MAX_TITLE_CHARS = 200;
const MAX_COMPANY_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 4000;
// Same cap app/api/copilot/answer/route.js already applies to this field.
const MAX_APPLICATION_ID_CHARS = 100;
const VALID_TYPES = ["behavioral", "technical", "general"];

const MAX_FRAMES = 3;
// A 320px-wide JPEG at SNAPSHOT_QUALITY (see videoStats.js) is a few tens of
// KB in practice — this cap is generous headroom for a real frame while
// still rejecting anything absurd sent by a misbehaving client.
const MAX_FRAME_BYTES = 700 * 1024;
const JPEG_DATA_URL_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;

const MAX_LIST = 4;
const MAX_STRING_LEN = 400;
const MAX_VERDICT_LEN = 500;

function sanitizePosting(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? "").trim().slice(0, MAX_TITLE_CHARS);
  const company = String(raw.company ?? "").trim().slice(0, MAX_COMPANY_CHARS);
  const description = String(raw.description ?? "").trim().slice(0, MAX_DESCRIPTION_CHARS);
  if (!title && !company && !description) return null;
  return { title, company, description };
}

// A frame that's character-legal base64 but doesn't actually decode is
// still forwarded by a bare alphabet check — Buffer.from() is lenient and
// silently drops illegal characters instead of throwing, so this instead
// requires a valid length AND a round-trip match: a string that isn't
// really valid base64 re-encodes to something different from the input
// (BUG-6).
function isValidBase64(str) {
  if (!str || str.length % 4 !== 0) return false;
  try {
    const decoded = Buffer.from(str, "base64");
    if (decoded.length === 0) return false;
    return decoded.toString("base64") === str;
  } catch {
    return false;
  }
}

// Keeps only well-formed, decodable JPEG data URLs under the size cap,
// stripped down to bare base64 — exactly the payload shape
// posting-from-image's inlineData call expects (see
// app/api/posting-from-image/route.js). Anything else (wrong mime type,
// malformed data URL, undecodable payload, oversized payload) is silently
// dropped rather than rejecting the whole request over one bad frame.
function sanitizeFrames(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const match = item.match(JPEG_DATA_URL_RE);
    if (!match) continue;
    const base64 = match[1];
    if (!isValidBase64(base64)) continue;
    // Rough byte size from base64 length (~3 bytes per 4 chars) — good
    // enough for a cap; exactness doesn't matter, only order of magnitude.
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_FRAME_BYTES) continue;
    out.push(base64);
    if (out.length >= MAX_FRAMES) break;
  }
  return out;
}

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sanitizeStringList(list, max = MAX_LIST, maxLen = MAX_STRING_LEN) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

// `star` is only ever populated for a behavioral question (AC-C4-1) —
// forced null for any other type regardless of what the model (or the
// embedded rubric, defensively) handed back, so a technical/general
// question can never come back with four STAR indicators (BUG-4).
function sanitizeStar(star, type) {
  if (type !== "behavioral") return null;
  if (!star || typeof star !== "object") return null;
  return {
    situation: !!star.situation,
    task: !!star.task,
    action: !!star.action,
    result: !!star.result,
  };
}

// BUG-12: tolerant enough to recognise "Body language:", "Body-language —",
// "BODYLANGUAGE –" etc. as already-prefixed, not only the one exact phrase
// with a literal space — a model that varies its own punctuation/casing
// must not get double-prefixed ("Body language: Body-language: ..."), and
// this same pattern is what both sanitizeCritique (below) and
// AnswerFeedback.js use to recognise a body-language item inside `delivery`
// regardless of which engine produced it.
const BODY_LANGUAGE_PREFIX_RE = /^body[\s-]*language\b/i;

function isBodyLanguageLine(s) {
  return typeof s === "string" && BODY_LANGUAGE_PREFIX_RE.test(s.trim());
}

// The body-language line can fold up to four separate facts (head
// orientation, posture, gestures, framing) into one sentence — MAX_STRING_LEN
// (400) is sized for a single short delivery note like "You spoke for..."
// and was silently truncating the framing fact off the end of a fully
// measured answer's line (BUG-2). Generous headroom over the realistic
// worst case (observed ~470-700 characters) rather than unbounded.
const MAX_BODY_LANGUAGE_LEN = 1000;

// D3: turns whatever the model returned for its own `bodyLanguage` field
// (see buildPrompt's schema below) into one delivery-array line, tagged
// with the same "Body language:" prefix critiqueLocal.js's own
// bodyLanguageDeliveryNote uses — so the feedback panel (AnswerFeedback.js)
// can split body-language content back out of `delivery` regardless of
// which engine produced it. Anything that isn't a non-empty string (a
// missing field, an object, a number the model hallucinated) is dropped
// silently rather than surfaced, matching how every other model field here
// degrades on malformed input instead of throwing.
function bodyLanguageLineFromModel(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const line = BODY_LANGUAGE_PREFIX_RE.test(trimmed) ? trimmed : `Body language: ${trimmed}`;
  return line.slice(0, MAX_BODY_LANGUAGE_LEN);
}

// Enforces the AC-C4-1 contract on ANY candidate result — the embedded
// path's own output (already correctly shaped, but run through here too as
// a safety net) and Gemini's parsed JSON alike — so a malformed model
// response never reaches the client. `source` is always the path THIS
// route actually took (never read from `raw.source`): it's the user's only
// signal for which engine produced their feedback, and a Gemini response
// must never be able to mislabel itself "embedded" or vice versa (BUG-3).
//
// D3: the response contract stays locked to its existing eight keys (see
// route.test.js's "drops any unexpected field" case) — body-language
// content is folded into the existing `delivery` list rather than given a
// new top-level field. The embedded path already builds its own
// body-language line straight into `raw.delivery` (critiqueLocal.js's
// buildDeliveryNotes, which self-gates on metrics.bodyLanguage — no extra
// gating needed here for that path); the Gemini path's separate
// `raw.bodyLanguage` string (see buildPrompt) is a second possible source.
// Whichever source produced it:
// - BUG-1: it is given its OWN reserved slot (`MAX_LIST - 1` for
//   everything else, one guaranteed slot for this) rather than competing
//   with pace/filler/camera/mic or the model's own up-to-four delivery
//   items for the same MAX_LIST cap — previously it was appended last and
//   then silently sliced away whenever the rest of the list was already
//   full, which was the common case, not an edge case.
// - BUG-2: it gets its own longer MAX_BODY_LANGUAGE_LEN clamp instead of
//   the per-item MAX_STRING_LEN every other short note uses, so a fully
//   measured line does not get cut off mid-sentence.
// - BUG-4: `allowBodyLanguage` gates the WHOLE channel, not just the
//   model's dedicated field — a body-language-prefixed item the model
//   wrote straight into its own `delivery` array is dropped the same way
//   `raw.bodyLanguage` is when nothing was measured and no frames were
//   sent (AC-D3-2), so a model cannot bypass the gate just by using the
//   other field.
function sanitizeCritique(raw, source, type, { allowBodyLanguage = true } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const deliveryRaw = Array.isArray(r.delivery) ? r.delivery : [];
  const otherDelivery = deliveryRaw.filter((s) => !isBodyLanguageLine(s));
  const embeddedBodyLanguageLines = allowBodyLanguage ? deliveryRaw.filter((s) => isBodyLanguageLine(s)) : [];
  const modelBodyLanguageLine = allowBodyLanguage ? bodyLanguageLineFromModel(r.bodyLanguage) : null;
  const bodyLanguageLine = embeddedBodyLanguageLines.length
    ? embeddedBodyLanguageLines
        .map((s) => String(s).trim())
        .join(" ")
        .slice(0, MAX_BODY_LANGUAGE_LEN)
    : modelBodyLanguageLine;
  const delivery = bodyLanguageLine
    ? [...sanitizeStringList(otherDelivery, MAX_LIST - 1), bodyLanguageLine]
    : sanitizeStringList(otherDelivery);
  return {
    score: clampScore(r.score),
    verdict:
      typeof r.verdict === "string" && r.verdict.trim()
        ? r.verdict.trim().slice(0, MAX_VERDICT_LEN)
        : "No verdict was returned.",
    strengths: sanitizeStringList(r.strengths),
    improvements: sanitizeStringList(r.improvements),
    missing: sanitizeStringList(r.missing),
    star: sanitizeStar(r.star, type),
    delivery,
    source,
  };
}

// A parsed Gemini response is only trustworthy enough to use directly when
// it at least has a real numeric score and a non-empty verdict — anything
// short of that is treated the same as a network failure or a parse
// failure: fall back to the deterministic rubric rather than surface a
// mostly-empty "gemini" result.
function looksLikeCritique(parsed) {
  return (
    !!parsed &&
    typeof parsed === "object" &&
    Number.isFinite(Number(parsed.score)) &&
    typeof parsed.verdict === "string" &&
    parsed.verdict.trim().length > 0
  );
}

// Every caller of critiqueAnswerLocal below goes through this wrapper
// instead. Inputs are normalized/validated exactly once, before either the
// embedded or Gemini branch runs (question/type/answer/posting/profile/
// metrics are all already-sanitized values by the time any of these calls
// happen) — but the FALLBACK call specifically must not be able to re-throw
// on whatever just made the Gemini branch fail, which would turn a
// recoverable failure into an unhandled 500 and break the AC's promise that
// the user always keeps their feedback (BUG-5).
function safeCritiqueAnswerLocal(inputs) {
  try {
    return critiqueAnswerLocal(inputs);
  } catch {
    return {
      score: 0,
      verdict: "Could not analyze this answer.",
      strengths: [],
      improvements: [],
      missing: [],
      star: null,
      delivery: [],
      source: "embedded",
    };
  }
}

const BASE_SYSTEM = [
  "You are an interview coach giving direct, honest feedback on ONE practice interview answer.",
  "Be specific and evidence-based. No flattery and no generic praise — every claim must be grounded in the actual answer text or the measured delivery facts provided below.",
  "When a CANDIDATE BACKGROUND section is supplied, judge whether the answer actually draws on the candidate's real experience, versus reading as generic.",
  "The MEASURED DELIVERY METRICS section was already computed from the recording. Treat those numbers as ground truth: cite them in your delivery notes, do not re-estimate pace, filler count, or timing yourself.",
].join(" ");

function visualInstruction(hasFrames) {
  return hasFrames
    ? "Up to three still frames from the recording are attached as images. Any visual observation (framing, lighting, posture, expression) must be based ONLY on what is actually visible in these attached frames — never speculate beyond them."
    : "No video frames were supplied for this answer. Make NO visual claims whatsoever — nothing about appearance, framing, lighting, posture, or expression.";
}

// AC-H5: only ever appended to the system instruction when a SUBMITTED
// RESUME and/or SUBMITTED COVER LETTER section was actually added to the
// prompt (see buildPrompt) — omitted entirely otherwise, which is what keeps
// the "no applicationId, or no documents found" case byte-identical to
// before this existed (AC-H5.21).
function submittedDocsInstruction() {
  return "When SUBMITTED RESUME and/or SUBMITTED COVER LETTER sections are supplied, judge whether the answer actually draws on what the candidate submitted for THIS specific application — not just their general prep notes — the same way you already judge the CANDIDATE BACKGROUND section.";
}

// D3: the body-language rules the standard sets (lib/copilot/bodyLanguage.js,
// restated in AC-D3), addressed to the model specifically — on top of, not
// instead of, visualInstruction above. A head-pose measurement is not a
// verified eye-contact measurement, so the model is barred from the eye
// contact/gaze/attention vocabulary the same way the deterministic rubric
// is; and since three still frames can show posture and framing but cannot
// show how someone felt, the model is barred from any emotion/confidence/
// personality/appearance read regardless of what it thinks it sees.
function bodyLanguageInstruction(hasFrames) {
  const rules = [
    "Body-language rules: a camera can only measure head orientation, posture (tilt, lean, slouch), hand movement, and framing (position and fill in frame) — nothing else.",
    "Describe head orientation only as facing the camera or head orientation — never as eye contact, gaze, or attention; a head-pose measurement is not a verified eye-contact measurement.",
    "Hands that were out of frame, or not visible enough to measure movement, must be reported as NOT MEASURED — never as stillness. An unmeasured hand is not the same as a still one.",
    "Never characterise emotion, confidence, nerves, or personality, and never comment on appearance, attractiveness, or any aspect of the person's body other than posture, orientation, and motion.",
    "Treat any MEASURED BODY LANGUAGE facts below as ground truth — never contradict them or re-estimate a number they already give you.",
    "Do not comment on any body-language signal that is absent from the MEASURED BODY LANGUAGE facts below and not visible in an attached frame — an absent signal was not measured, so say nothing about it rather than guessing.",
    hasFrames
      ? "Any visual body-language observation must be based ONLY on what is actually visible in the attached frames."
      : "No frames were supplied, so make no visual body-language claims at all — you may still cite the MEASURED BODY LANGUAGE facts below, if any, but must not describe what anything looked like.",
    "When body language was not measured and no frames were supplied, return bodyLanguage as an empty string rather than inventing generic filler.",
  ];
  return rules.join(" ");
}

// AC-G2-B-3: names the interview FORMAT being judged — distinct from
// `type`, the question's own behavioral/technical/general classification —
// and instructs the model to score against that format's bar specifically,
// so a strong system-design answer and a strong phone-screen answer aren't
// held to the same standard.
function interviewFormatSection(descriptor) {
  const { minWords, maxWords } = descriptor.lengthTarget;
  return [
    "--- INTERVIEW FORMAT ---",
    `${descriptor.label} interview. ${descriptor.guidance}`,
    `Judge this answer against the standard for THIS format specifically, not a generic one. ` +
      `Weight these most: ${descriptor.emphasis.join(", ")}. ` +
      `The ideal spoken length for this format is roughly ${minWords}-${maxWords} words.`,
  ];
}

function buildPrompt({
  question,
  type,
  answer,
  posting,
  profile,
  metricsFacts,
  bodyLanguageFacts,
  descriptor,
  resume,
  coverLetter,
}) {
  const parts = [
    `The candidate was asked this ${type} interview question: "${question}"`,
    "",
    "Their answer (as transcribed):",
    answer || "(no speech was captured for this answer)",
    "",
    ...interviewFormatSection(descriptor),
  ];
  if (profile) {
    parts.push("", "--- CANDIDATE BACKGROUND (resume / target role / prep notes) ---", profile);
  }
  if (posting?.title || posting?.company || posting?.description) {
    parts.push(
      "",
      "--- JOB POSTING ---",
      [posting.title, posting.company].filter(Boolean).join(" at "),
      posting.description || "",
    );
  }
  // AC-H5.21: submittedDocsPromptParts is only ever called here when there is
  // something to say — `resume`/`coverLetter` are both "" in the byte-
  // identical "no applicationId, or no documents found" case, so this branch
  // is skipped entirely rather than calling the helper and discarding its
  // "no submitted resume or cover letter" note. That note exists in
  // applicationDocsPrompt.js for answer-mode's framing; this prompt has never
  // had an equivalent sentence, and adding one here would break byte-
  // identity for exactly the case that must stay unchanged. See that
  // module's own doc comment, which names this exact trap.
  if (resume || coverLetter) {
    parts.push(...submittedDocsPromptParts({ resume, coverLetter }));
  }
  parts.push("", "--- MEASURED DELIVERY METRICS (ground truth — cite these, do not re-estimate) ---");
  for (const fact of metricsFacts) parts.push(`- ${fact}`);
  if (bodyLanguageFacts.length) {
    parts.push(
      "",
      "--- MEASURED BODY LANGUAGE (ground truth — cite these, do not re-estimate; add visual detail ONLY from attached frames, never contradicting these) ---",
    );
    for (const fact of bodyLanguageFacts) parts.push(`- ${fact}`);
  }
  parts.push(
    "",
    'Return ONLY JSON of this exact shape: { "score": number, "verdict": string, "strengths": string[], "improvements": string[], "missing": string[], "star": object | null, "delivery": string[], "bodyLanguage": string }',
    "score: 0-100 integer, an overall judgement of this answer's substance.",
    "verdict: one plain-language sentence.",
    "strengths: at most 4 short items — what the answer did well. Empty if the answer captured no real speech.",
    "improvements: at most 4 short items — concrete, actionable fixes.",
    "missing: at most 4 short items — what the question or job posting expected that the answer skipped.",
    'star: for a BEHAVIORAL question only, { "situation": boolean, "task": boolean, "action": boolean, "result": boolean } reflecting which STAR beats the answer actually covered. For technical or general questions, this must be null.',
    "delivery: at most 4 short items grounded in the MEASURED DELIVERY METRICS above — do not invent numbers not given there.",
    "bodyLanguage: one short sentence about head orientation, posture, hand movement, or framing only — grounded in the MEASURED BODY LANGUAGE facts above and/or what is actually visible in attached frames. An empty string when body language was not measured and no frames were supplied — never generic filler.",
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
      return Response.json({ error: "Sign in to use the interview copilot." }, { status: 401 });
    }

    // Every input is normalized/validated ONCE, here, before either branch
    // below runs — so the embedded path, the Gemini path, and the Gemini
    // path's own fallback all operate on the exact same sanitized values
    // (BUG-5), and nothing downstream ever sees raw client input.
    const body = await request.json();
    const question = (body?.question ?? "").toString().trim().slice(0, MAX_QUESTION_CHARS);
    const type = VALID_TYPES.includes(body?.type) ? body.type : "general";
    const answer = (body?.answer ?? "").toString().slice(0, MAX_ANSWER_CHARS);
    const posting = sanitizePosting(body?.posting);
    const profile = (body?.profile ?? "").toString().slice(0, MAX_PROFILE_CHARS);
    const metrics = normalizeMetrics(body?.metrics);
    // AC-G2-B-2: normalized once here, same as every other input above, then
    // passed to both the embedded rubric and the Gemini prompt below.
    const interviewType = normalizeInterviewType(body?.interviewType);
    // AC-H5: an applicationId string, capped the same way the answer route
    // caps it. Note there is deliberately no `body?.resume`/`body?.coverLetter`
    // read anywhere in this file — the ONLY source for those values is the
    // fetchApplicationDocs call below, keyed off this id and the signed-in
    // user, so a client cannot inject arbitrary text labelled "submitted
    // resume" into the prompt (AC-H5.20).
    const applicationId = (body?.applicationId ?? "").toString().trim().slice(0, MAX_APPLICATION_ID_CHARS);
    const docs = await fetchApplicationDocs(supabase, { applicationId, userId: user.id });
    const grounding = groundingFlags(docs);
    const { resume, coverLetter } = clampDocs(docs);

    // Embedded engine: a real deterministic rubric, no LLM call. Frames are
    // ignored entirely on this path — there is nothing to send them to.
    if (wantsEmbedded(body?.engine)) {
      const result = safeCritiqueAnswerLocal({
        question,
        type,
        answer,
        posting,
        profile,
        metrics,
        interviewType,
        resume,
        coverLetter,
      });
      return Response.json(sanitizeCritique(result, "embedded", type));
    }

    const frames = sanitizeFrames(body?.frames);
    const descriptor = resolveInterviewType(interviewType);

    // A Gemini failure or an unparseable response must not error out
    // mid-practice — fall back to the same deterministic rubric the
    // embedded engine uses, and report the fallback honestly.
    try {
      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const metricsFacts = buildDeliveryNotes(metrics);
      const bodyLanguageFacts = buildBodyLanguageFacts(metrics.bodyLanguage);
      const prompt = buildPrompt({
        question,
        type,
        answer,
        posting,
        profile,
        metricsFacts,
        bodyLanguageFacts,
        descriptor,
        resume,
        coverLetter,
      });
      const frameParts = frames.map((base64) => ({ inlineData: { mimeType: "image/jpeg", data: base64 } }));
      const systemInstruction = [
        BASE_SYSTEM,
        visualInstruction(frames.length > 0),
        bodyLanguageInstruction(frames.length > 0),
        // AC-H5.21: appended only when a documents section was actually
        // added to the prompt above — omitted entirely otherwise, so the
        // "no documents" case's systemInstruction stays byte-identical.
        ...(grounding.resume || grounding.coverLetter ? [submittedDocsInstruction()] : []),
      ].join(" ");

      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [...frameParts, { text: prompt }] }],
        config: { systemInstruction, responseMimeType: "application/json" },
      });

      const parsed = parseModelJson(response.text?.trim() || "");
      if (!looksLikeCritique(parsed)) {
        const fallback = safeCritiqueAnswerLocal({
          question,
          type,
          answer,
          posting,
          profile,
          metrics,
          interviewType,
          resume,
          coverLetter,
        });
        return Response.json(sanitizeCritique(fallback, "embedded", type));
      }
      const allowBodyLanguage = bodyLanguageFacts.length > 0 || frames.length > 0;
      return Response.json(sanitizeCritique(parsed, "gemini", type, { allowBodyLanguage }));
    } catch {
      const fallback = safeCritiqueAnswerLocal({
        question,
        type,
        answer,
        posting,
        profile,
        metrics,
        interviewType,
        resume,
        coverLetter,
      });
      return Response.json(sanitizeCritique(fallback, "embedded", type));
    }
  } catch (err) {
    return Response.json({ error: err?.message || "Critique request failed." }, { status: 500 });
  }
}
