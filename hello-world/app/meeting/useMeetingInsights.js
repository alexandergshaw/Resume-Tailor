"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { insightTrigger } from "@/lib/meeting/chunkTrigger";
import { fetchInsights } from "@/lib/meeting/insightClient";
import { meetingSpeakerLabel } from "@/lib/meeting/insightContract";

// The meeting copilot's insight LOOP: a ticking clock that asks
// lib/meeting/chunkTrigger.js's pure `insightTrigger` whether now is a good
// moment to spend a read, and — when it says yes — calls
// lib/meeting/insightClient.js's `fetchInsights` and merges whatever comes
// back into a growing, deduped list. This file owns exactly the WIRING
// around those two pure/thin modules: it does not re-decide WHEN to fire
// (chunkTrigger.js already did that) and it does not re-interpret the
// response shape (insightContract.js's normalizeInsights already ran
// server-side, and insightClient.js already shaped the failure case) — see
// each module's own header for why that split exists.
//
// `app/copilot/useDraftAnswer.js` and `app/copilot/useCompanyBrief.js` are
// this file's two structural models, for two DIFFERENT halves of the same
// problem — a network result that must never land after it stops being
// wanted:
//
//   - useDraftAnswer.js's half: a `useRef` generation counter, captured
//     once before the `await` and re-checked after it, before EVERY write
//     that await produces. This is what makes a stale write a no-op instead
//     of a bug, and it lives entirely inside the async callback
//     (`runRead` below) — nothing about it can be read during render.
//   - useCompanyBrief.js's half: a `forSessionId` field carried INSIDE the
//     state object itself, compared against the current `sessionId` prop
//     AT RENDER TIME (`belongsToCurrentSession` below). This exists because
//     this repo's `react-hooks/refs` lint rule forbids reading a ref's
//     `.current` during render — so "does what's in state still belong to
//     the meeting on screen right now" cannot be answered by a ref check,
//     only by comparing two things render already has: the state itself,
//     and the current `sessionId` prop. It also closes a gap the ref alone
//     cannot: between `sessionId` changing (a re-render) and the effect
//     that resets state actually running (after that render commits), this
//     comparison is what stops the OLD session's insights from flashing on
//     screen under the NEW session's identity for that one frame.
//
// Both exist because they guard two different things: the ref stops a
// stale write from happening at all; the state field stops a render from
// trusting stale state even in the brief window before the next reset
// lands. Neither is redundant with the other.
//
// The debounce itself — why a burst of transcript frames costs exactly one
// read — lives entirely in chunkTrigger.js's SETTLE_MS/MIN_INTERVAL_MS
// logic. What THIS file is responsible for is not re-implementing that
// logic with its own `>=` comparisons (the brief this feature shipped
// against is explicit that no such comparison may end up in a hook) and not
// evaluating it from the wrong place: the automatic check below runs ONLY
// from the 1s interval's own tick, never from inside a transcript-arrival
// callback — this hook has no transcript callback of its own at all, it
// only reads the CALLER's `turns` array (app/meeting/useMeetingSession.js's
// own state) once a second. If a naive implementation instead evaluated
// `insightTrigger` every time `turns` changed (a `useEffect` keyed on
// `turns`), a ten-final burst would evaluate the trigger ten times in a
// handful of milliseconds; even though the debounce would correctly refuse
// nine of those ten, that is nine wasted evaluations achieving nothing that
// waiting for the next tick wouldn't have achieved for free, and — worse —
// couples this hook's firing cadence to however fast turns happen to
// arrive, instead of to a clock this hook actually controls.

// How many of a growing meeting's accumulated insight ids are sent back on
// each read as `knownInsightIds`, so the server can skip re-surfacing them
// (insightContract.js's normalizeInsights also de-dupes server-side against
// this list). Unbounded would mean the request body grows for the entire
// life of a long meeting; the most RECENT ids (this hook keeps `insights`
// newest-first — see mergeInsights below) are what matters most for
// avoiding near-term repeats, so capping to the front of that list loses
// only the least likely repeats.
const KNOWN_IDS_CAP = 200;

// How many of the most recent turns are sent as `transcript` on each read.
// Unbounded would mean the request body — and the model's own reading of
// it — grows for the entire life of a long meeting, most of which is no
// longer relevant to "what should I know about what's being said right
// now". 150 turns is generous enough to cover several topic changes' worth
// of conversation while keeping the payload bounded.
const TRANSCRIPT_WINDOW_TURNS = 150;

// The automatic loop's own clock — independent of, and not read from,
// chunkTrigger.js's `now` parameter (that stays a pure argument; this is
// what supplies it). 1s is frequent enough that the debounce's own
// thresholds (SETTLE_MS = 2500ms, MIN_INTERVAL_MS = 20000ms) are the
// binding constraint on latency, not this interval's own granularity.
const TICK_MS = 1000;

const INITIAL_STATE = {
  forSessionId: null,
  insights: [],
  // Always a STRING — "" until the route has identified one. The route's own
  // response carries `topic` as a plain string and `topicChanged` as its
  // already-normalized verdict on whether it moved (insightContract.js's
  // normalizeTopic computes that server-side, comparing NORMALIZED text so a
  // trailing period or a trivial rephrase is not reported as a change).
  // Neither this hook nor its renderer re-derives that verdict: a `!==` on
  // raw text here would report exactly the noise normalizeTopic exists to
  // suppress.
  topic: "",
  topicChanged: false,
  status: "idle",
  error: "",
};

function wordCount(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function totalWords(turns) {
  return turns.reduce((sum, turn) => sum + wordCount(turn?.text), 0);
}

// The request's `transcript` field. Labels each turn through
// meetingSpeakerLabel — the ONE place that translation is allowed to happen
// (see app/meeting/useMeetingSession.js's own header comment: turns are
// stored with the raw routing value, "them"/"you"/"room", and never a
// resolved label). Building an outgoing network payload is a legitimate use
// of that translation, same as any other render/output boundary; what must
// never happen is baking the label into STORED state, which this function
// does not do — it reads `turns`, it does not write them.
//
// Exported (not module-private) because the saved-page builder needs the
// identical rendering: a second copy of this loop would be a second place for
// the "a `room` turn gets NO label" rule to drift, and that rule is the whole
// of this feature's speaker-attribution honesty — a shared mic has no signal
// for who is talking, so its lines go out unlabelled rather than mislabelled.
// One exported function, one place that rule can ever change.
export function buildTranscriptText(turns) {
  const windowed =
    turns.length > TRANSCRIPT_WINDOW_TURNS ? turns.slice(-TRANSCRIPT_WINDOW_TURNS) : turns;
  return windowed
    .map((turn) => {
      const label = meetingSpeakerLabel(turn.speaker);
      // "room" (a shared in-person mic) resolves to "" — no label at all,
      // per insightContract.js's own reasoning: there is no signal for who
      // is talking, so a line is sent unlabelled rather than mislabelled.
      return label ? `${label}: ${turn.text}` : turn.text;
    })
    .join("\n");
}

// Folds a read's freshly-normalized insights into the accumulated list,
// deduped by id, NEWEST FIRST — the incoming read's own insights (already
// deduped within themselves, and already filtered against
// `knownInsightIds` server-side by normalizeInsights) go in front of
// whatever was already on screen. Still guards against a duplicate/
// malformed entry defensively rather than trusting the server response
// blindly — the same discipline insightContract.js itself documents for
// why it never trusts raw model output either.
function mergeInsights(existing, incoming) {
  const seen = new Set();
  const merged = [];
  for (const insight of incoming) {
    if (!insight || typeof insight.id !== "string" || seen.has(insight.id)) continue;
    seen.add(insight.id);
    merged.push(insight);
  }
  for (const insight of existing) {
    if (!insight || typeof insight.id !== "string" || seen.has(insight.id)) continue;
    seen.add(insight.id);
    merged.push(insight);
  }
  return merged;
}

export function useMeetingInsights({ turns, sessionId, live, pageId, engine }) {
  const [state, setState] = useState(INITIAL_STATE);

  // Mirrors of the latest props/derived values, read from inside
  // `runRead`'s async body and the ticking interval's callback — never
  // during render (react-hooks/refs) — the same discipline
  // useDraftAnswer.js's profileRef/postingRef and useLiveSession.js's
  // questionsRef apply for the identical reason: a stable callback's async
  // body must see the LATEST value, not whatever was current when the
  // callback identity was created.
  const turnsRef = useRef(turns);
  const pageIdRef = useRef(pageId);
  const engineRef = useRef(engine);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    pageIdRef.current = pageId;
  }, [pageId]);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // The generation counter (useDraftAnswer.js's half of the supersession
  // idiom — see the file header). Incremented by runRead ITSELF on every
  // call (mirroring useCompanyBrief.js's own genRef, not useDraftAnswer.js's
  // externally-bumped one) because a read here can be superseded by ANOTHER
  // read from this same hook, not only by an outside event — see `nudge`
  // below, which must be able to invalidate an automatic read that's still
  // in flight. Also bumped from three externally-triggered effects further
  // down: `live` going false (stop), `sessionId` changing (a new meeting),
  // and unmount.
  const genRef = useRef(0);
  // Whether a read is CURRENTLY awaiting a response — the one piece of
  // bookkeeping chunkTrigger.js's `inFlight` parameter needs. Deliberately
  // a ref, not state: it is read every tick (up to once a second) purely to
  // feed a decision function, never rendered, and updating it via setState
  // would cost a render for information nothing on screen displays.
  const inFlightRef = useRef(false);
  // The debounce's other two clocks — see chunkTrigger.js for what each
  // guards. `lastFinalAt` is NOT tracked here as its own ref: it is always
  // just "the timestamp of the most recent turn", recomputed straight from
  // `turnsRef.current` on every tick rather than kept as a second, separate
  // piece of state that could drift from the turns array it is meant to
  // describe.
  const lastReadAtRef = useRef(null);
  // The transcript's total word count AS OF the last read that was issued
  // (fired, not necessarily succeeded) — `insightTrigger`'s `newWords` is
  // the delta between this and the CURRENT total, recomputed each tick.
  const wordsAtLastReadRef = useRef(0);
  // The topic string returned by the last successful read, fed back as the
  // next request's own `topic` — see insightClient.js's own doc on this
  // field: the ROUTE decides whether the topic changed, this hook is only
  // the courier that remembers what it last heard.
  const topicRef = useRef("");
  // The most recent read's own accumulated insight ids, newest first — the
  // source `knownInsightIds` is built from. Kept in step with `state.
  // insights` by every successful read (see runRead below) rather than
  // re-derived from state on every tick, since it is needed inside an async
  // callback where reading `state` directly would itself be a staleness
  // risk (the same reason profileRef/postingRef exist in useDraftAnswer.js
  // rather than that hook closing over `profile`/`posting` directly).
  const knownIdsRef = useRef([]);

  // AC (a new meeting resets everything): `sessionId` changing means the
  // caller has moved to a genuinely different meeting — nothing about the
  // PRIOR meeting's topic, known-insight bookkeeping, or pacing clocks has
  // any business influencing the new one's first read. Runs on mount too
  // (establishing this hook's very first session's own baseline), which is
  // harmless: nothing has fired yet, so there is nothing for the bump to
  // discard.
  //
  // Deliberately does NOT also reset `state` here — this repo's
  // react-hooks/set-state-in-effect rule forbids calling a state setter
  // synchronously from inside an effect body (see useLiveSession.js's own
  // `prevLiveForPin` comment for the same rule blocking the same shape of
  // fix elsewhere in this codebase), and unlike that case there is nothing
  // to restore here in a render-phase adjustment either: `belongsToCurrentSession`
  // below already does the job on its own, exactly as useCompanyBrief.js's
  // `belongsToCurrentPosting` does for a posting change — the OLD session's
  // `state.forSessionId` simply stops matching the new `sessionId` prop the
  // very next render, and `effective` falls back to INITIAL_STATE with no
  // effect needed to make that happen. The first read that actually fires
  // for the new session (automatic or nudged) is what establishes real
  // state for it, via `runRead`'s own `forSessionId: sid` write.
  useEffect(() => {
    genRef.current += 1;
    inFlightRef.current = false;
    lastReadAtRef.current = null;
    wordsAtLastReadRef.current = 0;
    topicRef.current = "";
    knownIdsRef.current = [];
  }, [sessionId]);

  // AC (stopping bumps the generation): `live` going false means the
  // capture session has ended (app/meeting/useMeetingSession.js's own
  // `status` no longer "connecting"/"live") — there is no reconnect in the
  // STT layer (see that hook's own comment on this), so nothing further
  // will arrive to read from until the user starts again. A read still
  // resolving at that moment has nothing useful left to report into: this
  // meeting's insights, as they stand, are exactly the ones already on
  // screen. Bumping here — rather than only relying on the tick effect
  // below simply stopping — is what makes that read's eventual result land
  // nowhere instead of quietly repainting the panel a second after Stop was
  // pressed. Does NOT reset `state`: unlike a new meeting, insights already
  // shown remain exactly what a user expects to still see after ending the
  // meeting they came from.
  useEffect(() => {
    if (!live) {
      genRef.current += 1;
      inFlightRef.current = false;
    }
  }, [live]);

  // AC (unmount bumps the generation): the same discipline
  // useLiveSession.js's own unmount effect applies to tearing down a
  // session — a result landing after the component owning this hook no
  // longer exists has nowhere correct to write to.
  useEffect(() => {
    return () => {
      genRef.current += 1;
    };
  }, []);

  const runRead = useCallback(async () => {
    // useCompanyBrief.js's own genRef discipline: incremented HERE, by this
    // call itself, so a SECOND call (whether the next automatic tick or an
    // explicit nudge) always invalidates whichever call came before it,
    // regardless of whether that earlier call has resolved yet.
    const gen = (genRef.current += 1);
    const sid = sessionIdRef.current;
    const currentTurns = turnsRef.current;
    const transcript = buildTranscriptText(currentTurns);
    const knownInsightIds = knownIdsRef.current.slice(0, KNOWN_IDS_CAP);

    // Bookkeeping for the NEXT trigger evaluation is stamped as soon as this
    // read is issued, not once it resolves — a read that ultimately fails,
    // or gets superseded, still genuinely consumed "the chunk of new speech
    // as of right now" and still genuinely happened "at this moment" for
    // MIN_INTERVAL_MS's purposes. Leaving these until after a successful
    // response would let a slow or failing read get re-fired on every
    // subsequent tick while it was still outstanding, defeating the pacing
    // this bookkeeping exists to provide.
    inFlightRef.current = true;
    lastReadAtRef.current = Date.now();
    wordsAtLastReadRef.current = totalWords(currentTurns);

    setState((prev) => (genRef.current === gen ? { ...prev, forSessionId: sid, status: "loading", error: "" } : prev));

    const result = await fetchInsights({
      transcript,
      topic: topicRef.current,
      knownInsightIds,
      pageId: pageIdRef.current,
      engine: engineRef.current,
    });

    // Superseded — by a stop, a new meeting, an unmount, or a nudge that
    // fired after this call started. Per insightClient.js's own contract,
    // the request itself was never aborted; only its result is discarded
    // here, by simply never writing it anywhere.
    if (genRef.current !== gen) return;
    inFlightRef.current = false;

    if (!result.ok) {
      // AC (a failed read is retryable and non-destructive): `insights` is
      // left exactly as it was — a failure never clears what is already on
      // screen, it only reports that THIS attempt didn't add to it. The
      // next automatic tick (or a nudge) is the retry; there is no separate
      // retry path to wire up.
      setState((prev) => ({ ...prev, forSessionId: sid, status: "error", error: result.error }));
      return;
    }

    // A successful read with no topic reported keeps whatever topic this
    // meeting was already tracking, rather than resetting it to blank —
    // insightClient.js's own contract only promises `topic: null` when the
    // route omitted the field, and the route sends `""` while no topic has
    // been identified yet; neither is the claim "there is no topic anymore".
    // The `typeof` guard is what keeps a non-string from ever reaching
    // `topicRef` — this field is fed straight back into the NEXT request's
    // `topic`, where anything but a string stringifies into the model's
    // prompt (an object arriving here once produced a literal
    // "[object Object]" as the previous topic, and the same string was then
    // concatenated into the page-ranking query, where "object" scored as a
    // search term).
    if (typeof result.topic === "string" && result.topic) topicRef.current = result.topic;

    setState((prev) => {
      const merged = mergeInsights(prev.insights, result.insights);
      knownIdsRef.current = merged.map((insight) => insight.id);
      return {
        ...prev,
        forSessionId: sid,
        status: "done",
        error: "",
        topic: topicRef.current,
        // Taken from the response, never recomputed, and REPLACED on every
        // successful read rather than latched: a read that did not change the
        // topic clears the cue, so "(just changed)" keeps meaning "just"
        // instead of staying pinned beside the heading for the rest of the
        // meeting.
        topicChanged: result.topicChanged === true,
        insights: merged,
      };
    });
  }, []);

  // The loop itself. Ticks only while `live` — a stopped or not-yet-started
  // meeting has nothing new to read and nothing to pace against — and its
  // ENTIRE job each second is to ask the pure decision function whether to
  // fire, then either call `runRead()` or do nothing. No `>=` comparison of
  // any clock lives here; every one of those lives inside chunkTrigger.js.
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => {
      const currentTurns = turnsRef.current;
      const lastTurn = currentTurns.length ? currentTurns[currentTurns.length - 1] : null;
      const decision = insightTrigger({
        now: Date.now(),
        newWords: totalWords(currentTurns) - wordsAtLastReadRef.current,
        lastFinalAt: lastTurn ? lastTurn.at : undefined,
        lastReadAt: lastReadAtRef.current ?? undefined,
        inFlight: inFlightRef.current,
        // The automatic loop never nudges — see `nudge` below for the
        // separate, unconditional path a deliberate user action takes
        // instead of asking this same trigger for permission.
        nudge: false,
      });
      if (decision.fire) runRead();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live, runRead]);

  // The explicit override — "check this now". Per the brief this shipped
  // against: bumps the generation (so an automatic read still in flight is
  // discarded, its eventual result landing nowhere — see the "superseded"
  // early return in runRead above) and then forces a read unconditionally.
  // This deliberately does NOT ask chunkTrigger.js's insightTrigger for
  // permission first: that function's own `nudge` branch (see
  // chunkTrigger.test.js's "still refuses to stack on top of a read already
  // in flight") describes what the AUTOMATIC loop above does when a pending
  // nudge flag happens to coincide with a genuinely in-flight read it did
  // not itself just discard — a scenario this function avoids entirely by
  // discarding that in-flight read itself, synchronously, before ever
  // calling runRead. By the time runRead's own fetch begins, nothing this
  // hook still cares about is in flight; `insightTrigger` has nothing left
  // to refuse.
  const nudge = useCallback(() => {
    runRead();
  }, [runRead]);

  // `?? null` on BOTH sides, deliberately: "no session id" has two spellings
  // in JavaScript and both reach here. `forSessionId` starts as `null`, an
  // omitted `sessionId` prop arrives as `undefined`, and a caller writing
  // `sessionId={meeting?.id ?? null}` produces `null` for the very same "no
  // meeting yet" — but `null === undefined` is false, so a strict comparison
  // treats one unnamed session as two different ones and silently discards
  // everything read under the other spelling. There is no error, no empty
  // state, no clue: the panel simply renders nothing it fetched. Coercing
  // both sides makes "no session id" a value that matches itself, so an
  // unnamed session degrades to ONE unnamed session rather than to a dead
  // panel.
  const belongsToCurrentSession = (state.forSessionId ?? null) === (sessionId ?? null);
  const effective = belongsToCurrentSession ? state : INITIAL_STATE;

  // A read still in flight when the user pressed Stop is superseded by the
  // `live` effect's generation bump, so it returns without ever writing to
  // state — which leaves `status` sitting at "loading" for a session that is
  // over, and the panel spinning "Listening for insights…" indefinitely.
  // Derived at render rather than corrected in an effect because this repo's
  // react-hooks/set-state-in-effect rule forbids the setter-in-effect shape,
  // and because there is nothing to correct in the first place: state is not
  // wrong, it is simply not what a stopped meeting should PRESENT as.
  const status = !live && effective.status === "loading" ? "idle" : effective.status;

  return {
    insights: effective.insights,
    topic: effective.topic,
    topicChanged: effective.topicChanged,
    status,
    error: effective.error,
    nudge,
  };
}
