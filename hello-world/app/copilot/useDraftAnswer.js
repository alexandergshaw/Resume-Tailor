"use client";

import { useCallback, useEffect, useRef } from "react";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { cachedAnswerFor, groundingFor } from "@/lib/copilot/answerGrounding";
import { getInterviewType } from "./useInterviewType";
// Namespace import, not named — see fetchAnswer's own comment for why.
import * as answerClientModule from "@/lib/copilot/answerClient";

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
}) {
  const profileRef = useRef("");
  // AC-H1: mirrors `posting`, the same reason profileRef exists just above.
  const postingRef = useRef(null);
  // AC-A16/AC-A16b: monotonic per-entry draft ownership counter. NOT mirrored
  // from render state and NOT reset alongside answerCacheRef.current.clear()
  // — resetting could let a new token collide with a stale stamp still
  // sitting on a surviving entry. The interview type itself is read straight
  // from getInterviewType() at the top of runDraft, never mirrored into a
  // ref: the store notifies synchronously inside a change, but
  // useSyncExternalStore only SCHEDULES a render and useEffect is passive and
  // commits after paint, so a ref mirrored during render would still read
  // the OLD type inside a synchronous change listener.
  const draftTokenRef = useRef(0);

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
      // profileRef/postingRef/getInterviewType() AFTER that await would
      // report whatever the user has since selected, not what THIS draft
      // actually used; capturing once and reusing the same value for the
      // lookup below, the network call, and the eventual cache write is what
      // AC-N1's correction to the original bug report is about. The
      // interview type goes through groundingFor exactly like the other two
      // fields — the shared machinery, not a hand-folded key — so a write
      // from one mode's cache can be read back correctly by the other's, and
      // this cache key stays correct the day a fourth field is added.
      const grounding = groundingFor({
        profile: profileRef.current,
        interviewType: getInterviewType(),
        applicationId: postingRef.current?.id || null,
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
                    idealProject: cached.idealProject || null,
                    // ARCH §4f/§6.8: the cache round-trip `cues`/
                    // `buzzwords`/`anchor`/`idealProject` already get,
                    // extended to `pageSources` — a cache hit that dropped
                    // it would render as an answer that had its citations
                    // when freshly drafted and lost them the second time
                    // the same question was asked, with nothing on screen
                    // explaining why.
                    pageSources: Array.isArray(cached.pageSources) ? cached.pageSources : [],
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
          it.id === id
            ? { ...it, status: "loading", error: "", cached: false, pageSources: [], draftToken: token }
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
        const { points, type, cues, buzzwords, resumeAnchor, idealProject, pageSources } = await fetchAnswer(
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
          idealProject: idealProject || null,
          // ARCH §4e: rides the terminal `done` frame only — fetchAnswer's
          // streaming path (draftAnswerStreaming) resolves with exactly that
          // frame's payload, so `pageSources` here is never a mid-stream
          // partial value; the `onPoints` callback above keeps carrying
          // ONLY `points`, unchanged, during the stream itself.
          pageSources: Array.isArray(pageSources) ? pageSources : [],
        };
        // AC-N1.2: the grounding this draft was ACTUALLY built from — the
        // same `grounding` captured before the await above, not a fresh read
        // of the refs now.
        answerCacheRef.current.set(norm, { points, type, ...aids, ...grounding });
        // AC-Q6.2: the resolved answer for this question.
        logEvent("answer.done", { id, points });
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id && it.draftToken === token
              ? { ...it, status: "done", points, ...aids, type: it.type || type }
              : it,
          ),
        );
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
