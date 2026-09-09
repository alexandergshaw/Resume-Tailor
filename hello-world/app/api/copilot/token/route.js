import { getDeepgramApiKey, getElevenLabsApiKey, getSttProvider } from "@/lib/config/env";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";

// ---------------------------------------------------------------------------
// THE SPEND CEILING for copilot-token.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. lib/rateLimit/index.js's header states
// this as the one way to adopt it catastrophically wrong, and both halves are
// pinned -- a behavioural case that fires 11 requests and expects the last to
// be denied (a per-request limiter would pass all 11), and the static case in
// lib/rateLimit/adoption.test.js that this declaration precedes the handlers.
//
// 10 per 10 minutes, per authenticated user, ON POST ONLY. Each POST mints a
// REAL credential at a metered provider, and the ElevenLabs one is single-use:
// it is consumed whether or not the browser ever connects, so a loop here is
// pure third-party spend with nothing to show for it. A session needs one mint
// plus a handful of reconnects. GET is deliberately NOT limited -- it calls no
// provider, costs nothing, and the copilot's privacy notice reads it on every
// page view, so a bound there would be cost without benefit.
//
// A DENIED REQUEST STILL INCREMENTS (see the module's header): the bound is
// 10 ATTEMPTS, not 10 successful mints.
//
// HONEST ABOUT WHAT THIS BUYS: createMemoryStore is per-instance, so on
// serverless this bounds a caller to 10 x instanceCount, not 10. It is worth
// having anyway -- it turns an unbounded token-minting loop into a bounded one
// -- but it is not a fleet-wide guarantee and must not be described as one.
// Swapping in a Redis-backed store satisfying the same two-method interface
// needs no change here.
// ---------------------------------------------------------------------------
const tokenLimiter = createRateLimiter({ limit: 10, windowMs: 600_000, prefix: "copilot-token" });

const tokenRateLimitedMessage =
  "Too many speech-to-text sessions started in a short window. Wait a moment and try again.";

// Read-only counterpart to POST below: returns which provider is selected
// without minting anything. A caller that only wants to know the provider
// name for display (CopilotClient's privacy-notice copy, see
// app/copilot/CopilotClient.js) has no reason to spend a real credential to
// find out — that's especially true for ElevenLabs, whose token is
// single-use, so a POST made purely to read `.provider` mints one real,
// never-connected token per page view. This calls no provider API at all.
// Auth-gated exactly like POST, and auth is still checked before anything
// about provider configuration.
export async function GET() {
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

    return Response.json({ provider: getSttProvider() });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Failed to resolve the speech-to-text provider." },
      { status: 500 },
    );
  }
}

// Mints a short-lived speech-to-text token for whichever provider
// STT_PROVIDER selects (see lib/config/env.js's getSttProvider) so the
// browser can open a transcription socket without ever seeing a long-lived
// provider API key. Requires an authenticated user — token minting is not a
// public endpoint, and that check happens before anything about provider
// configuration, so an unauthenticated caller learns nothing about which
// provider (or key) is or isn't set up.
export async function POST() {
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
    // of the provider lookup on purpose: a denied caller must not reach the
    // mint, and must not learn anything about which provider is configured
    // that it could not already learn from GET.
    //
    // `identify(null, ...)`: this handler takes no `request` (nothing here
    // reads the body or the URL), and the authenticated id is the only key
    // this route ever wants. The address path in `identify` is a backstop for
    // anonymous routes; there is no anonymous caller here, because the 401
    // above already returned.
    const rateLimit = await tokenLimiter.check(identify(null, { userId: user.id }));
    if (!rateLimit.allowed) {
      return Response.json(
        { error: tokenRateLimitedMessage },
        { status: 429, headers: rateLimitHeaders(rateLimit) },
      );
    }

    const provider = getSttProvider();
    return provider === "elevenlabs" ? await mintElevenLabsToken() : await mintDeepgramToken();
  } catch (err) {
    return Response.json(
      { error: err?.message || "Failed to mint a speech-to-text token." },
      { status: 500 },
    );
  }
}

// Unchanged from before ElevenLabs existed (AC-F2-7): same Authorization
// scheme, same endpoint, same response shape.
async function mintDeepgramToken() {
  const deepgramApiKey = getDeepgramApiKey();
  if (!deepgramApiKey) {
    return Response.json(
      {
        error:
          "Deepgram is not configured. Add DEEPGRAM_API_KEY to .env.local to use the interview copilot.",
      },
      { status: 503 },
    );
  }

  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: `Deepgram token request failed (${res.status}). ${detail}`.trim() },
      { status: 502 },
    );
  }

  const data = await res.json();
  return Response.json({
    token: data.access_token,
    expiresIn: data.expires_in,
    provider: "deepgram",
  });
}

// ElevenLabs' single-use realtime token: POST with no body, authenticated by
// the `xi-api-key` header rather than Deepgram's `Authorization: Token …`
// scheme. The response is just `{ token }` — no expiry field comes back, so
// nothing here invents an `expiresIn` value for it; the documented 15-minute,
// consumed-on-use lifetime is noted in the README instead.
async function mintElevenLabsToken() {
  const elevenLabsApiKey = getElevenLabsApiKey();
  if (!elevenLabsApiKey) {
    return Response.json(
      {
        error:
          "ElevenLabs is not configured. Add ELEVENLABS_API_KEY to .env.local to use the interview copilot.",
      },
      { status: 503 },
    );
  }

  const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: `ElevenLabs token request failed (${res.status}). ${detail}`.trim() },
      { status: 502 },
    );
  }

  const data = await res.json();
  return Response.json({
    token: data.token,
    provider: "elevenlabs",
  });
}
