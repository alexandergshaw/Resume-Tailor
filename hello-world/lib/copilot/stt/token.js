// Shared token fetch used by every speech-to-text provider (see ./index.js
// for the provider contract this supports). Mints a short-lived provider
// credential by POSTing to our own /api/copilot/token route (see
// app/api/copilot/token/route.js) — the browser never talks to a provider's
// API directly and never sees a long-lived provider secret.
//
// Returns the parsed response body as-is — currently
// `{ token, expiresIn, provider }` — rather than pulling `.token` back out
// for the caller, so createSttStream (./index.js) can read the `provider`
// field off the very same response a provider's own connect() call uses for
// its token. Each provider is responsible for validating whatever fields it
// actually needs out of that body (DeepgramStream wants `.token`, and
// throws if it's missing — see ./deepgram.js).
export async function fetchSttToken() {
  const res = await fetch("/api/copilot/token", { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Token request failed (${res.status}).`);
  }
  return json;
}
