"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import DescriptionIcon from "@mui/icons-material/Description";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

// N105 Step 7 -- the HYPOTHETICAL tab's banner (UX 4.4, M2-M4, M7).
//
// The hypothetical resume is a best case: it describes a stronger candidate than
// the user's record supports, so parts of it are untrue of them. Its safety is
// structural (the file name always begins with the HYPOTHETICAL token, and the
// Drive, Combine and default-template paths refuse it); this band is the part a
// person actually reads, so it is built to be unmissable and unremovable:
//
//   - no state and no close, collapse or dismiss control of any kind: it is
//     rendered for as long as the tab is active;
//   - the file name is plain read-only text, not a field, and wraps instead of
//     clipping, so the token at its start is always visible;
//   - its own download button, since the dialog's Download .docx belongs to the
//     scopes that may be submitted. It is outlined, never the primary style;
//   - it states why Save to Drive, Combine and Set as default do not apply, so
//     their absence does not read as a bug.
//
// Static text only: no live region of its own (the preview's existing pair
// announces what needs announcing), and no tooltip, which would replace the
// button's accessible name.
//
//   fileName    the marked base name the download resolves to
//   onDownload  () => void; the mount routes it to the hypothetical's own bytes
//   busy        a hypothetical download is already in flight

const TITLE = "HYPOTHETICAL - not for submission";
const BODY =
  "An idealized resume for this posting. It describes a stronger candidate than your record shows, so parts of it are not true of you. Use it to see what the posting rewards, and send the Application-ready resume instead.";
const FOOTER =
  "Kept for this session only - download it now if you want to keep it. Save to Drive, Combine and Set as default do not include this document.";

const ROOT_SX = {
  px: { xs: 1.25, sm: 2 },
  py: 1,
  borderBottom: "1px solid var(--border)",
  borderLeft: "4px solid var(--warning)",
  bgcolor: "var(--warning-soft)",
};
const TITLE_SX = { m: 0, fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" };
const TEXT_SX = { m: 0, mt: 0.75, fontSize: "0.82rem", color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX };
const FOOT_SX = { m: 0, mt: 1, fontSize: "0.75rem", color: "var(--text-secondary)" };

export default function HypotheticalBand({ fileName, onDownload, busy = false }) {
  return (
    <Box component="section" aria-label="HYPOTHETICAL resume notice" sx={ROOT_SX}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <WarningAmberIcon fontSize="small" sx={{ color: "var(--warning)", flexShrink: 0 }} />
        <Box component="h3" sx={TITLE_SX}>
          {TITLE}
        </Box>
      </Box>
      <Box component="p" sx={TEXT_SX}>
        {BODY}
      </Box>
      <Box component="p" sx={TEXT_SX}>
        File name:{" "}
        <Box component="span" data-quoted="true" sx={{ fontWeight: 600 }}>
          {fileName}
        </Box>
      </Box>
      <Button
        type="button"
        variant="outlined"
        size="small"
        startIcon={<DescriptionIcon />}
        disabled={busy}
        onClick={onDownload}
        sx={{ ...TOUCH_TARGET_SX, mt: 1, textTransform: "none" }}
      >
        Download hypothetical .docx
      </Button>
      <Box component="p" sx={FOOT_SX}>
        {FOOTER}
      </Box>
    </Box>
  );
}
