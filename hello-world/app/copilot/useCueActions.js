"use client";

import { useCallback, useRef, useState } from "react";
import {
  resolveCueAction,
  effectiveAttribution,
  CUE_IGNORED_REASONS,
  SPEAKER_ATTRIBUTION,
} from "@/lib/copilot/cuePolicy";

// AC-T1.13/T1.16.1/T1.17/T1.18/AC-V2.3/C12. The "act" half of
// useVoiceCues.js's "decide vs act" split — split out of useLiveSession.js
// purely to keep that file under this project's 1000-line cap, the same
// reasoning useSessionLogRecorder.js/useDraftAnswer.js/useQuestionPin.js
// already give for their own splits out of the same file. This is not a new
// architectural boundary: it is exactly the seam GROUP-V-ARCH.md names for
// this feature ahead of time, taken because AC-V2's plumbing (an extra piece
// of state, a ref mirror, a third argument threaded through evaluateVoiceCue)
// costs almost exactly what pulling handleVoiceCue's branching out of
// useLiveSession.js gives back.
//
// AC-T1.18.1: the idle shape, and the one place the announcement's wording
// is decided. `kind` is the action that fired ("pin" | "unpin"), `id` the
// question the pin landed on, `moved` whether it displaced an existing hold.
const IDLE_CUE_EVENT = { kind: "", id: null, moved: false, nonce: 0 };

// Turns one cue event into the sentence the polite region carries.
//
// Naming the question is what makes consecutive announcements differ, and it
// is worth saying in its own right — R-229's stranding clause is about a
// screen-reader user not being told WHICH question the panel is showing, and
// "Question held on screen." said three times answers that question zero
// times. A bare counter would defeat the Object.is bailout just as well and
// tell the user nothing, which is why the distinguishing part and the useful
// part are deliberately the same part.
//
// `pinnedEntry` is only trusted when it is the entry this event actually
// pinned — a newer question arriving in the same batch, or a hold already
// expired by the time this renders, would otherwise name the wrong one. With
// no entry to name it degrades to today's sentence rather than to nothing.
//
// The one case that still repeats a sentence is a pin cue landing on the
// question already held with nothing new behind it, twice running: nothing
// on screen changed either time, and a region that speaks when nothing
// changed is the inverse of the defect this fixes.
function cueSentence(event, pinnedEntry) {
  if (event.kind === "unpin") return "Question released.";
  if (event.kind !== "pin") return "";
  const named =
    pinnedEntry && pinnedEntry.id === event.id && typeof pinnedEntry.question === "string"
      ? pinnedEntry.question.trim()
      : "";
  // AC-T1.16.1's re-pin FORWARD is a different event from a first hold, and
  // the one that most needs saying: the panel's content changed under
  // someone who cannot see it.
  const lead = event.moved ? "Hold moved to the newest question" : "Question held on screen";
  return named ? `${lead}: ${named}` : `${lead}.`;
}

// Takes `{ pin, pinnedIdRef, onCompanyCueRef, logEvent, speakerAttributionRef }`
// — every one of them already owned elsewhere in useLiveSession.js — and
// returns `{ handleVoiceCue, cueAnnouncement, resetCueAnnouncement }`. Owns
// no session state of its own: `pin` (useQuestionPin.js) is still the only
// place a hold's id lives, this hook only calls into it.
export function useCueActions({ pin, pinnedIdRef, onCompanyCueRef, logEvent, speakerAttributionRef }) {
  // AC-T1.18/I10/AC-T1.18.1: what happened, not the sentence for it.
  //
  // *** A FRESH OBJECT GUARANTEES A RE-RENDER, NOT AN ANNOUNCEMENT ***
  // The `{ text, nonce }` shape came from SpeakerBar.js's barAnnouncement,
  // and that file's own comment states the benefit slightly wrong: the fresh
  // object literal defeats React's Object.is bailout, so the component
  // re-renders — but a screen reader announces a TEXT CHANGE inside a live
  // region, and the nonce never reaches the DOM (CopilotClient.js renders
  // `.text` alone, and must, or the region would read a number aloud). Two
  // consecutive announcements carrying the same sentence are therefore one
  // announcement. Measured: three holds, one DOM mutation. It bit hardest in
  // the state this feature exists for — under UNAVAILABLE attribution `pin`
  // is the only permitted action, so "Question held on screen." was the only
  // string this path could produce and the voice path went silent for the
  // rest of the interview.
  //
  // The fix is to make the sentence itself carry what changed, which needs
  // the question that ended up held — and that is not knowable at the moment
  // the cue fires: `pin.pinCurrentQuestion()` returns only an id, and
  // `pin.pinnedEntry` still holds the PREVIOUS render's pin until React has
  // re-rendered with the new one. So the event is what goes into state, and
  // the sentence is derived once, on the render that already has the entry.
  const [cueEvent, setCueEvent] = useState(IDLE_CUE_EVENT);
  const cueEventNonceRef = useRef(0);
  const announceCue = useCallback((kind, detail) => {
    cueEventNonceRef.current += 1;
    setCueEvent({ ...IDLE_CUE_EVENT, ...detail, kind, nonce: cueEventNonceRef.current });
  }, []);
  // useLiveSession.js's start() resets this to the idle shape at the top of
  // every session, the same way it resets every other piece of per-session
  // state this hook doesn't own — exposed as a function rather than the
  // setter itself so this hook still controls the exact shape of "reset".
  const resetCueAnnouncement = useCallback(() => {
    cueEventNonceRef.current = 0;
    setCueEvent(IDLE_CUE_EVENT);
  }, []);

  // AC-T1.18.1: the sentence, latched to the event that produced it.
  //
  // Derived on the render the event lands in — where `pin.pinnedEntry` IS the
  // newly held question, because `setPinnedId` and `setCueEvent` were both
  // dispatched from the same handler and batched into one pass — and then
  // held FROZEN until the next event. Freezing is the load-bearing half: a
  // hold that later expires (AC-T1.16.2) or is superseded takes
  // `pin.pinnedEntry` away with it, and a sentence recomputed at that moment
  // would rewrite the region's text with no cue having been spoken, which is
  // an announcement fired at a user for something that did not happen.
  //
  // A render-phase adjustment rather than a useEffect, the same idiom
  // useQuestionPin.js and SpeakerBar.js already use here and for the same two
  // reasons: this project's react-hooks/set-state-in-effect rule forbids
  // deriving render output in an effect, and an effect would also commit the
  // announcement one paint late. It converges immediately — once the nonces
  // agree there is no second mismatch to chase.
  const [cueAnnouncement, setCueAnnouncement] = useState({ text: "", nonce: 0 });
  if (cueAnnouncement.nonce !== cueEvent.nonce) {
    setCueAnnouncement({ text: cueSentence(cueEvent, pin.pinnedEntry), nonce: cueEvent.nonce });
  }

  // C12: the refusal has to happen BEFORE the branch that would carry it
  // out, not after — the old company branch called onCompanyCueRef.current()
  // (which opens the panel and fires the outbound request) and only then
  // decided what to log. Computing `act`/`ignoredReason` up front and
  // returning on `!act` before any of the three action branches run is what
  // makes AC-V2.3's "a matched unpin/company is refused" an actual refusal
  // instead of a log line written after the fact.
  const handleVoiceCue = useCallback(
    (match, utterance) => {
      // AC-V2.8: `match.snapshot` is the speaker snapshot as it stood when
      // useVoiceCues.js qualified this very frame — the evidence half of the
      // question, which the attribution flag alone answers wrong in a session
      // whose token route blipped (see cuePolicy.js's `effectiveAttribution`).
      // Without it this hook refused the CANDIDATE's own release and company
      // cues with a reason that was false.
      const snapshot = match?.snapshot;
      const { act, ignoredReason } = resolveCueAction({
        match,
        speakerAttribution: speakerAttributionRef.current,
        snapshot,
      });
      // AC-T1.13.1: a `{ blocked: "identity" }` marker never carries an
      // id/action to log as a match — it isn't one, it's qualifiesForCue
      // reporting that identity hasn't settled enough to even try.
      if (match.blocked !== "identity") {
        logEvent("cue.matched", { id: match.id, action: match.action, utterance });
      }
      if (!act) return logEvent("cue.ignored", { reason: ignoredReason });
      if (act === "pin") {
        // AC-V2.3.1: while nobody can tell the two voices apart, a hold cue
        // may CREATE a hold and may not MOVE one. resolveCueAction refuses a
        // spoken RELEASE in this state because a false release yanks away a
        // hold the candidate set deliberately — and a second spoken PIN does
        // exactly that same thing through the other door, because
        // pinCurrentQuestion always targets `latestQuestionEntry` (the
        // deliberate re-pin-FORWARD of AC-T1.16.1). Confirmed against R-229:
        // moving the hold drops the newer-question count from 1 to 0, so the
        // count-bearing one-click release loses its number and the held
        // question is reachable only through the feed; the polite region
        // announces a hold at the exact moment the panel changed under a
        // screen-reader user; and the third of R-229's three named states,
        // held-with-newer-behind, is destroyed with no state-name change.
        //
        // Guarded HERE, not in resolveCueAction, because "is a hold already
        // in force" is question state and cuePolicy.js is pure — see that
        // module's own note beside this reason. Re-pinning forward stays
        // correct in every state where it was actually argued for: a session
        // that can tell the candidate's voice from the interviewer's.
        //
        // AC-V2.8: asked through `effectiveAttribution` rather than by testing
        // the flag here, because this is the SAME question resolveCueAction
        // asks two lines above and a fifth place to write the rule is a fifth
        // place to widen it or forget it. It also makes this gate correct on
        // its own terms: re-pinning FORWARD was argued for in exactly the
        // session that can tell the candidate's voice from the interviewer's,
        // and a token-blip session with real speaker tags IS one of those.
        if (
          effectiveAttribution(speakerAttributionRef.current, snapshot) ===
            SPEAKER_ATTRIBUTION.UNAVAILABLE &&
          pinnedIdRef.current !== null
        ) {
          return logEvent("cue.ignored", { reason: CUE_IGNORED_REASONS.HOLD_ALREADY_IN_FORCE });
        }
        // Read BEFORE the pin: `pinnedIdRef` mirrors the committed
        // `pin.pinnedId`, so this is what was held a moment ago, which is
        // what tells a create apart from a move (AC-T1.18.1).
        const heldBefore = pinnedIdRef.current;
        const id = pin.pinCurrentQuestion(); // AC-T1.16.1: re-pins FORWARD when already held.
        if (id === null) logEvent("cue.ignored", { reason: CUE_IGNORED_REASONS.NO_QUESTION });
        else {
          logEvent("question.pinned", { id });
          announceCue("pin", { id, moved: heldBefore !== null && heldBefore !== id });
        }
      } else if (act === "unpin") {
        // AC-V2.4: the `pinnedIdRef.current !== null` test used to sit in the
        // `else if` condition itself, so a matched release with nothing held
        // fell through every branch and wrote no log line — leaving a lone
        // `cue.matched` and a session that could not say why nothing
        // happened. Moved inside the branch so the refusal has somewhere to
        // be recorded, exactly as the `pin` branch above already records
        // NO_QUESTION for its own mirror case.
        if (pinnedIdRef.current === null) logEvent("cue.ignored", { reason: CUE_IGNORED_REASONS.NOTHING_HELD });
        else {
          pin.unpinQuestion();
          logEvent("question.unpinned", {});
          announceCue("unpin");
        }
      } else if (act === "company") {
        // AC-T1.18: opening the panel is CopilotClient's state — trust its
        // report. Reached only once resolveCueAction has already allowed it.
        const handled = typeof onCompanyCueRef.current === "function" && onCompanyCueRef.current();
        if (!handled) logEvent("cue.ignored", { action: "company", reason: CUE_IGNORED_REASONS.COMPANY_UNAVAILABLE });
      }
    },
    [logEvent, pin, announceCue, pinnedIdRef, onCompanyCueRef, speakerAttributionRef],
  );

  return { handleVoiceCue, cueAnnouncement, resetCueAnnouncement };
}
