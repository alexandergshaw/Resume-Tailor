import { readEngine } from "@/app/settings/engine";

// Thin client for the /api/copilot/answer route. Returns { points, type }.
// Passes the selected engine so the Embedded engine drafts talking points
// on-device instead of calling Gemini.
export async function draftAnswer({ question, context, profile }) {
  const res = await fetch("/api/copilot/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context, profile, engine: readEngine() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Answer request failed (${res.status}).`);
  }
  return json;
}
