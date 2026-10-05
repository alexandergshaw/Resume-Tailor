"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import UndoOutlinedIcon from "@mui/icons-material/UndoOutlined";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import ActivityLogButton from "../ActivityLogButton";
import CappedList from "./CappedList";
import { Group } from "./ReviewFlagsPanel";

// N104 -- "What regenerating changed". A props-only leaf that draws the
// regenerateReportView view-model (headline, groups, sentences, footer) and offers
// Undo; every word of its own wording comes from that view-model, so the report can
// claim nothing the comparison did not measure and the guard that withholds
// per-suggestion claims is applied in exactly one place.
//
//   view    regenerateReportView(...) output
//   onUndo  restores the version from before the regenerate; the button is absent
//           when nothing was replaced (the text came out the same) or no undo is held
//
// A posting keyword is the posting's text, not this report's wording: it is marked
// `data-quoted` like every other quoted line in the review surfaces. The report
// mounts no live region of its own; the preview's announcer says the outcome.

const ROOT_SX = { pb: 1, mb: 1, borderBottom: "1px solid var(--border)" };
const TEXT_SX = { m: 0, mt: 0.75, fontSize: "0.8rem", color: "var(--text-secondary)", overflowWrap: "anywhere" };
const ROW_SX = { py: 0.5, borderTop: "1px solid var(--border)" };

function ReportRow({ row }) {
  return (
    <Box component="li" sx={ROW_SX}>
      <Box component="span" sx={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>
        {row.label}
      </Box>
      {row.term ? (
        <>
          {" - "}
          <Box component="q" data-quoted="true" sx={{ fontSize: "0.85rem" }}>
            {row.term}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

export default function RegenerateReport({ view, onUndo }) {
  if (!view) return null;
  const canUndo = view.unchanged !== true && typeof onUndo === "function";
  return (
    <Box component="section" aria-label="What regenerating changed" sx={ROOT_SX}>
      <Box component="p" sx={{ m: 0, fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)" }}>
        {view.headline}
      </Box>
      {(view.groups || []).map((group) => (
        <Group key={group.title} title={group.title} hint={group.hint}>
          <CappedList items={group.rows} renderItem={(row) => <ReportRow key={row.key} row={row} />} />
        </Group>
      ))}
      {(view.lines || []).map((line) => (
        <Box key={line} component="p" sx={TEXT_SX}>
          {line}
        </Box>
      ))}
      <Box component="p" sx={TEXT_SX}>
        {view.footer}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1.25, rowGap: 0.5, mt: 1 }}>
        {canUndo ? (
          <Button
            type="button"
            size="small"
            variant="outlined"
            onClick={onUndo}
            startIcon={<UndoOutlinedIcon fontSize="small" aria-hidden="true" />}
            sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}
          >
            Undo regenerate
          </Button>
        ) : null}
        <Box sx={{ flex: "1 1 11rem", minWidth: 0 }}>
          <ActivityLogButton />
        </Box>
      </Box>
    </Box>
  );
}
