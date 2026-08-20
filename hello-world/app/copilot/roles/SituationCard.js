"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "../mobileSx";

// AC-Q9.3 - the situation itself: who the user is speaking as, the scene to
// respond to out loud, the one fact that changes how to pitch it, and the
// two actions that move the drill forward. Purely presentational - every
// decision (which situation, whether the reveal is open) lives in
// useRoleDrill.js and arrives here as props, same split as
// app/copilot/practice/SampleAnswer.js draws against its hook.
//
// `situation` is null for the brief window between a role being chosen (or
// the mode mounting) and its first situation landing - nothing to answer out
// loud yet, so the card renders a plain loading line instead of a heading
// with nothing in it.
export default function SituationCard({
  roleLabel,
  situation,
  exhausted,
  revealVisible,
  revealPanelId,
  onToggleReveal,
  situationLoading,
  onNewSituation,
}) {
  if (!situation) {
    return (
      <Typography sx={{ color: "var(--text-secondary)" }}>Loading a situation for {roleLabel}…</Typography>
    );
  }

  return (
    <Stack spacing={1}>
      <Typography variant="caption" sx={{ color: "var(--text-secondary)" }}>
        Speaking as {roleLabel}
      </Typography>
      <Typography variant="h3" sx={{ fontSize: "1.15rem", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
        {situation.prompt}
      </Typography>
      <Typography sx={{ color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}>{situation.context}</Typography>
      <Typography sx={{ color: "var(--text-secondary)" }}>
        Answer it out loud before revealing the model answer below.
      </Typography>
      {exhausted ? (
        <Typography sx={{ color: "var(--text-secondary)" }}>
          You have seen every situation for this role - these will start repeating.
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", ...WRAP_ROW_SX }}>
        <Button
          variant="contained"
          onClick={onToggleReveal}
          aria-expanded={revealVisible}
          aria-controls={revealPanelId}
          sx={TOUCH_TARGET_SX}
        >
          {revealVisible ? "Hide model answer" : "Reveal a model answer"}
        </Button>
        {/* AC-Q9 follow-up (adversarial review): with nothing gating it,
            five fast clicks fired five authenticated fetchRoleSituation
            calls - four discarded by the generation guard in
            useRoleDrill.js, but only after already being sent, and (since
            that guard runs before the asked-list write) never recorded as
            asked either, so the server could serve those same discarded
            situations again later. Disabled for exactly the span of one
            in-flight request. */}
        <Button variant="outlined" onClick={onNewSituation} disabled={situationLoading} sx={TOUCH_TARGET_SX}>
          New situation
        </Button>
      </Stack>
    </Stack>
  );
}
