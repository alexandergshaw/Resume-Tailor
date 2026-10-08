"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { draftAnswer } from "@/lib/copilot/answerClient";
// Namespace import for Row 2 only, probed with `in` before use -- see
// liveFetchAvailable below for why a named import cannot be used here.
import * as answerClientModule from "@/lib/copilot/answerClient";
import {
  finalProjectExample,
  projectExampleFromResponse,
  startProjectExampleLive,
} from "@/lib/copilot/projectExampleLive";
import { startTechTerms } from "@/lib/copilot/techTermsLive";
import { readEngine } from "@/app/settings/engine";
import {
  emptySampleAnswer,
  activeSampleAnswer,
  needsRedraft,
  cachedSampleAnswerFor,
} from "@/lib/copilot/sampleAnswerState";
import { normalizeQuestion } from "@/lib/copilot/questions";

// Row 2 of the example-projects group is requested through a namespace probe
// because a test file that stubs answerClient with only the exports it uses
// omits this one, and Vitest treats touching an omitted export as an error.
// Absent, the feature simply does not run (the sample answer renders no Row 2),
// which is what every suite that predates it expects. useDraftAnswer.js carries
// the same probe for the same reason.
function liveFetchAvailable() {
  return "fetchProjectExampleLive" in answerClientModule && typeof answerClientModule.fetchProjectExampleLive === "function";
}

// The tech-buzzwords row's own probe, for the same stale-partial-mock reason. It
// checks fetchTechTerms, never fetchProjectExampleLive: the two rows call
// different exports and must each be gated on the one they actually call.
function techTermsFetchAvailable() {
  return "fetchTechTerms" in answerClientModule && typeof answerClientModule.fetchTechTerms === "function";
}

// The Row-1 core BOTH rows below gate on: an application is selected and the
// answer carried a Row 1 value (in any status), which is the one authoritative
// "the server ran a model backend for this posting" signal this hook has. One
// predicate rather than two inline copies, so the rows cannot drift apart.
function exampleRowEnabled(appId, example) {
  return !!appId && !!example;
}

// G1: thin React wrapper around lib/copilot/sampleAnswerState.js's pure
// derivation. This hook owns exactly the three things React-specific
// enough that the pure module can't: the state slot itself, the monotonic
// generation ref that gates stale writes (AC-G1-7 — same pattern as
// requestQuestion in PracticeClient.js and runCritique in
// usePracticeAnswer.js), and the draftAnswer network call. Every DECISION —
// which draft (if any) applies to the question on screen, whether a reveal
// needs a fresh request — lives in sampleAnswerState.js as plain functions,
// so it's reachable from vitest without React (AC-G1-12).
//
// Deliberately independent of usePracticeAnswer: nothing here starts or
// stops the recorder or samplers, reads or writes answering/settling, or
// touches the critique — see AC-G1-10.
//
// G2: takes `interviewType` (shapes the drafted answer the same way it
// shapes questions and critique) and `applicationId` (the selected
// posting's own id — see PracticeClient's onDoneAnswer for the same
// normalizePostingRows fact) so the draft can be grounded in the resume and
// cover letter actually submitted for that posting. Always requests
// `mode: "answer"`, which AC-H9 changed to return `points` — an array of
// complete, speakable, STAR-labeled-when-applicable sentences — in place of
// a single prose string; this hook carries `points` through exactly where
// it carried `answer` before, with the same caching/gating rules (AC-H9.37).
//
// AC-C24/AC-C25/AC-C27: also takes `codeLanguage` (the code-language
// control's current value, read by the caller's usePracticeCodeLanguage and
// handed straight through by identifier, never re-derived here) — carried
// alongside profile/interviewType/applicationId on every state write, every
// cache write, and every draftAnswer call this hook makes, so a reveal after
// a language change is a cache MISS and drafts fresh in the new language,
// exactly like a profile edit or a posting change already does.
//
// `onRowOneStatus` is optional: told, for every FRESH answer (a real request or
// a silent queue, never a cache reuse) that carried a Row 1 value, which
// application it was drafted for and that Row 1's status, so a cold pool can be
// warmed again within the session (useApplicationProjectPool's
// noteRowOneStatus). Held in a ref so a caller handing over a new function each
// render changes the identity of nothing below.
export function useSampleAnswer({ question, profile, interviewType, applicationId, codeLanguage, onRowOneStatus }) {
  const [state, setState] = useState(emptySampleAnswer);
  const onRowOneStatusRef = useRef(onRowOneStatus);
  useEffect(() => {
    onRowOneStatusRef.current = onRowOneStatus;
  }, [onRowOneStatus]);
  // Bumped on every new request; a response is only ever written to state
  // while it's still the newest one requested — a slow draft for a question
  // the user has since moved past must repaint nothing (AC-G1-7).
  const genRef = useRef(0);
  // AC-J2.8: practice mode's counterpart to live mode's answerCacheRef
  // (CopilotClient.js) — what makes a queued draft (see `queue` below) FREE
  // on reveal instead of merely fast. Keyed by normalizeQuestion, the same
  // normalization live mode's cache uses, so a question revisited with
  // different case/whitespace still hits. A plain ref rather than state:
  // writing to it must never itself trigger a render or touch `state`.
  const cacheRef = useRef(new Map());
  // AC-N2: `queue`'s own generation token, separate from `genRef` above —
  // `request` (a user-requested reveal) and `queue` (a silent pre-fetch for
  // a question that just landed) must never be able to invalidate one
  // another just because they happen to overlap in flight. A slow queue for
  // a question the user has since moved past is discarded exactly like a
  // slow `request` is (AC-G1-7), by the same "still the newest?" check.
  const queueGenRef = useRef(0);
  // AC-N2: the question `queue` last kicked off a draft for, normalized the
  // same way the cache is keyed — read fresh on every render (a ref, not
  // state, for the same reason `cacheRef` is one: writing it must never
  // itself trigger a render) so PracticeClient's queue effect can dedupe
  // against it via shouldQueueSampleAnswer without a second cache lookup.
  const queuedForRef = useRef("");
  // Which Row 2 request currently owns the sample answer: bumped by every fire
  // below and by every fresh `request`, so a Row 2 that resolves after a newer
  // draft (a Regenerate, a Retry) took over the panel repaints nothing. Separate
  // from `genRef`, which gates the ANSWER's own write -- a Row 2 for a reveal
  // served from the cache has no answer request to borrow a generation from.
  const liveGenRef = useRef(0);
  // The same ownership counter for the tech-buzzwords row, kept apart from
  // `liveGenRef` so the two rows' requests can never invalidate one another.
  const techTermsGenRef = useRef(0);

  // Row 2 of the example-projects group for the sample answer now on screen:
  // an invented project written for `q`, requested after the answer has landed
  // and never awaited, so it cannot delay or fail the answer. Called from BOTH
  // places a sample answer lands -- a fresh draft resolving, and a reveal served
  // from the cache (which makes no request of its own, so nothing else would
  // fire it). Row 2 is never cached; a revealed-again answer gets a fresh one.
  //
  // `example` is the Row 1 value the ANSWER carried, in whatever status, and it
  // is the gate: the server omits Row 1 exactly when the feature does not apply
  // (no application selected, or an engine the SERVER treats as embedded, which
  // the browser's own engine setting cannot always see), so its presence is the
  // one authoritative "Row 2 applies here" signal this hook has. Without it a
  // sample answer for a server-embedded deployment would spend a request on every
  // reveal to be told "nothing to show".
  const fireProjectExampleLive = useCallback((q, appId, example) => {
    if (!exampleRowEnabled(appId, example) || !liveFetchAvailable()) return;
    const liveGen = (liveGenRef.current += 1);
    try {
      startProjectExampleLive({
        applicationId: appId,
        question: q,
        engine: readEngine(),
        fetchLive: answerClientModule.fetchProjectExampleLive,
        apply: (value) => {
          if (liveGenRef.current !== liveGen) return;
          setState((prev) => (prev.question === q ? { ...prev, projectExampleLive: value } : prev));
        },
      });
    } catch {
      // Row 2 is a supplement; nothing here may interrupt the sample answer.
    }
  }, []);

  // The tech-buzzwords row for the sample answer now on screen, requested after
  // the answer has landed and never awaited, from the same two places and under
  // the same Row-1 core as Row 2 above. Never cached: a revealed-again answer
  // asks again, so a pending or failed list is never replayed. A settle that
  // arrives after a newer draft (or fire) took over repaints nothing.
  const fireTechTerms = useCallback((q, appId, example) => {
    if (!exampleRowEnabled(appId, example) || !techTermsFetchAvailable()) return;
    const termsGen = (techTermsGenRef.current += 1);
    try {
      startTechTerms({
        applicationId: appId,
        question: q,
        engine: readEngine(),
        fetchTerms: answerClientModule.fetchTechTerms,
        apply: (value) => {
          if (techTermsGenRef.current !== termsGen) return;
          setState((prev) => (prev.question === q ? { ...prev, techTerms: value } : prev));
        },
      });
    } catch {
      // The row is a supplement; nothing here may interrupt the sample answer.
    }
  }, []);

  // Reports a fresh answer's Row 1 status to the pool prewarm's self-heal. Guarded
  // on its own: both call sites sit inside a promise chain whose catch turns a
  // throw into an error card, and a warm-up callback must never be able to turn a
  // delivered answer into one.
  const reportRowOneStatus = useCallback((appId, example) => {
    try {
      onRowOneStatusRef.current?.(appId, example?.status);
    } catch {
      // The warm-up is a supplement; nothing here may interrupt the sample answer.
    }
  }, []);

  // Only a stored draft built for the EXACT question on screen right now
  // ever applies (AC-G1-5) — no effect resets this on question change, the
  // comparison below just naturally stops matching.
  const active = activeSampleAnswer(state, question);

  // Fires (or re-fires) the network request for `q`/`p`/`it`/`appId`,
  // unconditionally — callers decide via needsRedraft whether this should
  // run at all. Marks the panel visible and loading immediately. The
  // resolution/rejection handlers merge into whatever `visible` is true AT
  // THAT MOMENT (a functional update) rather than forcing it back to true —
  // hiding the panel while this request is still in flight must not be
  // silently undone the instant it lands; the draft still gets cached
  // either way. Errors are handled entirely inside this promise chain
  // (AC-G1-4): nothing here ever throws back out to a caller.
  const request = useCallback((q, p, it, appId, cl) => {
    const gen = (genRef.current += 1);
    // A Row 2 still in flight for the draft this one replaces must not land on
    // the new one's panel.
    liveGenRef.current += 1;
    techTermsGenRef.current += 1;
    setState({
      question: q,
      visible: true,
      status: "loading",
      points: [],
      cues: [],
      buzzwords: [],
      anchor: null,
      // ARCH §3.5/§4e: seeded empty alongside the other reading aids while
      // loading — a real value only ever lands from the resolved response
      // below, never mid-request.
      pageSources: [],
      grounding: null,
      error: "",
      profile: p,
      interviewType: it,
      applicationId: appId,
      codeLanguage: cl,
    });
    // AC-H9/AC-K1: the route's `mode: "answer"` response is
    // { points, cues, answer, type, grounding, buzzwords, resumeAnchor,
    // pageSources }. `cues` is what SampleAnswer.js renders,
    // with `points` alongside its point (answerLines); `buzzwords`/
    // `resumeAnchor`/`pageSources` are the subsections under
    // it (ARCH §3.5 added `pageSources` — which knowledge-base page, if any,
    // each point came from). The derived prose `answer` field exists for a
    // later speech-synthesis feature and is deliberately not read here.
    // AC-C24/AC-C25: `codeLanguage` rides this request the same way
    // `interviewType`/`applicationId` already do — the single most
    // consequential wire in chunk C's practice reveal path (see
    // usePracticeCodeLanguage.test.js's own header): a hook that keeps the
    // language for its cache bookkeeping and drops it here would draft the
    // sample answer in the wrong language while the cache faithfully records
    // that it was drafted in the right one.
    draftAnswer({
      question: q,
      context: "",
      profile: p,
      interviewType: it,
      applicationId: appId,
      codeLanguage: cl,
      mode: "answer",
    })
      .then(({ points, cues, buzzwords, resumeAnchor, pageSources, grounding, projectExample }) => {
        if (genRef.current !== gen) return;
        const cleanPoints = Array.isArray(points) ? points : [];
        // AC-K1: same defensive normalization `points` already gets — a
        // missing or malformed field must land in state as the empty shape,
        // so the render layer's "is there anything to show" checks stay
        // simple truthiness rather than each one re-guarding the type.
        const cleanCues = Array.isArray(cues) ? cues : [];
        const cleanBuzzwords = Array.isArray(buzzwords) ? buzzwords : [];
        const cleanAnchor = resumeAnchor || null;
        // ARCH §4f: same defensive normalization as its siblings above —
        // and the value this hook's caller (useSampleAnswer's own `request`
        // resolution) both renders NOW and, two statements down, writes into
        // the cache — see that cache write's own comment for why both must
        // agree.
        const cleanPageSources = Array.isArray(pageSources) ? pageSources : [];
        const cleanGrounding = grounding || null;
        // Row 1 of the example-projects group, picked server-side for this
        // question; absent stays absent (see projectExampleFromResponse).
        const cleanExample = projectExampleFromResponse(projectExample);
        setState((prev) => ({
          ...prev,
          question: q,
          status: "done",
          points: cleanPoints,
          cues: cleanCues,
          buzzwords: cleanBuzzwords,
          anchor: cleanAnchor,
          pageSources: cleanPageSources,
          projectExample: cleanExample,
          projectExampleLive: undefined,
          techTerms: undefined,
          grounding: cleanGrounding,
          error: "",
          profile: p,
          interviewType: it,
          applicationId: appId,
          codeLanguage: cl,
        }));
        // AC-J2.8: a real (user-requested) draft is cached the exact same
        // way `queue`'s own silent pre-fetch is (see below) — same key, same
        // entry shape — so a draft survives moving to a different question
        // and back without a second request. ARCH §4f/§6.8: `pageSources`
        // rides this write too — a cache entry that dropped it would render
        // this question's citations on the first ask and lose them on a
        // reveal -> hide -> reveal of the SAME cached entry, with nothing on
        // screen explaining why. AC-C27: `codeLanguage` rides it the same
        // way, one field later — see cachedSampleAnswerFor's own comparison.
        cacheRef.current.set(normalizeQuestion(q), {
          points: cleanPoints,
          cues: cleanCues,
          buzzwords: cleanBuzzwords,
          anchor: cleanAnchor,
          pageSources: cleanPageSources,
          projectExample: cleanExample,
          grounding: cleanGrounding,
          profile: p,
          interviewType: it,
          applicationId: appId,
          codeLanguage: cl,
        });
        fireProjectExampleLive(q, appId, cleanExample);
        fireTechTerms(q, appId, cleanExample);
        reportRowOneStatus(appId, cleanExample);
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setState((prev) => ({
          ...prev,
          question: q,
          status: "error",
          points: [],
          cues: [],
          buzzwords: [],
          anchor: null,
          pageSources: [],
          grounding: null,
          error: err?.message || "Could not draft a sample answer.",
          profile: p,
          interviewType: it,
          applicationId: appId,
          codeLanguage: cl,
        }));
      });
  }, [fireProjectExampleLive, fireTechTerms, reportRowOneStatus]);

  // Shared by the toggle's "show" branch (force=false — serve the cache
  // when it's still valid per needsRedraft) and by Retry/Regenerate
  // (force=true — always redraft). The pure module makes the call; this
  // just acts on it.
  const reveal = useCallback(
    (force) => {
      if (needsRedraft(active, profile, interviewType, applicationId, codeLanguage, force)) {
        // AC-J2.8: `force` (Retry/Regenerate) always bypasses the cache and
        // redrafts — needsRedraft already returns true unconditionally for
        // force, so this branch only reaches the cache lookup when force is
        // false, which is exactly what "always bypass" requires. A queued
        // draft must be FREE on reveal, not merely fast: before paying for a
        // fresh request, check whether `queue` already drafted this exact
        // question while it sat unrevealed. cachedSampleAnswerFor applies the
        // same profile/interviewType/applicationId/codeLanguage comparison
        // needsRedraft's own "done" branch does, just against a cache entry
        // instead of the draft already on screen, so a queued draft made
        // before the user edited their prep context (or changed posting/
        // interview type/code language) is never served as if it still
        // applied.
        if (!force) {
          const cached = cachedSampleAnswerFor(
            cacheRef.current.get(normalizeQuestion(question)),
            question,
            profile,
            interviewType,
            applicationId,
            codeLanguage,
          );
          if (cached) {
            // Row 1 rides the cache only in a FINAL state, and Row 2 is never
            // part of a cached entry: a reveal served from the cache makes no
            // request, so it gets a fresh Row 2 here rather than replaying a
            // pending or settled one. See finalProjectExample.
            const raw = cacheRef.current.get(normalizeQuestion(question));
            setState({ ...cached, projectExample: finalProjectExample(raw?.projectExample) });
            fireProjectExampleLive(question, applicationId, raw?.projectExample);
            fireTechTerms(question, applicationId, raw?.projectExample);
            return;
          }
        }
        request(question, profile, interviewType, applicationId, codeLanguage);
        return;
      }
      setState((prev) => (prev.question === question ? { ...prev, visible: true } : prev));
    },
    [active, profile, interviewType, applicationId, codeLanguage, question, request, fireProjectExampleLive, fireTechTerms],
  );

  // AC-N2: fetches a draft for `q` and writes it to the cache via the exact
  // same `cacheRef.current.set` shape `request`'s resolution above uses —
  // deliberately never touching `state`. Practice mode hides the sample
  // answer behind a reveal on purpose (seeing a model answer before
  // attempting one is what makes practice worthless), so this makes the
  // draft READY, never SHOWN — only `reveal` ever sets `state`. Callers
  // decide whether this should run at all via shouldQueueSampleAnswer
  // (lib/copilot/practiceFlow.js); this just does the fetch and the write.
  const queue = useCallback((q, p, it, appId, cl) => {
    // Written synchronously, before the fetch even starts — the same
    // moment `request` above marks its own state loading. `hasCached`
    // alone isn't enough to dedupe against: the cache entry doesn't exist
    // until the fetch below RESOLVES, so a second effect run for the same
    // question while it's still in flight (a profile edit, an interview-
    // type change) would see `hasCached` still false and queue it again.
    // `queuedFor` closes that gap — it's true from the moment this line
    // runs, not from whenever the network call happens to finish.
    queuedForRef.current = normalizeQuestion(q);
    const gen = (queueGenRef.current += 1);
    // AC-C24/AC-C25: the other `draftAnswer` call in this hook, and the one
    // whose result a reveal is then served from — a queue drafted under the
    // wrong language poisons the cache the reveal reads.
    draftAnswer({
      question: q,
      context: "",
      profile: p,
      interviewType: it,
      applicationId: appId,
      codeLanguage: cl,
      mode: "answer",
    })
      .then(({ points, cues, buzzwords, resumeAnchor, pageSources, grounding, projectExample }) => {
        // A newer queue (or a real `request`) has since started for a
        // different question — this response belongs to a question the
        // user has already moved past, so it writes nothing.
        if (queueGenRef.current !== gen) return;
        const queuedExample = projectExampleFromResponse(projectExample);
        cacheRef.current.set(normalizeQuestion(q), {
          points: Array.isArray(points) ? points : [],
          cues: Array.isArray(cues) ? cues : [],
          buzzwords: Array.isArray(buzzwords) ? buzzwords : [],
          anchor: resumeAnchor || null,
          // ARCH §4f/§6.8: this queue's own cache write must carry
          // `pageSources` the same way `request`'s does above — a draft
          // pre-fetched silently while unrevealed must not read back with
          // its citations missing the moment it IS revealed.
          pageSources: Array.isArray(pageSources) ? pageSources : [],
          // Same field `request`'s cache write carries, for the same reason: a
          // draft pre-fetched while unrevealed must still show its Row 1 the
          // moment it IS revealed (in a final state only -- see reveal).
          projectExample: queuedExample,
          grounding: grounding || null,
          profile: p,
          interviewType: it,
          applicationId: appId,
          codeLanguage: cl,
        });
        // A silent pre-fetch is a fresh server call too, so it is as good a
        // witness of the pool's state as a revealed one.
        reportRowOneStatus(appId, queuedExample);
      })
      .catch(() => {
        // AC-N2: swallowed on purpose — a failed queue must leave the user
        // with today's behaviour (a real request paid for on reveal), never
        // an error on screen and never a rejected promise escaping to a
        // caller that isn't expecting one. `reveal(false)` already falls
        // back to a fresh request whenever the cache has nothing usable, so
        // there is nothing else to do here.
      });
  }, [reportRowOneStatus]);

  // AC-N2: whether a draft is already cached for `q` — exposed so
  // PracticeClient's queue effect can feed shouldQueueSampleAnswer's
  // `hasCached` without reaching into `cacheRef` itself (which is private to
  // this hook) or re-deriving the same normalizeQuestion lookup a second way.
  const hasCached = useCallback((q) => cacheRef.current.has(normalizeQuestion(q)), []);

  // AC-N2: reads `queuedForRef` — a function, not the value itself, because
  // React now flags a ref read during render (this hook's own function body
  // runs on every one of PracticeClient's renders, same as any other hook)
  // as a mistake even when nothing here uses it to decide what to render.
  // Called from PracticeClient's queue effect, never during render, exactly
  // like `hasCached` above already is.
  const getQueuedFor = useCallback(() => queuedForRef.current, []);

  // "Show sample answer" / "Hide sample answer". Hiding never fetches — it
  // only flips visibility, leaving whatever is cached (points, status,
  // profile) exactly as it was for the next reveal (AC-G1-3).
  const toggle = useCallback(() => {
    if (active.visible) {
      setState((prev) => (prev.question === question ? { ...prev, visible: false } : prev));
      return;
    }
    reveal(false);
  }, [active.visible, question, reveal]);

  const retry = useCallback(() => reveal(true), [reveal]);
  const regenerate = useCallback(() => reveal(true), [reveal]);

  return {
    visible: active.visible,
    status: active.status,
    points: active.points,
    cues: active.cues,
    buzzwords: active.buzzwords,
    anchor: active.anchor,
    pageSources: active.pageSources,
    // Rows 1 and 2 of the example-projects group; undefined when the response
    // carried none (no posting selected, or the embedded engine).
    projectExample: active.projectExample,
    projectExampleLive: active.projectExampleLive,
    // The tech-buzzwords row (suggested terms to be aware of); undefined under
    // the same conditions as the two rows above.
    techTerms: active.techTerms,
    grounding: active.grounding,
    error: active.error,
    toggle,
    retry,
    regenerate,
    queue,
    hasCached,
    getQueuedFor,
  };
}
