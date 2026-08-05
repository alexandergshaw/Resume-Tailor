import { getDeepgramApiKey, getElevenLabsApiKey, getSttProvider } from "@/lib/config/env";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

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
