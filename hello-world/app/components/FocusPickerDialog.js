"use client";

import { useEffect, useMemo, useState } from "react";
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
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";

const AUTO = "__auto__";

// Categories whose extracted keywords are worth toggling (matches the skill
// categories the slot mapper actually consumes).
const SKILL_CATS = ["technology", "tool_platform", "domain", "methodology", "soft_skill", "certification", "subject"];
const MAX_LISTED = 24;

// The previewer's "wrong focus" modal: pick which library focus area should
// drive this posting's documents, AND pick-and-choose the buzzwords applied —
// uncheck a term to remove it from both documents (alias-aware, including the
// focus area's own emphasis lists), or add one to emphasize it. Optionally
// teaches the library (adds the posting's title to the chosen area's match
// terms) — only when the checkbox is explicitly ticked.
//
// Render with a `key` that changes per open so each opening remounts fresh —
// state initializes from props, no reset effects needed.
export default function FocusPickerDialog({
  open,
  currentFocus,
  override,
  keywords,
  keywordEdits,
  postingTitle,
  onClose,
  onApply,
}) {
  const [areas, setAreas] = useState(null); // null = loading, [] = none/failed
  const [loadError, setLoadError] = useState("");
  const [choice, setChoice] = useState(() => override || currentFocus?.name || AUTO);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Buzzword toggles: everything the engine extracted for this posting, plus
  // any previously-excluded terms (kept visible so they can be re-enabled).
  const listed = useMemo(() => {
    const items = [];
    const seen = new Set();
    for (const cat of SKILL_CATS) {
      for (const it of keywords?.[cat] || []) {
        const key = String(it.canonical).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ canonical: it.canonical, category: cat, score: it.score || 0 });
      }
    }
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, MAX_LISTED);
    for (const name of keywordEdits?.exclude || []) {
      const key = String(name).toLowerCase();
      if (!top.some((i) => i.canonical.toLowerCase() === key)) {
        top.push({ canonical: name, category: "", score: 0 });
      }
    }
    return top;
  }, [keywords, keywordEdits]);

  const [excluded, setExcluded] = useState(
    () => new Set((keywordEdits?.exclude || []).map((n) => String(n).toLowerCase())),
  );
  const [boosts, setBoosts] = useState(() => [...(keywordEdits?.boost || [])]);
  const [addText, setAddText] = useState("");

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

  function toggleTerm(name) {
    const key = String(name).toLowerCase();
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addBoost() {
    const name = addText.trim();
    if (!name) return;
    setBoosts((prev) =>
      prev.some((b) => b.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name],
    );
    setAddText("");
  }

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
      const exclude = listed
        .filter((i) => excluded.has(i.canonical.toLowerCase()))
        .map((i) => i.canonical);
      const edits = boosts.length > 0 || exclude.length > 0 ? { boost: boosts, exclude } : null;
      const ok = await onApply(choice === AUTO ? "" : choice, edits);
      if (ok === false) throw new Error("Couldn't regenerate with those settings.");
      onClose();
    } catch (err) {
      setError(err?.message || "Couldn't apply the changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Set document focus &amp; buzzwords</DialogTitle>
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

        {listed.length > 0 ? (
          <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid var(--border)" }}>
            <Box sx={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>
              Buzzwords for this posting
            </Box>
            <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4, mt: 0.25, mb: 0.75 }}>
              Uncheck a term to remove it from both documents (it also comes out of the focus
              area&apos;s emphasis lists). Add a term to make the documents lead with it.
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                columnGap: 1,
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {listed.map((item) => (
                <Box key={item.canonical} sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                  <Checkbox
                    size="small"
                    checked={!excluded.has(item.canonical.toLowerCase())}
                    onChange={() => toggleTerm(item.canonical)}
                    sx={{ p: 0.5 }}
                  />
                  <Box sx={{ fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.canonical}
                  </Box>
                  {item.category ? (
                    <Box sx={{ flexShrink: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
                      {item.category.replace(/_/g, " ")}
                    </Box>
                  ) : null}
                </Box>
              ))}
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Add a buzzword to emphasize (must be in your library's taxonomy)"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBoost();
                  }
                }}
              />
              <Button size="small" variant="outlined" onClick={addBoost} disabled={!addText.trim()} sx={{ textTransform: "none" }}>
                Add
              </Button>
            </Box>
            {boosts.length > 0 ? (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
                {boosts.map((b) => (
                  <Chip
                    key={b}
                    size="small"
                    label={`emphasize: ${b}`}
                    onDelete={() => setBoosts((prev) => prev.filter((x) => x !== b))}
                  />
                ))}
              </Box>
            ) : null}
          </Box>
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
