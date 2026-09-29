// ---------------------------------------------------------------------------
// POST /api/cover-fact-smooth -- N92 Wave 3 (Control B): a user-initiated,
// UNGROUNDED rewrite of the transition into/around one inserted company
// fact. Mirrors app/api/salary-estimate/route.js: auth -> validate ->
// embedded refusal -> the model call inside a try -> 200 (never 5xx) so the
// caller renders a withheld/rejected result in the confirm surface rather
// than a fetch error.
//
// NO GROUNDING (AC-B7). This is a pure sentence rewrite, not a web lookup --
// no `google_search` tool is sent, so the R-267 tools-nesting trap does not
// apply here and no vertexaisearch redirect can appear (there is nothing to
// ground). Egress is scoped to exactly the three sentences + the fact's
// recorded text the caller sends; never the whole letter, resume or job
// description -- lib/coverFacts/smoothTransition.js's client orchestrator is
// what keeps that true on the way IN, this route never asks for more.
//
// LAYER-ONE FAITHFULNESS (AC-B3a). The model's own output is auto-rejected,
// server-side, when it introduces a number/date/currency amount or a proper
// name absent from the in-scope material -- checkAddedTokens, imported from
// the smoothing module so both the client orchestrator and this route apply
// the identical rule. This route does NOT run the scope guard (checkScope):
// that needs the letter's full lines, which never reach this route by
// design (AC-B7) -- the client orchestrator re-derives and checks scope
// itself once it reconstructs the candidate paragraph.
//
// WRITES NOTHING TO ANY DATABASE. The rewrite is transient, held in the
// browser's pending state until the user confirms it (AC-B10) -- exactly
// like salary-estimate, this route persists nothing server-side.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { unauthorized, badRequest } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { interactionOutputText } from "@/lib/llm/interactionCitations";
import { checkAddedTokens } from "@/lib/coverFacts/smoothTransition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same budget as the other user-initiated Interactions-API call sites
// (salary-estimate, application-digest): 45s + backoff + 45s stays
// comfortably inside the 120s function duration this route also sets.
export const maxDuration = 120;
const SMOOTH_CALL_TIMEOUT_MS = 45_000;
const SMOOTH_CALL_MAX_RETRIES = 1;

const SMOOTH_SYSTEM_INSTRUCTION =
  "You smooth the transition into and out of one fact inserted into a job-application cover letter. " +
  "You are given the sentence immediately BEFORE the fact (may be empty -- the fact is first in its " +
  "paragraph), the FACT sentence itself, and the sentence immediately AFTER it (may be empty -- the fact " +
  "is last in its paragraph). Reword all three so the three read naturally together as one passage. " +
  "STRICT RULES: reuse only the words, numbers, dates, amounts, and names already present in the material " +
  "below -- never introduce a new number, date, amount, or name. Never change what the fact claims; never " +
  "add, drop, or reverse any negation. Reply with ONLY a JSON object of the exact shape " +
  '{"before":"...","fact":"...","after":"..."} and nothing else -- use an empty string for "before" or ' +
  '"after" when none was given.';

function buildSmoothInput({ before, factSentence, after, factText }) {
  return [
    `Before sentence: ${before || "(none -- the fact is first in its paragraph)"}`,
    `Fact sentence: ${factSentence}`,
    `After sentence: ${after || "(none -- the fact is last in its paragraph)"}`,
    `Fact text (must not change in meaning): ${factText}`,
  ].join("\n");
}

// Strips a ```json ... ``` fence if the model wrapped its answer in one;
// otherwise returns the text unchanged.
function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// The shape every non-"ok" outcome returns, so every early-exit path and the
// catch below agree on one envelope -- never the raw provider error, never a
// byte of the letter, always `fact: null` so the caller's `s.fact == null`
// check is a reliable "nothing to apply" signal.
function withheldSmoothed(status, reason) {
  return { status, reason, before: null, fact: null, after: null };
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const factSentence = typeof body?.factSentence === "string" ? body.factSentence.trim() : "";
  if (!factSentence) return badRequest("Missing fact sentence.");
  const before = typeof body?.before === "string" ? body.before : "";
  const after = typeof body?.after === "string" ? body.after : "";
  const factText = typeof body?.factText === "string" && body.factText ? body.factText : factSentence;

  // A de-escalation the offline engine has no equivalent for (S8) -- same
  // idiom as salary-estimate/application-digest.
  if (wantsEmbedded(body?.engine)) {
    return Response.json({ smoothed: withheldSmoothed("unavailable_embedded", "embedded") });
  }

  const inScopeText = [before, factSentence, after].filter(Boolean).join(" ");

  let smoothed;
  try {
    const model = getServerEnv().geminiModel;
    const client = getGeminiClient();
    const interaction = await client.interactions.create(
      {
        model,
        // `input`, not `contents`; NO `tools` at all (this is not a grounded
        // call -- see the header comment). Same top-level shape as the other
        // Interactions-API call sites in this repo.
        system_instruction: SMOOTH_SYSTEM_INSTRUCTION,
        input: buildSmoothInput({ before, factSentence, after, factText }),
      },
      { timeout: SMOOTH_CALL_TIMEOUT_MS, maxRetries: SMOOTH_CALL_MAX_RETRIES },
    );

    // K4: the real SDK omits `output_text` entirely when the model produced
    // no text, so `interactionOutputText` (which throws on that) is called
    // only when there is something to read.
    const outputText = interaction?.output_text ? interactionOutputText(interaction) : "";
    if (!outputText) {
      smoothed = withheldSmoothed("failed", "empty");
    } else {
      let parsed = null;
      try {
        parsed = JSON.parse(extractJsonObject(outputText));
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed.before !== "string" || typeof parsed.fact !== "string" || typeof parsed.after !== "string") {
        smoothed = withheldSmoothed("failed", "parse_error");
      } else {
        const candidateText = [parsed.before, parsed.fact, parsed.after].filter(Boolean).join(" ");
        const tokenCheck = checkAddedTokens(inScopeText, candidateText);
        smoothed = tokenCheck.ok
          ? { status: "ok", reason: "", before: parsed.before, fact: parsed.fact, after: parsed.after }
          : withheldSmoothed("rejected", "added-token");
      }
    }
  } catch {
    // Two codes / no leak: a provider failure degrades to a coarse withhold,
    // never the raw error and never a 5xx -- the caller renders this in the
    // confirm surface exactly like an auto-rejected candidate.
    smoothed = withheldSmoothed("failed", "provider_error");
  }

  return Response.json({ smoothed });
}
