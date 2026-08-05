import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { critiqueAnswerLocal, buildDeliveryNotes, normalizeMetrics } from "@/lib/copilot/critiqueLocal";

// Judges what a practice-mode candidate actually SAID in one recorded
// answer — C4, layered on top of C3's delivery metrics
// (lib/copilot/answerMetrics.js, lib/copilot/videoStats.js). Mirrors
// app/api/copilot/answer/route.js's shape: auth, caps, the wantsEmbedded
// branch, and a Gemini call with a system instruction. See AC-C4-1 for the
// exact response contract both paths must return.

const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 8000;
const MAX_PROFILE_CHARS = 8000;
const MAX_TITLE_CHARS = 200;
const MAX_COMPANY_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 4000;
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

// Enforces the AC-C4-1 contract on ANY candidate result — the embedded
// path's own output (already correctly shaped, but run through here too as
// a safety net) and Gemini's parsed JSON alike — so a malformed model
// response never reaches the client. `source` is always the path THIS
// route actually took (never read from `raw.source`): it's the user's only
// signal for which engine produced their feedback, and a Gemini response
// must never be able to mislabel itself "embedded" or vice versa (BUG-3).
function sanitizeCritique(raw, source, type) {
  const r = raw && typeof raw === "object" ? raw : {};
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
    delivery: sanitizeStringList(r.delivery),
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

function buildPrompt({ question, type, answer, posting, profile, metricsFacts }) {
  const parts = [
    `The candidate was asked this ${type} interview question: "${question}"`,
    "",
    "Their answer (as transcribed):",
    answer || "(no speech was captured for this answer)",
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
  parts.push("", "--- MEASURED DELIVERY METRICS (ground truth — cite these, do not re-estimate) ---");
  for (const fact of metricsFacts) parts.push(`- ${fact}`);
  parts.push(
    "",
    'Return ONLY JSON of this exact shape: { "score": number, "verdict": string, "strengths": string[], "improvements": string[], "missing": string[], "star": object | null, "delivery": string[] }',
    "score: 0-100 integer, an overall judgement of this answer's substance.",
    "verdict: one plain-language sentence.",
    "strengths: at most 4 short items — what the answer did well. Empty if the answer captured no real speech.",
    "improvements: at most 4 short items — concrete, actionable fixes.",
    "missing: at most 4 short items — what the question or job posting expected that the answer skipped.",
    'star: for a BEHAVIORAL question only, { "situation": boolean, "task": boolean, "action": boolean, "result": boolean } reflecting which STAR beats the answer actually covered. For technical or general questions, this must be null.',
    "delivery: at most 4 short items grounded in the MEASURED DELIVERY METRICS above — do not invent numbers not given there.",
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

    // Embedded engine: a real deterministic rubric, no LLM call. Frames are
    // ignored entirely on this path — there is nothing to send them to.
    if (wantsEmbedded(body?.engine)) {
      const result = safeCritiqueAnswerLocal({ question, type, answer, posting, profile, metrics });
      return Response.json(sanitizeCritique(result, "embedded", type));
    }

    const frames = sanitizeFrames(body?.frames);

    // A Gemini failure or an unparseable response must not error out
    // mid-practice — fall back to the same deterministic rubric the
    // embedded engine uses, and report the fallback honestly.
    try {
      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const metricsFacts = buildDeliveryNotes(metrics);
      const prompt = buildPrompt({ question, type, answer, posting, profile, metricsFacts });
      const frameParts = frames.map((base64) => ({ inlineData: { mimeType: "image/jpeg", data: base64 } }));
      const systemInstruction = [BASE_SYSTEM, visualInstruction(frames.length > 0)].join(" ");

      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [...frameParts, { text: prompt }] }],
        config: { systemInstruction, responseMimeType: "application/json" },
      });

      const parsed = parseModelJson(response.text?.trim() || "");
      if (!looksLikeCritique(parsed)) {
        const fallback = safeCritiqueAnswerLocal({ question, type, answer, posting, profile, metrics });
        return Response.json(sanitizeCritique(fallback, "embedded", type));
      }
      return Response.json(sanitizeCritique(parsed, "gemini", type));
    } catch {
      const fallback = safeCritiqueAnswerLocal({ question, type, answer, posting, profile, metrics });
      return Response.json(sanitizeCritique(fallback, "embedded", type));
    }
  } catch (err) {
    return Response.json({ error: err?.message || "Critique request failed." }, { status: 500 });
  }
}
