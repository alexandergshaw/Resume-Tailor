import { getServerEnv } from "@/lib/config/env";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

// Mints a short-lived Deepgram token (30s TTL) so the browser can open a
// WebSocket straight to Deepgram without ever seeing the long-lived API key.
// Requires an authenticated user — token minting is not a public endpoint.
export async function POST() {
  try {
    const { deepgramApiKey } = getServerEnv();
    if (!deepgramApiKey) {
      return Response.json(
        {
          error:
            "Deepgram is not configured. Add DEEPGRAM_API_KEY to .env.local to use the interview copilot.",
        },
        { status: 503 },
      );
    }

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
    return Response.json({ token: data.access_token, expiresIn: data.expires_in });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Failed to mint Deepgram token." },
      { status: 500 },
    );
  }
}
