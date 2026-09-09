import { NextResponse } from "next/server";
import { getAuth, unauthorized } from "@/lib/experience/apiAuth";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { extractEmploymentFromResumeText } from "@/lib/llm/extractEmployment";
import { parseEmploymentHistory } from "@/lib/resume/parseEmployment";
import { wantsEmbedded } from "@/lib/llm/featureEngine";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 20000;

// ---------------------------------------------------------------------------
// THE SPEND CEILING.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. lib/rateLimit/index.js's header states
// this as the one way to adopt it catastrophically wrong, and this route's
// suite pins BOTH halves -- a behavioural case that fires 11 requests and
// expects the 11th to be denied, and a static case that this declaration
// precedes `POST`.
//
// 10 extractions per 10 minutes, per authenticated user. This route is driven
// by a person picking a résumé file in the employment-import dialog
// (app/page.js:1064) and then reading the positions it came back with, so the
// legitimate rate is a handful of uploads while they fix a file that parsed
// badly -- not a stream. A denial is also the mildest of the four routes gated
// alongside it: the client already parses employment history on-device
// (parseEmploymentHistory) and falls back to that whenever this route does not
// answer, so a 429 costs accuracy, not the feature. A DENIED REQUEST STILL
// INCREMENTS (see the module's header): the bound is 10 ATTEMPTS.
//
// HONEST ABOUT WHAT THIS BUYS: `createMemoryStore` is per-instance, so on
// serverless this bounds a caller to 10 x instanceCount, not 10. It is worth
// having anyway -- it turns an unbounded loop against a model-calling endpoint
// into a bounded one -- but it is not a fleet-wide guarantee and must not be
// described as one.
// ---------------------------------------------------------------------------
const extractLimiter = createRateLimiter({ limit: 10, windowMs: 600_000, prefix: "extract-employment" });

const RATE_LIMITED_MESSAGE =
  "Too many résumés imported in a short window. Wait a moment and try again.";

// Extract employment history from résumé text. The client sends already-extracted
// text (it handles .docx/.txt parsing on-device). The Embedded engine (or a
// deploy with no Gemini key) parses it deterministically with the same heuristic
// parser the client uses as a fallback; otherwise Gemini does the extraction.
export async function POST(request) {
  // ORDER IS LOAD-BEARING BELOW.
  //
  // 1. IDENTITY, from `auth.getUser()` by way of the shared `getAuth()`. Never
  //    `getSession()`: that call makes ZERO network requests
  //    (app/api/health/route.js:204-210 records the measurement), so gating on
  //    it is not a weak check, it is a total bypass. Ahead of the BODY READ on
  //    purpose -- this route accepts 20k characters of résumé text, and an
  //    anonymous caller must not get that buffered, let alone extracted from.
  //
  //    Nothing legitimate is locked out by this. Every caller of this route is
  //    app/page.js, a PAGE route, and lib/supabase/middleware.js redirects any
  //    page route to /login without a session.
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  // 2. THE BOUND, keyed on the id step 1 resolved to -- never on the caller's
  //    access token, and never before the auth resolves. Checked ahead of
  //    validation on purpose: an invalid request is still a request, and a
  //    caller hammering this endpoint with junk should exhaust its own
  //    allowance rather than get an unmetered lane.
  const decision = await extractLimiter.check(identify(request, { userId }));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const resumeText =
    typeof body?.resumeText === "string" ? body.resumeText.slice(0, MAX_RESUME_CHARS) : "";
  if (!resumeText.trim()) {
    return NextResponse.json({ error: "resumeText is required." }, { status: 400 });
  }

  if (wantsEmbedded(body?.engine)) {
    return NextResponse.json({ positions: parseEmploymentHistory(resumeText), engine: "embedded" });
  }

  try {
    const positions = await extractEmploymentFromResumeText(resumeText);
    return NextResponse.json({ positions, engine: "gemini" });
  } catch (err) {
    console.error("[extract-employment] failed:", err?.message || err);
    // Rather than fail outright, fall back to the deterministic parser so the
    // feature still returns something usable (the client also parses locally).
    return NextResponse.json({ positions: parseEmploymentHistory(resumeText), engine: "embedded" });
  }
}
