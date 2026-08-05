const REQUIRED_SERVER_KEYS = ["Gemini_LLM_API_Key"];

export function getServerEnv() {
  const missingKeys = REQUIRED_SERVER_KEYS.filter((key) => !process.env[key]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(", ")}`,
    );
  }

  return {
    geminiApiKey: process.env.Gemini_LLM_API_Key,
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    // Deepgram powers the interview copilot's real-time speech-to-text. Optional
    // so the rest of the app still boots without it; the /copilot token route
    // returns a clear 503 when it's unset.
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || null,
    kvRestApiUrl: process.env.KV_REST_API_URL || null,
    kvRestApiToken: process.env.KV_REST_API_TOKEN || null,
    rapidApiKey: process.env.RAPID_API_KEY,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    resendApiKey: process.env.RESEND_API_KEY || null,
    emailFrom: process.env.EMAIL_FROM || null,
    // Document-generation engine selection. Default keeps the existing Gemini
    // pipeline; "external" routes to the standalone Resume Tailor API;
    // "embedded" uses the in-process, deterministic (no-LLM) tailor-lite engine.
    resumeEngine: (process.env.RESUME_ENGINE || "gemini").trim().toLowerCase(),
    resumeTailorApiUrl: process.env.RESUME_TAILOR_API_URL || null,
    resumeTailorApiKey: process.env.RESUME_TAILOR_API_KEY || null,
    resumeTailorWorkflow: (process.env.RESUME_TAILOR_WORKFLOW || "legacy").trim().toLowerCase(),
  };
}

// The interview copilot's speech-to-text (Deepgram) is independent of the LLM
// engine — requiring a Gemini key just to read the Deepgram key would wrongly
// couple transcription to the LLM being configured. This reads it directly,
// without the REQUIRED_SERVER_KEYS check that getServerEnv() enforces, so the
// /copilot token route can mint tokens on a deploy with no Gemini key set.
export function getDeepgramApiKey() {
  return process.env.DEEPGRAM_API_KEY || null;
}

// Which speech-to-text provider the /copilot token route mints for (see
// app/api/copilot/token/route.js) and the browser therefore connects to.
// "deepgram" is the default, and an unset or unrecognized value degrades to
// it rather than throwing — the same treatment unknown enum values get
// elsewhere in this codebase (resumeEngine above, THEM_CAPTURE_BY_SOURCE in
// lib/copilot/session.js, PROVIDERS in lib/copilot/stt/index.js), so a typo
// in STT_PROVIDER quietly falls back to today's behavior instead of
// breaking transcription outright.
export function getSttProvider() {
  const raw = (process.env.STT_PROVIDER || "").trim().toLowerCase();
  return raw === "elevenlabs" ? "elevenlabs" : "deepgram";
}

// ElevenLabs Scribe v2 Realtime is the copilot's second speech-to-text
// provider (see lib/copilot/stt/elevenlabs.js). Same reasoning as
// getDeepgramApiKey above: read directly, without getServerEnv()'s
// required-key check, so a deploy running STT_PROVIDER=deepgram (or one
// with no Gemini key at all) never fails to boot over an ElevenLabs key it
// doesn't need.
export function getElevenLabsApiKey() {
  return process.env.ELEVENLABS_API_KEY || null;
}