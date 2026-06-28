"use client";

import { useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";

import styles from "../page.module.css";

const ACCEPT = "image/png,image/jpeg,image/webp";

// Per-status presentation. "processing" covers reading the image + finding the
// URL + tailoring; the item's statusLabel carries the specific step.
const STATUS_STYLE = {
  pending: { color: "#777", bg: "rgba(0,0,0,0.04)", label: "Queued" },
  processing: { color: "#1565c0", bg: "rgba(25,118,210,0.10)", label: "Working…" },
  done: { color: "#2e7d32", bg: "rgba(46,125,50,0.12)", label: "Ready" },
  error: { color: "#c62828", bg: "rgba(198,40,40,0.10)", label: "Failed" },
};

function StatusPill({ status, statusLabel }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        fontSize: "0.72rem",
        fontWeight: 600,
        color: s.color,
        bgcolor: s.bg,
        borderRadius: 999,
        px: 1,
        py: 0.25,
        whiteSpace: "nowrap",
      }}
    >
      {status === "processing" ? <CircularProgress size={11} thickness={6} /> : null}
      {statusLabel || s.label}
    </Box>
  );
}

export default function ScreenshotTab({
  items = [],
  onAddFiles,
  onRemoveItem,
  onClear,
  onRetry,
  onPreview,
  processing = false,
  resumeReady = true,
  error = "",
}) {
  const inputRef = useRef(null);

  const pickFiles = () => inputRef.current?.click();
  const handleInput = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onAddFiles?.(files);
    e.target.value = ""; // allow re-selecting the same file
  };

  const anyDone = items.some((i) => i.status === "done");
  const failedCount = items.filter((i) => i.status === "error").length;

  return (
    <section className={styles.tabPanel}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary, #777)" }}>
          Upload screenshots (PNG/JPG) of job postings — processing starts automatically. One by one,
          Gemini reads the posting and finds it online, then the selected engine tailors your resume
          (and cover letter, if a template is uploaded) into a tracked job.
        </Box>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={handleInput}
          style={{ display: "none" }}
        />

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Button variant="outlined" startIcon={<AddPhotoAlternateIcon />} onClick={pickFiles} sx={{ textTransform: "none" }}>
            Add screenshots
          </Button>
          {processing ? (
            <Button variant="contained" disabled startIcon={<CircularProgress size={14} />} sx={{ textTransform: "none" }}>
              Working…
            </Button>
          ) : failedCount > 0 ? (
            <Button variant="contained" onClick={onRetry} disabled={!resumeReady} sx={{ textTransform: "none" }}>
              Retry failed ({failedCount})
            </Button>
          ) : null}
          {items.length > 0 ? (
            <Button onClick={onClear} disabled={processing} sx={{ textTransform: "none" }}>
              Clear
            </Button>
          ) : null}
        </Box>

        {!resumeReady ? (
          <Box sx={{ fontSize: "0.8rem", color: "#9a6700", bgcolor: "rgba(255,193,7,0.12)", p: 1, borderRadius: 1 }}>
            Upload a resume first so each screenshot can be tailored.
          </Box>
        ) : null}

        {items.length === 0 ? (
          <Box
            onClick={pickFiles}
            sx={{
              border: "1px dashed var(--border, #cfcfcf)",
              borderRadius: 1,
              p: 3,
              textAlign: "center",
              color: "var(--text-secondary, #999)",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            No screenshots yet — click to add. Processing starts automatically.
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {items.map((item) => (
              <Box
                key={item.id}
                sx={{
                  display: "flex",
                  gap: 1.5,
                  p: 1.25,
                  border: "1px solid var(--border, #e0e0e0)",
                  borderRadius: 1,
                  alignItems: "flex-start",
                }}
              >
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border,#e0e0e0)", flexShrink: 0 }}
                  />
                ) : null}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <StatusPill status={item.status} statusLabel={item.statusLabel} />
                    <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary,#999)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                      {item.name}
                    </Box>
                  </Box>
                  {item.jobTitle || item.company ? (
                    <Box sx={{ fontSize: "0.85rem", fontWeight: 600, mt: 0.5 }}>
                      {[item.jobTitle, item.company].filter(Boolean).join(" · ")}
                    </Box>
                  ) : null}
                  {item.url ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}>
                      <Box
                        component="a"
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ fontSize: "0.75rem", color: "#1565c0", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}
                      >
                        {item.url}
                      </Box>
                      <OpenInNewIcon sx={{ fontSize: 13, color: "#1565c0" }} />
                    </Box>
                  ) : null}
                  {item.error ? (
                    <Box sx={{ fontSize: "0.78rem", color: "var(--danger, #d32f2f)", mt: 0.5 }}>{item.error}</Box>
                  ) : null}
                  {item.status === "done" ? (
                    <Button
                      size="small"
                      startIcon={<VisibilityIcon sx={{ fontSize: 16 }} />}
                      onClick={() => onPreview?.(item)}
                      sx={{ textTransform: "none", mt: 0.5, px: 1 }}
                    >
                      Preview documents
                    </Button>
                  ) : null}
                </Box>
                <Tooltip title="Remove">
                  <span>
                    <IconButton size="small" onClick={() => onRemoveItem?.(item.id)} disabled={processing} sx={{ flexShrink: 0 }}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}

        {anyDone ? (
          <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary, #777)" }}>
            Tailored documents are saved to your tracked jobs — open any with “Preview documents”.
          </Box>
        ) : null}

        {error ? <p className={styles.error}>{error}</p> : null}
      </Box>
    </section>
  );
}
