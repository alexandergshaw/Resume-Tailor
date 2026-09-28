"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

// Gmail connection control for the settings menu: connect when disconnected, or
// show the connected state with a disconnect action. A failed status check (a
// non-OK response or a thrown fetch) is its own "couldn't check" state,
// distinct from a genuine disconnect — collapsing the two would tell a
// candidate their account is disconnected when the status check just
// hiccuped, the same swallow-a-failure-as-a-negative-verdict defect the
// message fetch has (AC-9).
export default function GmailButton() {
  // "loading" | "connected" | "disconnected" | "check-failed"
  const [status, setStatus] = useState("loading");
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/gmail/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((data) => setStatus(data?.connected ? "connected" : "disconnected"))
      .catch(() => setStatus("check-failed"));
  }, []);

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await fetch("/api/gmail/disconnect", { method: "DELETE" });
      setStatus("disconnected");
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (status === "loading") {
    return (
      <Typography sx={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Checking…</Typography>
    );
  }

  if (status === "check-failed") {
    return (
      <Typography sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        Couldn&apos;t check Gmail status. Try again shortly.
      </Typography>
    );
  }

  if (status === "disconnected") {
    return (
      <Button
        href="/api/gmail/connect"
        variant="outlined"
        size="small"
        fullWidth
        sx={{ textTransform: "none", justifyContent: "flex-start", borderColor: "var(--border-control)", color: "var(--text-primary)" }}
      >
        Connect Gmail
      </Button>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <CheckCircleIcon fontSize="small" sx={{ color: "var(--success)" }} />
        <Typography sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Gmail connected</Typography>
      </Box>
      <Button
        onClick={handleDisconnect}
        disabled={isDisconnecting}
        variant="text"
        size="small"
        color="inherit"
        sx={{ textTransform: "none", justifyContent: "flex-start", color: "var(--text-secondary)" }}
      >
        {isDisconnecting ? "Disconnecting…" : "Disconnect Gmail"}
      </Button>
    </Box>
  );
}
