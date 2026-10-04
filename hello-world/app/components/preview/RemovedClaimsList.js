"use client";

import { useId, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { writePlainText } from "@/lib/clipboard/plainText";
import { UNVERIFIED_FLAG } from "@/lib/llm/ideal/applicationReadyGate";
import {
  PANEL_COPY,
  leftOutTitle,
  removalReason,
  removedCopyOutcome,
  removedTitle,
  textRows,
} from "@/lib/review/flagPresentation";
import CappedList, { LIST_RESET_SX } from "./CappedList";

// N105 Step 8-UI -- the gate-output lists (UX-25, UX-36). Two groups, never
// mixed, each omitted when empty:
//
//   Removed - verify and add back (n)   claims the gate partly matched to the
//       user's resume and took OUT of the file. Each row shows the claim IN FULL
//       (never clamped: the user must read all of it to decide), where it would
//       sit, why it was removed, the AC-4 flag tag, and a "Copy line" button that
//       copies exactly the claim text. The user pastes it back through the
//       existing Edit toggle; a person, not the pipeline, is the only thing that
//       can put it into the document.
//   Left out because ... (n)   claims nothing in the resume supports. Collapsed,
//       and with NO controls of any kind: they are shown so a thinner file is
//       explained, not offered back.
//
// `onOutcome(outcome)` is the preview's announce seam: it receives the copy
// result as { polite, alert, visible, persist } so the dialog's existing
// live-region pair announces it. When the caller supplies none, the group shows
// the outcome itself in its own live regions, so a copy is never silent.
//
// Claim text and the employer a claim sits under are the user's own words, so
// both are marked `data-quoted` (the band's clean-verdict sweep excludes them).
// The AC-4 flag string is IMPORTED, never retyped, and appears only here, never
// in the file.

const ROW_SX = { py: 0.75, borderTop: "1px solid var(--border)" };
const CLAIM_SX = { fontSize: "0.85rem", color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX };
const META_SX = { fontSize: "0.8rem", color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX };
const TITLE_SX = { m: 0, fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)" };
const TAG_SX = {
  display: "inline-block",
  px: 0.75,
  border: "1px solid var(--border-control)",
  borderRadius: 1,
  fontSize: "0.75rem",
  color: "var(--text-primary)",
};
const FOCUS_SX = { "&:focus-visible": { outline: "2px solid var(--accent)", outlineOffset: "2px" } };

function whereItSits(item) {
  if (typeof item.contextKey === "string" && item.contextKey.trim() !== "") {
    return (
      <>
        Under: <span data-quoted="true">{item.contextKey}</span>
      </>
    );
  }
  if (typeof item.section === "string" && item.section.trim() !== "") {
    return (
      <>
        Section: <span data-quoted="true">{item.section}</span>
      </>
    );
  }
  return null;
}

function RemovedRow({ item, onCopy }) {
  const claimId = useId();
  const where = whereItSits(item);
  return (
    <Box component="li" sx={ROW_SX}>
      <Box id={claimId} data-quoted="true" sx={CLAIM_SX}>
        {item.text}
      </Box>
      {where ? <Box sx={META_SX}>{where}</Box> : null}
      <Box sx={META_SX}>{removalReason(item.reasonCode)}</Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mt: 0.5 }}>
        <Box component="span" sx={TAG_SX}>
          {UNVERIFIED_FLAG}
        </Box>
        <Button
          type="button"
          size="small"
          variant="outlined"
          startIcon={<ContentCopyIcon />}
          aria-describedby={claimId}
          // A pointer press must not take focus from the document editor: its
          // blur runs the auto-save. The action itself is on onClick.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onCopy(item.text)}
          sx={{ ...TOUCH_TARGET_SX, ...FOCUS_SX }}
        >
          Copy line
        </Button>
      </Box>
    </Box>
  );
}

// The local fallback for the copy outcome: both regions stay mounted (empty until
// there is something to say) so a screen reader announces the text when it lands.
function LocalOutcome({ outcome }) {
  return (
    <>
      <Box role="status" sx={{ fontSize: "0.8rem", color: "var(--success)" }}>
        {outcome?.polite ?? ""}
      </Box>
      <Box role="alert" sx={{ fontSize: "0.8rem", color: "var(--danger)" }}>
        {outcome?.alert ?? ""}
      </Box>
    </>
  );
}

export function RemovedGroup({ removed, onOutcome }) {
  const titleId = useId();
  const [local, setLocal] = useState(null);
  const rows = textRows(removed);
  if (rows.length === 0) return null;

  const report = typeof onOutcome === "function" ? onOutcome : setLocal;
  const handleCopy = async (text) => {
    // "edit" fences writePlainText's off-screen-textarea fallback: its select()
    // would take focus from a document editor that may be open beside this list.
    // The async clipboard and the copy event do not touch focus, and a failure
    // tells the user to select the (selectable) line and copy it themselves.
    const result = await writePlainText(text, { mode: "edit" });
    report(removedCopyOutcome(result));
  };

  return (
    <Box component="section" aria-labelledby={titleId} sx={{ mt: 1 }}>
      <Box component="h3" id={titleId} sx={TITLE_SX}>
        {removedTitle(rows.length)}
      </Box>
      <Box component="p" sx={{ ...META_SX, m: 0 }}>
        {PANEL_COPY.removedHint}
      </Box>
      <CappedList
        items={rows}
        renderItem={(item, index) => <RemovedRow key={item.spanId ?? index} item={item} onCopy={handleCopy} />}
      />
      {typeof onOutcome === "function" ? null : <LocalOutcome outcome={local} />}
    </Box>
  );
}

export function LeftOutGroup({ leftOut }) {
  const rows = textRows(leftOut);
  if (rows.length === 0) return null;
  return (
    <Box component="details" sx={{ mt: 1 }}>
      {/* Left at its default list-item display: any other value hides the native
          disclosure marker, the only visual cue that this title opens. */}
      <Box component="summary" sx={{ ...TITLE_SX, ...TOUCH_TARGET_SX, py: 0.75, cursor: "pointer", ...FOCUS_SX }}>
        {leftOutTitle(rows.length)}
      </Box>
      <Box component="ul" role="list" sx={LIST_RESET_SX}>
        {rows.map((item, index) => (
          <Box component="li" key={item.spanId ?? index} sx={ROW_SX}>
            <Box data-quoted="true" sx={CLAIM_SX}>
              {item.text}
            </Box>
            <Box sx={META_SX}>{removalReason(item.reasonCode)}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function RemovedClaimsList({ removed = [], leftOut = [], onOutcome }) {
  return (
    <>
      <RemovedGroup removed={removed} onOutcome={onOutcome} />
      <LeftOutGroup leftOut={leftOut} />
    </>
  );
}
