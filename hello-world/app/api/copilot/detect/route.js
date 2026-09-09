import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { localDetection } from "@/lib/copilot/localDetection";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";

const SYSTEM = [
  "You classify the interviewer's latest utterance during a LIVE job interview.",
  "Decide whether it is a question or an explicit request that the CANDIDATE should answer out loud.",
  "NOT questions: greetings, acknowledgements (\"great\", \"makes sense\", \"got it\"), the interviewer describing the company/role/logistics, and the interviewer answering the candidate's own question.",
  "If it IS a question/request, extract the core ask as a single clean, self-contained sentence (fix transcription artifacts, drop filler).",
  "Classify type as behavioral, technical, or general.",
].join(" ");

const MAX_UTTERANCE_CHARS = 1200;
const MAX_CONTEXT_CHARS = 2000;
const VALID_TYPES = ["behavioral", "technical", "general"];

function buildPrompt(utterance, context) {
  const parts = [];
  if (context) {
    parts.push("Recent conversation (most recent last):", context, "");
  }
  parts.push(
    `Latest interviewer utterance: "${utterance}"`,
    "",
    'Return ONLY JSON of this exact shape: { "isQuestion": boolean, "question": string, "type": "behavioral" | "technical" | "general" }',
    'If isQuestion is false, set "question" to "" and "type" to "general".',
  );
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// THE SPEND CEILING for copilot-detect.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. lib/rateLimit/index.js's header states
// this as the one way to adopt it catastrophically wrong, and both halves are
// pinned -- a behavioural case that fires 91 requests and expects the last to
// be denied (a per-request limiter would pass all 91), and the static case in
// lib/rateLimit/adoption.test.js that this declaration precedes the handler.
//
// 90 per 5 minutes, per authenticated user. This fires once per interviewer
// utterance during a LIVE interview -- the highest legitimate request rate
// anywhere in the product -- so the allowance is deliberately generous and the
// window short, at roughly one call every three seconds sustained.
// A DENIED REQUEST STILL INCREMENTS (see the module's header): the bound is
// 90 ATTEMPTS, not 90 successes.
//
// HONEST ABOUT WHAT THIS BUYS: createMemoryStore is per-instance, so on
// serverless this bounds a caller to 90 x instanceCount, not 90. It is worth
// having anyway: a client stuck in a reconnect loop currently bills a model
// call per iteration forever.
// It is not a fleet-wide guarantee and must not be described as one. Swapping
// in a Redis-backed store satisfying the same two-method interface needs no
// change here.
// ---------------------------------------------------------------------------
const detectLimiter = createRateLimiter({ limit: 90, windowMs: 300_000, prefix: "copilot-detect" });

const detectRateLimitedMessage =
  "Too many detections in a short window. Wait a moment and try again.";

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

    // THE BOUND, keyed on the id the auth gate above resolved -- never on the
    // caller's access token, and never before the auth resolves. Checked ahead
    // of body validation on purpose: an invalid request is still a request,
    // and a caller hammering this endpoint with junk should exhaust its own
    // allowance rather than get an unmetered lane.
    const rateLimit = await detectLimiter.check(identify(request, { userId: user.id }));
    if (!rateLimit.allowed) {
      return Response.json(
        { error: detectRateLimitedMessage },
        { status: 429, headers: rateLimitHeaders(rateLimit) },
      );
    }

    const body = await request.json();
    const utterance = (body?.utterance ?? "").toString().trim().slice(0, MAX_UTTERANCE_CHARS);
    if (!utterance) {
      return Response.json({ error: "No utterance provided." }, { status: 400 });
    }
    const context = (body?.context ?? "").toString().slice(0, MAX_CONTEXT_CHARS);

    // Embedded engine: classify with the zero-cost heuristic detector — no LLM.
    // The detected question is tidied like the LLM path tidies it (fillers,
    // lead-ins, stutters, punctuation) so the card reads clean.
    //
    // AC-P1.1: localDetection.js is THE one implementation of this decision
    // — this route and the client-side zero-network path (useLiveSession.js)
    // both call it rather than each carrying their own copy of
    // detectQuestion + cleanQuestion + classifyQuestionType, so the two can
    // never quietly disagree about what counts as a question.
    if (wantsEmbedded(body?.engine)) {
      const local = localDetection(utterance);
      return Response.json({ isQuestion: local.decided, question: local.question, type: local.type });
    }

    // AC-R2.2 (defect #4): a broken LLM path here has nothing to do with
    // THIS request — no API key configured (getServerEnv throws), the
    // client failing to construct, or the model call itself erroring out —
    // so none of it should surface as a 500. useLiveSession.js's catch on
    // confirmQuestion is a bare `return;`, so a 500 here means the
    // interviewer's question silently never gets detected. Degrade instead:
    // fall back to the same zero-cost heuristic the embedded engine uses,
    // and say so via `degraded` so a caller CAN surface it, without this
    // route needing to change again to add that later.
    try {
      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: buildPrompt(utterance, context) }] }],
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
      });

      const parsed = parseModelJson(response.text?.trim() || "") || {};
      const isQuestion = parsed.isQuestion === true;
      const question =
        isQuestion && typeof parsed.question === "string" && parsed.question.trim()
          ? parsed.question.trim()
          : "";
      const type = VALID_TYPES.includes(parsed.type) ? parsed.type : "general";

      return Response.json({ isQuestion: isQuestion && !!question, question, type });
    } catch (llmErr) {
      const local = localDetection(utterance);
      return Response.json({
        isQuestion: local.decided,
        question: local.question,
        type: local.type,
        degraded: true,
        degradedReason: llmErr?.message || "LLM detection unavailable.",
      });
    }
  } catch (err) {
    return Response.json(
      { error: err?.message || "Detection request failed." },
      { status: 500 },
    );
  }
}
