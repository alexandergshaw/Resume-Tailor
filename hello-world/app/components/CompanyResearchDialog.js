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
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { weaveSourcesAnnotated, placementOptions, DEFAULT_PLACEMENT } from "@/lib/document/coverLetterWeave";
import { useIsMobile } from "../hooks/useResponsive";

const PLACEMENT_OPTS = placementOptions();

// Research the target company, pick which recent positive articles (plus any URL
// you paste) to reference, then arrange where each lands in the cover letter and
// preview the woven result before inserting.
export default function CompanyResearchDialog({
  open,
  company = "",
  needsCompany = false,
  loading = false,
  error = "",
  articles = [],
  warnings = [],
  busy = false,
  coverLetterLines = [],
  onClose,
  onApply,
  onResearch,
  onAddUrl,
}) {
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState(() => new Set());
  const [suggestions, setSuggestions] = useState({});
  const [targets, setTargets] = useState({});
  const [companyInput, setCompanyInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [step, setStep] = useState("pick"); // "pick" | "arrange"
  const [prevArticles, setPrevArticles] = useState(articles);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStep("pick");
      setUrlInput("");
      setCompanyInput("");
    }
  }
  if (articles !== prevArticles) {
    setPrevArticles(articles);
    setSelected(new Set((articles || []).map((a) => a.id)));
    setSuggestions(Object.fromEntries((articles || []).map((a) => [a.id, a.suggestion || ""])));
    setTargets((prev) => {
      const next = { ...prev };
      for (const a of articles || []) if (!next[a.id]) next[a.id] = DEFAULT_PLACEMENT;
      return next;
    });
  }

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const setSuggestion = (id, v) => setSuggestions((p) => ({ ...p, [id]: v }));
  const setTarget = (id, v) => setTargets((p) => ({ ...p, [id]: v }));
  const copy = (t) => {
    try {
      navigator.clipboard?.writeText(t);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const chosen = () =>
    (articles || [])
      .filter((a) => selected.has(a.id))
      .map((a) => ({
        ...a,
        suggestion: (suggestions[a.id] ?? a.suggestion ?? "").trim(),
        target: targets[a.id] || DEFAULT_PLACEMENT,
      }))
      .filter((a) => a.suggestion);

  const addUrl = async () => {
    const u = urlInput.trim();
    if (!u || !onAddUrl) return;
    setAddingUrl(true);
    try {
      await onAddUrl(u);
      setUrlInput("");
    } finally {
      setAddingUrl(false);
    }
  };

  const previewParagraphs = () =>
    weaveSourcesAnnotated(coverLetterLines, chosen().map((c) => ({ target: c.target, suggestion: c.suggestion })));

  const renderPick = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary, #777)" }}>
        Pick the articles to reference (you can edit each suggestion). Next, you&apos;ll choose where each goes
        and preview the letter.
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
                  <IconButton size="small" component="a" href={a.url} target="_blank" rel="noopener noreferrer" sx={{ p: 0.25 }}>
                    <OpenInNewIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Box>
            <Box sx={{ fontSize: "0.72rem", color: "var(--text-secondary, #777)" }}>
              {[a.source, a.date].filter(Boolean).join(" · ")}
            </Box>
            {a.summary ? <Box sx={{ fontSize: "0.82rem", mt: 0.5 }}>{a.summary}</Box> : null}
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
      {/* Add your own article URL */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", pt: 0.5 }}>
        <TextField
          size="small"
          fullWidth
          label="Add an article URL"
          placeholder="https://…"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && urlInput.trim()) addUrl();
          }}
        />
        <Button onClick={addUrl} disabled={!urlInput.trim() || addingUrl} sx={{ textTransform: "none", whiteSpace: "nowrap" }}>
          {addingUrl ? "Adding…" : "Add"}
        </Button>
      </Box>
    </Box>
  );

  const renderArrange = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary, #777)" }}>
        Choose where each reference goes — the connecting wording adapts to the paragraph. The preview updates
        as you change placements.
      </Box>
      {chosen().map((c) => (
        <Box key={c.id} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Box sx={{ flex: 1, minWidth: 160, fontSize: "0.82rem" }}>{c.title}</Box>
          <Select size="small" value={c.target} onChange={(e) => setTarget(c.id, e.target.value)} sx={{ fontSize: "0.8rem", minWidth: 170 }}>
            {PLACEMENT_OPTS.map((o) => (
              <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>
            ))}
          </Select>
        </Box>
      ))}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
        <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #555)" }}>Preview</Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.72rem", color: "var(--text-secondary, #777)" }}>
          <Box component="span" sx={{ bgcolor: "rgba(255,213,79,0.55)", borderRadius: "2px", px: 0.5 }}>highlighted</Box>
          = added from research
        </Box>
      </Box>
      <Box
        sx={{
          fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif',
          fontSize: "0.85rem",
          lineHeight: 1.45,
          bgcolor: "#fff",
          color: "#111",
          border: "1px solid var(--border, #e0e0e0)",
          borderRadius: 1,
          p: 2,
          maxHeight: 320,
          overflowY: "auto",
        }}
      >
        {previewParagraphs().map((para, pi) => (
          <Box key={pi} component="p" sx={{ m: 0, mb: 1.25, "&:last-of-type": { mb: 0 } }}>
            {para.map((seg, si) =>
              seg.insert ? (
                <Box
                  key={si}
                  component="mark"
                  sx={{ bgcolor: "rgba(255,213,79,0.55)", color: "inherit", borderRadius: "2px", px: 0.25 }}
                >
                  {seg.text}
                </Box>
              ) : (
                <span key={si}>{seg.text}</span>
              ),
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );

  const showPickEmpty = !needsCompany && !loading && !error && (articles || []).length === 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 0.5 }}>
        Company research{company ? ` — ${company}` : ""}
        {step === "arrange" ? " · arrange" : ""}
      </DialogTitle>
      <DialogContent dividers>
        {needsCompany && (articles || []).length === 0 && !loading ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 2 }}>
            <Box sx={{ fontSize: "0.9rem" }}>
              No company name was detected for this posting, so no research was done. Enter the company name to
              research recent, positive coverage — or paste a specific article URL below.
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
              <Button variant="contained" onClick={() => onResearch?.(companyInput.trim())} disabled={!companyInput.trim()} sx={{ textTransform: "none" }}>
                Research
              </Button>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField size="small" fullWidth label="…or add an article URL" placeholder="https://…" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
              <Button onClick={addUrl} disabled={!urlInput.trim() || addingUrl} sx={{ textTransform: "none" }}>
                {addingUrl ? "Adding…" : "Add"}
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
        ) : showPickEmpty ? (
          <Box sx={{ color: "var(--text-secondary, #777)", fontSize: "0.9rem", py: 2 }}>
            No articles found. Try again or paste an article URL.
          </Box>
        ) : step === "arrange" ? (
          renderArrange()
        ) : (
          renderPick()
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Close
        </Button>
        <Box sx={{ flex: 1 }} />
        {step === "arrange" ? (
          <>
            <Button onClick={() => setStep("pick")} sx={{ textTransform: "none" }}>
              Back
            </Button>
            <Button variant="contained" onClick={() => onApply(chosen())} disabled={busy || chosen().length === 0} sx={{ textTransform: "none" }}>
              {busy ? "Inserting…" : "Insert into cover letter"}
            </Button>
          </>
        ) : (articles || []).length > 0 ? (
          <Button variant="contained" onClick={() => setStep("arrange")} disabled={chosen().length === 0} sx={{ textTransform: "none" }}>
            Next: arrange ({chosen().length})
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
