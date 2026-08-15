import { readEngine } from "@/app/settings/engine";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { localDetection } from "@/lib/copilot/localDetection";

// Thin client for the /api/copilot/detect route. Confirms whether an assembled
// interviewer utterance is a question and returns a cleaned, typed version.
// Returns { isQuestion, question, type }. Passes the selected engine so the
// Embedded engine confirms with the on-device heuristic instead of Gemini.
export async function confirmQuestion({ utterance, context }) {
  const engine = readEngine();

  // AC-R2.1: when the engine is embedded, the route's embedded branch would
  // just call this exact same localDetection against this exact same
  // utterance string the client already has in hand — a network round trip
  // that can only ever answer "no" differently than what the client already
  // knows. Decide locally and skip the network entirely for this engine.
  if (wantsEmbedded(engine)) {
    const local = localDetection(utterance);
    return { isQuestion: local.decided, question: local.question, type: local.type };
  }

  const res = await fetch("/api/copilot/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterance, context, engine }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Detection failed (${res.status}).`);
  }
  // AC-R2.3: passed through unchanged (not just isQuestion/question/type) so
  // `degraded`/`degradedReason` reach the caller without this module having
  // to know or care about them — a later change can surface `degraded`
  // without touching this file again.
  return json;
}
