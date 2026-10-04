"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { GROUP_ROW_CAP } from "@/lib/review/flagPresentation";

// A review group's list: at most GROUP_ROW_CAP rows, then one "Show all (n)"
// control. Shared by the reviewer-flag panel and the removed-claims list so the
// two cap the same way.
//
// The control stays mounted after it is used (it flips to "Show fewer") rather
// than vanishing: a control that unmounts under keyboard focus drops the user to
// <body>. No Tooltip wrapper: MUI's Tooltip can steal a control's accessible
// name, and this control's visible text IS its name.
//
// `role="list"` is set explicitly because `list-style: none` removes list
// semantics in Safari.
export const LIST_RESET_SX = { listStyle: "none", m: 0, p: 0 };

export default function CappedList({ items, renderItem, cap = GROUP_ROW_CAP }) {
  const [expanded, setExpanded] = useState(false);
  const list = Array.isArray(items) ? items : [];
  const overflow = list.length > cap;
  const shown = expanded || !overflow ? list : list.slice(0, cap);
  return (
    <>
      <Box component="ul" role="list" sx={LIST_RESET_SX}>
        {shown.map(renderItem)}
      </Box>
      {overflow ? (
        <Button
          type="button"
          size="small"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          sx={{ ...TOUCH_TARGET_SX, mt: 0.5, "&:focus-visible": { outline: "2px solid var(--accent)", outlineOffset: "2px" } }}
        >
          {expanded ? "Show fewer" : `Show all (${list.length})`}
        </Button>
      ) : null}
    </>
  );
}
