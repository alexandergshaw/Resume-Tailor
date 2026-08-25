import { readEngine } from "@/app/settings/engine";
import { splitFrames } from "./answerStream.js";

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
// lib/copilot/idealProjectNarrative.js).
//
// AC-6.2: both modes also return `pageSources` — one entry per point, in the
// same order, each `{ id, title }` for the candidate's own project page that
// point drew on, or null. It is [] when nothing could be cited at all, which
// is not the same as an array of nulls (lib/copilot/pageCitations.js explains
// why the distinction is load-bearing downstream). This client returns the parsed body verbatim,
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

// AC-P2.6: the streaming counterpart to draftAnswer, for live mode's card so
// bullets appear as the model writes them instead of after it finishes. Same
// request shape plus `stream: true`; the wire framing (NDJSON) and the
// partial-JSON-to-bullets parsing are NOT this module's job — both are the
// pure, independently-tested primitives in answerStream.js, reused here so
// there is exactly one implementation of each.
//
// Calls `onPoints(points)` once per points frame, in arrival order, and
// resolves with the terminal `done` frame's payload. Rejects — never
// resolves with a partial answer — on an `error` frame, a non-ok response,
// or the stream ending with no terminal frame at all (a dropped connection
// must surface as a retry-able failure, not a silent partial success). A
// caller-supplied `onPoints` that throws (a React setState wrapper mid-
// render, say) is swallowed so an otherwise-intact stream is never lost to
// it, and nothing is ever delivered to `onPoints` once this has resolved.
export async function draftAnswerStreaming(
  { question, context, profile, interviewType, applicationId, mode },
  { onPoints } = {},
) {
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
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `Answer request failed (${res.status}).`);
  }

  const emit = (points) => {
    if (typeof onPoints !== "function") return;
    try {
      onPoints(points);
    } catch {
      // A caller's render callback throwing must not lose an otherwise
      // intact stream.
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = null; // { error: string } | { done: object }

  const consume = (frames) => {
    for (const frame of frames) {
      if (settled) return;
      if (frame?.t === "points") {
        emit(Array.isArray(frame.points) ? frame.points : []);
      } else if (frame?.t === "done") {
        settled = { done: frame };
      } else if (frame?.t === "error") {
        settled = { error: frame.error || "Answer request failed." };
      }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const split = splitFrames(buffer);
    buffer = split.rest;
    consume(split.frames);
    if (settled) break;
  }

  if (!settled) {
    // The terminal frame may have arrived without a trailing newline.
    buffer += decoder.decode();
    consume(splitFrames(`${buffer}\n`).frames);
  }

  if (!settled) {
    throw new Error("Answer stream ended unexpectedly.");
  }
  if (settled.error) {
    throw new Error(settled.error);
  }
  const payload = { ...settled.done };
  delete payload.t;
  return payload;
}
