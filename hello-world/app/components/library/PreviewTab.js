"use client";

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "./libraryApi";

// Preview tab: render résumé + cover against the current library (no AI).
export default function PreviewTab() {
  const [posting, setPosting] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      setResult(await api("/api/library/preview", "POST", { posting }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const topKeywords = useMemo(() => {
    const kw = result?.keywords || {};
    const all = [];
    for (const cat of Object.keys(kw)) for (const k of kw[cat] || []) all.push(k.canonical);
    return all.slice(0, 24);
  }, [result]);

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>Preview</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Paste a posting and render the résumé + cover letter against your current library — verify an edit without AI.
      </Typography>
      <TextField fullWidth multiline minRows={6} label="Job posting" value={posting} onChange={(e) => setPosting(e.target.value)} />
      <Button variant="contained" size="small" disableElevation sx={{ mt: 2, textTransform: "none", borderRadius: 1.5 }} onClick={run} disabled={running || !posting.trim()}>
        {running ? "Rendering…" : "Render preview"}
      </Button>
      {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      {result ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2">Detected: {result.jobTitle || "—"}{result.companyName ? ` @ ${result.companyName}` : ""}</Typography>
          <Stack direction="row" spacing={0.5} sx={{ my: 1, flexWrap: "wrap" }}>
            {topKeywords.map((k) => <Chip key={k} size="small" label={k} />)}
          </Stack>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Résumé</Typography>
              <Box component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, p: 1.5, border: "1px solid var(--border)", borderRadius: 1, maxHeight: 480, overflow: "auto" }}>{result.resume}</Box>
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Cover letter</Typography>
              <Box component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, p: 1.5, border: "1px solid var(--border)", borderRadius: 1, maxHeight: 480, overflow: "auto" }}>{result.cover}</Box>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
