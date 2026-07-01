"use client";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";

import styles from "../../page.module.css";

const DownloadIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
);
const CopyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
const CheckIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);

// A résumé-material profile list rendered as a collapsible accordion of editable
// entry cards (references / education / employment). Behaviour comes from a
// useProfileEntries controller (`ctl`); the section's labels and per-entry field
// layout come from `config`. Employment also passes `importUI` to render the
// "auto-fill from résumé" affordance.
export default function ProfileListSection({ ctl, config, renderCopyButton, importUI = null }) {
  const {
    entries,
    open,
    setOpen,
    add,
    update,
    remove,
    copyBlock,
    copiedId,
    formatBlock,
    formatAll,
    copyAll,
    allCopied,
    downloadDocx,
    downloadError,
  } = ctl;
  const {
    label,
    headerId,
    noun,
    downloadTitle,
    copyAllTitle,
    emptyText,
    addLabel,
    addLabelAtMax,
    keyPrefix,
    headerLabel,
    fields,
    notesField,
    max = Infinity,
  } = config;

  const hasAny = !!formatAll();
  const atMax = entries.length >= max;
  const countSuffix = entries.length ? ` (${entries.length})` : "";

  return (
    <div className={styles.fieldGroup}>
      <label htmlFor={headerId} className={styles.label}>
        {label}
      </label>
      <Accordion
        disableGutters
        elevation={0}
        expanded={open}
        onChange={(_event, expanded) => setOpen(expanded)}
        sx={{
          border: "1px solid var(--border-strong)",
          borderRadius: "12px !important",
          overflow: "hidden",
          backgroundColor: "var(--bg-surface)",
          "&::before": { display: "none" },
        }}
      >
        <AccordionSummary
          aria-controls={`${headerId.replace("-header", "")}-content`}
          id={headerId}
          slotProps={{ root: { component: "div" } }}
          expandIcon={(
            <Box
              component="span"
              sx={{
                fontSize: "0.95rem",
                lineHeight: 1,
                color: "var(--text-secondary)",
              }}
            >
              ▾
            </Box>
          )}
          sx={{
            minHeight: 0,
            px: 1.75,
            py: 0.25,
            "& .MuiAccordionSummary-content": {
              my: 1,
              font: "inherit",
              fontSize: "0.9rem",
              color: "var(--text-secondary)",
              fontWeight: 400,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            },
          }}
        >
          <Box component="span">
            {open ? `Hide ${noun}${countSuffix}` : `Show ${noun}${countSuffix}`}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Tooltip title={downloadTitle}>
              <span onClick={(e) => { e.stopPropagation(); }} onFocus={(e) => e.stopPropagation()}>
                <IconButton
                  size="small"
                  disabled={!hasAny}
                  onClick={(e) => { e.stopPropagation(); downloadDocx(); }}
                  sx={{ p: 0.5, color: "var(--text-secondary)" }}
                  aria-label={downloadTitle}
                >
                  {DownloadIcon}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={allCopied ? "Copied!" : copyAllTitle}>
              <span onClick={(e) => { e.stopPropagation(); }} onFocus={(e) => e.stopPropagation()}>
                <IconButton
                  size="small"
                  disabled={!hasAny}
                  onClick={(e) => { e.stopPropagation(); copyAll(); }}
                  sx={{ p: 0.5, color: allCopied ? "var(--success)" : "var(--text-secondary)" }}
                  aria-label={copyAllTitle}
                >
                  {allCopied ? CheckIcon : CopyIcon}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </AccordionSummary>
        <AccordionDetails
          sx={{
            pt: 1.5,
            pb: 2,
            px: 1.75,
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
            borderTop: "1px solid var(--border)",
          }}
        >
          {importUI ? (
            <Box
              sx={{
                border: "1px dashed var(--border-strong)",
                borderRadius: 2,
                p: 1.5,
                display: "flex",
                flexDirection: "column",
                gap: 0.75,
                backgroundColor: "var(--bg-soft)",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Button
                  component="label"
                  size="small"
                  variant="outlined"
                  disabled={importUI.status?.loading}
                  sx={{ textTransform: "none", fontSize: "0.8rem" }}
                >
                  {importUI.status?.loading ? "Reading resume…" : "Upload resume to auto-fill"}
                  <input
                    type="file"
                    hidden
                    accept=".docx,.txt,.md,.markdown"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file && importUI.onImport) importUI.onImport(file);
                    }}
                  />
                </Button>
                <Box sx={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  Uses AI to pull positions from a .docx or .txt resume.
                </Box>
              </Box>
              {importUI.status?.error ? (
                <Box sx={{ fontSize: "0.78rem", color: "var(--danger)" }}>
                  {importUI.status.error}
                </Box>
              ) : null}
              {importUI.status?.message ? (
                <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  {importUI.status.message}
                </Box>
              ) : null}
            </Box>
          ) : null}

          {downloadError ? (
            <Box sx={{ fontSize: "0.78rem", color: "var(--danger)" }}>
              {downloadError}
            </Box>
          ) : null}

          {entries.length === 0 ? (
            <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {emptyText}
            </Box>
          ) : null}

          {entries.map((entry) => {
            const copied = copiedId === entry.id;
            return (
              <Box
                key={entry.id}
                sx={{
                  border: "1px solid var(--border)",
                  borderRadius: 2,
                  p: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  backgroundColor: "var(--bg-soft)",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1,
                  }}
                >
                  <Box sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{headerLabel(entry)}</Box>
                  <Box sx={{ display: "flex", gap: 0.75 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => copyBlock(entry)}
                      disabled={!formatBlock(entry)}
                      sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                    >
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => remove(entry.id)}
                      sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    gap: 1,
                  }}
                >
                  {fields.map((field) => (
                    <Box key={field.key} sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label={field.label}
                        value={entry[field.key]}
                        onChange={(e) => update(entry.id, field.key, e.target.value)}
                      />
                      {renderCopyButton(`${keyPrefix}:${entry.id}:${field.key}`, entry[field.key])}
                    </Box>
                  ))}
                </Box>
                <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-start" }}>
                  <TextField
                    fullWidth
                    size="small"
                    label={notesField.label}
                    value={entry[notesField.key]}
                    onChange={(e) => update(entry.id, notesField.key, e.target.value)}
                    multiline
                    minRows={2}
                  />
                  {renderCopyButton(`${keyPrefix}:${entry.id}:${notesField.key}`, entry[notesField.key], { alignTop: true })}
                </Box>
              </Box>
            );
          })}

          <Box>
            <Button
              size="small"
              variant="outlined"
              onClick={add}
              disabled={atMax}
              sx={{ textTransform: "none", fontSize: "0.8rem" }}
            >
              {atMax ? addLabelAtMax : addLabel}
            </Button>
          </Box>
        </AccordionDetails>
      </Accordion>
    </div>
  );
}
