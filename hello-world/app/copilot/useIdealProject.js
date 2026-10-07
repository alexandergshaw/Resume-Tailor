"use client";

import { useEffect, useState } from "react";
import { fetchIdealProject } from "@/lib/copilot/idealProjectClient";

// N125: the SINGLE display source for the worked example beside an answer, on
// every surface that renders one. It owns both tiers:
//
//   READY     asked for first, and shown the moment it lands. Always present
//             once a posting is selected (the server answers from a cache
//             peek, falling to the deterministic archetype), so the candidate
//             has an example in milliseconds whatever the model is doing.
//   TAILORED  asked for AFTER READY, on its own request: a live model call for
//             this exact question that the server allows seconds for BECAUSE
//             READY is already on screen. It is ADDED beside READY when it
//             lands and never replaces it.
//
// Returns { ready, tailored, tailoredStatus }:
//   tailoredStatus "idle"    nothing asked for yet, no question/posting, or the
//                            engine is embedded (the user's pick or the server's)
//   tailoredStatus "loading" READY has landed and TAILORED is in flight
//   tailoredStatus "done"    `tailored` is the arrived example
//   tailoredStatus "failed"  the request failed, timed out server-side, or came
//                            back empty: `tailored` stays null and READY stands
//                            alone. NEVER an error — there is no error state in
//                            this hook at all, by design: a candidate reading
//                            an answer mid-question must not be told about it.
//
// THE EMBEDDED ENGINE IS SUPPRESSED AT THE DISPATCH, on two readings. With
// `engine === "embedded"` (the user's own pick) the TAILORED request is never
// made. The client cannot see a SERVER-forced engine (RESUME_ENGINE=embedded, or
// no key), which needs server env, so the READY response carries the server's
// own verdict as `tailoredAvailable` (!wantsEmbedded, computed where the
// TAILORED gate runs) and `false` suppresses the dispatch too. Either way
// `tailoredStatus` never leaves "idle", so no "Tailoring to this question…" cue
// can flash for a result that can never arrive. (The server independently
// refuses a model call for embedded; this is the structural half, not a
// reliance on it.) A READY that FAILED carries no verdict, so TAILORED is still
// tried, and a refusal then ends as "failed", i.e. nothing — as does a READY
// from a server that predates the flag (`undefined` is not `false`).
//
// Stale writes: the effect's AbortController is the generation guard. A
// question (or posting, or engine) change aborts the previous run, whose
// requests then resolve to null and whose continuation sees `aborted` and
// writes nothing; the state's own `key` is the second guard, so even a write
// that raced the abort cannot land on the wrong question. The returned values
// are DERIVED from the key — no synchronous clearing in the effect body — so
// a different question never shows the previous question's example.
//
// `applicationId` and `question` blank → nothing is asked, nothing is shown:
// no posting selected means no example, an ordinary state and not an error.

const STATUS = { idle: "idle", pending: "loading", done: "done", failed: "failed" };

const EMPTY = { key: "", ready: null, tailored: null, tailoredResult: "idle" };

function requestKey(applicationId, engine, question) {
  return applicationId && question ? `${applicationId}\u0000${engine || ""}\u0000${question}` : "";
}

export function useIdealProject({ applicationId, question, engine } = {}) {
  const appId = applicationId || "";
  const q = (question || "").trim();
  const key = requestKey(appId, engine, q);
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    const mine = requestKey(appId, engine, q);
    if (!mine) return undefined;
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      const ready = await fetchIdealProject({ applicationId: appId, question: q, engine, signal });
      if (signal.aborted) return;
      const readyAid = ready?.idealProject || null;
      // A READY that came back OK with no example means no posting: nothing to
      // tailor to, so TAILORED is not asked for either. A READY that FAILED
      // (null) still lets TAILORED try on its own. The server's verdict is
      // compared against `false` exactly: only an explicit refusal suppresses.
      const serverRefuses = ready?.tailoredAvailable === false;
      const askTailored = engine !== "embedded" && !serverRefuses && !(ready && !readyAid);
      setState({ key: mine, ready: readyAid, tailored: null, tailoredResult: askTailored ? "pending" : "idle" });
      if (!askTailored) return;

      const live = await fetchIdealProject({ applicationId: appId, question: q, engine, tailored: true, signal });
      if (signal.aborted) return;
      const tailoredAid = live?.idealProject || null;
      setState((prev) =>
        prev.key === mine ? { ...prev, tailored: tailoredAid, tailoredResult: tailoredAid ? "done" : "failed" } : prev,
      );
    })();

    return () => controller.abort();
  }, [appId, q, engine]);

  const active = key && state.key === key ? state : null;
  return {
    ready: active?.ready || null,
    tailored: active?.tailored || null,
    tailoredStatus: active ? STATUS[active.tailoredResult] : "idle",
  };
}
