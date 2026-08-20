// AC-Q8 - POST /api/copilot/role-response.
//
// Serves the model answer for the "Speak as" drill. Same auth gate, engine
// selection and fallback discipline as app/api/copilot/question/route.js:
// `wantsEmbedded` picks the deterministic path with no network and no key;
// otherwise Gemini drafts the lines, but the register's own cadence,
// vocabulary and avoid list are NEVER authored by the model, and the
// model's line labels are always replaced, positionally, by the register's
// own beatLabels (AC-Q8.3).
//
// The panel this feeds prints two claims directly under the answer: "these
// are the terms of art for this role" and "the ones marked used really are
// used in this answer." Both have to stay true on Gemini, the DEFAULT
// engine, not just on the deterministic path - so a model answer is
// rejected (falls back to roleResponseLocal) whenever it would make either
// claim false: fewer than two of the role's own terms actually appear, or
// the answer says a phrase from the role's own do-not-say list. See
// AC-Q8.4 - those two checks are the reason this route exists as more than
// a thin proxy to the model.
//
// On Gemini every situation after the first carries a `generated-<hash>` id
// that is never in the bank — if the model then fails, roleResponseLocal has
// no beats for that scene and answers with the role's generic, situation-
// agnostic shape instead. `situationMatched` (from roleResponseLocal, or
// forced true here on a genuine model answer) says which one happened, so
// the panel can caption a generic answer honestly instead of silently
// showing it under a scene it was never actually about.

import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { roleRegister, normalizeRole } from "@/lib/copilot/roleRegisters";
import { roleResponseLocal, termsUsedIn, avoidHitsIn } from "@/lib/copilot/roleResponse";

const MAX_SITUATION_ID_CHARS = 200;
const MAX_SITUATION_PROMPT_CHARS = 600;
const MIN_TERMS_USED = 2;
// A spoken beat line runs a sentence or two (AC-Q7.4 caps the WHOLE
// deterministic answer at 190 words); this is a generous but real ceiling on
// a single model-authored line before it reaches the screen — there was
// previously no bound at all on that text.
const MAX_LINE_TEXT_CHARS = 500;

const SYSTEM = [
  "You write exactly ONE model answer, in a specific professional role's voice, to a workplace situation that",
  "role has just been asked to respond to out loud.",
  "Follow the role's guidance and speak in its register. Use its terms of art where they genuinely fit.",
  "Never say any of the role's listed do-not-say phrases, in any form.",
  "Produce exactly one line per requested beat, in the given order, each a complete sentence a person could",
  "actually say out loud.",
].join(" ");

function sanitizeSituationId(raw) {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_SITUATION_ID_CHARS) : "";
}

function sanitizeSituationPrompt(raw) {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_SITUATION_PROMPT_CHARS) : "";
}

function localResponse({ role, situationId, situationPrompt }, source) {
  const result = roleResponseLocal({ role, situationId, situationPrompt });
  return Response.json({ role, ...result, source });
}

function buildPrompt(register, situationPrompt) {
  const parts = [
    register.guidance,
    "",
    "The situation you are responding to, as the person in this role, is:",
    situationPrompt,
    "",
    "Speak in this role's register. Use these terms of art where they genuinely fit " +
      "(do not force all of them in):",
    register.vocabulary.map((v) => `- ${v.term}`).join("\n"),
    "",
    "Never say any of these phrases - they are register violations for this role:",
    register.avoid.map((a) => `- "${a.phrase}"`).join("\n"),
    "",
    "Produce exactly one line per beat, in this exact order:",
    register.beatLabels.map((label) => `- ${label}`).join("\n"),
    "",
    "Each line's text must be a complete sentence a person could say out loud - " +
      "capitalized, ending in punctuation, at least a few words long, no placeholders.",
    "",
    'Return ONLY JSON of this exact shape: { "lines": [ { "label": string, "text": string } ] }',
  ];
  return parts.join("\n");
}

// Whether a Gemini answer is trustworthy enough for the panel that reads
// termsUsed and avoid off of it verbatim (AC-Q8.4). `lines` here already has
// its labels replaced by the register's own beatLabels — only `text` came
// from the model.
function isUsableModelAnswer(register, lines) {
  if (!Array.isArray(lines) || lines.length !== register.beatLabels.length) return false;
  if (lines.some((l) => !l.text || !l.text.trim())) return false;
  if (termsUsedIn(register.value, lines).length < MIN_TERMS_USED) return false;
  if (avoidHitsIn(register.value, lines).length > 0) return false;
  return true;
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

    let body;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object") body = {};

    const role = normalizeRole(body.role);
    const situationId = sanitizeSituationId(body.situationId) || "no-situation-id";
    const situationPrompt = sanitizeSituationPrompt(body.situationPrompt);

    if (wantsEmbedded(body.engine)) {
      return localResponse({ role, situationId, situationPrompt }, "embedded");
    }

    try {
      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const register = roleRegister(role);
      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: buildPrompt(register, situationPrompt) }] }],
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
      });

      const parsed = parseModelJson(response.text?.trim() || "");
      const rawLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
      // The model's labels are never trusted (AC-Q8.3) — replaced
      // positionally by the register's own beatLabels before anything else
      // looks at these lines, including the fallback checks below. The text
      // is also capped (MAX_LINE_TEXT_CHARS) before it reaches anything
      // downstream, including the checks below and, on success, the screen.
      const lines = rawLines.map((l, i) => ({
        label: register.beatLabels[i] ?? register.beatLabels[register.beatLabels.length - 1],
        text: typeof l?.text === "string" ? l.text.trim().slice(0, MAX_LINE_TEXT_CHARS) : "",
      }));

      if (!isUsableModelAnswer(register, lines)) {
        return localResponse({ role, situationId, situationPrompt }, "fallback");
      }

      return Response.json({
        role,
        lines,
        cadence: [...register.cadence],
        terms: [...register.vocabulary],
        termsUsed: termsUsedIn(role, lines),
        avoid: [...register.avoid],
        source: "gemini",
        // The model was actually TOLD this situation (buildPrompt sends
        // situationPrompt) and answered it, unlike the fallback path below,
        // where roleResponseLocal may have had no bank beats for this scene
        // at all and used the role's generic shape instead. See AC-Q8.4's
        // note on situationMatched and roleResponseLocal's own comment.
        situationMatched: true,
      });
    } catch {
      return localResponse({ role, situationId, situationPrompt }, "fallback");
    }
  } catch (err) {
    return Response.json({ error: err?.message || "Role response request failed." }, { status: 500 });
  }
}

