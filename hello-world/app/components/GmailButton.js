"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

// Gmail connection control for the settings menu: connect when disconnected, or
// show the connected state with a disconnect action.
export default function GmailButton() {
  const [connected, setConnected] = useState(null); // null = loading
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/gmail/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setConnected(data?.connected ?? false))
      .catch(() => setConnected(false));
  }, []);

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await fetch("/api/gmail/disconnect", { method: "DELETE" });
      setConnected(false);
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (connected === null) {
    return (
      <Typography sx={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Checking…</Typography>
    );
  }

  if (!connected) {
    return (
      <Button
        href="/api/gmail/connect"
        variant="outlined"
        size="small"
        fullWidth
        sx={{ textTransform: "none", justifyContent: "flex-start", borderColor: "var(--border-strong)", color: "var(--text-primary)" }}
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
