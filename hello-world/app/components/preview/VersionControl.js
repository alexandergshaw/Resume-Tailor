"use client";

import Box from "@mui/material/Box";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import HistoryIcon from "@mui/icons-material/History";

// Mirrors SCOPE_LABEL in DocumentPreviewDialog.js (lowercase for inline copy).
const SCOPE_NOUN = { resume: "resume", cover: "cover letter" };

function formatVersionTimestamp(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Version history control (AC-3) for the dialog's ACTIVE tab only — a
// dropdown listing every saved generation of that document by timestamp,
// with the current selection rendered as "Version N of total" so the
// user's position in the history is visible at a glance.
//
// Hidden entirely rather than shown disabled/empty when there's nothing to
// switch between: signed out, the job has no position row yet, or the
// history has fewer than two entries (AC-7). `disabled` gates it while the
// ACTIVE scope specifically is busy (AC-8) — callers pass the per-scope
// busy flag for the tab currently shown, not a combined "any busy" flag.
export default function VersionControl({
  scope,
  versions = [],
  currentVersionId = null,
  onSelect,
  disabled = false,
}) {
  if (!Array.isArray(versions) || versions.length < 2) return null;

  const total = versions.length;
  const foundIndex = versions.findIndex((v) => v.id === currentVersionId);
  const selectedIndex = foundIndex >= 0 ? foundIndex : 0;
  const selectedValue = versions[selectedIndex].id;

  return (
    <Tooltip
      title={`Switch which saved generation of this ${SCOPE_NOUN[scope] || "document"} is shown. Your current draft is saved first, so nothing typed is lost.`}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, my: 0.5 }}>
        <HistoryIcon fontSize="small" sx={{ color: "var(--text-muted)" }} />
        <Select
          size="small"
          value={selectedValue}
          onChange={(e) => onSelect?.(scope, e.target.value)}
          disabled={disabled}
          displayEmpty
          renderValue={() => `Version ${selectedIndex + 1} of ${total}`}
          MenuProps={{ disableAutoFocusItem: true }}
          sx={{ height: 32, fontSize: "0.8rem", maxWidth: 220 }}
        >
          {versions.map((v, i) => (
            <MenuItem key={v.id} value={v.id} sx={{ fontSize: "0.85rem" }}>
              {`Version ${i + 1} of ${total} — ${formatVersionTimestamp(v.created_at)}${i === 0 ? " (newest)" : ""}`}
            </MenuItem>
          ))}
        </Select>
      </Box>
    </Tooltip>
  );
}
