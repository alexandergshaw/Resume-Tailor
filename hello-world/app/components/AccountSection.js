"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import MfaSetupDialog from "./MfaSetupDialog";

// Account controls for the settings menu: the signed-in email, two-factor
// management, and sign out. (The app is gated behind /login, so a user is
// normally present; the signed-out branch is a safe fallback.)
export default function AccountSection() {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState(null);
  const [mfaOpen, setMfaOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [supabase]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  if (!user) {
    return (
      <Button variant="contained" href="/login" fullWidth sx={{ textTransform: "none" }}>
        Sign in
      </Button>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography sx={{ fontSize: "0.85rem", color: "var(--text-secondary)", wordBreak: "break-all" }}>
        {user.email}
      </Typography>
      <Button
        onClick={() => setMfaOpen(true)}
        variant="outlined"
        size="small"
        startIcon={<ShieldOutlinedIcon fontSize="small" />}
        sx={{ textTransform: "none", justifyContent: "flex-start", borderColor: "var(--border-control)", color: "var(--text-primary)" }}
      >
        Two-factor authentication
      </Button>
      <Button
        onClick={signOut}
        variant="text"
        size="small"
        color="inherit"
        startIcon={<LogoutIcon fontSize="small" />}
        sx={{ textTransform: "none", justifyContent: "flex-start", color: "var(--text-secondary)" }}
      >
        Sign out
      </Button>
      <MfaSetupDialog open={mfaOpen} onClose={() => setMfaOpen(false)} />
    </Box>
  );
}
