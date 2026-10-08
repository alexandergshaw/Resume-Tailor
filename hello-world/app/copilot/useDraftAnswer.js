"use client";

import { useCallback, useEffect, useRef } from "react";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { cachedAnswerFor, groundingFor } from "@/lib/copilot/answerGrounding";
import { getInterviewType } from "./useInterviewType";
import { getCodeLanguage } from "./useCodeLanguage";
// Namespace import, not named — see fetchAnswer's own comment for why.
import * as answerClientModule from "@/lib/copilot/answerClient";
import {
  finalProjectExample,
  projectExampleFromResponse,
  startProjectExampleLive,
} from "@/lib/copilot/projectExampleLive";
import { startTechTerms } from "@/lib/copilot/techTermsLive";
import { readEngine } from "@/app/settings/engine";

// AC-P4.2: runDraft's one and only answer-fetching call, in production
// always the streaming client — draftAnswerStreaming resolves with exactly
// the same payload shape draftAnswer does, plus the `onPoints` callback that
// lets bullets land on the card as they arrive.
//
// The presence check exists for one reason: this hook and the pre-existing,
// out-of-scope app/copilot/useLiveSession.manual.test.js share the same
// runDraft/addQuestion path for a typed question (AC-O2 — "the same path a
// detected question uses"), and that file's `vi.mock("@/lib/copilot/
// answerClient", () => ({ draftAnswer: vi.fn() }))` stubs the module without
// `draftAnswerStreaming` at all. Vitest 4 treats touching an export a mock
// factory omitted (even a bare `typeof` on a named import of it) as an error
// — "No 'draftAnswerStreaming' export is defined on the mock" — specifically
// to catch a stale partial mock, so a named `import { draftAnswerStreaming }`
// throws under that file's mock before this function's own body ever runs.
// The `in` check on the NAMESPACE object is the one form of this probe
// Vitest allows without throwing; only once it confirms the export exists is
// the property actually read. In the real module (and in this feature's own
// app/copilot/useLiveSession.instant.test.js, which mocks both exports) this
// is always present, so the fallback never engages outside that one
// stale-mock file — see this feature's report for why editing it was not an
// option here.
function fetchAnswer(args, handlers) {
  if ("draftAnswerStreaming" in answerClientModule && typeof answerClientModule.draftAnswerStreaming === "function") {
    return answerClientModule.draftAnswerStreaming(args, handlers);
  }
  return answerClientModule.draftAnswer(args);
}

// Row 2 of the example-projects group goes through the same namespace probe, for
// the same reason: a test file that stubs answerClient with only the exports it
// cares about omits this one, and touching an omitted export throws. Absent, the
// feature simply does not run (the card renders no Row 2), which is what every
// pre-existing suite that never heard of it expects.
function liveFetchAvailable() {
  return "fetchProjectExampleLive" in answerClientModule && typeof answerClientModule.fetchProjectExampleLive === "function";
}

// The tech-buzzwords row probes ITS OWN export, for the same stale-partial-mock
// reason as above. It must not borrow liveFetchAvailable: that probes
// fetchProjectExampleLive, a different export, and a test (or a build) that
// carries one without the other would wire the wrong function.
function techTermsFetchAvailable() {
  return "fetchTechTerms" in answerClientModule && typeof answerClientModule.fetchTechTerms === "function";
}

// What the session log records about the two example rows: the card's id, the
// value's status and the identity tags a pool entry carries, never the entry's
// text. Row 1 is logged when it lands on a card (the selection decision), Row 2
// when it settles (the on-the-spot outcome).
//
// `fitScore` and `poolTags` are the owner probe's evidence (AC-N143-Q,
// docs/loop/N143.probe.md): the score the pick won or missed with, and every
// entry of the pool it was picked from as { competency, domain, title }. They are
// present only on a ready or no_match value (the server sends them there) and
// the log omits an undefined field, so a pending or failed value logs as before.
// Practice mode's log (usePracticeSessionLog) carries the same two fields, so the
// probe reads the same evidence in either mode.
function logExampleShown(logEvent, id, example) {
  if (!example) return;
  logEvent("projectExample.shown", {
    id,
    status: example.status,
    competency: example.competency || "",
    domain: example.domain || "",
    fitScore: example.fitScore,
    poolTags: example.poolTags,
  });
}

function logExampleLive(logEvent, id, example) {
  if (!example) return;
  logEvent("projectExample.live", { id, status: example.status, competency: example.competency || "" });
}

// The tech-buzzwords row's outcome, once it has settled: the card's id, the
// value's status and HOW MANY terms it carried. Never the terms themselves,
// the question or any posting text -- identity and outcome only, like the two
// example rows above.
function logTechTermsShown(logEvent, id, value) {
  if (!value) return;
  logEvent("techTerms.shown", {
    id,
    status: value.status,
    count: Array.isArray(value.terms) ? value.terms.length : 0,
  });
}

// AC-P4/AC-N1/AC-Q6.9: split out of useLiveSession.js purely to keep that
// file under this project's 1000-line cap — the same reasoning
// useSessionLogRecorder.js's own module doc gives (which itself split out of
// this same file for the same reason). This owns exactly one thing: turning
// a question into a drafted answer, with the answer cache and the
// in-flight-generation guard that makes a stale draft harmless. `profile`/
// `posting` are handed in as plain props (not refs) — this hook keeps its
// OWN ref mirrors of them for the same reason useLiveSession.js's other
// stable useCallbacks do (buildContext, handleUtterance, ...): runDraft is a
// stable callback whose async body must see the LATEST selection, not
// whatever was current when the callback identity was created, and this
// project's react-hooks/refs lint rule forbids reading a ref's `.current`
// during render as a substitute for that.
export function useDraftAnswer({
  profile,
  posting,
  answerCacheRef,
  draftGenRef,
  buildContext,
  setQuestions,
  logEvent,
  // Optional. Told, for every FRESH answer that carries a Row 1 value, which
  // application it was drafted for and what status that Row 1 had, so a pool that
  // was cold (`pending`) can be warmed again within the session. See
  // useApplicationProjectPool's noteRowOneStatus; held in a ref below so a caller
  // handing over a new function each render does not change runDraft's identity.
  onRowOneStatus,
}) {
  const onRowOneStatusRef = useRef(onRowOneStatus);
  useEffect(() => {
    onRowOneStatusRef.current = onRowOneStatus;
  }, [onRowOneStatus]);
  const profileRef = useRef("");
  // AC-H1: mirrors `posting`, the same reason profileRef exists just above.
  const postingRef = useRef(null);
  // AC-A16/AC-A16b: monotonic per-entry draft ownership counter. NOT mirrored
  // from render state and NOT reset alongside answerCacheRef.current.clear()
  // — resetting could let a new token collide with a stale stamp still
  // sitting on a surviving entry. The interview type AND the code language
  // are both read straight from their stores' getters at the top of
  // runDraft, never mirrored into a ref: the store notifies synchronously
  // inside a change, but useSyncExternalStore only SCHEDULES a render and
  // useEffect is passive and commits after paint, so a ref mirrored during
  // render would still read the OLD value inside a synchronous change
  // listener (AC-C26).
  const draftTokenRef = useRef(0);
  // The newest draft token stamped on each card, by card id. The card's own
  // `draftToken` is only readable inside a setQuestions updater, which must stay
  // pure, so this is how a draft that resolves AFTER a newer one took over its
  // card finds that out before it spends a model call on an example nobody
  // will see (Row 2 below).
  const latestTokenByIdRef = useRef(new Map());

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    postingRef.current = posting;
  }, [posting]);

  const runDraft = useCallback(
    async (id, question, { force = false } = {}) => {
      const norm = normalizeQuestion(question);
      // AC-N1.2/AC-A19: what this draft is (or would be) built from, read
      // ONCE, here — before the `await` further down. Re-reading
      // profileRef/postingRef or either store's getter AFTER that await
      // would report whatever the user has since selected, not what THIS
      // draft actually used; capturing once and reusing the same value for
      // the lookup below, the network call, and the eventual cache write is
      // what AC-N1's correction to the original bug report is about. The
      // interview type and the code language both go through groundingFor
      // exactly like the other fields — the shared machinery, not a
      // hand-folded key — so a write from one mode's cache can be read back
      // correctly by the other's, and this cache key stays correct the day a
      // fifth field is added.
      const grounding = groundingFor({
        profile: profileRef.current,
        interviewType: getInterviewType(),
        applicationId: postingRef.current?.id || null,
        // AC-C26: read synchronously here, on the line directly below
        // getInterviewType() — never mirrored into a ref (see draftTokenRef's
        // comment above). This is the ONE capture point; the request body
        // below reuses grounding.codeLanguage rather than reading the store
        // a second time.
        codeLanguage: getCodeLanguage(),
      });
      // AC-N1.3: this draft's generation, also captured before the await.
      // Bumped by onPostingChange/onProfileChange (CopilotClient.js) and by
      // useLiveSession.js's own `start` — re-checked past the await, before
      // either write, so a draft still resolving when the user moves on
      // can't land anywhere.
      const gen = draftGenRef.current;
      // AC-A16b: this draft's per-entry ownership token, stamped BEFORE the
      // cache-hit branch below — not after it. A cache hit resolves the card
      // without going through the loading write, so if the token were
      // stamped only there, a cache hit would leave a STALE token in place
      // and an older in-flight draft still matching it would overwrite the
      // answer just served. Monotonic, never reset, never seeded on an entry
      // anywhere else (C3/§D.22) — an entry that was never drafted carries no
      // token, and no live token can ever equal `undefined`.
      const token = (draftTokenRef.current += 1);
      latestTokenByIdRef.current.set(id, token);
      // Row 2 of the example-projects group: an invented project written for
      // THIS question, requested after the answer has landed and never awaited,
      // so it can neither delay the answer nor fail it. ONE function, called from
      // BOTH places a draft resolves a card — the cache-hit branch below, which
      // returns before the done-frame write, and the done-frame write itself.
      // Wired only to the done-frame write, a re-asked question (a cache hit)
      // would never fire it and its card would sit on "Writing one for this
      // question" until the watchdog gave up; a reused answer deserves a fresh
      // example, since Row 2 is by contract never cached.
      //
      // `example` is the Row 1 value the ANSWER carried, in whatever status, and it
      // is the gate -- the same one practice mode's sample answer uses, so the two
      // modes cannot disagree about when Row 2 exists. The server omits Row 1
      // exactly when the feature does not apply (no application, or an engine the
      // SERVER treats as embedded, which the browser's own engine setting cannot
      // always see), so its presence is the one authoritative "Row 2 applies here"
      // signal. Gating on the client's engine alone spent a request on every
      // question of a server-embedded deployment, and flashed an empty "Example
      // projects" group while it waited to be told "nothing to show".
      //
      // Every write is gated `it.id === id && it.draftToken === token`, like
      // every other post-await write in this function. A write that settles after
      // a GENERATION bump (the user changed posting or profile, or started a fresh
      // session, while Row 2 was in flight) clears the row rather than being
      // dropped: the pending placeholder written at the start belongs to a card
      // the user has left, and dropping the settle left "Writing one for this
      // question" on it forever. A card a newer draft has taken fails the token
      // gate, so the clear can never touch the newer draft's own row.
      //
      // THE ROW-1 GATE IS ONE NAMED LOCAL, `exampleRowEnabled`, because a second
      // row (the tech buzzwords below) leans on the identical "a posting is
      // selected AND the server ran a model backend" signal. Two parallel inline
      // copies would drift; a future change to when Row 1 is emitted has to
      // change this one predicate, and the answer route's emission guard
      // (route.techTermsEmission.test.js) turns red if it changes silently.
      // Each fire ANDs its OWN fetch-export probe on top, because the two rows
      // call different exports.
      const exampleRowEnabled = (example) =>
        !!grounding.applicationId && !!example && latestTokenByIdRef.current.get(id) === token;
      const fireProjectExampleLive = (example) => {
        if (!exampleRowEnabled(example) || !liveFetchAvailable()) return;
        try {
          startProjectExampleLive({
            applicationId: grounding.applicationId,
            question,
            engine: readEngine(),
            fetchLive: answerClientModule.fetchProjectExampleLive,
            apply: (value, settled) => {
              const superseded = settled && draftGenRef.current !== gen;
              const next = superseded ? undefined : value;
              setQuestions((prev) =>
                prev.map((it) =>
                  it.id === id && it.draftToken === token ? { ...it, projectExampleLive: next } : it,
                ),
              );
              if (settled && !superseded) logExampleLive(logEvent, id, value);
            },
          });
        } catch {
          // Row 2 is a supplement; nothing here may interrupt the draft.
        }
      };
      // The tech-buzzwords row, requested after the answer has landed and never
      // awaited, from the same two places and under the same shared gate as Row 2.
      // Same write rules too: gated `it.id === id && it.draftToken === token`, and
      // a settle that arrives after a GENERATION bump clears the row instead of
      // being dropped. Never cached: a reused answer asks again, so a pending or
      // failed list from an earlier draft is never replayed.
      const fireTechTerms = (example) => {
        if (!exampleRowEnabled(example) || !techTermsFetchAvailable()) return;
        try {
          startTechTerms({
            applicationId: grounding.applicationId,
            question,
            engine: readEngine(),
            fetchTerms: answerClientModule.fetchTechTerms,
            apply: (value, settled) => {
              const superseded = settled && draftGenRef.current !== gen;
              const next = superseded ? undefined : value;
              setQuestions((prev) =>
                prev.map((it) => (it.id === id && it.draftToken === token ? { ...it, techTerms: next } : it)),
              );
              if (settled && !superseded) logTechTermsShown(logEvent, id, value);
            },
          });
        } catch {
          // The row is a supplement; nothing here may interrupt the draft.
        }
      };
      // Reuse a prior answer for the same (normalized) question — interviewers
      // often circle back or rephrase — unless the user explicitly redrafts.
      // AC-N1.2: cachedAnswerFor rejects an entry whose OWN grounding
      // (however it was written) doesn't match `grounding` above — a mismatch
      // is an ordinary miss, indistinguishable from "nothing cached", so it
      // falls straight through to a fresh draft below with no error and no
      // "reused" label.
      if (!force) {
        const cached = cachedAnswerFor(answerCacheRef.current.get(norm), grounding);
        if (cached) {
          // AC-Q6.3: a reused answer resolved this card too — same outcome
          // as a fresh draft, from the log's point of view.
          logEvent("answer.done", { id, points: cached.points });
          // Row 1 rides the cache only in a FINAL state (ready, or no close
          // match): a reused answer makes no server call, so a cached "still
          // being prepared" or "couldn't prepare" would be replayed long after
          // the pool it described has changed. See finalProjectExample.
          const replayedExample = finalProjectExample(cached.projectExample);
          logExampleShown(logEvent, id, replayedExample);
          setQuestions((prev) =>
            prev.map((it) =>
              it.id === id
                ? {
                    ...it,
                    status: "done",
                    // BUG-7: a cache hit must clear a PRIOR error, not merely
                    // omit it — omitting it left whatever error string the
                    // fresh-draft path's catch block had set still sitting on
                    // this entry (that path only clears it via the loading
                    // transition just above, which this cache-hit branch
                    // returns before ever reaching), so a question that
                    // failed once and later served from cache rendered its
                    // answer WITH a stale "Failed to draft." alert above it.
                    error: "",
                    points: cached.points,
                    // AC-K1: served from cache exactly as they were drafted.
                    // A reused answer that silently dropped its cues and
                    // subsections would look like a WORSE answer than the
                    // same question drafted fresh, which is not what "reused"
                    // is meant to signal. An entry cached before these
                    // existed resolves to the empty shapes, and the card
                    // falls back to the full points.
                    cues: cached.cues || [],
                    buzzwords: cached.buzzwords || [],
                    anchor: cached.anchor || null,
                    // ARCH §4f/§6.8: the cache round-trip `cues`/
                    // `buzzwords`/`anchor` already get,
                    // extended to `pageSources` — a cache hit that dropped
                    // it would render as an answer that had its citations
                    // when freshly drafted and lost them the second time
                    // the same question was asked, with nothing on screen
                    // explaining why.
                    pageSources: Array.isArray(cached.pageSources) ? cached.pageSources : [],
                    projectExample: replayedExample,
                    // Never copied from the cache (it is not part of a cached
                    // entry): a stale pending or settled Row 2 from a previous
                    // draft of this card must not survive a reuse. The fire
                    // below writes the fresh one.
                    projectExampleLive: undefined,
                    // Same for the tech buzzwords: never part of a cached entry.
                    techTerms: undefined,
                    type: it.type || cached.type,
                    cached: true,
                    // AC-A16b: a cache hit ADVANCES the token — it must not
                    // leave a stale one in place for an older in-flight draft
                    // to still match and overwrite this answer with.
                    draftToken: token,
                  }
                : it,
            ),
          );
          // The RAW cached Row 1 is the gate (any status), not the replayed one:
          // whether the answer carried a Row 1 at all is what says Row 2 applies.
          fireProjectExampleLive(cached.projectExample);
          fireTechTerms(cached.projectExample);
          return;
        }
      }
      setQuestions((prev) =>
        prev.map((it) =>
          // `pageSources` is cleared here, not merely left to be overwritten
          // when the new draft lands. THE BUG THIS PREVENTS: a redraft leaves
          // the PREVIOUS answer's citations sitting on the entry while the
          // streaming path fills `points` in incrementally, so for a frame or
          // more the old citations pair positionally against the new partial
          // points — every line attributed to whichever page happened to be
          // cited at that index last time. A stale cue is a bad prompt; a
          // stale citation tells the candidate a claim came from a project
          // that did not produce it, and they say so out loud. `cues` carries
          // the same pre-existing hazard and is deliberately left alone: it
          // is not free (its own fallback logic reads the previous array) and
          // a mis-attributed page is the worse of the two by this feature's
          // own reasoning.
          // The two example rows are cleared with `pageSources` for the same
          // reason: a redraft's new answer must not sit beside the previous
          // answer's example, and a previous Row 2 is never carried across.
          it.id === id
            ? {
                ...it,
                status: "loading",
                error: "",
                cached: false,
                pageSources: [],
                projectExample: undefined,
                projectExampleLive: undefined,
                // The tech buzzwords go with the answer they sat beside.
                techTerms: undefined,
                draftToken: token,
              }
            : it,
        ),
      );
      // AC-N1.3: what a superseded draft leaves the card as — back at
      // "idle", never stuck at "loading" forever and never showing an
      // answer/error built for a posting or prep context the user has since
      // left. The existing "Draft answer" button is then the user's way back
      // in; nothing here auto-retries, since by the time this fires the
      // question may no longer even be the one on screen.
      // AC-A16/AC-A16b: gated `it.id === id && it.draftToken === token`, same
      // as every other post-await write below. A token mismatch means a
      // newer draft already owns this entry — leave `it` unchanged (a
      // superseded draft flipping a correct "done" back to "idle" was the
      // exact bug this token exists to prevent), never write `idle` there.
      const revertToIdle = () => {
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id && it.draftToken === token
              ? { ...it, status: "idle", error: "", cached: false }
              : it,
          ),
        );
      };
      try {
        const { points, type, cues, buzzwords, resumeAnchor, pageSources, projectExample } = await fetchAnswer(
          {
            question,
            context: buildContext(),
            profile: grounding.profile,
            // AC-A18/AC-A20: the type this draft was actually started under,
            // captured before the await above — never re-read here.
            interviewType: grounding.interviewType,
            // AC-H1.4/AC-H4: the selected posting's own id IS the application
            // id (see normalizePostingRows in lib/copilot/postings.js) — the
            // route uses it to fetch and ground in the submitted résumé/cover
            // letter itself; this client never sends document text.
            // `|| null` undoes groundingFor's "not applicable" -> "" folding —
            // this request must send exactly what postingRef held at capture
            // time (null), not the normalized comparison value.
            applicationId: grounding.applicationId || null,
            // AC-C24/AC-C25/AC-C27b: no `|| null` here — the sentinel is
            // always a non-empty string ("auto" when the user has stated no
            // preference), never a falsy placeholder, so the route's
            // normalizer and this cache's grounding always agree on what
            // "no preference" looks like.
            codeLanguage: grounding.codeLanguage,
          },
          {
            // AC-P4.2: bullets land on the card as they stream in — each
            // points frame overwrites `points` with its own (superset) array
            // so the visible list only ever grows, never flickers backward.
            // Guarded by the same two checks every post-await write uses, so
            // a frame from a superseded draft can't repaint a card the user
            // has since moved on from (or that a newer draft already owns).
            onPoints: (partial) => {
              if (draftGenRef.current !== gen) return;
              setQuestions((prev) =>
                prev.map((it) =>
                  it.id === id && it.draftToken === token ? { ...it, points: partial } : it,
                ),
              );
            },
          },
        );
        // AC-N1.3: a posting/profile change (or a fresh Start) landed while
        // this draft was in flight — see revertToIdle's own comment above.
        // Checked before EITHER write below: the cache write would be
        // rejected on its next read anyway (AC-N1.2's grounding check), but
        // the setQuestions write is not cache-mediated and has no other
        // guard at all.
        if (draftGenRef.current !== gen) {
          revertToIdle();
          return;
        }
        // AC-K1: same defensive normalization the practice hook applies — a
        // missing or malformed field becomes the empty shape here, once, so
        // neither the cache nor the render layer has to re-guard its type.
        const aids = {
          cues: Array.isArray(cues) ? cues : [],
          buzzwords: Array.isArray(buzzwords) ? buzzwords : [],
          anchor: resumeAnchor || null,
          // ARCH §4e: rides the terminal `done` frame only — fetchAnswer's
          // streaming path (draftAnswerStreaming) resolves with exactly that
          // frame's payload, so `pageSources` here is never a mid-stream
          // partial value; the `onPoints` callback above keeps carrying
          // ONLY `points`, unchanged, during the stream itself.
          pageSources: Array.isArray(pageSources) ? pageSources : [],
          // Row 1 of the example-projects group, picked server-side from the
          // pre-warmed pool for THIS question. ABSENT (not defaulted) when the
          // server omitted it -- see projectExampleFromResponse. Like `anchor`,
          // it rides the question-keyed cache below; the server never caches it
          // (the pick is per question).
          ...(projectExampleFromResponse(projectExample) ? { projectExample } : {}),
        };
        // AC-N1.2: the grounding this draft was ACTUALLY built from — the
        // same `grounding` captured before the await above, not a fresh read
        // of the refs now.
        answerCacheRef.current.set(norm, { points, type, ...aids, ...grounding });
        // AC-Q6.2: the resolved answer for this question.
        logEvent("answer.done", { id, points });
        logExampleShown(logEvent, id, aids.projectExample);
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id && it.draftToken === token
              ? { ...it, status: "done", points, ...aids, type: it.type || type }
              : it,
          ),
        );
        fireProjectExampleLive(aids.projectExample);
        fireTechTerms(aids.projectExample);
        // A fresh answer is the only evidence of the pool's state at question
        // time (a reused one made no server call), so only this branch reports it.
        // Guarded on its own: the answer above has already landed, and a throw
        // out of the report must not reach the catch below and turn a delivered
        // answer into an error card.
        try {
          onRowOneStatusRef.current?.(grounding.applicationId, aids.projectExample?.status);
        } catch {
          // The warm-up is a supplement; nothing here may interrupt the draft.
        }
      } catch (err) {
        if (draftGenRef.current !== gen) {
          revertToIdle();
          return;
        }
        const message = err?.message || "Failed to draft.";
        // AC-Q6.3: a failure is recorded as a failure, never as silence —
        // and never also as answer.done for the same id.
        logEvent("answer.error", { id, message });
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id && it.draftToken === token ? { ...it, status: "error", error: message } : it,
          ),
        );
      }
    },
    [buildContext, answerCacheRef, draftGenRef, setQuestions, logEvent],
  );

  return runDraft;
}
