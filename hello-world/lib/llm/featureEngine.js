// Engine selection for the *auxiliary* AI features (chat, copilot, company
// research, screenshot reading, employment extraction). These live outside the
// document-generation engine registry (lib/llm/engines) but honor the same
// user-facing choice: "embedded" means run the in-process deterministic path
// with no LLM call; anything else means use Gemini.
//
// Precedence (O-14, refined asymmetric by O-18): a request may only NARROW
// capability, never widen it. Running embedded is a de-escalation -- no
// spend, no egress -- so an explicit "embedded" request is always honored,
// regardless of the server's configuration. Running gemini/external is an
// escalation -- paid generation, live grounded search, the candidate's resume
// leaving the process -- so a request for one of those is honored only when
// the server default does not forbid it. Without this, a single request-body
// field could force a deployment the owner configured offline (e.g.
// RESUME_ENGINE=embedded) into paid Gemini calls with the candidate's resume;
// blocking the opposite (a request choosing LESS spend/egress than the
// default) would serve no security purpose, so it stays permitted.
//   1. An explicit "embedded" request -- always wins.
//   2. The server default RESUME_ENGINE, when set to a recognized engine --
//      wins over any other explicit request (blocks escalation).
//   3. Otherwise, an explicit "gemini"/"external" request -- honored when the
//      server has no default forbidding it.
//   4. If neither is configured and Gemini isn't set up at all, fall back to
//      embedded so the feature still works instead of erroring.
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

  // A de-escalation: always honored, regardless of server configuration.
  if (wanted === EMBEDDED) return true;

  // Any other explicit request is an escalation -- blocked when the server
  // default forbids it.
  const dflt = String(env.RESUME_ENGINE || "").trim().toLowerCase();
  if (dflt === EMBEDDED) return true;

  if (wanted === GEMINI || wanted === EXTERNAL) return false;

  // No explicit (recognized) request → the server default decides, then key
  // presence.
  if (dflt === GEMINI || dflt === EXTERNAL) return false;

  return !hasGeminiKey(env);
}
