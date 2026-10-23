"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TuneIcon from "@mui/icons-material/Tune";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

const TOOLS_ID = "preview-document-tools";

export function DocumentToolsButton({ expanded, onClick }) {
  return (
    <Button
      size="small"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={TOOLS_ID}
      startIcon={<TuneIcon fontSize="small" />}
      endIcon={<ExpandMoreIcon sx={{ transform: expanded ? "rotate(180deg)" : "none" }} />}
      sx={{ ml: "auto", textTransform: "none", minHeight: 36, whiteSpace: "nowrap" }}
    >
      Document tools
    </Button>
  );
}

function ToolSection({ title, children }) {
  return (
    <Box sx={{ minWidth: 0, p: 1.5, "& + &": { borderTop: "1px solid var(--border)" } }}>
      <Box component="h3" sx={{ m: 0, mb: 0.75, fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>
        {title}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}

// Keep controls mounted: collapsing changes presentation, never their lifecycle.
// Explicit display prevents MUI layout styles overriding the native hidden rule.
export default function PreviewDocumentTools({ expanded, tailoring, layout }) {
  return (
    <Box
      id={TOOLS_ID}
      role="region"
      aria-label="Document tools"
      hidden={!expanded}
      data-testid="document-tools"
      sx={{ display: expanded ? "block" : "none", mb: 2, border: "1px solid var(--border)", borderRadius: 2, bgcolor: "var(--bg-surface)", overflow: "hidden" }}
    >
      <ToolSection title="Tailoring & history">{tailoring}</ToolSection>
      <ToolSection title="Document layout">{layout}</ToolSection>
    </Box>
  );
}
