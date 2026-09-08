"use client";

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BREAK_LONG_WORDS_SX, TOUCH_FIELD_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";
import { useIsMobile } from "../../hooks/useResponsive";
import { api } from "./libraryApi";

// The two documents this tab renders, as data rather than as two copy-pasted
// JSX blocks - the phone branch shows exactly one of them and the desktop
// branch shows both, and neither should be able to drift from the other.
const DOCUMENTS = [
  { key: "resume", label: "Résumé" },
  { key: "cover", label: "Cover letter" },
];

// One style object for every rendered document pane, phone and desktop alike.
//
// `whiteSpace: "pre-wrap"` breaks at WHITESPACE ONLY, so a long URL or an
// unbroken token in the rendered résumé still overflows - and
// `html { overflow-x: hidden }` clips that overflow rather than scrolling to
// it, i.e. deletes it. BREAK_LONG_WORDS_SX is what lets such a token break;
// it is not phone-scoped because a 12px `<pre>` in a two-column desktop grid
// has the same problem.
//
// The 480px cap and its scroller stay above `sm` and are dropped below it: on
// an 812px-tall phone an inner scroller inside the page scroller steals the
// scroll gesture and hides its contents from find-in-page, and there is
// nothing beside this pane that the cap was protecting the alignment of.
const DOCUMENT_SX = {
  whiteSpace: "pre-wrap",
  ...BREAK_LONG_WORDS_SX,
  fontSize: 12,
  p: 1.5,
  border: "1px solid var(--border)",
  borderRadius: 1,
  maxHeight: { xs: "none", sm: 480 },
  overflow: { xs: "visible", sm: "auto" },
};

// Preview tab: render résumé + cover against the current library (no AI).
//
// ON A PHONE THIS IS A REVIEW SURFACE, NOT A COMPARISON SURFACE. The whole
// point of the two-column layout is reading a résumé against a cover letter
// against a pasted posting in one eye-span. Below `sm` there is no eye-span
// to use: two 12px `<pre>` blocks in 480px-tall nested scrollers inside a
// ~343px column are two long grey blocks you scroll past, not a diff. So the
// phone branch keeps everything that still works at that width - the detected
// title, the matched-keyword chips, the full text of each document - and
// shows ONE document at a time behind a two-button switch, with the
// limitation stated rather than silently applied. Above `sm` the shipped
// side-by-side grid is untouched.
export default function PreviewTab() {
  const isMobile = useIsMobile();
  const [posting, setPosting] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [shown, setShown] = useState("resume");

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
      <TextField fullWidth multiline minRows={6} label="Job posting" value={posting} onChange={(e) => setPosting(e.target.value)} sx={TOUCH_FIELD_SX} />
      <Button variant="contained" size="small" disableElevation sx={{ mt: 2, textTransform: "none", borderRadius: 1.5, ...TOUCH_TARGET_SX }} onClick={run} disabled={running || !posting.trim()}>
        {running ? "Rendering…" : "Render preview"}
      </Button>
      {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      {result ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2">Detected: {result.jobTitle || "—"}{result.companyName ? ` @ ${result.companyName}` : ""}</Typography>
          <Stack direction="row" spacing={0.5} sx={{ my: 1, flexWrap: "wrap" }}>
            {topKeywords.map((k) => <Chip key={k} size="small" label={k} />)}
          </Stack>
          {isMobile ? (
            <>
              {/* Two buttons, not a menu and not a wizard step: switching
                  document is one tap either way, and both destinations are
                  visible before the tap. */}
              <Stack direction="row" spacing={1} sx={{ mb: 1, ...WRAP_ROW_SX }}>
                {DOCUMENTS.map((doc) => (
                  <Button
                    key={doc.key}
                    size="small"
                    disableElevation
                    aria-pressed={shown === doc.key}
                    variant={shown === doc.key ? "contained" : "outlined"}
                    onClick={() => setShown(doc.key)}
                    sx={{ textTransform: "none", borderRadius: 1.5, ...TOUCH_TARGET_SX }}
                  >
                    {doc.label}
                  </Button>
                ))}
              </Stack>
              {/* Stated, not implied. A degraded surface that says nothing
                  reads as the whole feature; this one says what is missing
                  and where to get it. */}
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Showing one document at a time. The side-by-side comparison needs a larger screen.
              </Typography>
              <Box component="pre" sx={DOCUMENT_SX}>
                {shown === "resume" ? result.resume : result.cover}
              </Box>
            </>
          ) : (
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Résumé</Typography>
                <Box component="pre" sx={DOCUMENT_SX}>{result.resume}</Box>
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Cover letter</Typography>
                <Box component="pre" sx={DOCUMENT_SX}>{result.cover}</Box>
              </Box>
            </Box>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
