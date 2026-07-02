"use client";

import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";

const AUTO = "__auto__";

// The previewer's "wrong focus" flag: pick which library focus area should
// drive this posting's resume and cover letter. "Auto-detect" restores the
// engine's own matching. Optionally teaches the library — adding the posting's
// title to the chosen area's match terms so similar postings auto-select it —
// but only when the checkbox is explicitly ticked.
//
// Render with a `key` that changes per open so each opening remounts fresh —
// state initializes from props, no reset effects needed.
export default function FocusPickerDialog({ open, currentFocus, override, postingTitle, onClose, onApply }) {
  const [areas, setAreas] = useState(null); // null = loading, [] = none/failed
  const [loadError, setLoadError] = useState("");
  const [choice, setChoice] = useState(() => override || currentFocus?.name || AUTO);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Load the library's focus areas when the dialog opens (they're small, and
  // the user may have edited /library since the last open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/library");
        if (res.status === 401) {
          if (!cancelled) {
            setAreas([]);
            setLoadError("Sign in to use your library's focus areas.");
          }
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Couldn't load your library.");
        if (!cancelled) setAreas(Array.isArray(data?.focusAreas) ? data.focusAreas : []);
      } catch (err) {
        if (!cancelled) {
          setAreas([]);
          setLoadError(err?.message || "Couldn't load your library.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chosenArea = choice !== AUTO ? (areas || []).find((a) => a.name === choice) : null;
  const title = String(postingTitle || "").trim();
  const canRemember = !!chosenArea && !!title && !(chosenArea.match || []).some(
    (t) => String(t).toLowerCase() === title.toLowerCase(),
  );

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Teach the library first (explicit opt-in only): add the posting title
      // to the area's match terms so similar postings auto-select this focus.
      if (remember && canRemember) {
        const res = await fetch("/api/library/focus-areas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...chosenArea, match: [...(chosenArea.match || []), title] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || "Couldn't update the focus area's match terms.");
        }
      }
      const ok = await onApply(choice === AUTO ? "" : choice);
      if (ok === false) throw new Error("Couldn't regenerate with that focus.");
      onClose();
    } catch (err) {
      setError(err?.message || "Couldn't apply the focus.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Set document focus</DialogTitle>
      <DialogContent>
        <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5, mb: 1 }}>
          {currentFocus?.name
            ? `These documents were tailored with the “${currentFocus.name}” focus (${currentFocus.source === "override" ? "pinned by you" : "auto-detected"}).`
            : "No focus area was detected for this posting, so the documents got generic emphasis."}{" "}
          Pick the focus they should have — both documents regenerate with it.
        </Box>
        {areas === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={22} />
          </Box>
        ) : (
          <RadioGroup value={choice} onChange={(e) => setChoice(e.target.value)}>
            <FormControlLabel
              value={AUTO}
              control={<Radio size="small" />}
              label={<Box sx={{ fontSize: "0.9rem" }}>Auto-detect from the posting</Box>}
            />
            {(areas || []).map((a) => (
              <FormControlLabel
                key={a.id || a.name}
                value={a.name}
                control={<Radio size="small" />}
                label={<Box sx={{ fontSize: "0.9rem" }}>{a.name}</Box>}
              />
            ))}
          </RadioGroup>
        )}
        {loadError ? (
          <Box sx={{ mt: 1, fontSize: "0.8rem", color: "var(--danger)" }}>{loadError}</Box>
        ) : null}
        {areas !== null && areas.length === 0 && !loadError ? (
          <Box sx={{ mt: 1, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            Your library has no focus areas yet — add them in /library.
          </Box>
        ) : null}
        {canRemember ? (
          <FormControlLabel
            sx={{ mt: 1, alignItems: "flex-start" }}
            control={
              <Checkbox size="small" checked={remember} onChange={(e) => setRemember(e.target.checked)} sx={{ pt: 0 }} />
            }
            label={
              <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                Auto-select this focus for similar postings (adds “{title}” to the “{chosenArea.name}”
                match terms in your library)
              </Box>
            }
          />
        ) : null}
        {error ? <Box sx={{ mt: 1, fontSize: "0.85rem", color: "var(--danger)" }}>{error}</Box> : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={apply}
          disabled={busy || areas === null}
          variant="contained"
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
          sx={{ textTransform: "none" }}
        >
          Apply &amp; regenerate
        </Button>
      </DialogActions>
    </Dialog>
  );
}
