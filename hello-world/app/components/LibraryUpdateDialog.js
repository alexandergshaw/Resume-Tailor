"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import { TAXONOMY_CATEGORIES } from "@/lib/llm/engines/tailor-lite/library/validate";

// Uncategorized suggestions (RAKE phrases) need a category before import;
// posting-domain vocabulary fits "subject" best as a default.
const DEFAULT_CATEGORY = "subject";

// Permission prompt for the automatic buzzword scrape: when an embedded tailor
// covers too little of the posting, /api/tailor returns the posting terms the
// user's library lacks. NOTHING is saved until the user confirms here — rows
// they leave unchecked are discarded.
//
// Render with a `key` tied to the prompt (e.g. its jobId) so a new prompt
// remounts the dialog and row state initializes fresh — no effects needed.
export default function LibraryUpdateDialog({ prompt, onClose, onCommit }) {
  const open = !!prompt;
  const buzzwords = prompt?.suggestions?.buzzwords || [];

  // Per-row selection + category, keyed by canonical (fresh per mount).
  const [rows, setRows] = useState(() =>
    buzzwords.map((b) => ({
      canonical: b.canonical,
      category: b.category || DEFAULT_CATEGORY,
      recognized: !!b.category,
      checked: true,
      aliases: Array.isArray(b.aliases) ? b.aliases : [],
      matchCanonical: b.match_canonical !== false,
      seenCount: b.seenCount || 0,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = rows.filter((r) => r.checked);
  const scorePct = Math.round((prompt?.match?.score ?? 0) * 100);
  const fromEdit = prompt?.source === "edit";

  function setRow(i, patch) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function commit(retailor) {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const entries = selected.map((r) => ({
      canonical: r.canonical,
      category: r.category,
      aliases: r.aliases,
      ...(r.matchCanonical === false ? { match_canonical: false } : {}),
    }));
    const result = await onCommit(entries, { retailor });
    setBusy(false);
    if (!result?.ok) setError(result?.error || "Couldn't save to your library.");
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Update your tailoring library?</DialogTitle>
      <DialogContent>
        <Box sx={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.5, mb: 1.5 }}>
          {fromEdit
            ? "Your edits added wording the tailoring library doesn't know yet — adding it teaches the engine to produce it on its own next time. Check the terms worth keeping — nothing is saved until you confirm."
            : `The generated documents covered only ${scorePct}% of this posting's key terms, so the posting was scanned for vocabulary your library doesn't know yet. Check the terms worth keeping — nothing is saved until you confirm.`}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, maxHeight: 320, overflowY: "auto" }}>
          {rows.map((r, i) => (
            <Box key={r.canonical} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Checkbox
                size="small"
                checked={r.checked}
                onChange={(e) => setRow(i, { checked: e.target.checked })}
                sx={{ p: 0.5 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                  <Box sx={{ fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.canonical}
                  </Box>
                  {r.seenCount >= 2 ? (
                    <Box
                      component="span"
                      title="This term has been a coverage gap in multiple postings you've tailored — it's systematically missing, not a one-off."
                      sx={{
                        flexShrink: 0,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        color: "var(--accent)",
                        backgroundColor: "var(--accent-soft)",
                        borderRadius: 1,
                        px: 0.5,
                        py: 0.1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      seen in {r.seenCount} postings
                    </Box>
                  ) : null}
                </Box>
                {r.aliases.length > 0 ? (
                  <Box sx={{ fontSize: "0.7rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    also matches: {r.aliases.join(", ")}
                  </Box>
                ) : null}
              </Box>
              <Select
                size="small"
                value={r.category}
                onChange={(e) => setRow(i, { category: e.target.value })}
                disabled={r.recognized}
                sx={{ fontSize: "0.8rem", minWidth: 130 }}
              >
                {TAXONOMY_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c} sx={{ fontSize: "0.8rem" }}>
                    {c.replace(/_/g, " ")}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          ))}
        </Box>
        {error ? (
          <Box sx={{ mt: 1, color: "var(--danger)", fontSize: "0.85rem" }}>{error}</Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: "wrap" }}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: "none" }}>
          Not now
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={() => commit(false)}
          disabled={busy || selected.length === 0}
          variant={fromEdit ? "contained" : "outlined"}
          startIcon={fromEdit && busy ? <CircularProgress size={14} color="inherit" /> : null}
          sx={{ textTransform: "none" }}
        >
          Add {selected.length || ""} to library
        </Button>
        {/* Re-tailoring after a hand-edit would overwrite the user's edits, so
            the edit-sourced prompt only offers the plain library add. */}
        {!fromEdit ? (
          <Button
            onClick={() => commit(true)}
            disabled={busy || selected.length === 0}
            variant="contained"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
            sx={{ textTransform: "none" }}
          >
            Add &amp; re-tailor
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
