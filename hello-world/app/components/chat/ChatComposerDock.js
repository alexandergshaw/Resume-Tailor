"use client";

import Box from "@mui/material/Box";

// N123: the Ask-AI panel's composer dock -- the one part of the panel that never
// shrinks, so the composer and Send cannot be pushed out of it by a review result or a
// pile of attachment chips (those live in the body above and give up height first).
// Exactly two rows:
//
//   toolbar   toolbarStart at the left, toolbarEnd at the right, and an optional
//             toolbarNote caption directly under both
//   composer  `children`: the attach control, the input and Send, in that order
//
// This is layout only. Every control is built by the panel and arrives as a slot, so
// the dock owns no state and reads no store: the panel is the one place that knows
// which engine and which preferences are in force.
const DOCK_SX = {
  flex: "0 0 auto",
  borderTop: "1px solid var(--border)",
  p: 1,
  display: "flex",
  flexDirection: "column",
  gap: 0.75,
  backgroundColor: "var(--bg-surface)",
};

export default function ChatComposerDock({ toolbarStart, toolbarEnd, toolbarNote = null, children }) {
  return (
    <Box data-chat-dock sx={DOCK_SX}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0.5 }}>
          {toolbarStart}
          <Box sx={{ ml: "auto", flexShrink: 0 }}>{toolbarEnd}</Box>
        </Box>
        {toolbarNote}
      </Box>
      <Box sx={{ display: "flex", gap: 0.75, alignItems: "flex-end", flexShrink: 0 }}>{children}</Box>
    </Box>
  );
}
