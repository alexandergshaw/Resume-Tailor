"use client";

import { useCallback, useEffect, useRef } from "react";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { cachedAnswerFor, groundingFor } from "@/lib/copilot/answerGrounding";
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

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    postingRef.current = posting;
  }, [posting]);

  const runDraft = useCallback(
    async (id, question, { force = false } = {}) => {
      const norm = normalizeQuestion(question);
      // AC-N1.2: what this draft is (or would be) built from, read from the
      // refs ONCE, here — before the `await` further down. Re-reading
      // profileRef/postingRef AFTER that await would report whatever the
      // user has since selected, not what THIS draft actually used; capturing
      // once and reusing the same value for the lookup below, the network
      // call, and the eventual cache write is what AC-N1's correction to the
      // original bug report is about. groundingFor folds live mode's
      // always-absent interview type into the same "not applicable" value
      // practice mode's own entries use (answerGrounding.js), so a write from
      // one mode's cache can be read back correctly by the other's.
      const grounding = groundingFor({
        profile: profileRef.current,
        applicationId: postingRef.current?.id || null,
      });
      // AC-N1.3: this draft's generation, also captured before the await.
      // Bumped by onPostingChange/onProfileChange (CopilotClient.js) and by
      // useLiveSession.js's own `start` — re-checked past the await, before
      // either write, so a draft still resolving when the user moves on
      // can't land anywhere.
      const gen = draftGenRef.current;
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
                    type: it.type || cached.type,
                    cached: true,
                  }
                : it,
            ),
          );
          return;
        }
      }
      setQuestions((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, status: "loading", error: "", cached: false } : it,
        ),
      );
      // AC-N1.3: what a superseded draft leaves the card as — back at
      // "idle", never stuck at "loading" forever and never showing an
      // answer/error built for a posting or prep context the user has since
      // left. The existing "Draft answer" button is then the user's way back
      // in; nothing here auto-retries, since by the time this fires the
      // question may no longer even be the one on screen.
      const revertToIdle = () => {
        setQuestions((prev) =>
          prev.map((it) => (it.id === id ? { ...it, status: "idle", error: "", cached: false } : it)),
        );
      };
      try {
        const { points, type, cues, buzzwords, resumeAnchor, idealProject } = await fetchAnswer(
          {
            question,
            context: buildContext(),
            profile: grounding.profile,
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
            // Guarded by the same generation check the two post-await writes
            // below use, so a frame from a superseded draft can't repaint a
            // card the user has since moved on from.
            onPoints: (partial) => {
              if (draftGenRef.current !== gen) return;
              setQuestions((prev) =>
                prev.map((it) => (it.id === id ? { ...it, points: partial } : it)),
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
        };
        // AC-N1.2: the grounding this draft was ACTUALLY built from — the
        // same `grounding` captured before the await above, not a fresh read
        // of the refs now.
        answerCacheRef.current.set(norm, { points, type, ...aids, ...grounding });
        // AC-Q6.2: the resolved answer for this question.
        logEvent("answer.done", { id, points });
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id ? { ...it, status: "done", points, ...aids, type: it.type || type } : it,
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
          prev.map((it) => (it.id === id ? { ...it, status: "error", error: message } : it)),
        );
      }
    },
    [buildContext, answerCacheRef, draftGenRef, setQuestions, logEvent],
  );

  return runDraft;
}
