"use client";

import { useCallback, useState } from "react";
import { resolvePin } from "@/lib/copilot/questionPin";
import { latestQuestionEntry } from "@/lib/copilot/currentQuestion";

// AC-T1.16..T1.16.3/AC-T1.17. The React state around
// lib/copilot/questionPin.js's pure `resolvePin` — split out of
// useLiveSession.js purely to keep that file under this project's
// 1000-line cap, the same reasoning useSessionLogRecorder.js/
// useDraftAnswer.js already give for their own splits out of the same file.
//
// Owns exactly the two pieces of state resolvePin's own doc says a caller
// must persist across renders (`pinnedId`, `supersededAt`) and nothing
// else: which entry is "current" while held (pinnedQuestionEntry) and how
// many arrived behind it (newerQuestionCount) are both resolvePin's own
// decision, reused here, never re-derived.
//
// The expiry (AC-T1.16.2) has to be able to fire with NOTHING else
// happening — no new transcript frame, no click — so it needs a clock that
// keeps advancing on its own. Rather than start a second setInterval here
// (which could drift against useLiveSession's own ticking `now`, and would
// be a second timer this hook would then also have to tear down on
// unmount), this hook takes `now` as an ARGUMENT: the exact same ticking
// value useLiveSession.js already maintains for LiveHearingStrip's silence
// clock (AC-S3/D2). Every tick of that existing interval re-renders the
// caller, which re-invokes this hook with a fresh `now` — that alone is
// enough for resolvePin to notice an expiry; no separate scheduling of any
// kind lives here.
export function useQuestionPin({ questions, questionsRef, now }) {
  const [pinnedId, setPinnedId] = useState(null);
  const [supersededAt, setSupersededAt] = useState(null);

  const resolved = resolvePin({ pinnedId, supersededAt, questions, now });

  // Sync resolvePin's own decision back into this hook's state, in the SAME
  // render pass, whenever it disagrees with what is currently stored — an
  // expiry (AC-T1.16.2) releasing the hold, or the first supersede
  // recording its start time (resolvePin's own "the clock starts at the
  // FIRST supersede" rule). This is the "adjusting state during rendering"
  // idiom SpeakerBar.js's `seenSessionNonce` already uses in this codebase,
  // not a useEffect — this project's react-hooks/set-state-in-effect rule
  // forbids deriving render output that way, and an effect would also apply
  // an expiry release one paint late (the panel would keep showing the
  // superseded hold for an extra frame after its own 120s deadline passed).
  // This converges in the same render pass it fires in: once the mismatch
  // is corrected, resolvePin recomputes against the NEW pinnedId/
  // supersededAt and agrees with what was just stored, so there is no
  // second mismatch to chase.
  if (resolved.pinnedId !== pinnedId || resolved.supersededAt !== supersededAt) {
    setPinnedId(resolved.pinnedId);
    setSupersededAt(resolved.supersededAt);
  }

  // Both actions below read `questionsRef`, not the `questions` value
  // closed over above — these are stable callbacks (empty/near-empty dep
  // arrays) that fire from an EVENT (a click, or a matched voice cue), and
  // this project's react-hooks/refs rule only forbids reading `.current`
  // during RENDER, which neither of these ever does. Reading the ref here
  // is what useLiveSession.js's own buildContext/handleUtterance already do
  // for the same reason: a stable callback's closure must see the LATEST
  // list, not whatever was current when the callback's identity was
  // created.
  const pinCurrentQuestion = useCallback(() => {
    const target = latestQuestionEntry(questionsRef.current);
    // AC-T1.14/T1.18: safe to call with no questions at all — the caller
    // (useLiveSession.js) is what turns a null return here into a
    // `cue.ignored` log entry; this hook itself just reports "nothing to
    // pin" rather than pinning nothing.
    if (!target) return null;
    setPinnedId(target.id);
    // AC-T1.16.1: pinning always targets the CURRENT latestQuestionEntry,
    // whether this is a fresh pin or a repeat cue moving an existing hold
    // FORWARD — there is no separate "already held" branch anywhere in this
    // file; the re-pin behaviour falls straight out of always pinning to
    // "current". Clearing `supersededAt` here is the other half of that:
    // the newly-pinned entry IS the latest one, so nothing supersedes it
    // yet, and a repeat "good question" must reset the 120s clock rather
    // than inherit a countdown that was already running against the
    // PREVIOUS pin.
    setSupersededAt(null);
    return target.id;
  }, [questionsRef]);

  const unpinQuestion = useCallback(() => {
    setPinnedId(null);
    setSupersededAt(null);
  }, []);

  return {
    pinnedId: resolved.pinnedId,
    pinnedEntry: resolved.entry,
    newerQuestionCount: resolved.newerCount,
    held: resolved.held,
    pinCurrentQuestion,
    unpinQuestion,
  };
}
