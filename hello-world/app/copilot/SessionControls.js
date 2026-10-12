"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { fmtClock } from "@/lib/copilot/clock";
import { normalizeAidChoice } from "@/lib/copilot/aidDisclosure";
import { createChoiceStore } from "@/lib/copilot/choiceStore";
import CollapsibleAid from "./CollapsibleAid";
import StatusPill from "./StatusPill";
import { TOUCH_TARGET_SX, TOUCH_SWITCH_SX } from "@/app/theme/mobileSx";

// Headroom extraction, NOT a feature: split out of CopilotClient.js purely to
// keep that file under CopilotClient.extraction.test.js's 950-line cap — the
// same reason SpeakerBar.js, TranscriptDisclosure.js and useTypeAnnouncements
// .js were themselves split out of it (see each of those modules' own docs,
// and the call site in CopilotClient.js). The JSX below moved VERBATIM,
// comments included; nothing about what reaches the screen changed on the way
// out, and no assertion in this suite was weakened to let it move.
//
// Owns live mode's session control row and nothing else: Start/Stop, the
// status pill, the elapsed clock, the Auto-draft switch, the N162 "Add code
// solutions" switch, Copy, Clear, and the "Download session log" button with its
// D6 disabled-reason caption. This is
// the live-mode mirror of practice/PracticeControls.js — the same split, for
// the same reason, on the very row that file's own header already points at
// ("live mode's own Start/Stop row in CopilotClient.js").
//
// No SESSION state and no pipeline hooks of its own, deliberately. Every value
// rendered here and every handler called is a prop, so CopilotClient's own hook
// call order is byte-for-byte what it was before this file existed — an
// extraction that moved a useState or a useEffect across this boundary would be
// a behaviour change in React, not a relocation. `finals` and `questions`
// arrive as the ARRAYS rather than as pre-computed booleans for the same
// reason: it keeps the two `disabled` expressions identical to the ones that
// used to sit inline, instead of restating them one level up.
//
// N156 is the ONE amendment to that rule, and it is a NEW local hook set rather
// than a moved one, so it cannot reorder CopilotClient's hooks: a confirm guard
// on Clear (an armed flag, the timer handle that ends the armed state, and the
// unmount cleanup of that timer) — three hooks, no useCallback, no useMemo, and
// nothing that reads or writes the transcript. Clear used to wipe the whole
// session on ONE activation, ~12px from Copy; the first activation now only
// ARMS it and a second one inside CLEAR_CONFIRM_WINDOW_MS calls `clearAll`
// (useLiveSession.js, unchanged). Nothing is snapshotted for an undo: the live
// STT refs `clearAll` resets keep running, so a restore would race the stream.
// SessionControls.extraction.test.js bounds this to exactly those three hooks.
//
// N144b: on a phone (`compact`) while live, the post-session / destructive
// trio — Copy, Clear and Download session log, plus the caption — tucks behind
// ONE reused CollapsibleAid, so Clear (which wipes the transcript, every
// detected question and the confirm gate, and has no undo) is
// not a stray-tap target mid-session. Stop/Start, the pill, the clock,
// Auto-draft and "Add code solutions" stay inline in every state, and the trio
// is defined ONCE below and placed in
// exactly one of two spots, so a duplicated control row cannot exist. The
// disclosure's open state is the module-scope choice store below, read by
// CollapsibleAid, not state here.

// Remembered across sessions (null = not chosen = collapsed on a phone), the
// same shape AnswerAids.js uses for its own disclosures. Hydrated at module
// scope; the store guards on a missing localStorage, so a server render is safe.
const sessionActionsCollapse = createChoiceStore({
  storageKey: "copilot-session-actions",
  defaultValue: null,
  normalize: normalizeAidChoice,
  crossWindow: true,
});
sessionActionsCollapse.hydrate();

// The header names what is inside, including the destructive item, rather than
// a vague "More".
const SESSION_ACTIONS_LABEL = "Copy, clear and download";

// The tucked body's row: the same wrap rhythm as the inline row it replaces.
const WRAP_ROW_SX = { alignItems: "center", flexWrap: "wrap", rowGap: 1 };

// N156: how long the armed Clear waits for its second activation before it
// reverts on its own (no wipe). Exported so a test advances past this exact
// number rather than a hardcoded copy of it; it is a setTimeout, not a
// timestamp comparison, so the revert also happens with no further input.
export const CLEAR_CONFIRM_WINDOW_MS = 4000;

// The armed label replaces "Clear" on the SAME button, in the same spot.
const CLEAR_ARMED_LABEL = "Confirm clear?";

// What a screen reader is told when Clear arms. It says what the next
// activation does and that the arm cancels itself, because the visible label
// change alone is silent to a user who is not looking at the button.
const CLEAR_ARMED_ANNOUNCEMENT =
  `${CLEAR_ARMED_LABEL} Press the button again to erase the transcript and every ` +
  `detected question. This cancels in ${Math.round(CLEAR_CONFIRM_WINDOW_MS / 1000)} seconds.`;

export default function SessionControls({
  live,
  stop,
  onStartSession,
  status,
  startedAt,
  elapsed,
  autoDraft,
  setAutoDraft,
  // N162: the shared "include coding solution" preference. CopilotClient reads
  // the store (useIncludeCodingSolution) and hands the value and its setter
  // down, exactly as it does autoDraft/setAutoDraft; this module stays free of
  // any store subscription (SessionControls.extraction.test.js bans it).
  includeCodingSolution,
  onIncludeCodingSolutionChange,
  copyTranscript,
  clearAll,
  finals,
  questions,
  downloadLog,
  sessionLogHasEvents,
  compact = false,
}) {
  // The tuck needs BOTH: idle on a phone shows everything inline (Auto-draft is
  // a pre-start choice, Download and Copy matter right after Stop).
  const tuck = compact && live;

  // N156: the Clear confirm guard. `clearTimerRef` is the source of truth for
  // "armed" (a pending timer IS the armed window), so the click handler never
  // reads a stale render closure; `clearArmed` only drives what is painted.
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    },
    [],
  );

  const clearDisabled = finals.length === 0 && questions.length === 0;
  // A Clear that is disabled right now is never shown armed.
  const armed = clearArmed && !clearDisabled;

  // ONE handler for every input method (a native button's click covers pointer,
  // Enter and Space alike): the first activation only arms and starts the
  // window; a second one inside it disarms and calls `clearAll` exactly once.
  const onClearClick = () => {
    if (clearTimerRef.current === null) {
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setClearArmed(false);
      }, CLEAR_CONFIRM_WINDOW_MS);
      setClearArmed(true);
      return;
    }
    clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
    setClearArmed(false);
    clearAll();
  };

  const actions = (
    <>
      <Button
        size="small"
        variant="text"
        onClick={copyTranscript}
        disabled={finals.length === 0}
        sx={TOUCH_TARGET_SX}
      >
        Copy
      </Button>
      {/* N156: the same native button before and after arming, so focus stays
          on it; the announcement is the live region at the foot of this
          component, not a Tooltip (mui-a11y-traps) or an aria-label. */}
      <Button
        type="button"
        size="small"
        variant="text"
        color={armed ? "error" : "primary"}
        onClick={onClearClick}
        disabled={clearDisabled}
        sx={TOUCH_TARGET_SX}
      >
        {armed ? CLEAR_ARMED_LABEL : "Clear"}
      </Button>
      {/* AC-Q6.8/D6: one button, one file, no confirmation, no format
          menu; this row renders both while `live` and after Stop. No
          Tooltip (mui-a11y-traps: it would steal or rename this
          button's visible name). D6: the disabled reason used to
          live ONLY as an `aria-label` on this natively-disabled
          button — out of the tab order, so neither a keyboard/
          screen-reader user nor a sighted user (a greyed button with
          no visible text at all) could ever reach it. Mirrors
          practice/PracticeControls.js's own "Download session log"
          control exactly: `aria-describedby` pointing at a sibling
          VISIBLE caption, rendered under the same condition, so
          every user gets the same explanation through whichever
          channel they're using. Renamed to "Download session log" —
          the old "Download log" name meant practice mode and live
          mode named the same feature two different things. */}
      <Button
        size="small"
        variant="text"
        onClick={downloadLog}
        disabled={!sessionLogHasEvents}
        aria-describedby={sessionLogHasEvents ? undefined : "live-download-log-reason"}
        sx={TOUCH_TARGET_SX}
      >
        Download session log
      </Button>
      {!sessionLogHasEvents ? (
        <Typography id="live-download-log-reason" variant="caption" sx={{ color: "var(--text-muted)" }}>
          Available once the session has recorded something.
        </Typography>
      ) : null}
    </>
  );

  const controlRow = (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ mb: tuck ? 0.5 : 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
    >
      {live ? (
        <Button variant="outlined" color="error" onClick={stop} sx={TOUCH_TARGET_SX}>
          Stop
        </Button>
      ) : (
        // BUG-3: onStartSession, not the bare `start` — see its own
        // comment for why the bar's announcement must not survive
        // into a new session.
        <Button variant="contained" onClick={onStartSession} sx={TOUCH_TARGET_SX}>
          Start session
        </Button>
      )}
      <StatusPill status={status} />
      {startedAt ? (
        <Typography
          variant="body2"
          sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
        >
          {fmtClock(elapsed)}
        </Typography>
      ) : null}
      <Box sx={{ flex: 1, display: { xs: "none", sm: "block" } }} />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={autoDraft}
            onChange={(e) => setAutoDraft(e.target.checked)}
            sx={TOUCH_SWITCH_SX}
          />
        }
        label={
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            Auto-draft
          </Typography>
        }
        sx={{ mr: 0.5 }}
      />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={includeCodingSolution}
            onChange={(e) => onIncludeCodingSolutionChange(e.target.checked)}
            sx={TOUCH_SWITCH_SX}
          />
        }
        label={
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            Add code solutions
          </Typography>
        }
        sx={{ mr: 0.5 }}
      />
      {tuck ? null : actions}
    </Stack>
  );

  // The Stack stays the first child in every state, so the Start/Stop button
  // is the same DOM node across the idle-to-live flip (focus survives, WCAG
  // 2.4.3). The disclosure is a sibling AFTER it: reading order is the
  // rendered order, nothing is reordered with CSS.
  return (
    <>
      {controlRow}
      {tuck ? (
        <Box sx={{ mb: 2 }}>
          <CollapsibleAid label={SESSION_ACTIONS_LABEL} choiceStore={sessionActionsCollapse}>
            <Stack direction="row" spacing={1.5} sx={WRAP_ROW_SX}>
              {actions}
            </Stack>
          </CollapsibleAid>
        </Box>
      ) : null}
      {/* N156: PERSISTENT polite live region — mounted in every state, empty
          until Clear arms, so the text change is what gets announced (a region
          mounted already holding its text is never read out). Lives outside
          `actions` so the tuck collapsing cannot unmount it mid-arm. Empty on
          the server, so a server render is unaffected. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {armed ? CLEAR_ARMED_ANNOUNCEMENT : ""}
      </Box>
    </>
  );
}
