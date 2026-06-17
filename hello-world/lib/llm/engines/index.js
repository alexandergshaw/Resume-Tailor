import { geminiEngine } from "@/lib/llm/engines/geminiEngine";
import { externalEngine } from "@/lib/llm/engines/externalEngine";

// Registry of document-generation engines. Each engine implements
// `tailorResume(options)` and `tailorCoverLetter(options)` returning the
// normalized shape the /api/tailor route assembles its response from.
const ENGINES = {
  [geminiEngine.name]: geminiEngine,
  [externalEngine.name]: externalEngine,
};

export function registerEngine(engine) {
  if (engine?.name) ENGINES[engine.name] = engine;
}

export function listEngineNames() {
  return Object.keys(ENGINES);
}

// Resolve a requested engine name to one that is actually registered, falling
// back to the server default and finally to "gemini". Unknown/unregistered
// names degrade gracefully rather than erroring.
export function resolveEngineName(requested, fallback = "gemini") {
  const wanted = String(requested || "").trim().toLowerCase();
  if (wanted && ENGINES[wanted]) return wanted;
  const fb = String(fallback || "").trim().toLowerCase();
  if (fb && ENGINES[fb]) return fb;
  return geminiEngine.name;
}

export function getEngine(name) {
  return ENGINES[resolveEngineName(name)] || geminiEngine;
}
