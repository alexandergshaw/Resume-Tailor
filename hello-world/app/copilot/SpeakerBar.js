"use client";

import { useCallback, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import SpeakerChip from "./SpeakerChip";

// AC-M1.5.9/AC-X1: split out of CopilotClient.js purely to keep that file
// under this project's 1000-line cap (the same reason useLiveSession.js,
// useSessionLogRecorder.js and TranscriptDisclosure.js were themselves split
// out of it — see CopilotClient.js's own module doc). Owns the always-visible
// "Who's talking" bar: the speaker-correction control has to be reachable
// WITHOUT expanding the transcript disclosure — live mode collapses
// `showHistory` by default, and TranscriptView (the only other place this
// control lives) sits entirely inside that Collapse. This bar is rendered as
// a sibling of it, in the always-rendered part of the tree, so a correction
// is reachable the moment a second voice is heard even while the full
// transcript stays collapsed. Renders nothing until at least one voice has
// actually been observed (`speakerSnapshot.tags`), and nothing at all for
// tab/system, which never populate it — the component keeps that gate
// itself so the caller stays a single unconditional `<SpeakerBar ... />`.
// Reuses SpeakerChip — the exact same control TranscriptView's own rows use
// — so "mark as me" means the same thing and looks the same whichever
// surface it's pressed from.
export default function SpeakerBar({
  source,
  speakerSnapshot,
  speakerLabelFor,
  identityUnsettled,
  onAssignUser,
  sessionNonce,
}) {
  // BUG-2: a correction made from this always-visible bar must announce
  // itself through a polite live region, exactly as TranscriptView.handleAssign
  // already does for corrections made through the transcript — retroactively
  // rewriting every label in the transcript is a change of meaning, and a
  // user who cannot see it happen still needs to be told. This is a SEPARATE
  // region from TranscriptView's own, not a second announcement of the same
  // event: TranscriptView owns that region's state internally (it isn't
  // reachable from here) and, more importantly, TranscriptView sits inside
  // the `showHistory` Collapse — closed by default while a session is live —
  // which is exactly the surface BUG-2 says goes unreachable mid-session.
  // Each region only fires for a correction activated through its OWN
  // surface (bar vs. transcript row); a single click can only ever go
  // through one of the two, so nothing is ever announced twice.
  //
  // BUG-3: `{ text, nonce }`, not a plain string. React bails out of re-rendering a mounted node
  // when setState receives a value that is
  // `Object.is`-equal to what's already there — a plain string repeats
  // that equality check on CONTENT, so two corrections that land on the
  // identical sentence (reachable in any two-voice session: the only chip
  // that is ever clickable is the one NOT currently "You", so its label
  // going into the sentence is always "Them" — mark it, identity flips,
  // mark the other one back, and the sentence is byte-identical both
  // times) produce no text change on the live region, hence no
  // announcement at all (see lib/copilot/answerStatus.js's header doc for
  // this exact discipline elsewhere in this app). A fresh object literal is
  // never `Object.is`-equal to the previous one no matter what `text` says,
  // which guarantees a re-RENDER and — corrected, C5 — NOT a text change: a
  // screen reader announces changed text, so two corrections landing on the
  // identical sentence are still one announcement, and this bar has that
  // latent gap for the reason its own paragraph above describes. The fix
  // shape is app/copilot/useCueActions.js's `cueSentence`, which makes the
  // RENDERED sentence say which thing changed; only `.text` is
  // rendered into the region below, so the sentence read aloud is
  // unaffected — `nonce` never appears in it, it exists purely to make each
  // state value a distinct object.
  const [barAnnouncement, setBarAnnouncement] = useState({ text: "", nonce: 0 });
  const barAnnouncementNonceRef = useRef(0);

  // BUG-3: also cleared at the start of every new session — without this,
  // the FIRST correction of session 2 could repeat session 1's last
  // announcement text verbatim and, by the same identical-string bailout
  // above, say nothing. CopilotClient bumps `sessionNonce` in its own
  // onStartSession (the only caller of `start` in that component) and hands
  // it down here; this compares it against the last nonce THIS component has
  // rendered and resets synchronously during render when it changes — React's
  // documented "adjusting state when a prop changes" idiom — rather than in a
  // useEffect, which this repo's react-hooks/set-state-in-effect rule
  // disallows for deriving render output and which would also announce the
  // reset one render late.
  const [seenSessionNonce, setSeenSessionNonce] = useState(sessionNonce);
  if (seenSessionNonce !== sessionNonce) {
    setSeenSessionNonce(sessionNonce);
    setBarAnnouncement({ text: "", nonce: 0 });
  }

  const onAssignFromBar = useCallback(
    (tag, label) => {
      // BUG-2: only announce a REAL application of the correction —
      // onAssignUser (useLiveSession.js) now reports whether a live session
      // existed to apply it to. After Stop it does not (sessionRef.current
      // is null), and this chip would otherwise still be a clickable button
      // (see the map below) that announces success for a click that changed
      // nothing.
      if (!onAssignUser(tag)) return;
      barAnnouncementNonceRef.current += 1;
      setBarAnnouncement({
        text: `Marked ${label} as you. Earlier turns from this voice are now labeled You.`,
        nonce: barAnnouncementNonceRef.current,
      });
    },
    [onAssignUser],
  );

  if (!(source === "inperson" && speakerSnapshot.tags.length > 0)) return null;

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 0.75 }}
    >
      <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
        {identityUnsettled ? "Who's talking (still working out who is who):" : "Who's talking:"}
      </Typography>
      {speakerSnapshot.tags.map((tag) => {
        const label = speakerLabelFor(tag);
        const isYou = tag === speakerSnapshot.userTag;
        return (
          <SpeakerChip
            key={tag}
            label={label}
            resolved
            isYou={isYou}
            // BUG-1: the chip already resolved as the user is not
            // a control — there is no "mark yourself as yourself"
            // action. `onActivate: null` is what makes SpeakerChip
            // render the same non-interactive <Chip> the
            // tab/system path renders, instead of a self-
            // contradictory button. Only the OTHER voice's chip
            // corrects a wrong guess.
            onActivate={isYou ? null : () => onAssignFromBar(tag, label)}
          />
        );
      })}
      {/* BUG-2: mounted unconditionally alongside the bar itself —
          not only once a correction has actually happened — since
          a region that mounts already carrying its final text is
          not reliably announced; only a TEXT CHANGE on an
          already-mounted node is. Same discipline
          TranscriptView.js's own region and
          lib/copilot/answerStatus.js document.
          BUG-3: only `.text` is rendered — `.nonce` is state-only,
          never part of the announced sentence (see barAnnouncement's
          own derivation above). */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {barAnnouncement.text}
      </Box>
    </Stack>
  );
}
