import { readEngine } from "@/app/settings/engine";

// Thin client for the /api/copilot/answer route. `mode` is "points" (the
// default — live mode's glanceable bullets) or "answer" (practice mode's
// spoken sample answer, which also carries `answer` and `grounding`); an
// unknown/missing mode is treated as "points" by the route. Passes the
// selected engine so the Embedded engine drafts the answer on-device instead
// of calling Gemini.
//
// AC-K1: both modes return `cues` (one short prompt per point — what the UI
// renders), `buzzwords` (terms from the posting to work in), `resumeAnchor`
// ({ title, company, matched, project, description } or null) and
// `idealProject` ({ shape, summary, metrics, project } or null — the
// ideal-project benchmark, lib/copilot/idealProject.js; AC-M1 added
// `project`, the worked-example write-up built by
// lib/copilot/idealProjectNarrative.js). This client returns the parsed body verbatim,
// so those need no plumbing here; the consumers that carry them into state
// are useSampleAnswer.js (practice), CopilotClient.js (live) and
// useCopilotDashboard.js (both dashboards).
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
