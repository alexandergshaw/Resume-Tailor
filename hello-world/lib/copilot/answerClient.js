import { readEngine } from "@/app/settings/engine";

// Thin client for the /api/copilot/answer route. `mode` is "points" (the
// default — live mode's glanceable bullets, response { points, type }) or
// "answer" (practice mode's spoken sample answer, response
// { answer, type, grounding }); an unknown/missing mode is treated as
// "points" by the route. Passes the selected engine so the Embedded engine
// drafts the answer on-device instead of calling Gemini.
export async function draftAnswer({ question, context, profile, interviewType, applicationId, mode }) {
  const res = await fetch("/api/copilot/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      context,
      profile,
      interviewType,
      applicationId,
      mode,
      engine: readEngine(),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Answer request failed (${res.status}).`);
  }
  return json;
}
