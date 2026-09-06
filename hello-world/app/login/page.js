"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import GoogleIcon from "@mui/icons-material/Google";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { safeRedirectPath } from "@/lib/url/safeRedirectPath";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// Full login experience: email/password sign in + sign up, Google OAuth, and a
// TOTP MFA challenge step shown when the signed-in user must step up to aal2.
// Rendered without the app chrome (AppHeader hides itself on /login).
function LoginForm() {
  const [supabase] = useState(() => createClient());
  const searchParams = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams?.get("redirect"));

  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [step, setStep] = useState("credentials"); // "credentials" | "mfa" | "verifyEmail"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // redirectTo is already constrained to a same-origin path by
  // safeRedirectPath (see lib/url/safeRedirectPath.js). Every browser
  // navigation in this app additionally flows through the canonical
  // safeExternalHref gate before it reaches a location API — see
  // app/components/windowOpenSafety.sweep.test.js — so re-validate the
  // concrete, now-absolute target through it here too rather than making
  // this one call site a snowflake.
  const goToApp = () => {
    const target = safeExternalHref(`${window.location.origin}${redirectTo}`) || "/";
    window.location.assign(target);
  };

  const resetMessages = () => {
    setError("");
    setNotice("");
  };

  // After a password sign-in / sign-up with a session, send the user to the MFA
  // challenge if they have a verified authenticator, otherwise into the app.
  async function continueAfterAuth() {
    const { data, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) {
      // If we can't read AAL, fail open to the app — middleware re-checks.
      goToApp();
      return;
    }
    if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") {
      setCode("");
      setStep("mfa");
      resetMessages();
    } else {
      goToApp();
    }
  }

  async function handleCredentials(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    resetMessages();
    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        await continueAfterAuth();
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          await continueAfterAuth();
        } else {
          setStep("verifyEmail");
          setNotice("Check your email to confirm your account, then sign in.");
        }
      }
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    resetMessages();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (oauthError) setError(oauthError.message);
  }

  async function handleForgotPassword() {
    if (!email) {
      setError("Enter your email above first, then choose “Forgot password”.");
      return;
    }
    resetMessages();
    setBusy(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (resetError) throw resetError;
      setNotice("Password reset email sent — check your inbox.");
    } catch (err) {
      setError(err?.message || "Couldn't send the reset email.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyMfa(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    resetMessages();
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = factors?.totp?.[0];
      if (!factor) throw new Error("No authenticator is enrolled on this account.");
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      goToApp();
    } catch (err) {
      setError(err?.message || "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelMfa() {
    await supabase.auth.signOut();
    setStep("credentials");
    setCode("");
    resetMessages();
  }

  const isMfa = step === "mfa";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 420,
          p: { xs: 3, sm: 4 },
          borderRadius: 3,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow)",
        }}
      >
        {/* Brand */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "var(--accent)" }} />
          <Typography
            sx={{
              fontFamily: "var(--font-source-serif), Georgia, serif",
              fontWeight: 600,
              fontSize: "1.35rem",
              letterSpacing: "-0.01em",
            }}
          >
            Resume Tailor
          </Typography>
        </Box>

        {isMfa ? (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2, mb: 1 }}>
              <ShieldOutlinedIcon fontSize="small" sx={{ color: "var(--accent)" }} />
              <Typography sx={{ fontWeight: 700 }}>Two-factor authentication</Typography>
            </Box>
            <Typography sx={{ color: "var(--text-secondary)", fontSize: "0.9rem", mb: 2 }}>
              Enter the 6-digit code from your authenticator app to finish signing in.
            </Typography>

            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            <Box component="form" onSubmit={handleVerifyMfa} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                autoFocus
                label="Authentication code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", style: { letterSpacing: "0.4em", textAlign: "center", fontSize: "1.2rem" } } }}
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy || code.length !== 6}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {busy ? "Verifying…" : "Verify"}
              </Button>
              <Button onClick={cancelMfa} disabled={busy} color="inherit" size="small">
                Use a different account
              </Button>
            </Box>
          </>
        ) : (
          <>
            <Typography sx={{ color: "var(--text-secondary)", fontSize: "0.9rem", mt: 0.5, mb: 2 }}>
              Sign in to tailor resumes and manage your applications.
            </Typography>

            <Tabs
              value={mode}
              onChange={(_e, v) => {
                setMode(v);
                setStep("credentials");
                resetMessages();
              }}
              variant="fullWidth"
              sx={{ mb: 2 }}
            >
              <Tab value="signin" label="Sign in" />
              <Tab value="signup" label="Create account" />
            </Tabs>

            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            {notice ? <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert> : null}

            <Box component="form" onSubmit={handleCredentials} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                type="email"
                label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                fullWidth
              />
              <TextField
                type={showPw ? "text" : "password"}
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                fullWidth
                helperText={mode === "signup" ? "At least 6 characters." : undefined}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowPw((s) => !s)} edge="end" size="small" aria-label={showPw ? "Hide password" : "Show password"}>
                          {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              {mode === "signin" ? (
                <Box sx={{ mt: -1, textAlign: "right" }}>
                  <Link component="button" type="button" onClick={handleForgotPassword} underline="hover" sx={{ fontSize: "0.82rem" }}>
                    Forgot password?
                  </Link>
                </Box>
              ) : null}
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </Box>

            <Divider sx={{ my: 2.5, color: "var(--text-muted)", fontSize: "0.75rem" }}>OR</Divider>

            <Button
              onClick={handleGoogle}
              variant="outlined"
              size="large"
              fullWidth
              startIcon={<GoogleIcon />}
              sx={{ color: "var(--text-primary)", borderColor: "var(--border-strong)" }}
            >
              Continue with Google
            </Button>
          </>
        )}
      </Paper>
    </Box>
  );
}

// useSearchParams must sit under a Suspense boundary for static generation.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
