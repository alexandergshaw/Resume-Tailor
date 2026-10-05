"use client";

import { useEffect, useId, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import AutorenewOutlinedIcon from "@mui/icons-material/AutorenewOutlined";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { setEngine } from "@/app/settings/engine";
import { PANEL_COPY } from "@/lib/review/flagPresentation";
import { REGENERATE_STATE } from "@/lib/review/regenerateAvailability";
import { LEVEL_CAPTIONS } from "@/lib/tailor/tailorLevel";

// N104 -- the Regenerate row: ONE outlined button and the sentence that says what it
// will do, drawn in the state `regenerateAvailability` chose. A props-only leaf; it
// decides nothing about whether a regenerate may run.
//
//   state        a REGENERATE_STATE value
//   counts       { resolvable, confirm, unqualified } of the review on screen
//   inputs       { posting, realMaterial }, which of the two the review lacked
//   engineLabel  the current engine's picker label, named when it cannot regenerate
//   handEdited   the text on screen was edited by hand (regenerating replaces it)
//   hasReport    a report of an earlier run is showing, so the button reads "again"
//   failed       the last run could not finish (nothing was changed)
//   note         one plain line shown above the row (the restored-version line)
//   focusSignal  a counter; each increase moves focus to the Regenerate button (the
//                host bumps it after Undo, whose own button unmounts under focus)
//   onRegenerate called on activation, only in `ready`
//   onUnavailable called with the state when an unavailable control is activated
//   announce     the preview's announcer; carries the reason an unavailable
//                activation gives and the engine-switched cue
//
// The promise before the click is exactly as strong as the gate behind it: it names
// the group of lines it acts on and says that whatever cannot be supported is set
// aside and listed, never added. It never says it will fill or fix anything.
//
// The control is never the native `disabled` attribute (focus would be dropped);
// an unavailable state is `aria-disabled`, its activation is a no-op, and the
// reason is a visible caption the button points at. No Tooltip: the visible text is
// the button's name. A scope or hidden state draws a sentence or nothing, never a
// button. On an engine that cannot regenerate, a plain Switch to Gemini button is
// offered because the top bar is out of reach under the modal; focus then returns
// to the Regenerate button, which stays mounted.

const CAPTIONS = {
  tail: "Requirements your resume cannot meet by rewording, and items to confirm, are left as they are.",
  nothing: "Rewording has nothing to address in the checks that ran.",
  running:
    "Regenerating - this runs several AI passes and takes longer than a review. Your resume stays as it is until the new one is ready.",
  stale: "You have edited this resume since this review. Review again to update the list, then regenerate.",
  noResume: "Your uploaded resume was not available, so we cannot tell which gaps rewording can address.",
  noPosting: "The job posting was not available, so we cannot tell which gaps rewording can address.",
  unsupportedJob: "Regenerating with every line checked against your resume is available for results built at the Ideal level.",
  unsupportedScope: "Regenerating is available for the resume only.",
  failed: "The regenerate could not finish, so your resume is unchanged. Try again.",
  handEdited:
    "You have edited this resume. Regenerating replaces your edits; Undo regenerate brings them back until you close this window.",
};

const READY_CAPTION = `Rewrites the lines under ${PANEL_COPY.improveTitle} using only what your resume supports. Anything it cannot support is set aside and listed, never added.`;

const ROOT_SX = { px: { xs: 1.25, sm: 2 }, py: 1, borderBottom: "1px solid var(--border)" };
const TEXT_SX = { m: 0, fontSize: "0.8rem", color: "var(--text-secondary)", overflowWrap: "anywhere" };
const INFO_SX = { borderLeft: "4px solid var(--accent)", bgcolor: "var(--accent-soft)", px: 1, py: 0.5 };

const hasTail = (counts) => (counts?.unqualified ?? 0) > 0 || (counts?.confirm ?? 0) > 0;

// The sentence under the button for a state that carries a button, or the whole row
// for a state that does not. `reason` is what an unavailable activation announces.
function captionFor({ state, counts, inputs, engineLabel, handEdited }) {
  const tail = hasTail(counts) ? ` ${CAPTIONS.tail}` : "";
  switch (state) {
    case REGENERATE_STATE.READY:
      return { text: `${READY_CAPTION}${tail}${handEdited ? ` ${CAPTIONS.handEdited}` : ""}` };
    case REGENERATE_STATE.RUNNING:
      return { text: CAPTIONS.running };
    case REGENERATE_STATE.NOTHING_TO_ADDRESS:
      return { text: `${CAPTIONS.nothing}${tail}`, reason: CAPTIONS.nothing };
    case REGENERATE_STATE.STALE:
      return { text: CAPTIONS.stale, reason: "Review again before regenerating." };
    case REGENERATE_STATE.NEEDS_MATERIAL: {
      const text = inputs?.realMaterial === false ? CAPTIONS.noResume : inputs?.posting === false ? CAPTIONS.noPosting : CAPTIONS.noResume;
      return { text, reason: text };
    }
    case REGENERATE_STATE.ENGINE_CANNOT: {
      const label = typeof engineLabel === "string" && engineLabel.trim() ? engineLabel.trim() : "the current engine";
      return {
        text: `Regenerating needs the Gemini AI engine. You are on ${label}, which cannot check lines against your resume.`,
        reason: "Regenerating needs the Gemini AI engine.",
        info: true,
      };
    }
    default:
      return { text: "" };
  }
}

export default function RegenerateRow({
  state = REGENERATE_STATE.HIDDEN,
  counts,
  inputs,
  engineLabel,
  handEdited = false,
  hasReport = false,
  failed = false,
  note = "",
  focusSignal = 0,
  onRegenerate,
  onUnavailable,
  announce,
}) {
  const captionId = useId();
  const buttonRef = useRef(null);
  // Only a bump seen while mounted moves focus; a row that remounts keeps the page's.
  const seenSignal = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal === seenSignal.current) return;
    seenSignal.current = focusSignal;
    buttonRef.current?.focus();
  }, [focusSignal]);

  if (state === REGENERATE_STATE.HIDDEN) return null;
  if (state === REGENERATE_STATE.UNSUPPORTED_JOB || state === REGENERATE_STATE.UNSUPPORTED_SCOPE) {
    const sentence = state === REGENERATE_STATE.UNSUPPORTED_JOB ? CAPTIONS.unsupportedJob : CAPTIONS.unsupportedScope;
    return (
      <Box role="group" aria-label="Regenerate" sx={ROOT_SX}>
        <Box component="p" sx={TEXT_SX}>
          {sentence}
        </Box>
      </Box>
    );
  }

  const ready = state === REGENERATE_STATE.READY;
  const running = state === REGENERATE_STATE.RUNNING;
  const caption = captionFor({ state, counts, inputs, engineLabel, handEdited });
  const label = running ? "Regenerating..." : hasReport ? "Regenerate again" : "Regenerate to address weaknesses";

  function activate() {
    if (ready) {
      onRegenerate?.();
      return;
    }
    if (!caption.reason) return;
    announce?.({ polite: caption.reason });
    onUnavailable?.(state);
  }

  function switchToGemini() {
    setEngine("gemini");
    // The Switch button unmounts when the state flips; the Regenerate button does not.
    buttonRef.current?.focus();
    announce?.({ polite: LEVEL_CAPTIONS.switchedToGemini });
  }

  return (
    <Box role="group" aria-label="Regenerate" sx={ROOT_SX}>
      {failed ? (
        <Box component="p" sx={{ ...TEXT_SX, color: "var(--text-primary)", mb: 0.75 }}>
          {CAPTIONS.failed}
        </Box>
      ) : null}
      {note ? (
        <Box component="p" sx={{ ...TEXT_SX, mb: 0.75 }}>
          {note}
        </Box>
      ) : null}
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1.25, rowGap: 0.5 }}>
        <Button
          ref={buttonRef}
          type="button"
          size="small"
          variant="outlined"
          onClick={activate}
          aria-describedby={captionId}
          aria-disabled={ready ? undefined : "true"}
          aria-busy={running ? "true" : undefined}
          startIcon={running ? <CircularProgress size={14} aria-hidden="true" /> : <AutorenewOutlinedIcon fontSize="small" aria-hidden="true" />}
          sx={{ textTransform: "none", ...TOUCH_TARGET_SX, ...(ready ? null : { opacity: 0.7 }) }}
        >
          {label}
        </Button>
        {state === REGENERATE_STATE.ENGINE_CANNOT ? (
          <Button type="button" size="small" variant="outlined" onClick={switchToGemini} sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}>
            Switch to Gemini
          </Button>
        ) : null}
      </Box>
      <Box id={captionId} sx={{ ...TEXT_SX, mt: 0.75, ...(caption.info ? INFO_SX : null) }}>
        {caption.text}
      </Box>
    </Box>
  );
}
