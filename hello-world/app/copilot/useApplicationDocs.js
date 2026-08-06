"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadApplicationDocs } from "@/lib/copilot/applicationDocsClient";

// The raw state this hook keeps. It is only ever written from a load's
// `.then`/`.catch` — never synchronously from the effect below — which is
// what keeps this file clear of react-hooks/set-state-in-effect (a
// synchronous setState reachable from an effect body, even through a
// called function, is what that rule rejects; setState from an async
// callback is not).
//
// `forId` is the application id the fields below actually belong to —
// null until a load first settles. `outcome` ("done" | "error" | null)
// is only meaningful once `forId` matches the id being asked about;
// resolveDocs below is what makes that comparison, the same trick
// lib/copilot/sampleAnswerState.js's activeSampleAnswer uses (a stored
// value only applies when the key it was built for still matches what's
// being asked about now — there, a question; here, an application id).
const INITIAL_STATE = { forId: null, outcome: null, resume: "", coverLetter: "", error: "" };

// What to report for `applicationId` right now, derived from the last
// load that settled rather than tracked as its own "loading"/"idle"
// state. This is what lets the effect below do nothing but kick a load
// off (AC-H2.6, AC-H2.9):
//
//   - no `applicationId` — idle, no documents, no error. Covers the
//     "posting cleared" case without anything needing to reset `state`.
//   - `state` belongs to a DIFFERENT id (nothing has settled yet for
//     this one — either it just changed, or the very first load for it
//     is still in flight) — loading, no documents.
//   - otherwise, `state.forId` already matches — report whatever that
//     load produced: "done" with its documents, or "error" with its
//     message.
// Exported separately so it can be unit-tested without a Supabase client,
// mirroring lib/copilot/postings.js's normalizePostingRows.
export function resolveDocs(state, applicationId) {
  if (!applicationId) {
    return { status: "idle", resume: "", coverLetter: "", error: "" };
  }
  if (state.forId !== applicationId) {
    return { status: "loading", resume: "", coverLetter: "", error: "" };
  }
  return { status: state.outcome, resume: state.resume, coverLetter: state.coverLetter, error: state.error };
}

// Loads the résumé and cover letter actually submitted for the currently
// selected posting, the moment `applicationId` changes — no button press,
// no expanding the panel first (AC-H2.6). Backs the "Submitted for this
// application" panel (SubmittedDocs.js) in both live mode and practice
// mode.
//
// Owns the monotonic generation ref that gates stale writes (AC-H2.8), the
// same pattern as PracticeClient's requestQuestion and useSampleAnswer's
// genRef: a load already in flight for an application the caller has since
// moved past must never write its result over whatever is current. This
// still has to be a generation, not just a `forId` comparison, because two
// loads for the SAME id can be in flight at once — the initial load and a
// `retry()` fired before it lands — and `forId` can't tell those apart
// since it's identical for both. Only the generation each one captured at
// kickoff can, so whichever was kicked off LAST always wins the write,
// regardless of which one's network call happens to resolve last.
//
// Clearing the posting (`applicationId` becomes falsy) reports empty
// documents and no error (AC-H2.9) — resolveDocs above reports "idle" for
// any falsy id regardless of what's sitting in `state`, so there is
// nothing to clear.
//
// Never throws (AC-H2.10): the one thing that can reject —
// loadApplicationDocs's auth lookup — is caught here and turned into
// `status: "error"` with a retryable `retry`, so a load failure can never
// break the capture session, the transcript, question generation, or
// answer drafting, all of which are driven by state this hook never
// touches.
export function useApplicationDocs(applicationId) {
  const [state, setState] = useState(INITIAL_STATE);
  const genRef = useRef(0);

  // Kicks a load off. Nothing here runs setState synchronously — only the
  // `.then`/`.catch` callbacks do, once the fetch actually settles — so
  // calling this from the effect below never trips the synchronous-
  // setState-in-effect lint rule. Bumping genRef unconditionally, even
  // when `id` is falsy, keeps a load still in flight for a posting just
  // left behind from ever winning the write race against whatever comes
  // after it, including "nothing" (the posting was cleared).
  const load = useCallback((id) => {
    const gen = (genRef.current += 1);
    if (!id) return;
    loadApplicationDocs(id)
      .then(({ resume, coverLetter } = {}) => {
        if (genRef.current !== gen) return;
        setState({ forId: id, outcome: "done", resume: resume || "", coverLetter: coverLetter || "", error: "" });
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setState({
          forId: id,
          outcome: "error",
          resume: "",
          coverLetter: "",
          error: err?.message || "Could not load the submitted documents.",
        });
      });
  }, []);

  // Runs on every `applicationId` change, including to/from falsy — `load`
  // itself branches on that (above), so this effect has exactly one job:
  // hand the current id to it. The "loading" (or "idle") the caller sees
  // for the moment between this running and the load settling comes from
  // resolveDocs below, not from anything written here.
  useEffect(() => {
    load(applicationId);
  }, [applicationId, load]);

  // BUG-H2: without this, a retry for an application whose LAST load already
  // failed leaves `state.forId` already equal to `applicationId`, so
  // resolveDocs keeps reporting "error" — from the stale, superseded load —
  // for the whole time the retry is in flight, and again if it fails a
  // second time nothing here would visibly change. `retry` is an event
  // handler (fired from the panel's Retry button), not an effect, so writing
  // state directly here is legal and does not reintroduce the
  // react-hooks/set-state-in-effect violation this file was written to
  // avoid — only a synchronous setState reachable from the EFFECT body (the
  // one above, which only ever calls `load`) trips that rule. Setting
  // `outcome` to "loading" (rather than clearing `state` back to
  // INITIAL_STATE) is enough: resolveDocs reports whatever `state.outcome`
  // is once `forId` matches, so this alone flips the reported status to
  // "loading" immediately, and the load's own `.then`/`.catch` — still
  // gated by the same generation ref as every other load — overwrites it
  // once the retry actually settles.
  const retry = useCallback(() => {
    if (!applicationId) return;
    setState((prev) => (prev.forId === applicationId ? { ...prev, outcome: "loading" } : prev));
    load(applicationId);
  }, [applicationId, load]);

  const { status, resume, coverLetter, error } = resolveDocs(state, applicationId);

  return { status, resume, coverLetter, error, retry };
}
