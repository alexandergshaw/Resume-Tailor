"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FeedAutomationCard from "./FeedAutomationCard";
import AutoTailorRunLog from "./AutoTailorRunLog";

// N60 S8. The Automation view's single mount point -- a sibling of the queue
// view, reached from FeedToolbar's third button, and OUTSIDE the Filters
// sheet (AC-F2). Reads the server-reported email configuration (AC-E5: the
// browser cannot see an env var, so it must consume /api/alerts/status rather
// than guess) and renders one FeedAutomationCard per saved search.
export default function FeedAutomationPanel({ currentUser, savedSearches, setSavedSearchAutoTailor }) {
  // Starts NOT configured, and an unreadable status stays not configured. Only a
  // successful read saying so can enable the switch. The optimistic opposite is
  // a fail-open: the whole point of AC-E5 is to refuse an "on" switch that
  // cannot work, and a status endpoint that errors is precisely the case where
  // we do not know that it can.
  const [status, setStatus] = useState({
    emailConfigured: false,
    reason: "Checking your email configuration...",
  });

  useEffect(() => {
    let live = true;
    fetch("/api/alerts/status")
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (live) setStatus({ emailConfigured: !!data.emailConfigured, reason: data.reason });
      })
      .catch(() => {
        if (live) {
          setStatus({
            emailConfigured: false,
            reason: "We could not check your email configuration. Reload to try again.",
          });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  if (!currentUser) {
    return <Typography sx={{ color: "text.secondary" }}>Sign in to set up automation.</Typography>;
  }

  const serverBacked = (savedSearches || []).filter(
    (entry) => typeof entry.id === "string" && !entry.id.startsWith("ss-"),
  );

  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}>
        Automation
      </Typography>
      {serverBacked.length === 0 ? (
        <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
          Save a search while signed in to automate it.
        </Typography>
      ) : (
        serverBacked.map((entry) => (
          <FeedAutomationCard
            key={entry.id}
            entry={entry}
            setSavedSearchAutoTailor={setSavedSearchAutoTailor}
            emailConfigured={status.emailConfigured}
            emailReason={status.reason}
          />
        ))
      )}
      <AutoTailorRunLog mode="full" />
    </Box>
  );
}
