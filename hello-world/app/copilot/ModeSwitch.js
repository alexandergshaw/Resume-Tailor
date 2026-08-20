"use client";

import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { TOUCH_TARGET_SX } from "./mobileSx";

// AC-Q10.5: split out of CopilotClient.js purely to keep that file under its
// 1000-line cap — this owns the WHOLE mode toggle group: the "Mode:" label,
// all three ToggleButtons, the shared `disabled` state, and MUI's own
// null-on-re-click guard. ToggleButtonGroup reports `val === null` when the
// currently-selected button is clicked again (its own "deselect" behaviour
// for an exclusive group with no button actually meant to be deselectable);
// swallowing that HERE, rather than leaving it to the caller, is what keeps
// the mode from ever being unset regardless of what `onChange` does with it.
export default function ModeSwitch({ value, onChange, disabled }) {
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
    >
      <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
        Mode:
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value}
        disabled={disabled}
        onChange={(_e, val) => {
          if (val === null) return;
          onChange(val);
        }}
      >
        <ToggleButton value="live" sx={{ textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX }}>
          Live interview
        </ToggleButton>
        <ToggleButton value="practice" sx={{ textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX }}>
          Practice
        </ToggleButton>
        <ToggleButton value="roles" sx={{ textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX }}>
          Speak as
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}
