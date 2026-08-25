"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { answerLines } from "@/lib/copilot/answerPoints";
import { answerStatusMessage, visuallyHidden } from "@/lib/copilot/answerStatus";
import { pinnedQuestionEntry } from "@/lib/copilot/currentQuestion";
import AnswerAids from "../AnswerAids";
import AnswerLines from "../AnswerLines";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "../mobileSx";

// AC-I5/AC-J2: the copilot's dashboard — current question, its answer, and a
// delivery strip covering the user's current talking pace AND verbal-filler
// rate. Purely presentational (AC-I5.31):
// every value arrives as a prop, same contract as
// SampleAnswer.js/SubmittedDocs.js — this owns no fetching and no state
// beyond the trivial "is a panel expanded" kind SubmittedDocs already uses
// elsewhere, and here not even that. It does not replace QuestionFeed
// (AC-I5.30) — the caller renders both; this is a glanceable summary,
// QuestionFeed is the full history with its own redraft actions.
//
// `questions` is the SAME array CopilotClient already holds and passes to
// useCopilotDashboard — panels 1/2 re-derive "the current question" from it
// directly (AC-I5.28) rather than through any prop this component invents,
// so there is exactly one place that array is read as "what's the latest
// question" (here) instead of two copies that could disagree. Practice mode
// has no such array; it synthesizes a one-entry list in the same shape (see
// PracticeClient.js), which is what lets both modes share this component
// rather than fork it.
//
// AC-J2.1: BOTH modes render this. The layout, the panel treatments and
// every state (loading, error, empty, measured/unmeasured) are shared
// verbatim — the whole point of practice mode having a dashboard is
// rehearsing against the instrument the candidate will be reading during
// the real interview, so a divergence here defeats the feature. Only the
// WORDS differ, via the `copy` prop below, and only where a live-mode
// sentence would be untrue in practice mode ("the interviewer has not
// asked this" when there is no interviewer).
const PACE_LABEL_TEXT = { slow: "Slow", conversational: "Conversational", rushed: "Rushed" };
const PACE_LABEL_COLOR = {
  slow: "var(--warning)",
  conversational: "var(--success)",
  rushed: "var(--warning)",
};
// Filler-rate reading beside pace, same shape as PACE_LABEL_TEXT/COLOR above
// so the two readings in DeliveryPanel (below) are visually one family of
// thing rather than two differently-designed widgets bolted together.
// `noticeable` and `heavy` deliberately share a color with each other (and
// with pace's `slow`/`rushed`) — the LABEL TEXT is what tells them apart,
// never color alone (WCAG 1.4.1), same reasoning as PACE_LABEL_COLOR.
const FILLER_LABEL_TEXT = { clean: "Clean", noticeable: "Some filler", heavy: "Heavy filler" };
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

// AC-J2.2: live mode's wording, verbatim — every string this component
// rendered before practice mode shared it. It is the DEFAULT for the `copy`
// prop, so live mode passes nothing and its output is unchanged; the same
// "defaults are the incumbent mode's exact strings" discipline
// PostingPicker.js's `label`/`blankHint` already use. Keeping both modes'
// wording in one place, side by side, is also what makes a drift between
// them visible in review rather than spread across two components.
export const LIVE_COPY = {
  title: "Live dashboard",
  currentQuestionTitle: "Current question",
  noQuestion: "No question has been detected yet this session.",
  currentAnswerTitle: "Answer to the current question",
  noCurrentAnswer: "There is no current question to answer yet.",
  noPoints: "No talking points have been drafted for this question yet.",
  // Covers both readings in the strip below (speed and filler rate), not
  // speed alone any more — see DeliveryPanel.
  deliveryTitle: "Your delivery",
};

// AC-J2.2: practice mode's wording. Deliberately the SAME sentences
// wherever a live-mode sentence is still true with no interviewer in the
// room — the differences below are all places where live's wording would
// be a false statement here, not places where practice was given a
// different voice for its own sake.
export const PRACTICE_COPY = {
  ...LIVE_COPY,
  title: "Practice dashboard",
  noQuestion: "No question yet — press Start practice to get your first one.",
  // R-109: `noCurrentAnswer` is deliberately NOT overridden. Live's wording
  // turns on the word "current", which is perfectly true in practice mode —
  // there IS a current question — so paraphrasing it to "on screen" was
  // divergence for its own sake, and it made this mode contradict itself:
  // the panel titles below still say "Current question" and "Answer to the
  // current question", so the body text would have called the same thing by
  // a different name three lines under its own heading. The bar for an
  // override here is that live's sentence would be FALSE with no
  // interviewer in the room, not that a different phrasing reads slightly
  // better.
  noPoints: "No sample answer has been drafted for this question yet.",
};

// The two "real" panels' shared card look — a plain surface, same as
// QuestionFeed's own question cards. Deliberately distinct from
// AccentPanel's look below: a user glancing at this mid-interview must
// never mistake one for the other (AC-I3.20).
function RealPanel({ title, children }) {
  return (
    <Box
      sx={{
        p: { xs: 1.25, sm: 1.75 },
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-soft)",
        minWidth: 0,
      }}
    >
      {/* F10: nested one level under the dashboard's own h3 title below —
          `variant="subtitle2"` alone maps (via MUI's defaultVariantMapping)
          to `h6`, which skipped straight from the tab's h2 with h3/h4/h5
          never appearing. `component=` changes only the rendered element;
          `variant` (and therefore the look) is unchanged. */}
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1, color: "var(--text-secondary)", fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

// The shared card look for content the app is NOT certain about — an
// accent-tinted surface plus an explicit chip, so it can never be read as
// something the interviewer actually said or something already confirmed
// for real (AC-I3.20). Deliberately distinct from RealPanel above.
//
// BUG-1: `chipLabel` is required — its only caller is
// CurrentQuestionPanel's provisional branch below, passing
// `chipLabel="Unconfirmed"`, which names the SPECIFIC uncertainty (a real
// detected utterance of unclear speaker) rather than a generic label.
// Reusing one wrapper (not copying it) is what keeps the accent-plus-chip
// look itself in exactly one place.
function AccentPanel({ title, children, chipLabel }) {
  return (
    <Box
      sx={{
        p: { xs: 1.25, sm: 1.75 },
        borderRadius: 2,
        border: "1px solid var(--accent)",
        background: "var(--accent-soft)",
        minWidth: 0,
      }}
    >
      {/* BLOCKER fix: this row previously had no flexWrap, and the Chip had
          no flexShrink guard. MUI's Chip root carries `overflow: hidden`,
          which zeroes its flex `min-width: auto` floor, so at ~140px of
          available width (well under the row's natural ~262px) the Chip
          shrank first and its label ellipsized down to nothing readable
          ("PREDI…" or narrower). This badge is load-bearing (see
          CurrentQuestionPanel's "Unconfirmed" reuse below) — it is what
          stops uncertain content from being read as something confirmed —
          so it must never truncate. WRAP_ROW_SX lets the badge drop to its
          own line intact instead. */}
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", ...WRAP_ROW_SX }}>
        {/* F10: same nesting level as RealPanel's title above — both sit
            directly under the dashboard's own h3 title. */}
        <Typography variant="subtitle2" component="h4" sx={{ color: "var(--text-secondary)", fontWeight: 700 }}>
          {title}
        </Typography>
        <Chip
          size="small"
          label={chipLabel}
          sx={{
            // `height: 18`/`fontSize: 10` unconditionally left no room for
            // the label to wrap onto two lines even after the Stack above
            // gained flexWrap, and 10px uppercase text is below a readable
            // floor on a phone. `xs: "auto"` lets the label wrap; `sm` keeps
            // the original compact pill on pointer-driven layouts.
            height: { xs: "auto", sm: 18 },
            fontSize: { xs: 11, sm: 10 },
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            color: "var(--accent-contrast)",
            background: "var(--accent)",
            // Keeps the badge itself from being the thing that shrinks when
            // the row is tight — see the Stack comment above.
            flexShrink: 0,
            "& .MuiChip-label": { py: { xs: 0.25, sm: 0 } },
          }}
        />
      </Stack>
      {children}
    </Box>
  );
}

// AC-T1.16/I6: the held treatment for the current-question panel. Reuses
// AccentPanel's wrapper/Chip mechanics (WRAP_ROW_SX avoids the "PREDI…"
// ellipsis bug) but with the WARNING accent — `--warning-soft` on
// `--bg-surface` measures only 1.08:1, so the border, badge and release
// control are ALL required, never colour alone (AC-X2). The release button
// is the count-bearing element, one click, uncapped (OpenShift/Mastodon/
// Guardian all ship this pattern); its caption says what is STILL
// happening, so a frozen display doesn't read as broken.
function HeldQuestionPanel({ title, newerCount, onRelease, live, children }) {
  const releaseLabel =
    newerCount > 0
      ? `Release hold and show ${newerCount} newer question${newerCount === 1 ? "" : "s"}`
      : "Release hold";
  return (
    <Box
      sx={{ p: { xs: 1.25, sm: 1.75 }, borderRadius: 2, border: "1px solid var(--warning)", background: "var(--warning-soft)", minWidth: 0 }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", ...WRAP_ROW_SX }}>
        <Typography variant="subtitle2" component="h4" sx={{ flex: 1, minWidth: 0, color: "var(--text-secondary)", fontWeight: 700 }}>
          {title}
        </Typography>
        <Chip
          size="small"
          label="Held on screen"
          sx={{
            height: { xs: "auto", sm: 18 },
            fontSize: { xs: 11, sm: 10 },
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            color: "var(--warning)",
            background: "transparent",
            border: "1px solid var(--warning)",
            flexShrink: 0,
            "& .MuiChip-label": { py: { xs: 0.25, sm: 0 } },
          }}
        />
      </Stack>
      {children}
      <Button
        size="small"
        variant="outlined"
        onClick={onRelease}
        sx={{ mt: 1, textTransform: "none", borderColor: "var(--warning)", color: "var(--warning)", ...TOUCH_TARGET_SX }}
      >
        {releaseLabel}
      </Button>
      {/* Defect 3 fix: was unconditional — a false "is it broken?" claim
          once the session had actually ended (see useLiveSession.js's own
          defect-3 fix for how a hold used to outlive its session).
          Belt-and-suspenders: that fix already keeps `held` from being true
          while `!live`. Adds a live/not-live axis without collapsing the
          existing three states: not held, held, held-with-N-newer. */}
      <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "var(--text-secondary)" }}>
        {live
          ? "Detection and drafting keep running behind the hold; only this panel's display is frozen."
          : "This session has ended, so nothing is running behind this hold anymore — release it to see the dashboard's normal idle state."}
      </Typography>
    </Box>
  );
}

// BUG-1: `current` can be the array's true LAST entry even though it is
// `provisional` — latestQuestionEntry's fallback for "every entry is
// provisional" above. Before this branch existed, that fallback rendered
// through RealPanel — the plain treatment, no chip, no accent, no caveat —
// under the same "Current question" heading a confirmed entry gets. By
// construction a provisional entry is one the app CURRENTLY attributes to
// the candidate's own voice (see the AC-M1.3.5 doc above), so that plain
// treatment presented the candidate's own speech as the interviewer's
// question with nothing to tell them apart. This is not a rare edge case:
// at cold start the interviewer speaks first and becomes the provisional
// argmax on word count alone, so their genuine opening question is
// routinely the one flagged provisional — which is exactly why the
// fallback must keep rendering (never nothing) and instead be marked.
//
// R-106's bar is why this is BOTH the accent/chip treatment AND a sentence,
// not one or the other: visual distinction alone is insufficient (a user
// glancing mid-interview, or anyone who can't rely on color/border), text
// alone is insufficient (a user skimming past the caption to the bold
// question line). Reuses AccentPanel rather than a new component so the
// "uncertain content" look stays defined in one place; "Unconfirmed" names
// this uncertainty specifically because this IS a real detected utterance,
// just of unclear speaker — the opposite uncertainty a guess about the
// future would be.
//
// Practice mode never sets `provisional` (see latestQuestionEntry's own
// doc), so `current?.provisional` is always falsy there and this branch
// never runs — practice always takes the plain `RealPanel` path below,
// unchanged. AC-T1.16: `held` is checked FIRST, above the provisional
// branch — a held entry gets the warning treatment above regardless of
// whether it also happens to be provisional; practice mode passes no
// `pinnedId` (so `held` is always false there), which is what keeps it
// byte-identical to before this prop existed.
function CurrentQuestionPanel({ current, copy, held, newerCount, onReleasePin, live }) {
  if (held) {
    return (
      <HeldQuestionPanel title={copy.currentQuestionTitle} newerCount={newerCount} onRelease={onReleasePin} live={live}>
        {current ? (
          <Typography sx={{ color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
            {current.question}
          </Typography>
        ) : (
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            {copy.noQuestion}
          </Typography>
        )}
      </HeldQuestionPanel>
    );
  }
  if (current?.provisional) {
    return (
      <AccentPanel title={copy.currentQuestionTitle} chipLabel="Unconfirmed">
        <Typography sx={{ color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
          {current.question}
        </Typography>
        <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "var(--text-secondary)" }}>
          Not confirmed as the interviewer — this may be your own words, picked up while speaker identity is
          still unsettled.
        </Typography>
      </AccentPanel>
    );
  }
  return (
    <RealPanel title={copy.currentQuestionTitle}>
      {current ? (
        <Typography sx={{ color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
          {current.question}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          {copy.noQuestion}
        </Typography>
      )}
    </RealPanel>
  );
}

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
function CurrentAnswerPanel({ current, copy, answerHidden, onReveal, revealLabel }) {
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
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
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
          {current.status === "loading" ? (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <CircularProgress size={16} sx={{ flexShrink: 0 }} />
              <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
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
            <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
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
    <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
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
  // AC-T1.16..T1.18: the pin/hold surface. `pinnedId` degrades to
  // latestQuestionEntry(questions) inside pinnedQuestionEntry when it is
  // `null`/`undefined` — practice mode passes none of these four props at
  // all, which is what keeps it byte-identical to before the pin existed.
  pinnedId,
  held = false,
  newerQuestionCount: newerCount = 0,
  onReleasePin,
  // Defect 3 fix: whether the SESSION is live — gates HeldQuestionPanel's
  // caption above. Defaults `true` (practice mode never passes `held: true`).
  live = true,
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
}) {
  const current = pinnedQuestionEntry(questions, pinnedId);
  const text = { ...LIVE_COPY, ...(copy || {}) };

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
          h2 (TabHeader.js) — see RealPanel/AccentPanel/DeliveryPanel above
          for the panel titles nested another level under this one. */}
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" component="h3" sx={{ color: "var(--text-secondary)", fontWeight: 700 }}>
          {text.title}
        </Typography>
      </Box>

      <Box
        sx={{
          display: "grid",
          // Was `md` (900px). A half-width window on a common 1440-wide
          // dual-screen setup is ~720px — under `md` — which fell to a
          // single column and stacked both panels, the single biggest
          // contributor to the scrolling the half-window/dual-screen user
          // is complaining about. `sm` (600px) still gives up two columns
          // well before that width. Do not "tidy" this back to `md`: the
          // half-window case is the point, not an oversight.
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 1.5,
        }}
      >
        <CurrentQuestionPanel current={current} copy={text} held={held} newerCount={newerCount} onReleasePin={onReleasePin} live={live} />
        <CurrentAnswerPanel
          current={current}
          copy={text}
          answerHidden={answerHidden}
          onReveal={onRevealAnswer}
          revealLabel={revealLabel}
        />
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <DeliveryPanel pace={pace} fillers={fillers} copy={text} />
      </Box>
    </Box>
  );
}
