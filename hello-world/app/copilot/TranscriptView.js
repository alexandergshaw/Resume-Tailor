"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import SpeakerChip from "./SpeakerChip";
import { BREAK_LONG_WORDS_SX, PHONE_PANE_SX } from "./mobileSx";

// Formats ms-since-start as m:ss for the per-turn timestamp.
function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Scrolling transcript. Consecutive lines from the same speaker are grouped
// under one label + timestamp, interim (not-yet-final) text renders muted +
// italic, and the view auto-scrolls to the bottom — but only while the user is
// already near the bottom, so scrolling up to re-read isn't yanked back down.
//
// AC-M1.5: four new props add in-person speaker correction on top of that
// unchanged behaviour, and every one of them is OPTIONAL:
//   - `finals` entries may now carry `speakerTag` (the diarized speaker id).
//   - `speakerLabelFor(speakerTag)` resolves a tag to "You" / "Them" /
//     "Speaker 2", or returns null/undefined when not yet known.
//   - `identityUnsettled` shows a "still working out who is who" state.
//   - `onAssignUser(speakerTag)` turns each turn's speaker chip into the
//     correction control.
//
// `onAssignUser` presence is the ONE gate for all of the above (requirement
// 1's "never fall back to You" fix, requirement 4's unsettled banner, and
// requirement 3's live region all live behind it). That is the pinned
// compatibility rule: tab/system mode never passes `onAssignUser`, and
// this component's output for that mode must stay byte-identical to
// before this feature existed — so nothing new may show through on ANY
// other prop alone. Labels are resolved through `speakerLabelFor` at
// RENDER time rather than cached on a row, which is what makes a
// correction retroactive: every row sharing a tag picks up the new label
// the next time this component renders, with no rewrite step of its own.
export default function TranscriptView({
  finals,
  interims,
  startedAt,
  speakerLabelFor,
  identityUnsettled,
  onAssignUser,
}) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  // Below `md`, PHONE_PANE_SX (mobileSx.js) removes this pane's own height
  // cap and sets `overflowY: "visible"` so the PAGE is the single scroll
  // container on a phone (see that export's own doc for why). The moment
  // that happens, `scrollHeight === clientHeight` on this element: the
  // `el.scrollTop = el.scrollHeight` write below becomes inert and
  // `onScroll` never fires, so `stickRef` alone can no longer keep the
  // newest line in view. `pageStickRef`/`lastRowRef` are the page-scroll
  // equivalent of `stickRef`/`scrollRef` for that regime — do not delete
  // them thinking `stickRef` already covers it; the two regimes are
  // genuinely disjoint (only one of them ever does anything on a given
  // render) and BOTH are required for auto-follow to work at every width.
  const pageStickRef = useRef(true);
  const lastRowRef = useRef(null);
  // Requirement 3: a polite live region announcing a correction. Local
  // state rather than diffing `finals` for a label change, because the
  // click that triggers the retroactive rewrite is the one unambiguous
  // moment this component knows a change of meaning just happened — see
  // handleAssign below.
  //
  // BUG-2 (adversarial review): `{ text, nonce }`, not a plain string —
  // matches CopilotClient.js's `barAnnouncement` shape exactly, for the same
  // reason. React bails out of re-rendering a mounted node when setState
  // receives a value that is `Object.is`-equal to what's already there, and
  // a plain string repeats that equality check on CONTENT. The only chip
  // that is ever clickable here is the one NOT currently "You", so its
  // label going into the sentence is always "Them" — mark it, identity
  // flips, mark the other one back, and the sentence is byte-identical both
  // times, producing no text change on the live region and hence no
  // announcement at all (see lib/copilot/answerStatus.js's header doc for
  // this exact discipline elsewhere in this app). A fresh object literal is
  // never `Object.is`-equal to the previous one no matter what `text` says,
  // which is what actually guarantees a text change; only `.text` is
  // rendered into the region below, so the sentence read aloud is
  // unaffected — `nonce` never appears in it.
  const [announcement, setAnnouncement] = useState({ text: "", nonce: 0 });
  const announcementNonceRef = useRef(0);

  // Tracks whether the PAGE (not this pane) is scrolled near its own
  // bottom, mirroring `onScroll` below one-for-one but for the regime
  // where this pane isn't a scroll container of its own. Attached
  // unconditionally (cheap, and the regime can change under a resize
  // that crosses `md`) but only ever consulted from the page-scroll
  // branch of the effect below.
  useEffect(() => {
    const onPageScroll = () => {
      const doc = document.documentElement;
      pageStickRef.current = doc.scrollHeight - window.scrollY - window.innerHeight < 48;
    };
    window.addEventListener("scroll", onPageScroll, { passive: true });
    return () => window.removeEventListener("scroll", onPageScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Ground truth for which regime is live RIGHT NOW, read off the
    // element rather than re-guessing PHONE_PANE_SX's `md` breakpoint in
    // JS (which could silently drift from the CSS). Computed `overflowY`
    // is what PHONE_PANE_SX actually flips between the two regimes
    // ("visible" below `md`, "auto" at/above it), so it can't go stale
    // the way comparing `scrollHeight`/`clientHeight` alone would: early
    // in a session the transcript is short enough that this pane hasn't
    // overflowed its `minHeight: 340` even at >= md, so that comparison
    // alone can't tell "not scrolled yet" apart from "not a scroller at
    // all" and would wrongly take the page-scroll branch on desktop.
    const isOwnScroller = getComputedStyle(el).overflowY !== "visible";
    if (isOwnScroller) {
      // >= md: PHONE_PANE_SX's "auto" branch is live, so this pane is its
      // own scroll container again. Unchanged from before this fix,
      // unconditionally — same write, same `stickRef` guard.
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    } else if (pageStickRef.current) {
      // < md: this pane is no longer a scroll container (PHONE_PANE_SX
      // set `overflowY: visible`, no height cap), so keeping the newest
      // line in view means moving the PAGE, via the last row's own ref.
      // `block: "nearest"` (never `"center"`/`"end"`) is required: it is
      // a no-op once the row is already fully visible, so a transcript
      // that is updating far faster than the user can read never yanks
      // the page on every turn — only when the newest row has actually
      // scrolled out of view does it move at all. `pageStickRef` (not
      // `stickRef`, which tracks THIS element and is meaningless once it
      // stops being a scroll container) gates it the same way `stickRef`
      // gates the branch above: a user who has scrolled the page up to
      // re-read something is not dragged back down by new lines arriving.
      lastRowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [finals, interims]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const correctable = typeof onAssignUser === "function";

  const handleAssign = (speakerTag, label) => {
    // BUG-1 (adversarial review): onAssignUser (useLiveSession.js) now
    // reports whether a live session actually existed to apply the
    // correction to. After Stop it does not (the underlying session object
    // is gone and the assignment is a silent no-op) — but this chip is
    // still clickable (see canAssign below), so announcing success
    // unconditionally would tell a screen-reader user that every earlier
    // turn from this voice was just relabeled when nothing changed at all.
    // Only announce a REAL application. Matches CopilotClient.js's
    // onAssignFromBar, which fixes the same defect on the "Who's talking"
    // bar.
    if (!onAssignUser(speakerTag)) return;
    announcementNonceRef.current += 1;
    setAnnouncement({
      text: `Marked ${label} as you. Earlier turns from this voice are now labeled You.`,
      nonce: announcementNonceRef.current,
    });
  };

  const hasContent = finals.length > 0 || interims.them || interims.you;

  // Build a render list where each item knows whether it starts a new speaker
  // group (chip + timestamp shown) or continues the previous one.
  //
  // BUG-1 (adversarial review): grouping on the coarse `speaker` label
  // ("you"/"them") merges two different diarized voices under one chip
  // whenever both happen to route to "them" — every non-user voice, and any
  // voice during the cold-start window, collapses to that one value. E.g.
  // the candidate speaks, then the interviewer asks a question: both finals
  // can carry `speaker: "them"`, so the second row's groupStart comes out
  // false and it renders with no chip of its own, visually appended to the
  // first row's group (whose chip resolves from the FIRST row — so the
  // interviewer's question shows up labeled as the candidate). A third
  // voice is swallowed the same way.
  //
  // Fix: in the correctable (in-person) path only, group on the fine-grained
  // `row.speakerTag` when it is present (a number), falling back to
  // `row.speaker` when it is absent. The non-correctable (tab/system) path
  // must keep grouping on `speaker` exactly as HEAD does — `correctable` is
  // false there, so `groupKey` reduces to `line.speaker` for every row,
  // same as before.
  const rows = [];
  let prevGroupKey = null;
  for (const line of finals) {
    const groupKey =
      correctable && typeof line.speakerTag === "number"
        ? `tag:${line.speakerTag}`
        : line.speaker;
    rows.push({
      ...line,
      groupStart: groupKey !== prevGroupKey,
      interim: false,
    });
    prevGroupKey = groupKey;
  }
  // Interims stay the fixed two-key { them, you } map they are today — a
  // diarized third voice's interim has nowhere to go until it finalizes and
  // arrives here through `finals` with its own `speakerTag`. Nothing here
  // widens this loop; the values below never carry a `speakerTag`, so their
  // grouping key is always the plain `speaker` value (same as the fallback
  // above), and they always render through the "not yet resolvable" path
  // when `correctable`.
  for (const speaker of ["them", "you"]) {
    if (interims[speaker]) {
      rows.push({
        id: `interim-${speaker}`,
        speaker,
        text: interims[speaker],
        at: null, // interim: timestamp appears once the turn is finalized
        groupStart: speaker !== prevGroupKey,
        interim: true,
      });
      prevGroupKey = speaker;
    }
  }

  return (
    <Box
      ref={scrollRef}
      onScroll={onScroll}
      sx={{
        flex: 1,
        minWidth: 0,
        ...PHONE_PANE_SX,
        p: 2,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      {/* Requirement 3's announcement region. Rendered only in correctable
          (in-person) mode — requirement 7 forbids anything new rendering
          for tab/system — but unconditional WITHIN that mode, so a later
          announcement is always a text change on an already-mounted node.
          Same discipline lib/copilot/answerStatus.js documents for every
          other status region in this app: a region that mounts already
          carrying its text is not reliably announced by some screen
          readers, only a change to an already-mounted one is. */}
      {correctable ? (
        <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
          {announcement.text}
        </Box>
      ) : null}

      {/* Requirement 4: a visible "still working out who is who" state
          instead of presenting a guess as settled fact. Text-only — never
          a colour-only cue — and shown independent of whether there is
          transcript content yet, since the guess can be unsettled before
          anyone has said enough to fill the box below. */}
      {correctable && identityUnsettled ? (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            mb: 1,
            color: "var(--text-secondary)",
            fontStyle: { xs: "normal", sm: "italic" },
            fontSize: { xs: 13, sm: "0.75rem" },
          }}
        >
          Still working out who is who in this conversation.
        </Typography>
      ) : null}

      {!hasContent ? (
        <Typography sx={{ color: "var(--text-muted)" }}>
          Transcript will appear here once the session starts…
        </Typography>
      ) : (
        <Stack spacing={0.25}>
          {rows.map((row, i) => (
            <TranscriptRow
              key={row.id}
              row={row}
              startedAt={startedAt}
              speakerLabelFor={speakerLabelFor}
              onAssign={correctable ? handleAssign : null}
              // Only the newest row needs to be findable for the
              // page-scroll regime's scrollIntoView — see the effect
              // above.
              rowRef={i === rows.length - 1 ? lastRowRef : undefined}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function TranscriptRow({ row, startedAt, speakerLabelFor, onAssign, rowRef }) {
  // The pinned compatibility gate (requirement 1): `onAssign` is null
  // whenever `onAssignUser` was not supplied to TranscriptView, and this
  // whole branch reproduces HEAD's rendering byte-for-byte — same
  // ternary, same labels, same styling, same plain <Chip> — so tab/system
  // mode is visually unchanged.
  if (!onAssign) {
    const isThem = row.speaker === "them";
    return (
      <Box ref={rowRef} sx={{ pt: row.groupStart ? 1 : 0 }}>
        {row.groupStart ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", mb: 0.25 }}
          >
            <Chip
              size="small"
              label={isThem ? "Them" : "You"}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 700,
                color: isThem
                  ? "var(--accent-contrast)"
                  : "var(--text-secondary)",
                background: isThem ? "var(--accent)" : "var(--bg-soft)",
                border: isThem ? "none" : "1px solid var(--border)",
              }}
            />
            {startedAt && row.at ? (
              <Typography
                variant="caption"
                sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtElapsed(row.at - startedAt)}
              </Typography>
            ) : null}
          </Stack>
        ) : null}
        <Typography
          sx={{
            pl: 0.25,
            color: row.interim ? "var(--text-muted)" : "var(--text-primary)",
            fontStyle: row.interim ? "italic" : "normal",
            ...BREAK_LONG_WORDS_SX,
          }}
        >
          {row.text}
        </Typography>
      </Box>
    );
  }

  // Requirement 1: resolved through `speakerLabelFor` at RENDER time, not
  // cached on the row — the retroactive relabel AC-M1.5 requires falls out
  // of that for free. Never falls back to "You": a row without a numeric
  // `speakerTag` (an interim — see the loop above) or one `speakerLabelFor`
  // can't yet resolve gets the explicit "Unknown speaker" state instead.
  const hasTag = typeof row.speakerTag === "number";
  const resolved =
    hasTag && typeof speakerLabelFor === "function"
      ? speakerLabelFor(row.speakerTag)
      : null;
  const label = resolved || "Unknown speaker";
  const isYou = resolved === "You";
  // Requirement 2: only a row we can actually attribute to a tag can be
  // assigned — calling `onAssignUser(undefined)` for an untagged interim
  // would not mean anything. A row already resolved as the user themselves
  // cannot be assigned either — there is no "mark yourself as yourself"
  // action. Only the OTHER voice's chip corrects a wrong guess.
  const canAssign = hasTag && !isYou;

  return (
    <Box ref={rowRef} sx={{ pt: row.groupStart ? 1 : 0 }}>
      {row.groupStart ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", mb: 0.25 }}
        >
          {/* BUG-2 (adversarial review): `onActivate` used to be
              `canAssign ? fn : null`, so the exact row a correction just
              landed on (isYou flips true on the next render) went from a
              function to null in one step — SpeakerChip swapped its
              <button> for a <Chip> at that moment and the user's keyboard
              focus fell back to <body>. `onActivate` is now truthy for
              every tagged row, assignable or not, so SpeakerChip always
              returns the same <button> for it; `disabled` (not a null
              handler) marks the ones that aren't currently actionable, so
              only the disabled-ness changes, never the element. Untagged
              rows still get `onActivate: null` — they render the plain
              <Chip> and always have, so there is no button, and no focus,
              to protect there. Trade-off, made deliberately: this also
              puts the user's own already-resolved rows back in the tab
              order (as an inert stop), which an earlier pass had traded
              away to avoid a self-contradictory "You" button — a stable
              focus target across corrections matters more. */}
          <SpeakerChip
            label={label}
            resolved={Boolean(resolved)}
            isYou={isYou}
            onActivate={hasTag ? () => onAssign(row.speakerTag, label) : null}
            disabled={!canAssign}
          />
          {startedAt && row.at ? (
            <Typography
              variant="caption"
              sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
            >
              {fmtElapsed(row.at - startedAt)}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
      <Typography
        sx={{
          pl: 0.25,
          color: row.interim ? "var(--text-muted)" : "var(--text-primary)",
          fontStyle: row.interim ? "italic" : "normal",
          ...BREAK_LONG_WORDS_SX,
        }}
      >
        {row.text}
      </Typography>
    </Box>
  );
}
