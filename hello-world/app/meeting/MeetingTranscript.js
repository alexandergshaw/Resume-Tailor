"use client";

// Presentational only, per this feature's split: no fetching, no session
// state, no capture. Everything this component knows arrives as props —
// the finished list of final turns, whatever partial text is still being
// transcribed, and which capture source produced them. Wiring those props
// up to a live socket/session is someone else's file (app/meeting/use*.js),
// deliberately kept out of reach here.
//
// Modeled on app/copilot/TranscriptView.js, the interview copilot's own
// scrolling transcript, but simplified: this meeting has no diarization
// correction UI (that component's `onAssignUser` machinery exists only for
// the in-person interview flow's speaker-reassignment feature, which this
// surface has no equivalent of). What carries over is the one property that
// actually matters for a live, fast-moving transcript: auto-follow the newest
// line while the reader hasn't scrolled away to re-read something earlier.
//
// It ALSO carries over the page-scroll-vs-pane-scroll split, which this file
// used to reject in this very comment: PHONE_PANE_SX was described as "a
// copilot-specific layout contract this file has no reason to import". That
// was wrong twice over. It is not copilot-specific — it now lives in
// app/theme/mobileSx.js as the app-wide contract, imported by every surface
// that has had a phone pass. And the reason to import it is the one this file
// had no phone in view to see: without it this pane is a 420px nested touch
// scroller inside a page scroll, on a screen 812px tall that also carries two
// consent notices, the Stop row and the whole insight list. See that export's
// own doc for the two independent failures it exists to prevent.
//
// The split below is not optional decoration on top of that import. Read
// `PHONE_PANE_SX`'s effect on this component precisely: below `md` it sets
// `overflowY: visible` and removes the height cap, so this element STOPS
// BEING A SCROLL CONTAINER. The instant that happens `onScroll` can never
// fire, so `stickRef` is frozen at its initial `true` and auto-follow runs on
// every arriving turn no matter where the reader is — which on a phone means
// a reader who scrolled UP to re-read something is dragged back to the bottom
// by the next line of speech. `pageStickRef` is the page-scroll equivalent of
// `stickRef` for that regime; the two are genuinely disjoint (only one of them
// does anything on a given render) and BOTH are required for auto-follow to
// behave at every width. Adopting the pane contract without it would trade a
// scroll-trap for a scroll-yank.

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { meetingSpeakerLabel } from "@/lib/meeting/insightContract";
import { speakerAttributionNotice } from "@/lib/meeting/meetingNotices";
import {
  BREAK_LONG_WORDS_SX,
  PHONE_PANE_SX,
  TOUCH_TARGET_SX,
  WRAP_ROW_SX,
} from "@/app/theme/mobileSx";

// How close to the bottom still counts as "following along". Matches
// TranscriptView.js's own threshold, and is applied to the page and to the
// pane by the two sticky checks below so the two regimes behave identically.
const STICK_SLACK_PX = 48;

// Every length below carries an explicit unit, for the same reason
// MeetingInsightList.js's own copy of this object states in full: MUI's `sx`
// does not read these as plain CSS. A bare `width: 1`/`height: 1` is a
// PERCENTAGE (any number in 0..1) and a bare `margin: -1` is the 8px spacing
// scale, not a pixel, so the unitless version of this object rendered a
// full-size overlay rather than a 1px clip-rect — invisible only because
// `clip`/`overflow` kept doing their job. Kept local rather than imported
// from lib/copilot/answerStatus.js's `visuallyHidden` so this file stays one
// of the sites lib/copilot/visuallyHiddenUnits.sweep.test.js can find and
// check on its own — an import here would erase the very copy that sweep
// was written to catch. Matched byte-for-byte against that shared export.
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// The three routing values a turn's `speaker` field can carry, matching
// lib/meeting/insightContract.js's MEETING_LABELS keys exactly. Used only to
// know which interim slots to look for below — never as a substitute for
// `meetingSpeakerLabel`, which stays the ONE place a routing value becomes
// display text.
const SPEAKER_KEYS = ["you", "them", "room"];

function formatClockTime(at) {
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// One final turn's row. `speaker` is translated to display text via
// `meetingSpeakerLabel` right here — the render boundary the brief calls
// for — and a "room" turn's empty label means literally no chip renders,
// not an empty one: a shared microphone cannot say who was talking, and a
// blank chip would still visually claim it knew there WAS an attributable
// turn boundary worth marking.
function FinalTurnRow({ turn, rowRef }) {
  const label = meetingSpeakerLabel(turn.speaker);
  const clock = formatClockTime(turn.at);
  return (
    <Box ref={rowRef} sx={{ pt: 0.75 }}>
      {label || clock ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.25, ...WRAP_ROW_SX }}>
          {label ? (
            <Chip
              size="small"
              label={label}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 700,
                // MUI's Chip root is `overflow: hidden` + `text-overflow:
                // ellipsis`, so a chip squeezed as a flex item truncates its
                // own label rather than the row wrapping. Latent with today's
                // two-word vocabulary ("You"/"Others"); pinned so it stays
                // that way rather than being rediscovered as "PREDI…" the way
                // CopilotDashboard.js documents.
                flexShrink: 0,
                color: turn.speaker === "them" ? "var(--accent-contrast)" : "var(--text-secondary)",
                background: turn.speaker === "them" ? "var(--accent)" : "var(--bg-soft)",
                border: turn.speaker === "them" ? "none" : "1px solid var(--border)",
              }}
            />
          ) : null}
          {clock ? (
            <Typography variant="caption" sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {clock}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
      {/* `overflowWrap: anywhere`, not the `wordBreak: break-word` this was:
          only `anywhere` also feeds intrinsic min-content sizing, which is
          what stops a dictated URL or an email address forcing this pane
          wider than the screen. Transcribed speech is exactly where such a
          token arrives unannounced. */}
      <Typography sx={{ pl: 0.25, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}>
        {turn.text}
      </Typography>
    </Box>
  );
}

// One in-progress (not-yet-final) line. Distinguished from a final turn two
// ways at once, per the brief: visually (muted + italic, same cue TranscriptView
// uses for its own interims) AND programmatically — a leading visually-hidden
// "Still speaking:" prefix is part of this row's actual text content, so a
// screen-reader user who tabs or reads onto this row hears the distinction
// too, not just sees it. Deliberately NOT inside any aria-live/role="status"
// region: an interim updates many times a second as speech resolves, and a
// live region would announce every one of those partial re-renders. Leaving
// it a plain, non-live node means it is only ever read when the user
// actually navigates to it — which is what "not announced repeatedly" means
// in practice, since nothing here proactively interrupts.
function InterimRow({ speaker, text, rowRef }) {
  const label = meetingSpeakerLabel(speaker);
  return (
    <Box ref={rowRef} sx={{ pt: 0.75 }}>
      {label ? (
        <Chip
          size="small"
          label={label}
          sx={{
            height: 20,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-secondary)",
            background: "var(--bg-soft)",
            border: "1px solid var(--border)",
            mb: 0.25,
          }}
        />
      ) : null}
      <Typography
        data-interim="true"
        sx={{ pl: 0.25, color: "var(--text-muted)", fontStyle: "italic", ...BREAK_LONG_WORDS_SX }}
      >
        <Box component="span" sx={visuallyHidden}>
          Still speaking:{" "}
        </Box>
        {text}
      </Typography>
    </Box>
  );
}

export default function MeetingTranscript({ turns, interims, source }) {
  const finalTurns = Array.isArray(turns) ? turns : [];
  const interimMap = interims && typeof interims === "object" ? interims : {};
  const activeInterims = SPEAKER_KEYS.filter((key) => typeof interimMap[key] === "string" && interimMap[key]);

  const scrollRef = useRef(null);
  // Tracks whether THIS PANE is scrolled near its own bottom. Meaningful only
  // at `md` and up, where PHONE_PANE_SX's `overflowY: auto` branch makes the
  // pane a scroll container again; below `md` `onScroll` never fires and this
  // ref is frozen — see this file's header.
  const stickRef = useRef(true);
  // The page-scroll equivalent, for the regime below `md` where the PAGE is
  // the single scroller. Do not delete this thinking `stickRef` covers it:
  // the two regimes are disjoint and each ref is inert in the other's.
  const pageStickRef = useRef(true);
  const newestRef = useRef(null);

  const hasContent = finalTurns.length > 0 || activeInterims.length > 0;

  // Extracted to its own variable (rather than inlining `.join("|")` in the
  // dependency array below) purely so the array is statically checkable —
  // react-hooks/exhaustive-deps cannot verify a dependency it can't see is
  // stable across renders when it's a fresh expression written inline.
  const activeInterimsKey = activeInterims.join("|");

  // Mirrors `onScroll` below one-for-one, but for the PAGE rather than this
  // pane. Attached unconditionally — it is cheap, and the regime can change
  // under a resize that crosses `md` — but only ever consulted from the
  // page-scroll branch of the effect below.
  useEffect(() => {
    const onPageScroll = () => {
      const doc = document.documentElement;
      pageStickRef.current =
        doc.scrollHeight - window.scrollY - window.innerHeight < STICK_SLACK_PX;
    };
    window.addEventListener("scroll", onPageScroll, { passive: true });
    return () => window.removeEventListener("scroll", onPageScroll);
  }, []);

  // Auto-follow the newest line, the same "stick unless the reader has
  // scrolled away" contract TranscriptView.js uses — new turns in a live
  // meeting must not require the reader to keep manually scrolling down,
  // but a reader who scrolled UP to re-read something earlier must not be
  // yanked back to the bottom by the next arriving line either.
  //
  // WHICH ref gates that depends on which regime is live, and that is read
  // off the ELEMENT rather than re-deriving PHONE_PANE_SX's `md` breakpoint
  // in JS (where it could silently drift from the CSS). Computed `overflowY`
  // is the exact property the contract flips between the two regimes, so it
  // cannot go stale the way comparing `scrollHeight`/`clientHeight` would:
  // early in a meeting the transcript is short enough not to have overflowed
  // its `minHeight: 340` even at >= md, and that comparison alone cannot tell
  // "not scrolled yet" apart from "not a scroller at all".
  //
  // `scrollIntoView({ block: "nearest" })` serves BOTH regimes, which is why
  // there is one call rather than two: it is a no-op once the row is already
  // fully visible, so a transcript updating faster than anyone can read never
  // jerks the viewport on every turn — it moves only when the newest row has
  // actually gone out of view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isOwnScroller = getComputedStyle(el).overflowY !== "visible";
    if (isOwnScroller ? stickRef.current : pageStickRef.current) {
      newestRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [finalTurns.length, activeInterimsKey]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_SLACK_PX;
  };

  // "Newest turns must be reachable without hunting" — the AC this button
  // exists to satisfy directly and testably, independent of whatever a
  // jsdom test environment's zeroed-out layout metrics let the auto-follow
  // effect above actually prove. Always enabled and always in the tab
  // order whenever there is any content at all (never conditionally
  // disabled while explanatory text about it is on screen — the
  // accessibility rule this brief calls out by name).
  //
  // BOTH sticky refs are re-armed, not just `stickRef`. Pressing this control
  // is the user saying "follow along again", and which ref actually gates
  // that depends on a regime this handler has no reason to branch on — arming
  // only the pane's would leave the button working once on a phone and then
  // never following the next turn.
  const jumpToLatest = () => {
    stickRef.current = true;
    pageStickRef.current = true;
    newestRef.current?.scrollIntoView({ block: "nearest" });
  };

  const attributionNotice = speakerAttributionNotice(source);

  const rows = [];
  finalTurns.forEach((turn, i) => {
    rows.push(
      <FinalTurnRow
        key={turn.id}
        turn={turn}
        rowRef={i === finalTurns.length - 1 && activeInterims.length === 0 ? newestRef : undefined}
      />,
    );
  });
  activeInterims.forEach((speaker, i) => {
    rows.push(
      <InterimRow
        key={`interim-${speaker}`}
        speaker={speaker}
        text={interimMap[speaker]}
        rowRef={i === activeInterims.length - 1 ? newestRef : undefined}
      />,
    );
  });

  return (
    <Box>
      {attributionNotice ? (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 1 }}>
          {attributionNotice}
        </Typography>
      ) : null}

      {hasContent ? (
        <Box sx={{ mb: 1, textAlign: "right" }}>
          <Button
            size="small"
            onClick={jumpToLatest}
            aria-label="Jump to the latest turn"
            sx={TOUCH_TARGET_SX}
          >
            Jump to latest
          </Button>
        </Box>
      ) : null}

      {/* `data-transcript-pane` exists so this element is addressable by the
          mobile suite, which has to read back which scroll regime the pane is
          actually in. Nothing renders off it. */}
      <Box
        ref={scrollRef}
        onScroll={onScroll}
        data-transcript-pane="true"
        sx={{
          // Replaces a hard `maxHeight: 420, overflowY: "auto"` — see this
          // file's header. Below `md` the page becomes the single scroller;
          // at `md` and up this is a bounded, internally-scrolling pane
          // again, on the contract's shared values rather than this file's
          // own.
          ...PHONE_PANE_SX,
          p: 2,
          borderRadius: 2,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        {!hasContent ? (
          <Typography sx={{ color: "var(--text-muted)" }}>
            The transcript will appear here once the meeting starts…
          </Typography>
        ) : (
          <Stack spacing={0.25}>{rows}</Stack>
        )}
      </Box>
    </Box>
  );
}
