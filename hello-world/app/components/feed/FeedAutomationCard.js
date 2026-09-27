"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Button from "@mui/material/Button";
import FormDialog from "../FormDialog";
import { MAX_TAILORS_PER_USER_PER_UTC_DAY } from "@/lib/feed/autoTailorBounds";

// N60 S8. One card per server-backed saved search, moved into the Automation
// view and out of the Filters sheet (AC-F2/F3): the email-alerts toggle
// (formerly FeedEmailAlerts.js -- see FeedEmailAlerts.wiring.test.js, which
// now reads this file for the same three properties) plus the auto-tailor
// enable toggle, its cost confirmation (AC-R3), and the AC-E5 unavailable
// state. AC-E5 is CONSUMED here, never re-derived: `emailConfigured` and
// `emailReason` come from the server by way of FeedAutomationPanel's
// /api/alerts/status read.
export default function FeedAutomationCard({ entry, setSavedSearchAutoTailor, emailConfigured, emailReason }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isServerBacked = typeof entry.id === "string" && !entry.id.startsWith("ss-");
  if (!isServerBacked) {
    return (
      <Box sx={{ p: 1, color: "text.disabled", fontSize: "0.72rem", fontStyle: "italic" }}>
        {entry.name}: sign-in-only saved search. Re-save while signed in to automate it.
      </Box>
    );
  }
  const unavailable = !emailConfigured;

  function onToggleAuto(e) {
    if (e.target.checked) {
      setConfirmOpen(true); // AC-R3: no write until the user confirms
    } else {
      // AC-R3's deliberate asymmetry: disabling is one action, no confirm.
      setSavedSearchAutoTailor(entry.id, { autoTailorEnabled: false });
    }
  }
  function confirmEnable() {
    setSavedSearchAutoTailor(entry.id, { autoTailorEnabled: true });
    setConfirmOpen(false);
  }

  return (
    <Box sx={{ p: 1, border: "1px solid", borderColor: "divider", borderRadius: 1, mb: 1 }}>
      <Box sx={{ fontWeight: 600, fontSize: "0.82rem" }}>{entry.name}</Box>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!!entry.emailOnNewJobs}
            onChange={(e) => setSavedSearchAutoTailor(entry.id, { emailOnNewJobs: e.target.checked })}
          />
        }
        label={<Box sx={{ fontSize: "0.78rem" }}>Email me new jobs</Box>}
        sx={{ m: 0 }}
      />
      {entry.emailOnNewJobs && (
        <Box sx={{ color: "text.secondary", fontSize: "0.72rem" }}>Sent to your account email.</Box>
      )}
      <FormControlLabel
        control={
          <Switch size="small" disabled={unavailable} checked={!!entry.autoTailorEnabled} onChange={onToggleAuto} />
        }
        label={<Box sx={{ fontSize: "0.78rem" }}>Auto-tailor new matches</Box>}
        sx={{ m: 0 }}
      />
      {unavailable && (
        <Typography sx={{ color: "text.secondary", fontSize: "0.72rem" }}>
          Email alerts are unavailable ({emailReason || "email is not set up"}). Auto-tailoring can&apos;t be turned
          on until email is configured.
        </Typography>
      )}
      <FormDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Turn on auto-tailoring?"
        actions={
          <Button variant="contained" onClick={confirmEnable}>
            Turn on auto-tailoring
          </Button>
        }
      >
        <Typography sx={{ fontSize: "0.9rem" }}>
          Up to {MAX_TAILORS_PER_USER_PER_UTC_DAY} matching postings a day will be tailored automatically and
          unattended, while you&apos;re away. The tailored r&eacute;sum&eacute; and cover letter are generated and
          parked in your Auto-Apply queue for you to review &mdash; nothing is ever submitted on your behalf.
        </Typography>
      </FormDialog>
    </Box>
  );
}
