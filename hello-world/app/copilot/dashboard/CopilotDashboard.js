"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { answerLines } from "@/lib/copilot/answerPoints";
import { answerStatusMessage, visuallyHidden } from "@/lib/copilot/answerStatus";
import { pinnedQuestionEntry } from "@/lib/copilot/currentQuestion";
import { dashboardCopy, PACE_LABEL_TEXT, FILLER_LABEL_TEXT } from "@/lib/copilot/dashboardCopy";
import AnswerAids from "../AnswerAids";
import AnswerLines from "../AnswerLines";
import { RealPanel } from "./panelShells";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";
import { confirmRevealLabel } from "@/lib/copilot/confirmReveal";

// AC-I5/AC-J2: the copilot's dashboard — the current question's answer, and
// a delivery strip covering the user's current talking pace AND
// verbal-filler rate. Purely presentational (AC-I5.31): every value arrives
// as a prop, same contract as SampleAnswer.js/SubmittedDocs.js — this owns
// no fetching and no state beyond the trivial "is a panel expanded" kind
// SubmittedDocs already uses elsewhere, and here not even that. It does not
// replace QuestionFeed (AC-I5.30) — the caller renders both; this is a
// glanceable summary, QuestionFeed is the full history with its own redraft
// actions.
//
// ARCH-sticky §2.1: the current-QUESTION panel used to render here too, as
// this grid's first child. It now mounts once per client, in a sticky strip
// above this component entirely (app/copilot/dashboard/StickyQuestionStrip.js)
// — "the question is always visible wherever I am on the page" needs it to
// outlive whatever scroll position THIS component is at, which a child of
// this grid structurally cannot. Nothing here duplicates it: this file
// derives `current` only for CurrentAnswerPanel below, via the same
// `pinnedQuestionEntry` call the strip makes — one decision, one place,
// unmoved by the relocation.
//
// `questions` is the SAME array CopilotClient already holds and passes to
// useCopilotDashboard — this component re-derives "the current question"
// from it directly (AC-I5.28) rather than through any prop it invents, so
// there is exactly one place that array is read as "what's the latest
// question" (here) instead of two copies that could disagree. Practice mode
// has no such array; it synthesizes a one-entry list in the same shape (see
// PracticeClient.js), which is what lets both modes share this component
// rather than fork it.
//
// AC-J2.1: BOTH modes render this. The layout, the panel treatment and every
// state (loading, error, empty, measured/unmeasured) are shared verbatim —
// the whole point of practice mode having a dashboard is rehearsing against
// the instrument the candidate will be reading during the real interview, so
// a divergence here defeats the feature. Only the WORDS differ, via the
// `copy` prop below, and only where a live-mode sentence would be untrue in
// practice mode ("the interviewer has not asked this" when there is no
// interviewer).
// ARCH-stats-in-strip r3 §2.3: PACE_LABEL_TEXT/FILLER_LABEL_TEXT moved to
// lib/copilot/dashboardCopy.js (imported above) so StatsRow.js's strip
// reading and this file's DeliveryPanel share one lookup — see that
// module's own comment on the two maps for why they moved and the COLOR
// maps below did not.
const PACE_LABEL_COLOR = {
  slow: "var(--warning)",
  conversational: "var(--success)",
  rushed: "var(--warning)",
};
// Filler-rate COLOR reading beside pace, same shape as PACE_LABEL_COLOR
// above so the two readings in DeliveryPanel (below) are visually one
// family of thing rather than two differently-designed widgets bolted
// together. `noticeable` and `heavy` deliberately share a color with each
// other (and with pace's `slow`/`rushed`) — the LABEL TEXT (imported above)
// is what tells them apart, never color alone (WCAG 1.4.1).
const FILLER_LABEL_COLOR = {
  clean: "var(--success)",
  noticeable: "var(--warning)",
  heavy: "var(--warning)",
};

// AC-T1.9: `latestQuestionEntry` moved to lib/copilot/currentQuestion.js —
// see that module for its full doc comment (AC-M1.3.5's provisional
// preference, BUG-3/R-121's "one decision, one place", BUG-4's null-element
// guard). Re-exported here, as the SAME function object (not a wrapper), so
// QuestionFeed.js's existing `import { latestQuestionEntry } from
// "./dashboard/CopilotDashboard"` keeps resolving with no edit to that
// file. This is an existing import path kept working, not a second place
// the decision is made — the component's own internal use above imports
// directly from lib/ instead of reading its own re-export.
export { latestQuestionEntry } from "@/lib/copilot/currentQuestion";

// BUG-J6: filtered via lib/copilot/answerPoints.js rather than a
// module-local copy — cachedSampleAnswerFor (lib/copilot/sampleAnswerState.js)
// only filters a COPY of `entry.points` to length-check it, then returns
// `entry.points` itself unfiltered — so a cached answer like ["", "a real
// point"] reaches the render layer with a blank entry still in it. That
// module is the ONLY place this filter is written out — see its doc comment
// for why the same guard used to live here AND in SampleAnswer.js, and had
// already drifted between the two.

// ARCH-sticky §2.7/§3.1: both copy constants now live in
// lib/copilot/dashboardCopy.js, alongside the `dashboardCopy()` merge below
// — the same merge app/copilot/dashboard/StickyQuestionStrip.js now makes
// for the relocated question panel's copy, over the SAME module-local
// default object, so neither side of the relocation can silently disagree
// about what "the rest of the copy" is. Re-exported here (not re-declared)
// so this file's own PracticeClient.js:17 import and
// CopilotDashboard.render.test.js:22 import keep resolving unedited.
export { LIVE_COPY, PRACTICE_COPY } from "@/lib/copilot/dashboardCopy";

// BUG-2/R-121 group-L: shared by CurrentAnswerPanel below AND QuestionFeed's
// own feed-level region — once BUG-3 makes QuestionFeed derive "current"
// through this file's exported `latestQuestionEntry` too, its region is
// exposed to the exact same collision this hook exists to prevent, so the
// fix for COMPOSING an informative announcement belongs in one place too,
// not copied into QuestionFeed by hand.
//
// Before latestQuestionEntry's provisional fallback existed, `current`
// could only change by a brand new entry being appended, and a new entry
// always starts "loading"/"idle" — confirmed for both live's addQuestion
// (useLiveSession.js) and practice's useSampleAnswer.js (a question that
// doesn't match `state.question` falls back to `emptySampleAnswer()`;
// nothing but an explicit reveal ever writes `status: "done"`) — so the
// region's text always changed on its own. The fallback can now make
// `current` swap to a DIFFERENT, already-`done` entry without the array
// growing at all (the retroactive provisional remap in
// useLiveSession.js's onSpeakerIdentity). If the two entries' bullet counts
// happen to match, `answerStatusMessage` returns byte-identical text and
// React bails out of the DOM update — the whole panel's contents change and
// nothing is announced. If the counts differ, the text does change, but
// "Answer ready, 3 points" reads as an edit to the SAME answer, not "the
// current question changed".
//
// `answerStatusMessage` is pinned by R-123 and gains no parameter, so the
// fix is composed here, at the surface: track the id of the entry rendered
// last render, and — only when it changes AND the newly-current entry is
// already `done` (the only way a swap can land on text that reads as an
// in-place edit rather than a fresh draft starting from loading/idle) —
// prefix the announcement with which question is now current. Gating on
// "newly done" is what keeps this from ever firing on an ordinary
// new-question append in EITHER mode: a brand new entry is never already
// `done` on the render its id first appears (see above), so this can only
// trigger for a swap between two entries that both already existed —
// structurally impossible for practice mode's one-entry array (see
// CopilotDashboard's own module doc), which is what keeps practice's
// announcement text byte-identical to before this hook existed.
//
// `prevId`/`swapQuestion` are both plain STATE, compared and conditionally
// re-set DURING RENDER — React's own documented "store information from
// previous renders" recipe (a render-phase update, not an effect). Two
// stricter rules in this repo's lint config rule out the two more obvious
// alternatives: react-hooks/refs forbids reading `ref.current` while
// rendering (a value read and mutated in the same render pass can disagree
// with itself if React re-invokes the function body before committing —
// exactly the bug this rule exists to catch), and react-hooks/set-state-in-
// effect forbids the natural-looking "compare in an effect, setState if it
// changed" version of this for the same reason: effects are for
// synchronizing with something OUTSIDE React, not for deriving one piece of
// render output from another. The render-phase-update form sidesteps both —
// no ref, no effect — and is still applied before this render's return
// value is computed, so there is no extra commit or visible lag.
//
// One consequence of not using an effect: there is no later tick to CLEAR
// `swapQuestion` once it has been announced, so it stays set until the
// NEXT id change rather than pulsing for a single commit. That is
// deliberately left as-is rather than fought — the sentence below reads
// correctly for as long as it's still true ("Current question: <X>" is
// accurate whether X became current a moment ago or several renders ago),
// and it still guarantees the one thing BUG-2 requires: the FIRST render
// after any swap always differs from what was showing before, by more than
// just `statusText`.
export function useCurrentQuestionAnnouncement(current, statusText) {
  const currentId = current?.id ?? null;
  const [prevId, setPrevId] = useState(currentId);
  const [swapQuestion, setSwapQuestion] = useState(null);

  if (currentId !== prevId) {
    setPrevId(currentId);
    // A swap actually happened. Only "announce which question" when the
    // newly-current entry arrived already `done` — see the module doc
    // above for why that's the only shape a swap between two EXISTING
    // entries can take, and why an ordinary new-question append (which
    // always starts loading/idle, in both modes) never matches it, so
    // `swapQuestion` stays `null` — and this hook a no-op — for the entire
    // life of a session that never triggers the fallback at all (every
    // practice session; most live sessions).
    setSwapQuestion(current?.status === "done" ? current.question : null);
  }

  if (swapQuestion !== null) {
    const prefix = `Current question: "${swapQuestion}".`;
    return statusText ? `${prefix} ${statusText}` : prefix;
  }
  return statusText;
}

// AC-J2.3: `answerHidden` is practice mode's reveal gate, and it is checked
// BEFORE any of the status branches below. Practice mode deliberately keeps
// a sample answer hidden until the candidate asks for it (AC-G1) — the
// whole drill is answering cold, and a dashboard that put the model's
// answer on screen the moment a question appeared would quietly remove the
// thing being practised. Live mode passes neither `answerHidden` nor
// `onReveal`, so it never reaches this branch and renders exactly as it did
// before the gate existed.
//
// The button is the same control SampleAnswer.js offers on the question
// card, driven by the SAME useSampleAnswer instance (see PracticeClient),
// so revealing in either place reveals in both — two independent visibility
// flags for one draft would let the card and this panel disagree about
// whether the answer is showing.
//
// Contract 8 (CopilotClient -> CopilotDashboard): `staleTypeChangeAt`
// defaults to `0` so every caller that does not pass it — practice mode,
// and every existing test — renders byte-identical to before this prop
// existed: `current.at` is always a real `Date.now()` timestamp (or
// `undefined`, which also fails the comparison), so the line below never
// shows unless a caller deliberately supplies a nonzero value. A number,
// not a boolean, because it self-clears against `current.at` at the render
// site the moment a NEW question becomes current (`current.at` moves
// forward, the comparison flips) — no effect, no setState, no extra state
// held here. Set to `Date.now()` by CopilotClient when a change to the
// interview type arrives from somewhere other than this window's own
// picker (a "foreign" change): that path leaves the visible card exactly
// as-is rather than auto-redrafting it (contract 8's own doc; AC-A15 is
// local-origin only), so the card can silently go on describing the wrong
// format unless something says otherwise.
// AC-N18.13, THE DELIBERATE DIVERGENCE: `announceHiddenReadiness` is what
// keeps this reused reveal gate from also reusing R-110's SILENCE. Practice
// mode (AC-J2.3/AC-G1) hides readiness on purpose — the drill is answering
// cold, so the status region is forced to "idle" while `answerHidden`, same
// as always (this defaults `false`, so that caller's behaviour is untouched,
// byte for byte). Live mode's N18 gate hides the SAME content for the
// opposite reason: the candidate has already been told a question was
// detected (the waiting surface, or the panel itself) and is being asked to
// confirm *because* the answer is ready — withholding that readiness would
// defeat the one thing this gate exists to announce. Passing `true` here
// leaves the REAL status (`current?.status`) flowing into the region even
// while hidden, so "Drafting an answer" / "Answer ready, N points" still
// reach a screen-reader user before they ever click "Show answer".
function CurrentAnswerPanel({
  current,
  copy,
  answerHidden,
  onReveal,
  revealLabel,
  announceHiddenReadiness = false,
  staleTypeChangeAt = 0,
  // M7, OWNER RULING: the undo affordance for a confirm that turns out
  // wrong — most acutely the cold-start seed, where seedView (questionConfirm.js)
  // tracks the latest entry INCLUDING a provisional one, so the candidate's
  // very first confirm can lock in their own sentence with no way back
  // except Clear (which wipes the whole session). Optional: `undefined` for
  // every caller that predates M7 (practice mode, which has no confirm gate
  // at all) hides the control entirely rather than wiring a handler with
  // nothing to call.
  onUnconfirm,
}) {
  // BUG-J6: filtered here (not `current.points` directly) — see
  // lib/copilot/answerPoints.js's doc for why an unfiltered array can reach
  // this component with blank entries in it. The `done` branch below tests
  // THIS filtered length, not `current.points?.length` — an all-blank array
  // must fall through to the copy.noPoints branch rather than rendering an
  // empty `<ul>`.
  //
  // AC-K1.1/AC-L1: a cue PLUS the sentence behind it, per line — the same
  // answerLines call practice mode's SampleAnswer.js and live mode's
  // QuestionFeed.js card make, so all three read alike.
  const lines = answerLines(current?.cues, current?.points, current?.pageSources);
  // BUG-2: computed here (not inline in the region below) so it can be fed
  // to useCurrentQuestionAnnouncement above as well as used for its own
  // sake — see that hook's doc for why the announcement can't simply be
  // this string on every render.
  const currentAnswerStatusText = answerStatusMessage({
    status: answerHidden && !announceHiddenReadiness ? "idle" : current?.status,
    bulletCount: lines.length,
  });
  const currentAnswerRegionText = useCurrentQuestionAnnouncement(current, currentAnswerStatusText);

  // F7: WCAG 2.4.3. Clicking the reveal button below UNMOUNTS it (the
  // `answerHidden` branch stops matching) and replaces it with the revealed
  // content, so focus fell back to <body> — a keyboard/screen-reader user
  // pressed Enter, heard silence, and had to Tab from the top of the
  // document mid-interview. `revealedRef` sits on the wrapping container for
  // every post-reveal state (loading/error/done/empty; see the render below)
  // so focus lands there and stays valid across the loading -> done
  // transition, without ever needing to move again. `prevAnswerHiddenRef`
  // starts equal to the current value on mount specifically so the effect
  // never fires on mount — only on a later true -> false TRANSITION, i.e.
  // the reveal button actually being pressed.
  const revealedRef = useRef(null);
  const prevAnswerHiddenRef = useRef(answerHidden);
  // AC-N18.13 EXTENSION: seeded to whether this mount already starts past
  // its own reveal (`!answerHidden`) — a caller that mounts mid-session
  // (or a test harness) with something already showing must not be treated
  // as "not yet activated". Flips permanently true the first time this
  // effect sees the true -> false transition below, and never resets.
  const hasEverRevealedRef = useRef(!answerHidden);
  const prevCurrentIdRef = useRef(current?.id ?? null);
  useEffect(() => {
    const prevAnswerHidden = prevAnswerHiddenRef.current;
    prevAnswerHiddenRef.current = answerHidden;
    const prevCurrentId = prevCurrentIdRef.current;
    const currentId = current?.id ?? null;
    prevCurrentIdRef.current = currentId;

    // R-110/R-122: three separate protections here, each doing a different
    // job — worth naming precisely rather than crediting one with work
    // another one does:
    //   1. `prevAnswerHiddenRef` seeds to the CURRENT `answerHidden` on
    //      mount (see the ref's own declaration above), so this effect can
    //      never see a transition on its first run. That is what stops a
    //      mount-time false-positive focus steal, in every mode.
    //   2. Practice mode passes neither `answerHidden` nor `onRevealAnswer`,
    //      so this component's defaults hold `answerHidden={false}` for the
    //      component's ENTIRE life — there is no `true -> false` edge to
    //      detect there, ever.
    //   3. The `onReveal` guard is defence-in-depth for a caller that passes
    //      `answerHidden` (making the edge reachable) without also passing
    //      `onRevealAnswer` — neither practice mode nor live mode is that
    //      caller today, since both always pass a real reveal callback
    //      alongside the flag.
    const revealedJustNow = prevAnswerHidden === true && answerHidden === false && typeof onReveal === "function";
    if (revealedJustNow) hasEverRevealedRef.current = true;

    // AC-N18.13 EXTENSION, THE SECOND HALF OF F-F7's FIX. The seed's own
    // reveal (above) is not the only way this panel's content changes out
    // from under a keyboard/screen-reader user. Once anything has been
    // confirmed, resolveConfirmedView's own contract (questionConfirm.js)
    // guarantees `current` moves ONLY via a later explicit confirm — never
    // automatically — so a swap onto a DIFFERENT id here, at any point after
    // the first reveal, is exactly the same "content changed under a
    // control that then vanishes" shape the original F7 bug was: the
    // waiting-list button that triggered it (WaitingList, above)
    // unmounts the instant its entry stops being `waiting`, so without this,
    // focus would fall back to <body> for every confirm AFTER the first one.
    // Gated on `announceHiddenReadiness` (live mode's own marker, see that
    // prop's doc) so practice mode — whose `current` legitimately changes
    // automatically, with no click behind it — never has this fire.
    const swappedAfterActivation =
      announceHiddenReadiness &&
      hasEverRevealedRef.current &&
      !revealedJustNow &&
      currentId !== prevCurrentId &&
      currentId !== null;

    if (revealedJustNow || swappedAfterActivation) {
      revealedRef.current?.focus();
    }
  }, [answerHidden, onReveal, current?.id, announceHiddenReadiness]);

  return (
    <RealPanel title={copy.currentAnswerTitle}>
      {/* F9: persistently mounted regardless of status (never nested inside
          a conditionally-rendered branch) so only its TEXT changes as a
          draft moves loading -> done — see answerStatusMessage's doc for why
          a region that mounts already carrying its final text is not
          announced by NVDA/JAWS.
          R-110/AC-J2.3: while `answerHidden` is true AND `announceHiddenReadiness`
          is false (practice mode, the default), the status is forced to
          "idle" so this region stays silent — the panel must not announce
          the drafted answer's readiness or shape (e.g. "Answer ready, 4
          points") before the user has asked to see it, which would leak
          exactly the thing practice mode's reveal gate exists to withhold.
          Nothing is lost there: the F7 focus move above already lands focus
          on the revealed container the moment the user presses reveal, which
          is what announces the content at that point.
          AC-N18.13, THE DELIBERATE DIVERGENCE: live mode passes
          `announceHiddenReadiness`, which keeps this SAME region live while
          hidden — see `announceHiddenReadiness`'s own doc above the
          component for why: the N18 confirm gate withholds the answer
          precisely so the candidate can be told it is ready before they
          click to see it (N18 delta review D9: reworded off "hold", which a
          sweep now treats as the retired voice cue's own name, not this
          gate's), the opposite of what practice mode's drill needs. Do not
          "fix" this back to unconditional silence; that would re-import
          R-110's reasoning into a caller it was never meant to govern.
          BUG-2: text comes from useCurrentQuestionAnnouncement above, not a
          bare answerStatusMessage(...) call — see that hook's doc for why a
          swap between two already-`done` entries needs more than the status
          string alone to be announced correctly. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {currentAnswerRegionText}
      </Box>
      {!current ? (
        // WCAG 1.4.3: `var(--text-secondary)` (6.67:1), never
        // `var(--text-muted)` (3.90:1) — this is normal body2 text on the
        // same `--bg-soft` RealPanel fill the caption comment below already
        // measures this against; `--text-muted` fails 4.5:1 there (see
        // app/copilot/dashboard/CopilotDashboard.contrast.test.js).
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          {copy.noCurrentAnswer}
        </Typography>
      ) : answerHidden ? (
        // N18 delta review F6: m10 changed this to `onReveal(current.id)`,
        // claiming to fix a click racing a re-render that changed which
        // entry is current. It cannot: this button (and the identical
        // `current` value it closes over) is only ever attached fresh by the
        // SAME render that produced `current`, and CopilotClient.js's own
        // `onRevealAnswer` closure is rebuilt from that identical render's
        // `confirmedCurrent` at the same time — there is no commit at which
        // the two could name different entries for React to attach a stale
        // handler over. No fixture in this suite (or a plausible one) can
        // tell `onReveal(current.id)` apart from `onReveal()`, which is what
        // m10 replaced; reverted rather than left claiming a fix it never
        // was.
        <Button size="small" variant="outlined" onClick={() => onReveal()} sx={TOUCH_TARGET_SX}>
          {revealLabel}
        </Button>
      ) : (
        // F7: the single revealed-content container focus moves into on
        // reveal — see the effect above. `tabIndex={-1}` makes it
        // programmatically focusable without adding a tab stop. Wrapping
        // every post-reveal status branch (not only `done`) means focus
        // also lands here — and a screen reader starts reading from here —
        // when the reveal click kicks off a fresh draft that is still
        // `loading`, not only on a cache hit that is already `done`.
        <Box ref={revealedRef} tabIndex={-1}>
          {/* Contract 8: renders nothing at all — not an empty wrapper —
              when `current.at` is not older than `staleTypeChangeAt`, which
              is every render for every caller that leaves the prop at its
              default. `var(--text-secondary)` (6.67:1), never
              `var(--text-muted)` (3.90:1) — a 0.75rem caption fails contrast
              at the muted color (AnswerLines.js:70-78). */}
          {current.at < staleTypeChangeAt ? (
            <Typography variant="caption" sx={{ display: "block", color: "var(--text-secondary)", mb: 0.75 }}>
              Drafted before the interview type changed.
            </Typography>
          ) : null}
          {current.status === "loading" ? (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <CircularProgress size={16} sx={{ flexShrink: 0 }} />
              {/* WCAG 1.4.3: --text-secondary, not --text-muted — see the
                  `!current` branch above for the measured ratios. */}
              <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
                Drafting…
              </Typography>
            </Stack>
          ) : current.status === "error" ? (
            // F11: matches the sibling error path in SampleAnswer.js —
            // role="alert" plus a non-color icon, rather than a plain
            // colored Typography (WCAG 1.4.1).
            <Alert severity="error">{current.error || "Could not draft an answer."}</Alert>
          ) : current.status === "done" && lines.length ? (
            <>
              <AnswerLines lines={lines} />
              {/* AC-K1.2/AC-K1.3: the same subsections the question card
                  shows, in the panel a candidate is actually looking at
                  mid-interview — including the ideal-project benchmark.
                  Renders nothing at all when the draft carries none of them
                  (no posting selected, no submitted resume). Reading these
                  aloud too — via the same focus move, without any separate
                  wiring — is F9's free coverage for this panel. */}
              <AnswerAids buzzwords={current.buzzwords} anchor={current.anchor} idealProject={current.idealProject} />
            </>
          ) : (
            // WCAG 1.4.3: --text-secondary, not --text-muted — see the
            // `!current` branch above for the measured ratios.
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              {copy.noPoints}
            </Typography>
          )}
          {/* M7: one click, no confirmation dialog — undoing is itself the
              safe, reversible action (the entry falls back to `waiting`, or
              to the seed's own hidden-behind-reveal state; nothing is
              deleted). Rendered only when a caller actually has the confirm
              gate's `unconfirmQuestion` to call (live mode); practice mode
              never passes `onUnconfirm` and never renders this. */}
          {onUnconfirm ? (
            <Button
              size="small"
              variant="text"
              onClick={() => onUnconfirm(current.id)}
              sx={{ mt: 1, textTransform: "none", color: "var(--text-secondary)", ...TOUCH_TARGET_SX }}
            >
              Not the interviewer — undo
            </Button>
          ) : null}
        </Box>
      )}
    </RealPanel>
  );
}

// AC-I2.14: `measured: false` is not "0 wpm" (or "0% filler") — it must read
// as "not measured", never as a real (if unflattering) reading. Rendered as
// plain muted text rather than a colored chip in that case, so an unmeasured
// signal never even LOOKS like the same kind of thing as a measured one.
// This now covers TWO independent signals — talking speed (`pace`) and
// verbal-filler rate (`fillers`) — each gated on its OWN `measured` flag,
// because they have different measurability rules (filler detection needs
// enough transcribed words to count against; pace needs enough elapsed
// time). One being unmeasured must never hide or block the other.
//
// Renamed from PacePanel: it used to hold one reading, now it holds two, so
// "pace" stopped being an accurate name for what the whole strip shows.
function ReadingSlot({ label, valueText, measuredCopy }) {
  return valueText ? (
    // Without flexWrap, "125 words/min" + "Conversational" needed ~191px
    // against ~182px available at 320px wide, so "words/min" broke
    // mid-phrase instead of the whole label dropping to its own line.
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", flexWrap: "wrap", rowGap: 0.25 }}>
      <Typography sx={{ color: "var(--text-primary)", fontWeight: 600 }}>{valueText}</Typography>
      {label}
    </Stack>
  ) : (
    // Same slot, same position, just muted text instead of a number+label —
    // this is what keeps the strip's height and layout fixed as a reading
    // arrives mid-answer (no reflow when speed or filler rate flips from
    // unmeasured to measured).
    // WCAG 1.4.3: --text-secondary, not --text-muted — this renders on
    // DeliveryPanel's own `--bg-soft` fill below, where --text-muted fails
    // 4.5:1 (see app/copilot/dashboard/CopilotDashboard.contrast.test.js).
    <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
      {measuredCopy}
    </Typography>
  );
}

function DeliveryPanel({ pace, fillers, copy }) {
  const paceMeasured = !!pace?.measured;
  const fillerMeasured = !!fillers?.measured;
  return (
    <Box
      sx={{
        // Shorter than the old PacePanel on purpose (AC: cut half-window
        // scrolling) — less padding, and the title moves onto the readings'
        // own row below instead of sitting above them on its own line.
        p: 1.25,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-soft)",
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: "baseline",
          // Wrap only when the strip genuinely cannot hold all three items
          // (title + two readings) on one line — this is the compact strip
          // the half-window dual-screen case needs, not a panel that
          // reserves its own row for the title.
          flexWrap: "wrap",
          rowGap: 0.5,
        }}
      >
        {/* F10: same nesting level as the panel titles above — a
            sibling section under the dashboard's own h3 title. Heading
            LEVEL is unchanged by this rewrite (R-125) even though the
            title moved onto the readings' row. */}
        <Typography variant="subtitle2" component="h4" sx={{ color: "var(--text-secondary)", fontWeight: 700 }}>
          {copy.deliveryTitle}
        </Typography>
        <ReadingSlot
          label={
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, color: PACE_LABEL_COLOR[pace?.paceLabel] || "var(--text-secondary)" }}
            >
              {PACE_LABEL_TEXT[pace?.paceLabel] || pace?.paceLabel}
            </Typography>
          }
          valueText={paceMeasured ? `${Math.round(pace.wordsPerMinute)} words/min` : null}
          measuredCopy="speed: not measured yet"
        />
        <ReadingSlot
          label={
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, color: FILLER_LABEL_COLOR[fillers?.fillerLabel] || "var(--text-secondary)" }}
            >
              {FILLER_LABEL_TEXT[fillers?.fillerLabel] || fillers?.fillerLabel}
            </Typography>
          }
          valueText={fillerMeasured ? `${fillers.fillerRate.toFixed(1)}% filler` : null}
          measuredCopy="filler: not measured yet"
        />
      </Stack>
    </Box>
  );
}

// AC-N18.4: the "asks before displaying" surface for every question besides
// whichever one is `current` right now. M4 (fresh delta review): this used
// to say the seed never appears here at all — false; questionConfirm.js's
// own `firstUnconfirmedView` puts every OTHER unconfirmed, non-provisional
// entry into `waiting` from the moment it is detected, seed or not (AC-N18.1's
// F2 fix), so a second or third question arriving before the very first
// confirm is exactly as reachable through this list as one detected after.
// The genuine exception is the FIRST question itself: it IS `current`, so it
// goes straight to CurrentAnswerPanel's own reveal gate instead of appearing
// here (currentIsSeed, above).
//
// Renders question TEXT, not a count — questionPin.js:22-24 (AC-N18.4's own
// citation): "a passive on-screen badge does not fix this, because someone
// mid-answer is reading bullets, not counting badges." A candidate mid-answer
// needs to know WHICH later question is waiting to decide whether it is
// worth jumping to out of order (AC-N18.5) — a bare count answers a
// different question than the one they're actually asking.
//
// Mounted here, inside CopilotDashboard's own always-visible column
// (CopilotClient.js's box around this component has no disclosure gating
// it), never inside TranscriptDisclosure.js's <Collapse>, which stays closed
// by default for every live session (CopilotClient.js's own comment on that
// disclosure). Confirming from a control buried behind a second click would
// contradict AC-N18.4's own "still one click" requirement the moment a
// session actually starts.
//
// m9: `onConfirmNext` wires useLiveSession's confirmNext — previously
// computed and returned, unconsumed by any caller. This list's own primary
// action is its natural home: "Show next" confirms the OLDEST waiting entry
// (the order the interviewer actually asked them in —
// lib/copilot/questionConfirm.js's nextConfirmTarget) with one click, for a
// candidate who wants to advance without reading every question's own text
// first. `onConfirmNext` is optional so a caller that predates m9 (there are
// none left, but the pattern matches every other prop here) renders
// byte-identically without it.
//
// M3 (fresh delta review): this used to also take a `waitingCount` prop,
// documented as load-bearing alongside `onConfirmNext` — but it never could
// differ from `items.length`: resolveConfirmedView returns both `waiting`
// and `waitingCount` from the exact same computation, and every caller
// (CopilotClient.js) passed both straight through. A mutant that made this
// component ignore the prop entirely changed nothing observable. Removed
// rather than kept as a no-op parameter — see useQuestionConfirm.js's own
// return shape and CopilotClient.js's call site, both trimmed the same way.
function WaitingList({ items, onConfirm, onConfirmNext }) {
  if (!items.length) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", ...WRAP_ROW_SX }}>
        <Typography
          variant="subtitle2"
          component="h4"
          sx={{ flex: 1, minWidth: 0, color: "var(--text-secondary)", fontWeight: 700 }}
        >
          Waiting to show ({items.length})
        </Typography>
        {onConfirmNext ? (
          <Button size="small" variant="text" onClick={onConfirmNext} sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}>
            Show next
          </Button>
        ) : null}
      </Stack>
      <Stack spacing={1}>
        {items.map((entry) => {
          // Same decision, same place as CurrentAnswerPanel's own reveal
          // label (lib/copilot/confirmReveal.js) — see that module's doc.
          const stateLabel = confirmRevealLabel(entry.status);
          return (
            <Button
              key={entry.id}
              variant="outlined"
              onClick={() => onConfirm(entry)}
              startIcon={entry.status === "loading" ? <CircularProgress size={14} color="inherit" /> : null}
              // D10-style: the visible content IS the question's own text
              // (AC-N18.4), and the accessible name adds the verb ahead of
              // it, the same "{action}: {question}" composition QuestionFeed
              // already uses for its own per-card button.
              aria-label={`${stateLabel}: ${entry.question}`}
              sx={{
                justifyContent: "flex-start",
                textAlign: "left",
                textTransform: "none",
                ...TOUCH_TARGET_SX,
              }}
            >
              <Typography component="span" sx={{ color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
                {entry.question}
              </Typography>
            </Button>
          );
        })}
      </Stack>
    </Box>
  );
}

// AC-N18.7/N18.8: one past question+answer, collapsed by default. Renders a
// HEADER ROW ONLY until expanded — question text, a timestamp, and a status
// dot — never mounting AnswerLines/AnswerAids until the candidate actually
// asks for them. `answerLines(...)` runs unmemoized on every render
// (CopilotClient.js's own comment on that cost) and every streamed points
// frame re-renders whichever entry is still drafting, so a collapsed item
// that called it anyway would pay that cost for content nobody can see.
// Expanding never mounts a live region of its own (F-F8): the answer text
// underneath is already final by the time it can be expanded (this entry is,
// by construction, no longer `current`), so there is nothing here for an
// aria-live region to announce that the click itself doesn't already convey.
function HistoryItem({ entry, copy }) {
  const [expanded, setExpanded] = useState(false);
  // Computed ONLY when expanded — see this function's own doc above for why
  // a collapsed item must not pay this cost at all.
  const lines = expanded ? answerLines(entry.cues, entry.points, entry.pageSources) : [];
  // CopilotDashboard.contrast.test.js bans --text-muted file-wide (it fails
  // 4.5:1 on this file's --bg-soft panels) — --text-secondary is this file's
  // own established stand-in, used here too even though this dot is
  // decorative rather than text, so the whole file stays on one palette.
  const statusColor =
    entry.status === "done" ? "var(--success)" : entry.status === "error" ? "var(--danger)" : "var(--text-secondary)";
  return (
    <Box sx={{ borderRadius: 2, border: "1px solid var(--border)", background: "var(--bg-soft)", overflow: "hidden" }}>
      <Button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        variant="text"
        sx={{
          width: 1,
          p: 1.25,
          justifyContent: "flex-start",
          textAlign: "left",
          textTransform: "none",
          borderRadius: 0,
          ...TOUCH_TARGET_SX,
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: 1 }}>
          <Box component="span" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </Box>
          <Typography
            component="span"
            sx={{ flex: 1, minWidth: 0, color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}
          >
            {entry.question}
          </Typography>
          {Number.isFinite(entry.at) ? (
            <Typography component="span" variant="caption" sx={{ color: "var(--text-secondary)", flexShrink: 0 }}>
              {new Date(entry.at).toLocaleTimeString()}
            </Typography>
          ) : null}
          <Box
            aria-hidden="true"
            sx={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, flexShrink: 0 }}
          />
        </Stack>
      </Button>
      {expanded ? (
        <Box sx={{ px: 1.25, pb: 1.25 }}>
          {lines.length ? (
            <>
              <AnswerLines lines={lines} />
              <AnswerAids buzzwords={entry.buzzwords} anchor={entry.anchor} idealProject={entry.idealProject} />
            </>
          ) : (
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              {copy.noPoints}
            </Typography>
          )}
        </Box>
      ) : null}
    </Box>
  );
}

function HistoryList({ items, copy }) {
  if (!items.length) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1, color: "var(--text-secondary)", fontWeight: 700 }}>
        Previous questions
      </Typography>
      <Stack spacing={1}>
        {items.map((entry) => (
          <HistoryItem key={entry.id} entry={entry} copy={copy} />
        ))}
      </Stack>
    </Box>
  );
}

export default function CopilotDashboard({
  questions,
  // AC-T1.18: `pinnedId` degrades to latestQuestionEntry(questions) inside
  // pinnedQuestionEntry when it is `null`/`undefined` — practice mode passes
  // none of it, which is what keeps it byte-identical to before the pin
  // existed. ARCH-sticky §3.6: `held`/`newerQuestionCount`/`onReleasePin`/
  // `live` used to live here too, defaulted for the now-removed
  // CurrentQuestionPanel call below — they are StickyQuestionStrip.js's own
  // props now (its own defaults match what this file used to default), so
  // this component no longer reads any of the pin/hold surface beyond the id
  // itself.
  pinnedId,
  // AC-N18.14: the confirm gate's already-resolved `current` — computed ONCE
  // in useQuestionConfirm.js (via useLiveSession.js/CopilotClient.js) and
  // handed straight through. `undefined` (practice mode, and every existing
  // test) falls through to the pinnedQuestionEntry derivation below, so this
  // is purely additive — this component never calls resolveConfirmedView
  // itself, the exact defect BUG-3/R-121 already taught this codebase not to
  // repeat for a "what's current" decision.
  current: currentOverride,
  // Whether `current` above is still the unconfirmed seed (AC-N18.1). `false`
  // by default so a caller that never confirms anything (practice mode)
  // never hides its answer for this reason. N18 delta review F5: this is
  // `answerHidden`'s own default below, not a second, independent gate — a
  // caller that passes ONLY this prop still gets CurrentAnswerPanel's reveal
  // gate; one that also passes `answerHidden` explicitly (as CopilotClient.js
  // does today) overrides it as usual.
  currentIsSeed = false,
  // AC-N18.7/N18.8: confirmed entries older than `current`, newest first,
  // rendered as a collapsed-by-default list directly under the answer panel
  // — see HistoryList below. Empty for every caller that doesn't pass it.
  history = [],
  // AC-N18.4: detected, not-yet-confirmed entries, each rendered as its own
  // button showing its OWN question text — see WaitingList below.
  waiting = [],
  // AC-N18.5/N18.9: the one handler behind every button both lists render —
  // see CopilotClient.js's onConfirmQuestion for what it does (confirm, plus
  // a draft for an `idle` entry).
  onConfirmQuestion,
  // m9: wires useLiveSession's confirmNext into WaitingList's own primary
  // action — see that function's own doc. Undefined for every caller that
  // predates m9 (practice mode included), which is what keeps WaitingList's
  // own default (no "Show next" button) byte-identical for them.
  onConfirmNext,
  pace,
  // Verbal-filler reading beside pace in DeliveryPanel — see the contract
  // atop FILLER_LABEL_TEXT/COLOR above. May be `undefined` from a caller
  // that has not been wired up to computeLiveFillers yet; DeliveryPanel
  // reads it defensively and renders the unmeasured phrase in that case,
  // same as it already does for a missing `pace`.
  fillers,
  // AC-J2.2: merged OVER live mode's strings rather than replacing them, so
  // a caller supplying a partial set still gets a complete one and a string
  // added here later can never leave a mode rendering `undefined`.
  copy,
  // AC-J2.3: practice mode's reveal gate — see CurrentAnswerPanel above.
  // Defaults to `currentIsSeed` (N18 delta review F5), not a bare `false`,
  // so the AC-N18.1 seed gate is what actually drives it for a caller that
  // passes ONLY `currentIsSeed` — see that prop's own comment above.
  // CopilotClient.js relies on this default rather than passing the two
  // redundantly; a caller that DOES pass `answerHidden` explicitly (practice
  // mode's own reveal-toggle wiring) still overrides it as usual.
  answerHidden = currentIsSeed,
  onRevealAnswer,
  revealLabel = "Show sample answer",
  // M7: see CurrentAnswerPanel's own doc above — passed straight through,
  // undefined for every caller that predates it.
  onUnconfirm,
  // AC-N18.13: see CurrentAnswerPanel's own doc for the R-110 divergence
  // this drives. `false` by default — practice mode's existing silence is
  // untouched unless a caller opts in.
  announceHiddenReadiness = false,
  // Contract 8: see CurrentAnswerPanel's own doc above. Defaulted to `0` —
  // no caller today passes a negative `current.at`, so this never trips
  // unless CopilotClient deliberately sets it, which is what keeps every
  // existing caller (practice mode included) byte-identical.
  staleTypeChangeAt = 0,
}) {
  // AC-N18.14: `currentOverride` (undefined for every caller that predates
  // N18) is checked explicitly against `undefined`, not merely truthiness —
  // `null` is a legitimate "nothing confirmed and nothing detected yet"
  // value the confirm gate can hand through, and must not fall back to the
  // pin-based derivation just because it is falsy.
  const current = currentOverride !== undefined ? currentOverride : pinnedQuestionEntry(questions, pinnedId);
  const text = dashboardCopy(copy);

  return (
    <Box
      sx={{
        p: { xs: 1.25, sm: 2 },
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      {/* F10: the dashboard's own section title, one level under the tab's
          h2 (TabHeader.js) — see RealPanel/DeliveryPanel above for the panel
          titles nested another level under this one. */}
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" component="h3" sx={{ color: "var(--text-secondary)", fontWeight: 700 }}>
          {text.title}
        </Typography>
      </Box>

      <Box
        sx={{
          display: "grid",
          // ARCH-sticky §3.2: this used to be `{ xs: "1fr", sm: "1fr 1fr" }`
          // so the question and answer panels sat side by side from `sm`
          // up — a half-width window on a common 1440-wide dual-screen setup
          // is ~720px, comfortably past `sm`, which is why this was `sm` and
          // not `md` (do not "tidy" it back: the half-window case was the
          // point, not an oversight). With the question panel relocated to
          // the sticky strip, this grid has exactly one child left —
          // CurrentAnswerPanel — so a second track would sit empty and just
          // hold the answer at half width for no reason. One column, always.
          gridTemplateColumns: "1fr",
          gap: 1.5,
        }}
      >
        <CurrentAnswerPanel
          current={current}
          copy={text}
          answerHidden={answerHidden}
          onReveal={onRevealAnswer}
          revealLabel={revealLabel}
          announceHiddenReadiness={announceHiddenReadiness}
          staleTypeChangeAt={staleTypeChangeAt}
          onUnconfirm={onUnconfirm}
        />
      </Box>

      {/* AC-N18.4: directly under the answer panel — not inside
          TranscriptDisclosure's collapsed-by-default region (see
          WaitingList's own doc for why that would make a single-click
          confirm a two-click one during a live session). Renders nothing
          when `waiting` is empty, which is every render for every caller
          that doesn't pass it. */}
      <WaitingList items={waiting} onConfirm={onConfirmQuestion} onConfirmNext={onConfirmNext} />

      {/* AC-N18.7/N18.8: same placement reasoning as WaitingList above — the
          re-openable list of everything already shown and confirmed past.
          Renders nothing when `history` is empty. */}
      <HistoryList items={history} copy={text} />

      <Box sx={{ mt: 1.5 }}>
        <DeliveryPanel pace={pace} fillers={fillers} copy={text} />
      </Box>
    </Box>
  );
}
