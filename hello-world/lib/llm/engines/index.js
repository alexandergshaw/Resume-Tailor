import { geminiEngine } from "@/lib/llm/engines/geminiEngine";
import { externalEngine } from "@/lib/llm/engines/externalEngine";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite";

// Registry of document-generation engines. Each engine implements
// `tailorResume(options)`, `tailorCoverLetter(options)`, and
// `tailorHiringEmail(options)` returning the normalized shape the /api/tailor
// route assembles its response from. "embedded" is the in-process,
// deterministic (no-LLM) engine; "external" calls the standalone Resume
// Tailor API.
//
// The hiring email is the one place the three engines diverge: it's a short
// plain-text note (`{ subject, bodyLines }`), never a filled .docx — no
// engine runs it through a template pipeline. "external" has no such
// endpoint on the standalone service and its `tailorHiringEmail` always
// resolves to null rather than throwing; callers must treat a null/absent
// result as "no email generated" rather than an error.
const ENGINES = {
  [geminiEngine.name]: geminiEngine,
  [externalEngine.name]: externalEngine,
  [embeddedEngine.name]: embeddedEngine,
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
