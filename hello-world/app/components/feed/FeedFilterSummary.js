"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FilterAltOffIcon from "@mui/icons-material/FilterAltOff";

// The active-filter summary chips shown above the Search section in the
// advanced-filters panel. Extracted out of LiveFeedTab.js as MARKUP only --
// `chips` is still built in LiveFeedTab.js's activeFilterChips useMemo, and
// each chip's onDelete closure is still whatever that memo produced.
export default function FeedFilterSummary({ chips, onClearAll }) {
  if (!chips || chips.length === 0) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
          Active filters
        </Typography>
        <Button
          size="small"
          color="inherit"
          startIcon={<FilterAltOffIcon fontSize="small" />}
          onClick={onClearAll}
          sx={{ textTransform: "none", color: "text.secondary" }}
        >
          Clear all
        </Button>
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            size="small"
            variant="outlined"
            onDelete={chip.onDelete}
            sx={{ maxWidth: 240 }}
          />
        ))}
      </Box>
    </Box>
  );
}
