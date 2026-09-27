"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FeedAutomationCard from "./FeedAutomationCard";

// N60 S8. The Automation view's single mount point -- a sibling of the queue
// view, reached from FeedToolbar's third button, and OUTSIDE the Filters
// sheet (AC-F2). Reads the server-reported email configuration (AC-E5: the
// browser cannot see an env var, so it must consume /api/alerts/status rather
// than guess) and renders one FeedAutomationCard per saved search.
export default function FeedAutomationPanel({ currentUser, savedSearches, setSavedSearchAutoTailor }) {
  const [status, setStatus] = useState({ emailConfigured: true, reason: null });

  useEffect(() => {
    let live = true;
    fetch("/api/alerts/status")
      .then((res) => res.json())
      .then((data) => {
        if (live) setStatus({ emailConfigured: !!data.emailConfigured, reason: data.reason });
      })
      .catch(() => {});
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
    </Box>
  );
}
