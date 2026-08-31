"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

// Google Drive connection control for the settings menu. Modelled directly on
// GmailButton.js: three states (loading / disconnected / connected), the same
// button variants and tokens, the same disconnect idiom. Three differences,
// all required by this feature and absent from the Gmail precedent:
//
// - A "not configured" state (the server has no Google client credentials):
//   the control renders nothing at all, so a deploy with Drive turned off
//   shows no half-built feature in Settings.
// - A failed status fetch degrades to the DISCONNECTED view rather than to
//   nothing, mirroring GmailButton.js's own `.catch(() => setConnected(false))`
//   posture: a connected user whose status call 500s still sees a visible,
//   clickable "Connect Drive" rather than a silently vanished feature with no
//   way to recover.
// - The connected state names the granting Google account (AC-C10): people
//   routinely have more than one signed in, and "Drive connected" alone
//   doesn't say which one their documents are being written to. The status
//   route (a later wave) may or may not send it, so it is rendered only
//   when present -- never an empty line or a dangling separator.
//
// Disconnecting takes no confirmation: the user's Drive files are untouched
// (the caption below says so), so this is not a destructive action.
export default function DriveButton() {
  const [connected, setConnected] = useState(null); // null = loading
  const [configured, setConfigured] = useState(true); // unknown until the fetch resolves; assume yes so a failure never hides the feature
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  // WAVE4-SEAMS.md MAJOR-1: app/api/drive/disconnect/route.js was built so a
  // disconnect that fails over a SURVIVING credential row reports failure
  // (503) rather than success -- deliberately the opposite of
  // lib/gmail/gmailClient.js's deleteTokens, which ignores its response
  // status and reports success regardless. That guarantee is worthless if
  // the only caller throws the response away, which is exactly what this
  // component used to do: `await fetch(...); setConnected(false);` with no
  // `res.ok` check at all, so a user who clicked Disconnect while the store
  // was unreachable was told "disconnected" while the refresh token stayed
  // in the database -- the precise lie the route exists to avoid. `res.ok`
  // now gates whether the UI actually flips to disconnected.
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  // The granting Google account, e.g. "person@gmail.com" -- OPTIONAL. The
  // status route (a later wave) may omit it, send an empty string, or send
  // something non-string; "" is the only value that means "don't render
  // it," so every other shape is coerced down to that rather than trusted.
  const [email, setEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/drive/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setConfigured(data?.configured !== false);
        setConnected(data?.connected ?? false);
        setEmail(typeof data?.email === "string" ? data.email.trim() : "");
      })
      .catch(() => {
        if (cancelled) return;
        setConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDisconnect() {
    setIsDisconnecting(true);
    setDisconnectFailed(false);
    try {
      const res = await fetch("/api/drive/disconnect", { method: "DELETE" });
      if (res.ok) {
        setConnected(false);
      } else {
        // The route only returns non-2xx when the disconnect did NOT
        // happen (401/503) -- the credential row survives, so the UI must
        // not claim otherwise. Stay connected and surface the failure.
        setDisconnectFailed(true);
      }
    } catch {
      // A network failure means we genuinely don't know whether the
      // server-side delete happened -- same posture as res.ok === false:
      // never optimistically claim disconnected.
      setDisconnectFailed(true);
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (connected === null) {
    return (
      <Typography sx={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Checking…</Typography>
    );
  }

  if (!configured) {
    return null;
  }

  if (!connected) {
    return (
      <Button
        href="/api/drive/connect"
        variant="outlined"
        size="small"
        fullWidth
        sx={{ textTransform: "none", justifyContent: "flex-start", borderColor: "var(--border-strong)", color: "var(--text-primary)" }}
      >
        Connect Drive
      </Button>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <CheckCircleIcon fontSize="small" sx={{ color: "var(--success)" }} />
        <Typography sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Drive connected</Typography>
      </Box>
      {email ? (
        <Typography sx={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{email}</Typography>
      ) : null}
      <Button
        onClick={handleDisconnect}
        disabled={isDisconnecting}
        variant="text"
        size="small"
        color="inherit"
        sx={{ textTransform: "none", justifyContent: "flex-start", color: "var(--text-secondary)" }}
      >
        {isDisconnecting ? "Disconnecting…" : "Disconnect Drive"}
      </Button>
      {disconnectFailed ? (
        <Typography sx={{ fontSize: "0.72rem", color: "var(--danger)" }}>
          Couldn&apos;t disconnect Drive. Try again.
        </Typography>
      ) : null}
      <Typography sx={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
        Documents are saved to a “Resume Tailor” folder in your Drive.
      </Typography>
      <Typography sx={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
        Disconnecting only removes this app&apos;s access — your Docs stay in Drive.
      </Typography>
    </Box>
  );
}
