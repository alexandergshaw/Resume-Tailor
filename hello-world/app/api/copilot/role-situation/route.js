// AC-Q6 - POST /api/copilot/role-situation, the server half of the
// /copilot "Speak as" drill's situation picker (lib/copilot/roleDrillClient.js
// is the browser client that calls this).
//
// Same shape as app/api/copilot/question/route.js, deliberately: the same
// sign-in gate and error string, the same wantsEmbedded(body?.engine) branch
// from @/lib/llm/featureEngine, and the same discipline that ANY model
// failure - a throw, an empty prompt, or a repeat of something already asked
// - falls back to the deterministic bank in lib/copilot/roleSituations.js
// and says so in `source`, rather than ever surfacing a 500 for a model
// hiccup or a well-formed but silently-empty situation.
//
// What this route does NOT do, on purpose: it never sends the resume, cover
// letter, prep context or job posting anywhere. On the embedded engine
// nothing leaves the server at all; on Gemini, only the role's own guidance
// and the situation prompts already shown this session are sent.

import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { nextRoleSituation } from "@/lib/copilot/roleSituations";
import { normalizeRole, roleRegister } from "@/lib/copilot/roleRegisters";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { hashString } from "@/lib/text/phrasing";

const SYSTEM = [
  "You write exactly ONE realistic workplace SITUATION for a professional to respond to out loud, in a",
  "specific role's voice.",
  "Given that role's guidance and the situations already used this session, produce a NEW scene: who is",
  "in the room, and what they just said or asked.",
  "Never repeat a situation already used, even reworded.",
].join(" ");

const MAX_ASKED = 40;
const MAX_ASKED_CHARS = 420;

// A generated situation has to be renderable the same way a bank one is: a
// prompt short enough to read as one scene, rendered straight into an h3
// with no other bound on it, and a non-empty context line so the panel
// never shows a blank line under the heading. Both bounds mirror the bank's
// own AC-Q2.3/AC-Q2.4 contract exactly (prompt 80-420 chars, context <= 200
// chars) - a generated situation has to meet the same bar the bank holds
// its own hand-written content to, not a lower one. A prompt under 80 chars
// is not a scene, the same way none of the bank's own situations are.
const MIN_PROMPT_CHARS = 80;
const MAX_PROMPT_CHARS = 420;
const MAX_CONTEXT_CHARS = 200;

// `asked` entries are situation PROMPT strings (roleDrillClient.js's own
// convention). Non-strings are dropped rather than stringified - a stray
// object in the array must never turn into the literal text
// "[object Object]" inside the prompt sent to the model.
function sanitizeAsked(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, MAX_ASKED_CHARS))
    .filter(Boolean)
    // The caller appends newest-last, so cap by keeping the most recent
    // entries - the ones most likely to be repeated - not the oldest.
    .slice(-MAX_ASKED);
}

// The bank's own situations carry `beats` - the material the model answer is
// built from - and the browser has no use for them: the whole drill is that
// you answer the scene out loud BEFORE seeing how someone in the role would.
// Shipping the beats alongside the prompt would put the answer in the network
// response of the request that asks the question. Only what the drill screen
// actually renders leaves here, which is also exactly the shape
// lib/copilot/roleDrillClient.js documents.
function situationForClient({ id, prompt, context }) {
  return { id, prompt, context };
}

function fallbackResult(role, asked) {
  const { situation, exhausted } = nextRoleSituation({ role, asked });
  return { role, situation: situationForClient(situation), source: "fallback", exhausted };
}

function buildPrompt(register, asked) {
  const parts = [
    `Role: ${register.label}`,
    register.guidance,
    "Write the situation as a short scene: name who is in the room and what they just said or asked, that",
    "this role now has to respond to out loud.",
  ];
  if (asked.length) {
    parts.push(
      "",
      "Situations already used this session (never repeat one of these, even reworded):",
      asked.map((entry) => `- ${entry}`).join("\n"),
    );
  }
  parts.push(
    "",
    'Return ONLY JSON of this exact shape: { "prompt": string, "context": string }',
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

    // A malformed body - null, a bare string, an array, or a request whose
    // .json() itself rejects - must still resolve to a usable situation for
    // the default role rather than a 500, so every read below goes through
    // optional chaining against whatever `body` ends up being.
    const body = await request.json().catch(() => null);
    const role = normalizeRole(body?.role);
    const asked = sanitizeAsked(body?.asked);

    // Embedded engine: pull from the deterministic bank - no LLM.
    if (wantsEmbedded(body?.engine)) {
      const { situation, exhausted } = nextRoleSituation({ role, asked });
      return Response.json({
        role,
        situation: situationForClient(situation),
        source: "embedded",
        exhausted,
      });
    }

    // The drill must never dead-end on a model hiccup: any failure to get a
    // fresh, unasked situation from Gemini falls back to the deterministic
    // bank, and the fallback is reported rather than silent.
    try {
      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const register = roleRegister(role);
      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: buildPrompt(register, asked) }] }],
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
      });

      const parsed = parseModelJson(response.text?.trim() || "");
      const prompt = typeof parsed?.prompt === "string" ? parsed.prompt.trim() : "";
      const context = typeof parsed?.context === "string" ? parsed.context.trim() : "";

      // `asked` entries were capped to MAX_ASKED_CHARS by sanitizeAsked;
      // compare like with like so a generated prompt longer than the cap
      // isn't compared against itself at full length - that would never
      // match its own (capped) recorded entry and would let the same
      // over-long situation repeat forever while `exhausted` stayed false.
      // Same fix, same reasoning, as app/api/copilot/question/route.js.
      const promptForCompare = prompt.slice(0, MAX_ASKED_CHARS);
      const alreadyAsked = asked.some(
        (entry) => normalizeQuestion(entry) === normalizeQuestion(promptForCompare),
      );

      const usable =
        prompt.length >= MIN_PROMPT_CHARS &&
        prompt.length <= MAX_PROMPT_CHARS &&
        context.length > 0 &&
        context.length <= MAX_CONTEXT_CHARS;

      if (!usable || alreadyAsked) {
        return Response.json(fallbackResult(role, asked));
      }

      return Response.json({
        role,
        // Derived from the prompt text itself, never a clock or a counter,
        // so the same generated situation keeps the same id across requests
        // - the panel's per-situation answer cache depends on that.
        situation: { id: `generated-${hashString(prompt)}`, prompt, context },
        source: "gemini",
        exhausted: false,
      });
    } catch {
      return Response.json(fallbackResult(role, asked));
    }
  } catch (err) {
    return Response.json(
      { error: err?.message || "Role situation request failed." },
      { status: 500 },
    );
  }
}
