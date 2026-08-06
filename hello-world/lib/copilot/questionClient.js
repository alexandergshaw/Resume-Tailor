import { readEngine } from "@/app/settings/engine";

// Thin client for the /api/copilot/question route. Returns
// { question, type, source, exhausted }. Passes the selected engine so the
// Embedded engine pulls from the deterministic question bank on-device
// instead of calling Gemini. `interviewType` is forwarded as-is (the route
// normalizes it) — callers that omit it keep getting the default "general"
// session, unchanged.
export async function fetchNextQuestion({ posting, asked, interviewType }) {
  const res = await fetch("/api/copilot/question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posting, asked, interviewType, engine: readEngine() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Question request failed (${res.status}).`);
  }
  return json;
}
