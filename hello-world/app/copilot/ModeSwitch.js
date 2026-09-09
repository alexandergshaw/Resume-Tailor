"use client";

import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";

// AC-Q10.5: split out of CopilotClient.js purely to keep that file under its
// 1000-line cap — this owns the WHOLE mode toggle group: the "Mode:" label,
// all three ToggleButtons, the shared `disabled` state, and MUI's own
// null-on-re-click guard. ToggleButtonGroup reports `val === null` when the
// currently-selected button is clicked again (its own "deselect" behaviour
// for an exclusive group with no button actually meant to be deselectable);
// swallowing that HERE, rather than leaving it to the caller, is what keeps
// the mode from ever being unset regardless of what `onChange` does with it.
// MOBILE-G F-03, MEASURED AND NOT REPRODUCED — recorded here so it is not
// re-litigated. The audit ranked this group with SessionSetup.js's own
// ToggleButtonGroup, which stacks below `sm` because its min-content measured
// 269.8px against 252px of available width at 320. This one does not need
// that: measured in a browser (Manrope, this component's own serialized CSS
// and DOM), the group is 263.97px wide — buttons 109.06 / 76.61 / 80.30 —
// against 296px of content width at 320 (the live root's `p: { xs: 1.5 }`
// gutters) and 351px at 375. It clears by 22.03px at 320 and 36.31px at 375,
// with scrollWidth == clientWidth at both, so it never overflows itself
// either. Stacking it would have added ~100px above the fold on every phone
// to fix nothing. See ModeSwitch.mobile.test.js for the full table.
//
// What that clearance DEPENDS on is the wrap below: at 320 the label plus the
// group is 317px, so the group only gets its 296px because the row wraps it
// onto a line of its own (measured row height 72.02px at 320 vs 44.00px at
// 375, where both fit together). That is why the wrap now comes from the
// app-wide WRAP_ROW_SX rather than a hand-written `{ flexWrap: "wrap",
// rowGap: 1 }` holding the same values by coincidence — the copy was
// invisible to app/theme/mobileSx.test.js's no-copies sweep, which only walks
// for `const TOUCH_*` names and hand-rolled tap floors.
export default function ModeSwitch({ value, onChange, disabled }) {
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{ mb: 2, alignItems: "center", ...WRAP_ROW_SX }}
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
