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
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

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
function CurrentAnswerPanel({ current, copy, answerHidden, onReveal, revealLabel, staleTypeChangeAt = 0 }) {
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
    status: answerHidden ? "idle" : current?.status,
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
  useEffect(() => {
    const prevAnswerHidden = prevAnswerHiddenRef.current;
    prevAnswerHiddenRef.current = answerHidden;
    // R-110/R-122: three separate protections here, each doing a different
    // job — worth naming precisely rather than crediting one with work
    // another one does:
    //   1. `prevAnswerHiddenRef` seeds to the CURRENT `answerHidden` on
    //      mount (see the ref's own declaration above), so this effect can
    //      never see a transition on its first run. That is what stops a
    //      mount-time false-positive focus steal, in every mode.
    //   2. Live mode passes neither `answerHidden` nor `onRevealAnswer`, so
    //      this component's defaults hold `answerHidden={false}` for the
    //      component's ENTIRE life — there is no `true -> false` edge to
    //      detect in the first place, ever. That absence of any transition
    //      is what excludes live mode, independent of the `onReveal` guard
    //      below: the condition on the next line is unreachable there
    //      regardless of whether that guard exists.
    //   3. The `onReveal` guard is defence-in-depth for a caller this
    //      component does not have today: one that passes `answerHidden`
    //      (making the edge reachable) without also passing
    //      `onRevealAnswer`. It protects nothing in live mode currently,
    //      since live mode never reaches a state where the edge could fire.
    if (prevAnswerHidden === true && answerHidden === false && typeof onReveal === "function") {
      revealedRef.current?.focus();
    }
  }, [answerHidden, onReveal]);

  return (
    <RealPanel title={copy.currentAnswerTitle}>
      {/* F9: persistently mounted regardless of status (never nested inside
          a conditionally-rendered branch) so only its TEXT changes as a
          draft moves loading -> done — see answerStatusMessage's doc for why
          a region that mounts already carrying its final text is not
          announced by NVDA/JAWS.
          R-110/AC-J2.3: while `answerHidden` is true the status is forced to
          "idle" so this region stays silent — the panel must not announce
          the drafted answer's readiness or shape (e.g. "Answer ready, 4
          points") before the user has asked to see it, which would leak
          exactly the thing practice mode's reveal gate exists to withhold.
          Nothing is lost: the F7 focus move above already lands focus on the
          revealed container the moment the user presses reveal, which is
          what announces the content at that point.
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
        <Button size="small" variant="outlined" onClick={onReveal} sx={TOUCH_TARGET_SX}>
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
  answerHidden = false,
  onRevealAnswer,
  revealLabel = "Show sample answer",
  // Contract 8: see CurrentAnswerPanel's own doc above. Defaulted to `0` —
  // no caller today passes a negative `current.at`, so this never trips
  // unless CopilotClient deliberately sets it, which is what keeps every
  // existing caller (practice mode included) byte-identical.
  staleTypeChangeAt = 0,
}) {
  const current = pinnedQuestionEntry(questions, pinnedId);
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
          staleTypeChangeAt={staleTypeChangeAt}
        />
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <DeliveryPanel pace={pace} fillers={fillers} copy={text} />
      </Box>
    </Box>
  );
}
