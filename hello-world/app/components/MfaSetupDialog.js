"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

// Enroll / manage a TOTP authenticator (two-factor authentication). Shown from
// the settings menu. Uses Supabase's mfa.enroll / challenge / verify APIs.
export default function MfaSetupDialog({ open, onClose }) {
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState("loading"); // loading | enabled | enroll | busy
  const [error, setError] = useState("");
  const [verifiedFactorId, setVerifiedFactorId] = useState(null);
  const [enroll, setEnroll] = useState(null); // { factorId, qr, secret }
  const [code, setCode] = useState("");
  // Track an unverified enroll so we can clean it up if the user backs out.
  const pendingEnrollRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      setError("");
      setCode("");
      setEnroll(null);
      setStatus("loading");
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (listError) {
        setError(listError.message);
        setStatus("enroll");
        return;
      }
      const verified = (data?.totp || []).find((f) => f.status === "verified");
      if (verified) {
        setVerifiedFactorId(verified.id);
        setStatus("enabled");
      } else {
        setStatus("enroll");
      }
    })();
    return () => {
      active = false;
    };
  }, [open, supabase]);

  // Discard an unverified factor left behind if the dialog closes mid-enrollment.
  async function cleanupPendingEnroll() {
    const pending = pendingEnrollRef.current;
    if (pending) {
      pendingEnrollRef.current = null;
      try {
        await supabase.auth.mfa.unenroll({ factorId: pending });
      } catch {
        /* best effort */
      }
    }
  }

  async function startEnroll() {
    setError("");
    setStatus("busy");
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    });
    if (enrollError) {
      setError(enrollError.message);
      setStatus("enroll");
      return;
    }
    pendingEnrollRef.current = data.id;
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
    setStatus("enroll");
  }

  async function verifyEnroll() {
    if (!enroll) return;
    setError("");
    setStatus("busy");
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enroll.factorId,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      pendingEnrollRef.current = null;
      setVerifiedFactorId(enroll.factorId);
      setEnroll(null);
      setStatus("enabled");
    } catch (err) {
      setError(err?.message || "That code didn't work. Try again.");
      setStatus("enroll");
    }
  }

  async function disableMfa() {
    if (!verifiedFactorId) return;
    setError("");
    setStatus("busy");
    try {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
      if (unenrollError) throw unenrollError;
      setVerifiedFactorId(null);
      setStatus("enroll");
    } catch (err) {
      setError(err?.message || "Couldn't disable two-factor authentication.");
      setStatus("enabled");
    }
  }

  async function handleClose() {
    await cleanupPendingEnroll();
    onClose?.();
  }

  const busy = status === "busy";

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Two-factor authentication</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

        {status === "loading" ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : status === "enabled" ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, py: 2, textAlign: "center" }}>
            <CheckCircleIcon sx={{ fontSize: 40, color: "var(--success)" }} />
            <Typography sx={{ fontWeight: 600 }}>Two-factor authentication is on</Typography>
            <Typography sx={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              You&apos;ll be asked for a code from your authenticator app each time you sign in.
            </Typography>
          </Box>
        ) : enroll ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography sx={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code.
            </Typography>
            <Box sx={{ display: "flex", justifyContent: "center" }}>
              {/* Supabase returns the QR as an SVG data URI. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt="Authenticator QR code" width={180} height={180} style={{ background: "var(--paper-bg)", borderRadius: 8, padding: 8 }} />
            </Box>
            <Typography sx={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", wordBreak: "break-all" }}>
              Or enter this key manually: <strong>{enroll.secret}</strong>
            </Typography>
            <TextField
              autoFocus
              label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              slotProps={{ htmlInput: { inputMode: "numeric", style: { letterSpacing: "0.3em", textAlign: "center" } } }}
              fullWidth
            />
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1 }}>
            <Typography sx={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              Add an extra layer of security. You&apos;ll enter a code from your authenticator app when you sign in.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button onClick={handleClose} color="inherit" disabled={busy}>
          Close
        </Button>
        <Box sx={{ flex: 1 }} />
        {status === "enabled" ? (
          <Button onClick={disableMfa} color="error" disabled={busy}>
            {busy ? "Working…" : "Disable"}
          </Button>
        ) : enroll ? (
          <Button onClick={verifyEnroll} variant="contained" disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify & enable"}
          </Button>
        ) : (
          <Button onClick={startEnroll} variant="contained" disabled={busy}>
            {busy ? "Preparing…" : "Set up"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
