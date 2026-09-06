"use client";

import { useRef } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import EmptyState from "./EmptyState";
import StatusPill from "./StatusPill";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

import styles from "../page.module.css";

const ACCEPT = "image/png,image/jpeg,image/webp";

const URL_LINE_SX = {
  fontSize: "0.75rem",
  textDecoration: "none",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
};

// The posting URL read out of the screenshot. It is shown as text either
// way - seeing where a scraped link points is the whole point of the line -
// but it is only a LINK when safeExternalHref admits it. A refused URL
// renders no anchor at all (never href="", never "#", never a dead <a>) and
// loses the open-in-new affordance with it, so the control does not lie
// about being clickable.
function PostingUrlLine({ url }) {
  if (!url) return null;
  const href = safeExternalHref(url);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25, minWidth: 0 }}>
      {href ? (
        <>
          <Box
            component="a"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ ...URL_LINE_SX, color: "var(--accent-hover)" }}
          >
            {url}
          </Box>
          <OpenInNewIcon sx={{ fontSize: 13, color: "var(--accent-hover)", flexShrink: 0 }} />
        </>
      ) : (
        <Box sx={{ ...URL_LINE_SX, color: "var(--text-secondary)" }}>{url}</Box>
      )}
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
        <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
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

        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: 1,
            flexWrap: "wrap",
            alignItems: { xs: "stretch", sm: "center" },
          }}
        >
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
          <Box sx={{ fontSize: "0.8rem", color: "var(--warning)", bgcolor: "var(--warning-soft)", p: 1, borderRadius: 1 }}>
            Upload a resume first so each screenshot can be tailored.
          </Box>
        ) : null}

        {items.length === 0 ? (
          <Box
            onClick={pickFiles}
            sx={{
              border: "1px dashed var(--border)",
              borderRadius: 1,
              cursor: "pointer",
            }}
          >
            <EmptyState
              icon={<AddPhotoAlternateIcon />}
              title="No screenshots yet"
              message="Click to add screenshots — processing starts automatically."
            />
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {items.map((item) => (
              <Box
                key={item.id}
                sx={{
                  display: "flex",
                  gap: { xs: 1, sm: 1.5 },
                  p: { xs: 1, sm: 1.25 },
                  border: "1px solid var(--border)",
                  borderRadius: 1,
                  alignItems: "flex-start",
                }}
              >
                {item.previewUrl ? (
                  <Box
                    component="img"
                    src={item.previewUrl}
                    alt={item.name}
                    sx={{
                      width: { xs: 52, sm: 72 },
                      height: { xs: 52, sm: 72 },
                      objectFit: "cover",
                      borderRadius: 1,
                      border: "1px solid var(--border)",
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <StatusPill status={item.status} statusLabel={item.statusLabel} />
                    <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                      {item.name}
                    </Box>
                  </Box>
                  {item.jobTitle || item.company ? (
                    <Box sx={{ fontSize: "0.85rem", fontWeight: 600, mt: 0.5, overflowWrap: "anywhere" }}>
                      {[item.jobTitle, item.company].filter(Boolean).join(" · ")}
                    </Box>
                  ) : null}
                  <PostingUrlLine url={item.url} />
                  {item.error ? (
                    <Box sx={{ fontSize: "0.78rem", color: "var(--danger)", mt: 0.5, overflowWrap: "anywhere" }}>{item.error}</Box>
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
                    <IconButton size="small" onClick={() => onRemoveItem?.(item.id)} disabled={processing} sx={{ flexShrink: 0, mt: -0.5, mr: -0.5 }}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}

        {anyDone ? (
          <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
            Tailored documents are saved to your tracked jobs — open any with “Preview documents”.
          </Box>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}
      </Box>
    </section>
  );
}
