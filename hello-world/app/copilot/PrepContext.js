"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { TOUCH_TARGET_SX } from "./mobileSx";

// Collapsible panel where the candidate keeps the background the copilot uses to
// personalize answers: a resume summary, the target job description, and any
// prep notes. Seeded from the user's saved context and persisted locally by the
// parent — this component is purely presentational.
export default function PrepContext({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const chars = value?.length || 0;

  return (
    <Box sx={{ mb: 2 }}>
      <Button
        size="small"
        variant="text"
        onClick={() => setOpen((o) => !o)}
        sx={{ color: "var(--text-secondary)", ...TOUCH_TARGET_SX }}
      >
        {open ? "▾" : "▸"} Your prep context
        {chars > 0 ? ` (${chars.toLocaleString()} chars)` : " — add resume & role"}
      </Button>
      <Collapse in={open}>
        <Box sx={{ mt: 1 }}>
          <Typography
            variant="caption"
            sx={{
              color: "var(--text-muted)",
              display: "block",
              mb: 0.75,
              fontSize: { xs: 13, sm: "0.75rem" },
            }}
          >
            Paste a resume summary, the job description, and any notes. Answers are
            grounded in this. Stored only in this browser.
          </Typography>
          <TextField
            value={value}
            onChange={(e) => onChange(e.target.value)}
            multiline
            minRows={4}
            maxRows={12}
            fullWidth
            placeholder="e.g. Senior backend engineer, 6 yrs — led payments at Acme… • Target role: Staff Engineer at Globex (JD: …) • Notes: emphasize scaling + mentorship"
          />
        </Box>
      </Collapse>
    </Box>
  );
}
