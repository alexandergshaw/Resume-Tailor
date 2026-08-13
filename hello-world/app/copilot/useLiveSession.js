"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotSession } from "@/lib/copilot/session";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { normalizeManualQuestion } from "@/lib/copilot/manualQuestion";
import { confirmQuestion } from "@/lib/copilot/detectClient";
// Namespace import, not named — see fetchAnswer's own comment for why.
import * as answerClientModule from "@/lib/copilot/answerClient";
import { localDetection, remoteConfirmNeeded } from "@/lib/copilot/localDetection";
import { speakerDisplayLabel } from "@/lib/copilot/speakerIdentity";
import { cachedAnswerFor, groundingFor } from "@/lib/copilot/answerGrounding";

const CONTEXT_TURNS = 12;

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

// AC-M1.3.1/AC-M1.5.6: the idle shape `speakerSnapshot` state starts (and
// resets to, each new session) at — before an in-person session has
// observed a single turn, or for the entire life of a tab/system session,
// which never constructs a speakerIdentity instance at all (session.js's
// `speakerSnapshot()` returns exactly this shape in that case too, so this
// hook's default and CopilotSession's own no-op default can never drift
// apart).
const DEFAULT_SPEAKER_SNAPSHOT = { userTag: null, confidence: "unknown", overridden: false, tags: [] };

// BUG-6: shared by copyTranscript and buildContext below — resolves a
// row/turn's label through the CURRENT identity snapshot when it carries a
// numeric `speakerTag`, the same per-render (never cached) resolution
// TranscriptView.js already applies to what's on screen via
// `speakerLabelFor`, instead of the literal `speaker` field, which is
// frozen at frame-capture time and is never rewritten by a correction. A
// row with no `speakerTag` at all (tab/system — see AC-M1.5.7 above) falls
// through to today's exact ternary, unchanged: the pinned compatibility
// requirement for those two sources.
function resolveTranscriptLabel(row, snapshot) {
  if (typeof row.speakerTag === "number") {
    return speakerDisplayLabel(row.speakerTag, snapshot);
  }
  return row.speaker === "them" ? "Them" : "You";
}

// Phase 4: assemble the interviewer's speech into complete utterances (on
// Deepgram's speech_final endpoint), confirm/normalize questions with an LLM
// (heuristic pre-filter avoids calling it on trivial fragments), and auto-draft
// talking points as soon as a question is detected.
//
// Extracted out of CopilotClient.js (which was pinned at this project's
// 1000-line verification cap) purely to keep both files under it before an
// upcoming feature adds more code to CopilotClient.js — this is the live-
// interview session pipeline (capture session, transcript, detected-question
// queue, answer drafting) and only that; CopilotClient.js keeps every piece
// of setup/UI state (mode, posting, source, mic, ...) and the render, the
// same split useCopilotDashboard.js and useApplicationDocs.js already
// established for their own pieces of this component.
//
// `answerCacheRef` is passed in rather than created here, and
// `recordSpeechSample`/`resetForSession` are passed in from
// useCopilotDashboard, because CopilotClient must call useCopilotDashboard
// (which needs `onPrefetchedAnswer`, itself writing through answerCacheRef)
// BEFORE this hook (which needs useCopilotDashboard's own
// recordSpeechSample/resetForSession) — keeping the cache ref in the
// component is what avoids a call-order cycle between the two hooks.
// `status`/`setStatus` and `questions`/`setQuestions` are passed in for the
// SAME reason, in the opposite direction: useCopilotDashboard's `active` and
// `questions` arguments need this hook's `live` (derived from `status`) and
// `questions` values, but useCopilotDashboard is called first, so neither
// can come from this hook's return yet at that point in the render — and
// this project's react-hooks/refs lint rule forbids reading a ref's
// `.current` during render (only inside effects/callbacks), so a ref-mirror
// bridge like answerCacheRef's can't stand in for reactive values the way it
// stands in for a cache write. CopilotClient instead keeps the raw
// `useState` calls for just these two pieces of state (like it already does
// for `profile`/`posting`/`autoDraft`) and hands them down as controlled
// state; every state TRANSITION for them (setStatus/setQuestions calls) still
// lives entirely in this hook, exactly as the rest of the pipeline does.
//
// AC-N1.3: `draftGenRef` is the same story as `answerCacheRef` — created in
// CopilotClient so its two writers outside this hook (onPostingChange,
// onProfileChange) can bump it without needing anything this hook returns.
// runDraft captures it before its own `await` and re-checks it before both
// of its post-await writes (the cache write AC-N1.2 already guards via
// grounding, and the direct `setQuestions(... status: "done" ...)` write,
// which is not cache-mediated and so has no other guard at all — see
// runDraft's own comment). `start` below bumps it too, so a draft still
// resolving from a session the user has already left behind can't land in
// the new one either.
export function useLiveSession({
  answerCacheRef,
  draftGenRef,
  recordSpeechSample,
  resetForSession,
  status,
  setStatus,
  questions,
  setQuestions,
  source,
  micDeviceId,
  profile,
  posting,
  autoDraft,
  setSetupExpanded,
  setShowHistory,
}) {
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker, text, at, speakerTag }
  const [interims, setInterims] = useState({ them: "", you: "" });
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(0);
  // AC-M1.5.6/AC-M1.5.8: the in-person speaker-identity snapshot, updated
  // from CopilotSession's `onSpeakerIdentity` callback (session.js) — both
  // from new evidence and from a manual correction. Stays at its default,
  // untouched, for a tab/system session, since that path never fires the
  // callback in the first place (session.js's constructor never builds a
  // `_speakerIdentity` instance for those sources).
  const [speakerSnapshot, setSpeakerSnapshot] = useState(DEFAULT_SPEAKER_SNAPSHOT);

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  const qIdRef = useRef(0);
  const recentRef = useRef([]); // rolling [{ speaker, text }] for answer context
  const pendingRef = useRef([]); // interviewer segments awaiting speech_final
  const lastQNormRef = useRef(""); // dedupe back-to-back identical questions
  const questionsRef = useRef([]);
  const autoDraftRef = useRef(true);
  const profileRef = useRef("");
  // AC-H1: mirrors `posting` for runDraft below, the same reason
  // profileRef exists — runDraft is a stable useCallback whose async body
  // must see the LATEST selection, not whatever was current when the
  // callback identity was created (same pattern as PracticeClient's
  // postingRef).
  const postingRef = useRef(null);
  // BUG-6: mirrors `speakerSnapshot` for buildContext below, same reason
  // profileRef/postingRef exist — buildContext is a stable useCallback
  // (empty dep array; see its own comment) whose closure must resolve
  // against the LATEST identity snapshot, not whichever one was current
  // when the callback identity was created.
  const speakerSnapshotRef = useRef(DEFAULT_SPEAKER_SNAPSHOT);

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  useEffect(() => {
    autoDraftRef.current = autoDraft;
  }, [autoDraft]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    postingRef.current = posting;
  }, [posting]);
  useEffect(() => {
    speakerSnapshotRef.current = speakerSnapshot;
  }, [speakerSnapshot]);

  const live = status === "live" || status === "connecting";

  useEffect(() => {
    if (!live || !startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live, startedAt]);

  const stop = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }
    setInterims({ them: "", you: "" });
    setStatus("idle");
    // BUG-2: back to the untouched default the instant a session ends — a
    // stale snapshot left in place (tags still populated, a resolved
    // userTag still set) is what let the "Who's talking" bar keep
    // rendering its chips as live, functional controls after Stop, for a
    // session that no longer exists to apply a correction to.
    setSpeakerSnapshot(DEFAULT_SPEAKER_SNAPSHOT);
    // Step 2: mirrors start's setSetupExpanded(false) — `!live` must
    // always mean "SessionSetup renders in full".
    setSetupExpanded(true);
  }, [setSetupExpanded, setStatus]);

  // Unmounting (e.g. switching main tabs) must not leave the screen-share or
  // mic running — stop whatever session is active on the way out.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, []);

  // BUG-6: resolves each turn's label through resolveTranscriptLabel (the
  // current identity snapshot, via speakerSnapshotRef) instead of the
  // frozen `t.speaker` — the same wrong-attribution bug as copyTranscript
  // below, but for the conversation context sent to draftAnswer/
  // confirmQuestion: a corrected interviewer turn must not keep reading as
  // "You" (or vice versa) in the grounding text a model sees.
  const buildContext = useCallback(
    () =>
      recentRef.current
        .slice(-CONTEXT_TURNS)
        .map((t) => `${resolveTranscriptLabel(t, speakerSnapshotRef.current)}: ${t.text}`)
        .join("\n"),
    [],
  );

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
      // `start` below — re-checked past the await, before either write, so a
      // draft still resolving when the user moves on can't land anywhere.
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
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: "error", error: err?.message || "Failed to draft." }
              : it,
          ),
        );
      }
    },
    [buildContext, answerCacheRef, draftGenRef, setQuestions],
  );

  // AC-M1.3.5: `meta` is populated ONLY by the in-person path
  // (handleUtterance below) — `{ speakerTag, provisional }`. The tab/system
  // pendingRef path (further down) still calls this with no third argument
  // at all, so `speakerTag` stays `null` and `provisional` stays `false`
  // for every entry it ever creates, exactly today's shape plus two inert
  // fields.
  const addQuestion = useCallback(
    (question, type, auto, meta = {}) => {
      const id = (qIdRef.current += 1);
      setQuestions((prev) => [
        ...prev,
        {
          id,
          question,
          at: Date.now(),
          status: auto ? "loading" : "idle",
          points: null,
          // AC-K1: seeded empty alongside `points` so an entry is a complete
          // shape from the moment it exists, whichever status it is in.
          cues: [],
          buzzwords: [],
          anchor: null,
          idealProject: null,
          type: type || null,
          error: "",
          // AC-M1.3.5: which voice this was detected from (in-person only),
          // and whether it was provisional AT DETECTION TIME — see
          // onSpeakerIdentity in start() below for how this is kept correct
          // retroactively as identity settles.
          speakerTag: typeof meta.speakerTag === "number" ? meta.speakerTag : null,
          provisional: !!meta.provisional,
        },
      ]);
      if (auto) runDraft(id, question);
    },
    [runDraft, setQuestions],
  );

  // AC-O2: live mode's half of "typing a question is the same as detecting
  // one" — the manual counterpart to evaluateUtterance below, skipping
  // straight to addQuestion instead of running its confirmQuestion pipeline.
  //
  // Does NOT call confirmQuestion: that client exists to decide IS THIS A
  // QUESTION for a fragment of speech. Typing it is that decision, already
  // made by the person who knows it. A round trip to have the model
  // second-guess it is both slower and capable of throwing the entry away
  // outright — and MIN_WORDS_FOR_LLM, the pre-filter that exists purely to
  // avoid paying for that round trip, is skipped for the same reason.
  //
  // Passes `null` as the type, not a locally-classified one: runDraft
  // resolves `type: it.type || type` — a pre-set type would WIN over the
  // drafted answer's own classification, so leaving it null here is what
  // makes a typed question's card end up identical to a detected one's.
  //
  // Writes lastQNormRef, but — unlike evaluateUtterance below — never reads
  // it, and that asymmetry is deliberate. The common case is typing what
  // you just heard while the interviewer is still speaking, with the
  // transcript producing the same question a second later; writing the
  // guard here is what suppresses that follow-on detection. But an
  // explicit typed submit must never itself vanish with no feedback, so
  // this never checks lastQNormRef before adding — a deliberate repeat (the
  // user submits the same question twice on purpose) always lands as a
  // second card. That second card costs no second model call: runDraft
  // serves it straight out of answerCacheRef.
  //
  // No `meta` argument: a manual entry has no speaker to attribute, so
  // addQuestion runs with its default `{}` — the entry gets
  // `speakerTag: null, provisional: false`, exactly like a tab/system
  // detection.
  const addManualQuestion = useCallback(
    (text) => {
      const { ok, question } = normalizeManualQuestion(text);
      if (!ok) return false;
      lastQNormRef.current = normalizeQuestion(question);
      addQuestion(question, null, autoDraftRef.current);
      return true;
    },
    [addQuestion],
  );

  // AC-P4.1: decide locally first — zero network — and only fall back to a
  // remote confirm when the heuristic genuinely missed (AC-P1.3). Replaces
  // the old inline detectQuestion + MIN_WORDS_FOR_LLM pre-filter, which is
  // now localDetection.js's own job (the SAME primitives, reused, not a
  // second heuristic — see that module's own comment).
  //
  // `norm === lastQNormRef.current` alone used to be enough to dedupe a
  // back-to-back repeat (AC-M1.6.3's original guard). It still is, UNLESS
  // the entry it would be deduping against is itself still "loading": two
  // genuinely separate utterances that happen to clean to the same question
  // (an interviewer re-asking mid-draft, "So, tell me about...") must each
  // get their own draft rather than the second silently vanishing while the
  // first is still being answered — AC-P4.4 pins this on the streaming
  // client directly. A prior entry already "done" (or "error") still gets
  // suppressed exactly as before.
  const acceptQuestion = useCallback(
    (question, type, meta) => {
      const norm = normalizeQuestion(question);
      if (norm === lastQNormRef.current) {
        const prior = [...questionsRef.current]
          .reverse()
          .find((q) => normalizeQuestion(q.question) === norm);
        if (prior && prior.status === "loading") {
          // Still being answered — a repeat right now is a fresh ask, not
          // noise; fall through and give it its own card/draft.
        } else {
          return;
        }
      }
      lastQNormRef.current = norm;
      addQuestion(question, type, autoDraftRef.current, meta);
    },
    [addQuestion],
  );

  // Confirm a completed interviewer utterance is a question, then queue it.
  // AC-M1.6.3/AC-P4.1: the ONE path either source funnels through —
  // evaluateUtterance -> localDetection (or confirmQuestion when it misses)
  // -> addQuestion -> runDraft -> draftAnswerStreaming — unchanged by `meta`,
  // which merely rides along to addQuestion for the in-person case
  // (AC-M1.3.5). The tab/system call site further down still calls this
  // with a bare string, so `meta` defaults to `{}` there exactly as before
  // this parameter existed.
  const evaluateUtterance = useCallback(
    async (utterance, meta = {}) => {
      if (!utterance) return;

      const local = localDetection(utterance);
      if (local.decided) {
        acceptQuestion(local.question, local.type, meta);
        return;
      }

      // AC-P1.2/AC-P1.3: the heuristic missed it — worth a remote confirm
      // only when the utterance is long enough that the LLM has a real
      // chance of catching an indirect ask (today's exact pre-filter).
      if (!remoteConfirmNeeded({ decided: local.decided, utterance })) return;

      let result;
      try {
        result = await confirmQuestion({ utterance, context: buildContext() });
      } catch {
        // LLM unavailable and the heuristic already missed this one —
        // nothing left to fall back to.
        return;
      }
      if (!result.isQuestion) return;

      const question = (result.question || utterance).trim();
      acceptQuestion(question, result.type, meta);
    },
    [buildContext, acceptQuestion],
  );

  // AC-M1.4.9/10: the in-person source's OWN question-evaluation trigger —
  // CopilotSession's `onUtterance` callback and its `evaluate` flag, never
  // `speaker === "them"` and never the display label. Gating on either of
  // those would reintroduce v1's exact silent-deafness bug (see
  // speakerIdentity.js's header comment): a voice provisionally labelled
  // "You" while identity is still unsettled must still be evaluated.
  //
  // `evaluate` already reflects THIS utterance's own evidence — session.js
  // folds it into the identity instance (observe()) and fires
  // onSpeakerIdentity BEFORE onUtterance for the same utterance (see
  // _emitUtterance in session.js) — so `sessionRef.current.speakerSnapshot()`
  // read synchronously here is exactly the state the AC means by
  // "CURRENTLY the argmax" (AC-M1.3.5), not a stale snapshot from before
  // this utterance existed.
  const handleUtterance = useCallback(
    ({ speakerTag, text, evaluate }) => {
      if (!evaluate) return;
      const snap = sessionRef.current?.speakerSnapshot() || DEFAULT_SPEAKER_SNAPSHOT;
      // AC-M1.3.5: provisional exactly when this utterance came from the
      // tag identity currently presumes IS the user, but confidence has not
      // (yet, or ever, if never confirmed) reached "high" and no manual
      // override is in force. Once either of those becomes true,
      // `shouldEvaluateAsQuestion` would have returned `evaluate: false` for
      // this same tag — so provisional and evaluated-at-all are mutually
      // exclusive for the resolved user's own tag, by construction.
      const provisional =
        snap.userTag !== null &&
        speakerTag === snap.userTag &&
        snap.confidence !== "high" &&
        !snap.overridden;
      evaluateUtterance(text, { speakerTag, provisional });
    },
    [evaluateUtterance],
  );

  // AC-M1.5.7: `speakerTag` rides alongside the existing four fields — it is
  // `undefined` for tab/system (their frames never carry the key at all;
  // see session.js's AC-M1.4.7 guarantee), which is exactly what makes
  // retroactive relabelling possible for in-person turns without changing
  // anything about how a tab/system turn is stored. TranscriptView reads
  // this straight off the row and resolves the label at RENDER time, not
  // here — this hook never resolves a label itself.
  const appendFinal = useCallback((speaker, text, speakerTag) => {
    // BUG-6: `speakerTag` now rides along into recentRef too (previously
    // only `finals` carried it) — buildContext's resolveTranscriptLabel
    // call needs it on THESE entries to resolve a corrected label into the
    // context sent to draftAnswer/confirmQuestion, not just on-screen.
    recentRef.current = [...recentRef.current, { speaker, text, speakerTag }].slice(
      -CONTEXT_TURNS * 2,
    );
    setFinals((prev) => [
      ...prev,
      { id: (idRef.current += 1), speaker, text, at: Date.now(), speakerTag },
    ]);
  }, []);

  // AC-M1.5.6: applies a correction (or any later identity change) to the
  // session's own identity instance. Harmless no-op for tab/system —
  // CopilotSession.assignUser() itself is a no-op when there is no
  // `_speakerIdentity` instance to correct (see session.js) — so this is
  // safe to hand to TranscriptView unconditionally; CopilotClient only
  // wires it up for the in-person source regardless, matching
  // TranscriptView's own "onAssignUser presence is the gate" contract.
  // BUG-2: reports whether the assignment actually reached a live session
  // — `sessionRef.current` is null once stop() has run (Stop nulls it out
  // but, before this fix, left `speakerSnapshot` populated), and the
  // optional-chain below silently no-ops in that case. The caller
  // (CopilotClient's onAssignFromBar) needs a real signal here to avoid
  // announcing a correction "worked" when nothing was left to correct —
  // a false success claim about the one action this feature exists to
  // provide.
  const onAssignUser = useCallback((tag) => {
    if (!sessionRef.current) return false;
    sessionRef.current.assignUser(tag);
    return true;
  }, []);

  // AC-M1.5.6: `speakerLabelFor` for TranscriptView's prop contract — a
  // straight pass-through to the pure `speakerDisplayLabel`, closed over
  // the CURRENT snapshot so a re-render after `onSpeakerIdentity` fires
  // resolves every row against the latest identity state.
  const speakerLabelFor = useCallback(
    (tag) => speakerDisplayLabel(tag, speakerSnapshot),
    [speakerSnapshot],
  );

  // AC-M1.5.8: "still working out who is who" — true whenever confidence
  // has not reached "high" and the user has not manually overridden it.
  // (`setUserTag`/`swap` already force confidence to "high" the instant
  // `overridden` becomes true, so the `!overridden` half of this check is
  // belt-and-braces, not load-bearing — kept explicit so this reads
  // correctly on its own rather than depending on that coupling.)
  const identityUnsettled = speakerSnapshot.confidence !== "high" && !speakerSnapshot.overridden;

  const start = useCallback(async () => {
    setError("");
    setWarning("");
    setFinals([]);
    setInterims({ them: "", you: "" });
    setQuestions([]);
    setStartedAt(null);
    setSpeakerSnapshot(DEFAULT_SPEAKER_SNAPSHOT);
    recentRef.current = [];
    pendingRef.current = [];
    lastQNormRef.current = "";
    answerCacheRef.current.clear();
    // AC-N1.3: invalidates a draft still resolving from the session just
    // left behind — see runDraft's own comment for why the cache clear above
    // isn't enough by itself (a superseded draft's direct setQuestions write
    // isn't cache-mediated).
    draftGenRef.current += 1;
    resetForSession();
    // Step 2/4: collapse both disclosures for THIS session, same as every
    // other per-session reset above.
    setSetupExpanded(false);
    setShowHistory(false);
    setStatus("connecting");
    try {
      const session = new CopilotSession({
        withMic: true,
        source,
        micDeviceId,
        onStatus: (s) => {
          setStatus(s);
          if (s === "live") setStartedAt((prev) => prev || Date.now());
        },
        onError: (err) => setWarning(err.message),
        // AC-M1.4.9/10: fired only for the "inperson" source, once per
        // utterance CopilotSession itself assembles — see handleUtterance
        // above for why this, not `speaker === "them"`, is what drives
        // in-person question detection.
        onUtterance: handleUtterance,
        // AC-M1.5.6: fired on every identity change — new evidence AND a
        // manual correction (session.js's assignUser). Never fires for
        // tab/system.
        onSpeakerIdentity: (snap) => {
          setSpeakerSnapshot(snap);
          // BUG-1 (adversarial review): `provisional` means "this question
          // is attributed to the voice CURRENTLY believed to be the user" —
          // not "...and that belief is still unconfirmed". The old formula
          // (`... && snap.confidence !== "high" && !snap.overridden`) went
          // false the moment confidence reached "high" or the user pressed
          // "mark as me" — the exact instant the attribution is CONFIRMED,
          // not disproven — so it re-derived every matching entry's flag to
          // `false` and evicted it from the "provisional" UI right when it
          // was proven right. Once identity is confident that tag IS the
          // user, a question from that tag is MORE certainly the user's own
          // speech, not less.
          //
          // Still re-derives EVERY entry from the fresh snapshot (not only
          // clearing it), so an argmax that has moved on to a DIFFERENT tag
          // also stops calling a past entry provisional the instant it
          // turns out to have been the actual interviewer all along.
          // Entries with no `speakerTag` at all (tab/system, or seeded
          // before any tag existed) are never provisional and are left
          // alone.
          setQuestions((prev) =>
            prev.map((q) =>
              q.speakerTag === null
                ? q
                : {
                    ...q,
                    provisional: snap.userTag !== null && q.speakerTag === snap.userTag,
                  },
            ),
          );
        },
        onTranscript: ({
          speaker,
          transcript,
          isFinal,
          speechFinal,
          start: spanStart,
          duration,
          textAlreadyDelivered,
          speakerTag,
        }) => {
          if (!isFinal) {
            setInterims((prev) => ({ ...prev, [speaker]: transcript }));
            return;
          }
          setInterims((prev) => ({ ...prev, [speaker]: "" }));

          // R-127: textAlreadyDelivered re-delivers the text of the final
          // that already went into appendFinal/recordSpeechSample/pendingRef
          // for this same span (see lib/copilot/stt/index.js's onTranscript
          // contract) — skip the TEXT accumulation below, but `speechFinal`
          // is still honoured unconditionally further down: it is this
          // frame's own end-of-turn signal regardless of whether its text
          // was new.
          if (!textAlreadyDelivered) {
            appendFinal(speaker, transcript, speakerTag);

            // AC-I2.10/11: feed the pace sampler from the user's own FINAL
            // frames only — never the interviewer's, and never with a
            // wall-clock substitute for missing audio timing.
            // appendSpeechSample (via recordSpeechSample) already drops
            // frames whose start/duration aren't usable numbers, so this
            // passes them through as-is rather than pre-filtering here.
            // Unchanged for "inperson": session.js already resolves that
            // source's `speaker` to the same two-value "you"/"them"
            // vocabulary, so this stays gated on the user's own speech only
            // there too (AC-M1.6.3.4) — never on some other participant's.
            if (speaker === "you") {
              recordSpeechSample({ text: transcript, start: spanStart, duration });
            }

            // AC-M1.4.9: the tab/system pendingRef assembly below is
            // COMPLETELY untouched for those two sources, but must not also
            // run for "inperson" — that source's `speaker` resolves through
            // the very same "you"/"them" values, and CopilotSession already
            // assembles and evaluates ITS utterances through onUtterance
            // above (AC-M1.4.9/10). Running both would double-detect every
            // in-person question and is exactly the "second per-tag
            // assembly inside the client" the AC forbids.
            if (source !== "inperson" && speaker === "them") {
              pendingRef.current.push(transcript);
            }
          }

          if (source !== "inperson" && speaker === "them" && speechFinal) {
            const utterance = pendingRef.current
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            pendingRef.current = [];
            evaluateUtterance(utterance);
          }
        },
      });
      sessionRef.current = session;
      await session.start();
    } catch (err) {
      setError(err?.message || "Could not start capture.");
      setStatus("error");
      await stop();
    }
  }, [
    stop,
    appendFinal,
    evaluateUtterance,
    handleUtterance,
    source,
    micDeviceId,
    recordSpeechSample,
    resetForSession,
    answerCacheRef,
    draftGenRef,
    setSetupExpanded,
    setShowHistory,
    setStatus,
    setQuestions,
  ]);

  const onDraft = useCallback(
    (id) => {
      const q = questionsRef.current.find((it) => it.id === id);
      // "Redraft" (already answered) forces a fresh generation; the first draft
      // may reuse a cached answer.
      if (q) runDraft(id, q.question, { force: q.status === "done" });
    },
    [runDraft],
  );

  const clearAll = useCallback(() => {
    setFinals([]);
    setInterims({ them: "", you: "" });
    setQuestions([]);
    recentRef.current = [];
    pendingRef.current = [];
    lastQNormRef.current = "";
  }, [setQuestions]);

  // BUG-6: resolves each line through resolveTranscriptLabel (current
  // identity snapshot) rather than the frozen `l.speaker` — otherwise a
  // user who corrects a wrong identity mid-session, watches the ON-SCREEN
  // transcript relabel itself, and then presses Copy would get a pasted
  // transcript with the OLD (wrong) attribution, since `l.speaker` is set
  // once at frame time and no correction ever rewrites it. `speakerSnapshot`
  // (not a ref) is fine here — this only runs synchronously from a button
  // click, so the latest render's closure is exactly what's needed.
  const copyTranscript = useCallback(() => {
    const text = finals
      .map((l) => `${resolveTranscriptLabel(l, speakerSnapshot)}: ${l.text}`)
      .join("\n");
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  }, [finals, speakerSnapshot]);

  const elapsed = startedAt ? now - startedAt : 0;

  // Extra (adversarial review): `now`, `buildContext`, `runDraft`,
  // `addQuestion`, `evaluateUtterance`, and `appendFinal` used to be
  // exported here too, but CopilotClient.js — the only caller — never
  // destructures any of them (`elapsed` is the only thing outside this hook
  // that ever needed `now`, and it's computed above). This module boundary
  // exists to bound CopilotClient.js's file size (see the module doc at the
  // top); a public surface nothing uses just invites a future caller to
  // reach into the pipeline's internals instead of going through
  // start/stop/onDraft/etc. All six stay as ordinary local bindings — every
  // one of them is still used INSIDE this hook (runDraft by onDraft and
  // addQuestion, evaluateUtterance by handleUtterance, appendFinal by
  // start's onTranscript, buildContext by runDraft/evaluateUtterance/
  // copyTranscript) — only the return object shrinks.
  return {
    warning,
    setWarning,
    error,
    finals,
    interims,
    startedAt,
    elapsed,
    start,
    stop,
    onDraft,
    // AC-O2: CopilotClient wires this to ManualQuestion's onSubmit — see
    // addManualQuestion's own comment above for what it deliberately skips.
    addManualQuestion,
    clearAll,
    copyTranscript,
    // AC-M1.5.6/5.8: the in-person speaker-identity surface — CopilotClient
    // feeds these straight into TranscriptView's own prop contract (and its
    // own always-reachable correction control, AC-M1.5.9). All four are
    // harmless/inert for tab/system: `speakerSnapshot` never leaves its
    // default, `identityUnsettled` is therefore always true but simply
    // never read for that source (CopilotClient never wires this surface up
    // for tab/system to begin with — see its own `identityProps`), and
    // `onAssignUser` (BUG-2) now returns `false` instead of silently
    // no-oping whenever no session exists to apply a correction to
    // (stopped, or never started) — CopilotClient's onAssignFromBar is what
    // actually acts on that return value.
    speakerSnapshot,
    speakerLabelFor,
    identityUnsettled,
    onAssignUser,
    // AC (onModeChange): sessionRef itself, so CopilotClient's onModeChange
    // can keep keying its teardown off "does a session object exist" rather
    // than off `status`/`live` — see onModeChange's own comment for why an
    // errored session still needs this distinct check.
    sessionRef,
  };
}
