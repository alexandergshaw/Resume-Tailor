"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useIsMobile } from "../hooks/useResponsive";

// Research the target company, then pick which recent positive articles to
// reference in the cover letter. Articles arrive asynchronously after the dialog
// opens, so the editable draft re-seeds whenever the articles change.
export default function CompanyResearchDialog({
  open,
  company = "",
  needsCompany = false,
  loading = false,
  error = "",
  articles = [],
  warnings = [],
  busy = false,
  onClose,
  onApply,
  onResearch,
  placementNote = "",
}) {
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState(() => new Set());
  const [suggestions, setSuggestions] = useState({});
  const [companyInput, setCompanyInput] = useState("");
  const [prevArticles, setPrevArticles] = useState(articles);

  if (articles !== prevArticles) {
    setPrevArticles(articles);
    setSelected(new Set((articles || []).map((a) => a.id))); // default: all checked
    setSuggestions(Object.fromEntries((articles || []).map((a) => [a.id, a.suggestion || ""])));
  }

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const setSuggestion = (id, value) => setSuggestions((prev) => ({ ...prev, [id]: value }));
  const copy = (text) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const chosen = () =>
    (articles || [])
      .filter((a) => selected.has(a.id))
      .map((a) => ({ ...a, suggestion: (suggestions[a.id] ?? a.suggestion ?? "").trim() }))
      .filter((a) => a.suggestion);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 0.5 }}>
        Company research{company ? ` — ${company}` : ""}
      </DialogTitle>
      <DialogContent dividers>
        {needsCompany && (articles || []).length === 0 && !loading ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 2 }}>
            <Box sx={{ fontSize: "0.9rem" }}>
              No company name was detected for this posting, so no research was done. Enter the company
              name to research recent, positive coverage to reference in your cover letter.
            </Box>
            {error ? <Box sx={{ color: "var(--danger, #d32f2f)", fontSize: "0.85rem" }}>{error}</Box> : null}
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                size="small"
                fullWidth
                autoFocus
                label="Company name"
                value={companyInput}
                onChange={(e) => setCompanyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && companyInput.trim()) onResearch?.(companyInput.trim());
                }}
              />
              <Button
                variant="contained"
                onClick={() => onResearch?.(companyInput.trim())}
                disabled={!companyInput.trim()}
                sx={{ textTransform: "none", whiteSpace: "nowrap" }}
              >
                Research
              </Button>
            </Box>
          </Box>
        ) : loading ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, py: 5 }}>
            <CircularProgress />
            <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary, #777)" }}>
              Searching for recent, positive coverage of {company || "the company"}…
            </Box>
          </Box>
        ) : error ? (
          <Box sx={{ color: "var(--danger, #d32f2f)", fontSize: "0.9rem", py: 2 }}>{error}</Box>
        ) : (articles || []).length === 0 ? (
          <Box sx={{ color: "var(--text-secondary, #777)", fontSize: "0.9rem", py: 2 }}>
            No articles found. Try again or check the company name.
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary, #777)" }}>
              Pick the articles you want to reference. {placementNote || "The chosen suggestion(s) are woven into your opening paragraph"} — each is editable and also copyable to insert yourself.
            </Box>
            {(warnings || []).map((w, i) => (
              <Box key={i} sx={{ fontSize: "0.78rem", color: "#9a6700", bgcolor: "rgba(255,193,7,0.12)", p: 1, borderRadius: 1 }}>
                {w}
              </Box>
            ))}
            {(articles || []).map((a) => (
              <Box
                key={a.id}
                sx={{
                  display: "flex",
                  gap: 1,
                  p: 1.5,
                  border: "1px solid var(--border, #e0e0e0)",
                  borderRadius: 1,
                  bgcolor: selected.has(a.id) ? "rgba(25,118,210,0.05)" : "transparent",
                }}
              >
                <Checkbox checked={selected.has(a.id)} onChange={() => toggle(a.id)} sx={{ p: 0.5, mt: -0.25 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
                    <Box sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{a.title}</Box>
                    {a.url ? (
                      <Tooltip title={a.url}>
                        <IconButton
                          size="small"
                          component="a"
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ p: 0.25 }}
                        >
                          <OpenInNewIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Box>
                  <Box sx={{ fontSize: "0.72rem", color: "var(--text-secondary, #777)" }}>
                    {[a.source, a.date].filter(Boolean).join(" · ")}
                  </Box>
                  {a.summary ? (
                    <Box sx={{ fontSize: "0.82rem", mt: 0.5 }}>{a.summary}</Box>
                  ) : null}
                  <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mt: 1 }}>
                    <TextField
                      size="small"
                      fullWidth
                      multiline
                      maxRows={4}
                      label="Cover-letter suggestion"
                      value={suggestions[a.id] ?? ""}
                      onChange={(e) => setSuggestion(a.id, e.target.value)}
                    />
                    <Tooltip title="Copy suggestion">
                      <IconButton size="small" onClick={() => copy(suggestions[a.id] ?? "")} sx={{ mt: 0.5 }}>
                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Close
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={() => onApply(chosen())}
          disabled={busy || loading || chosen().length === 0}
          sx={{ textTransform: "none" }}
        >
          {busy ? "Adding…" : `Add ${chosen().length || ""} to cover letter`.trim()}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
