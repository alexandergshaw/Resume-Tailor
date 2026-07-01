"use client";

import { useEffect, useState } from "react";

export default function GmailButton() {
  const [connected, setConnected] = useState(null); // null = loading
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/gmail/status")
      .then((r) => r.ok ? r.json() : null)
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

  // Still checking — render nothing to avoid layout shift
  if (connected === null) return null;

  if (!connected) {
    return (
      <a href="/api/gmail/connect" style={styles.btn}>
        Connect Gmail
      </a>
    );
  }

  return (
    <div style={styles.row}>
      <span style={styles.label}>Gmail connected</span>
      <button
        onClick={handleDisconnect}
        disabled={isDisconnecting}
        style={{ ...styles.btn, ...styles.outlineBtn }}
      >
        {isDisconnecting ? "Disconnecting…" : "Disconnect Gmail"}
      </button>
    </div>
  );
}

const styles = {
  row: { display: "flex", alignItems: "center", gap: 10 },
  label: { fontSize: 13, color: "var(--text-secondary)" },
  btn: {
    fontSize: 13,
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    background: "var(--accent)",
    color: "var(--bg-surface)",
    cursor: "pointer",
    textDecoration: "none",
  },
  outlineBtn: {
    background: "transparent",
    border: "1px solid var(--border-strong)",
    color: "var(--text-primary)",
  },
};
