// Engine selection for the *auxiliary* AI features (chat, copilot, company
// research, screenshot reading, employment extraction). These live outside the
// document-generation engine registry (lib/llm/engines) but honor the same
// user-facing choice: "embedded" means run the in-process deterministic path
// with no LLM call; anything else means use Gemini.
//
// Precedence mirrors the tailor route's engine resolution:
//   1. An explicit per-request engine ("embedded" | "gemini" | "external").
//   2. The server default RESUME_ENGINE.
//   3. If Gemini isn't configured at all, fall back to embedded so the feature
//      still works instead of erroring.
//
// "external" is a document-generation engine only; for these auxiliary features
// it has no deterministic path of its own, so it behaves like "gemini" (use the
// LLM, degrading gracefully when the key is absent).

const EMBEDDED = "embedded";
const GEMINI = "gemini";
const EXTERNAL = "external";

function hasGeminiKey(env) {
  return !!env.Gemini_LLM_API_Key;
}

// Returns true when an auxiliary feature should run its deterministic embedded
// path instead of calling Gemini. `requested` is the client-selected engine
// (from the tailorEngine store); `env` is injectable for testing.
export function wantsEmbedded(requested, env = process.env) {
  const wanted = String(requested || "").trim().toLowerCase();
  if (wanted === EMBEDDED) return true;
  if (wanted === GEMINI || wanted === EXTERNAL) return false;

  // No explicit request → fall back to the server default, then key presence.
  const dflt = String(env.RESUME_ENGINE || "").trim().toLowerCase();
  if (dflt === EMBEDDED) return true;
  if (dflt === GEMINI || dflt === EXTERNAL) return false;

  return !hasGeminiKey(env);
}
