import { readEngine } from "@/app/settings/engine";

// Thin client for the /api/copilot/detect route. Confirms whether an assembled
// interviewer utterance is a question and returns a cleaned, typed version.
// Returns { isQuestion, question, type }. Passes the selected engine so the
// Embedded engine confirms with the on-device heuristic instead of Gemini.
export async function confirmQuestion({ utterance, context }) {
  const res = await fetch("/api/copilot/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterance, context, engine: readEngine() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Detection failed (${res.status}).`);
  }
  return json;
}
