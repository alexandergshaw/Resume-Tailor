import { readEngine } from "@/app/settings/engine";

// Thin client for the /api/copilot/critique route — mirrors answerClient.js.
// Passes the selected engine so the Embedded engine judges the answer
// on-device instead of calling Gemini. Also forwards `interviewType` (see
// lib/copilot/interviewTypes.js) so the route can judge the answer against
// that format's bar instead of a generic one; omitted, it's undefined and
// JSON.stringify drops it from the request body entirely, so an existing
// caller that never passes it behaves exactly as before. Returns the
// AC-C4-1 shape: { score, verdict, strengths, improvements, missing, star,
// delivery, source }.
export async function critiqueAnswer({ question, type, answer, posting, profile, metrics, frames, interviewType }) {
  const res = await fetch("/api/copilot/critique", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      type,
      answer,
      posting,
      profile,
      metrics,
      frames,
      interviewType,
      engine: readEngine(),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Critique request failed (${res.status}).`);
  }
  return json;
}
