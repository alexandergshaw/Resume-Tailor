// ---------------------------------------------------------------------------
// POST /api/copilot/answer/tech-term-detail -- the DETAIL half of the
// tech-buzzwords row: a short general explanation of ONE technical term the
// candidate clicked while preparing an answer. Its sibling, tech-terms, chooses
// the terms; this explains one of them on demand.
//
// WHY A NEW ROUTE AND NOT A MODE OF /expand. The expand route's load-bearing
// invariants are the opposite of what this needs: it grounds ONLY in the
// candidate's own page, validates a bullet index, cites a page, and filters every
// sentence against the candidate's material. A term has no index, no page and no
// candidate material behind it. A shared route with half its gates conditionally
// bypassed is exactly the structure where the wrong thing is merely absent today
// rather than impossible, so each route keeps its invariants categorical. What IS
// shared is the skeleton and the untrusted-data fence wording.
// ---------------------------------------------------------------------------

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { TECH_TERM_MAX_CHARS } from "@/lib/copilot/techTermDetailContract";
import { TECH_TERM_DETAIL_SYSTEM, buildTechTermDetailUserTurn } from "@/lib/copilot/techTermPrompt";
import { sanitizeTechTermDetail } from "@/lib/copilot/techTermDetailHonesty";

export const runtime = "nodejs";
export const maxDuration = 30;

// The server's budget for its one model call. Strictly shorter than the client's
// own (CLIENT_TIMEOUT_MS = 6000 in lib/copilot/techTermDetailClient.js) so that
// when both fire the server's diagnosis wins the race and the reader is told
// what happened.
const TECH_TERM_DETAIL_TIMEOUT_MS = 4000;

// Same ceilings the answer route applies to the same two inputs; local copies so
// this route does not pull the tailoring library in for two numbers.
const MAX_APPLICATION_ID_CHARS = 100;
const MAX_QUESTION_CHARS = 2000;
const MAX_ROLE_CHARS = 120;

const DISABLED_MESSAGE =
  "Term explanations are switched off on this server right now. Nothing was sent and nothing was charged.";
const TIMEOUT_MESSAGE = "That took too long to look up.";
const FAILED_MESSAGE = "Could not explain this term.";
const INVALID_MESSAGE = "That request did not describe a term of the current answer.";

function fail(message, status, code) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

// The posting's title for the application, or "" when there is none to give. The
// role is context for what matters, never a requirement: a missing application, a
// failed read or a posting with no title all mean the term is explained
// generally, so nothing here can fail the request. Scoped to the caller in the
// query itself.
async function roleFor(supabase, userId, applicationId) {
  if (!applicationId) return "";
  try {
    const { data, error } = await supabase
      .from("applications")
      .select("id, user_id, positions ( id, title )")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return "";
    const title = data?.positions?.title;
    return typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_CHARS) : "";
  } catch {
    return "";
  }
}

export async function POST(request) {
  try {
    // ORDER IS LOAD-BEARING BELOW, and each step states what it must precede.

    // 1. THE KILL SWITCH, before a Supabase client and before any model client.
    //    An operator turning this off must stop the spend, not merely hide the
    //    result. `wantsEmbedded` is NOT this switch and must never be used as
    //    one: lib/llm/featureEngine.js returns on the client's own `body.engine`
    //    BEFORE it reads env.RESUME_ENGINE.
    if (process.env.COPILOT_TECH_TERM_DETAIL_DISABLED === "1") {
      return fail(DISABLED_MESSAGE, 503, "disabled");
    }

    // 2. IDENTITY, from `auth.getUser()`. Never `getSession()`: that call makes
    //    ZERO network requests, so gating on it is not a weak check, it is a
    //    total bypass. Everything downstream is scoped by the id this resolves to
    //    and never by a body field.
    const supabase = await createSupabaseServerClient();
    const {
      data: { user } = {},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return fail("Sign in to use the interview copilot.", 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return fail("Invalid request body.", 400);
    }

    // 3. NO PER-USER BOUND, ON PURPOSE. The copilot prefetches every shown term's
    //    detail, so a cap here could only refuse a real candidate mid-interview
    //    (an owner ruling, recorded in lib/rateLimit/adoption.test.js). What
    //    keeps a render from bursting is the client-side concurrency throttle and
    //    the store's dedupe. This is the seam where a bound would sit, keyed on
    //    the id step 2 resolved to and checked ahead of validation, if the owner
    //    sets a number later.

    // 4. VALIDATION, before a single Supabase data read and before any model
    //    client. Every field REFUSES rather than coerces: `.toString()` on an
    //    object yields "[object Object]", which validates and prompts perfectly
    //    happily.
    const term = typeof body?.term === "string" ? body.term.trim() : "";
    if (!term || term.length > TECH_TERM_MAX_CHARS) return fail(INVALID_MESSAGE, 400);

    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) return fail("No question provided.", 400);
    if (question.length > MAX_QUESTION_CHARS) return fail("That question is too long.", 400);

    // OPTIONAL, unlike the expand route: it is role context only, so absence is
    // allowed. Present but not a string, or too long, is still refused.
    const rawApplicationId = body?.applicationId;
    if (rawApplicationId !== undefined && rawApplicationId !== null && typeof rawApplicationId !== "string") {
      return fail(INVALID_MESSAGE, 400);
    }
    const applicationId = typeof rawApplicationId === "string" ? rawApplicationId.trim() : "";
    if (applicationId.length > MAX_APPLICATION_ID_CHARS) return fail(INVALID_MESSAGE, 400);

    // 5. EMBEDDED has no general-knowledge faculty, so it gets an honest empty
    //    and NO model client. In practice the row is absent on embedded because
    //    generation returned null, so this is defence in depth; it still builds
    //    no client and reads no env.
    if (wantsEmbedded(body?.engine)) {
      return Response.json({ detail: "", empty: true, engine: "embedded" });
    }

    // 6. THE GEMINI PATH. One call, always.
    const role = await roleFor(supabase, user.id, applicationId);

    const { geminiModel } = getServerEnv();
    const client = getGeminiClient();
    let response;
    try {
      response = await client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: buildTechTermDetailUserTurn({ term, role }) }] }],
        config: {
          systemInstruction: TECH_TERM_DETAIL_SYSTEM,
          // The single highest-likelihood way this feature ships slow. The answer
          // route sets it on its own latency-critical call and almost nothing
          // else in the app does.
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: AbortSignal.timeout(TECH_TERM_DETAIL_TIMEOUT_MS),
        },
      });
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        return fail(TIMEOUT_MESSAGE, 504, "tech_term_timeout");
      }
      // NO SILENT DEGRADATION. There is no local drafter for a general
      // explanation, and a visible error the reader can retry is the honest
      // outcome.
      console.error("[copilot/tech-term-detail] model call failed:", err);
      return fail(FAILED_MESSAGE, 502, "http");
    }

    // 6b. THE MANDATORY OUTPUT GATE. Runs on every non-embedded success, with no
    //     flag in front of it. The prompt bans a scripted first-person claim, but
    //     a prompt clause is not a control over what the model actually wrote;
    //     this is. Whatever it strips, the reader never sees, and a detail that
    //     was entirely claims comes back empty.
    const detail = sanitizeTechTermDetail(typeof response?.text === "string" ? response.text : "");

    // AN EMPTY RESULT IS A 200, not a 5xx: nothing failed, there is simply nothing
    // here that can honestly be said.
    return Response.json({ detail, empty: detail === "" });
  } catch (err) {
    // A FIXED STRING. A provider's message can carry request ids, model names and
    // quoted prompt fragments, none of which belongs in a browser.
    console.error("[copilot/tech-term-detail] request failed:", err);
    return fail(FAILED_MESSAGE, 500);
  }
}
