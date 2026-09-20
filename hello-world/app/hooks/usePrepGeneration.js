"use client";

// N29 -- the manual "prepare me for this interview" trigger. POSTs to the
// SAME route/body shape `startInterviewPrepResearch`
// (lib/interviewPrep/prepTrigger.js) uses -- POST /api/interview-prep,
// {applicationId, triggerClass} -- but AWAITED and response-reading, because
// this hook's caller (a candidate who just clicked a button) has nothing
// else to do but be told what happened. That is the opposite contract from
// `startInterviewPrepResearch`, whose own header says it "RETURNS NOTHING"
// and "SWALLOWS EVERYTHING" by design, for its five existing fire-and-forget
// call sites -- this is a second CALLING CONVENTION for the same endpoint,
// never a second generation path, and never merged into that function.
//
// Modelled directly on app/hooks/useApplicationDigests.js's own solved
// version of this exact problem (a manual, user-initiated, awaitable POST
// with same-id double-fire protection): a `useRef` gate, checked and written
// SYNCHRONOUSLY, separate from the `useState` Set that exists only to drive
// the UI's "Generating..." label. A `useState`-only guard can be read stale
// by a stable `useCallback`'s own closure and cannot, by itself, stop a fast
// double-click or a programmatic double call (useApplicationDigests.js's own
// 1h F-7 fix, ":96-121").

import { useCallback, useRef, useState } from "react";

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// One POST to the interview-prep route, module-private (not exported),
// mirroring useApplicationDigests.js's own non-exported requestDigest.
// Tolerant JSON parse via readJson above -- this route always returns a JSON
// body on every gate (app/api/interview-prep/route.js's own POST handler),
// so a non-JSON body only happens on a genuine network/framework failure,
// which generateNow below maps to a networkError result.
async function requestPrepGeneration(applicationId, { triggerClass = "B2" } = {}) {
  const res = await fetch("/api/interview-prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, triggerClass }),
  });
  return readJson(res);
}

/**
 * @returns {{
 *   generatingIds: Set<string>,
 *   generateNow: (applicationId: string) => Promise<object>
 * }}
 *
 * `generateNow`'s promise never rejects and never resolves to `undefined`.
 * It resolves to one of:
 *   {status: "ready"|"partial"|"failed"|"unavailable"} -- a normal terminal
 *     write happened; the caller must re-fetch GET to see it, since this
 *     route's POST response never carries pack content.
 *   {status: "disabled"} -- GATE 1, the kill switch.
 *   {status: "refused", reason: "in-flight"|"error"} -- GATE 9's claim
 *     refusal ("attempts-spent" is no longer a value the server can produce
 *     once N41's cap-removal migration lands, but this hook does not
 *     special-case it -- an unrecognized reason simply passes through).
 *   {error: string} -- any other gate's own error text, already a complete,
 *     human-readable sentence at the source.
 *   {error: string, networkError: true} -- fetch rejected, threw
 *     synchronously, or the response body was not JSON.
 *   {skipped: true} -- a synchronous no-op: a request for this exact
 *     applicationId was already in flight.
 */
export function usePrepGeneration() {
  const inFlightRef = useRef(new Set());
  const [generatingIds, setGeneratingIds] = useState(() => new Set());

  const markGenerating = useCallback((applicationId, on) => {
    setGeneratingIds((prev) => {
      const has = prev.has(applicationId);
      if (on === has) return prev;
      const next = new Set(prev);
      if (on) next.add(applicationId);
      else next.delete(applicationId);
      return next;
    });
  }, []);

  const generateNow = useCallback(
    async (applicationId) => {
      if (!applicationId) return { error: "Missing applicationId." };
      if (inFlightRef.current.has(applicationId)) return { skipped: true };
      inFlightRef.current.add(applicationId);
      markGenerating(applicationId, true);
      try {
        const json = await requestPrepGeneration(applicationId);
        if (json && (json.status || json.error)) return json;
        return { error: "Could not start generation.", networkError: true };
      } catch (err) {
        return { error: err?.message || "Could not start generation.", networkError: true };
      } finally {
        markGenerating(applicationId, false);
        inFlightRef.current.delete(applicationId);
      }
    },
    [markGenerating],
  );

  return { generatingIds, generateNow };
}
