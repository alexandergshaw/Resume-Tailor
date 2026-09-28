"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";


/**
 * The one-click, reachable remedy for a refused Gmail fetch (AC-6/AC-7).
 * Rendered exactly once by TrackingTab, above the application list — never
 * per ApplicationCard, since a Gmail connection is one-per-account, not
 * per-application; showing N identical Connect controls would cry wolf N
 * times on a single blip.
 *
 * cause === "not_connected"           -> Connect Gmail (first-time)
 * cause === "reauth_required"         -> Reconnect Gmail (access expired/revoked)
 * cause === "temporarily_unavailable" -> quiet note, no control (nothing the
 *                                         user can do; offering a reconnect on
 *                                         a self-healing blip is the wrong
 *                                         remedy)
 * cause == null / undefined           -> renders nothing
 *
 * The control is a plain `href` link (the same idiom GmailButton.js already
 * uses) — it is user-initiated by construction, since nothing fires until the
 * user clicks. It never auto-navigates the tab to Google's consent screen.
 */
export default function GmailConnectionNotice({ cause }) {
  if (cause === "not_connected") {
    return (
      <Alert
        severity="info"
        sx={{ mb: 2 }}
        action={
          <Button href="/api/gmail/connect" color="inherit" size="small" sx={{ textTransform: "none" }}>
            Connect Gmail
          </Button>
        }
      >
        Connect Gmail to see application updates from your inbox here.
      </Alert>
    );
  }

  if (cause === "reauth_required") {
    return (
      <Alert
        severity="warning"
        sx={{ mb: 2 }}
        action={
          <Button href="/api/gmail/connect" color="inherit" size="small" sx={{ textTransform: "none" }}>
            Reconnect Gmail
          </Button>
        }
      >
        Gmail access expired or was revoked. Reconnect to keep seeing application updates.
      </Alert>
    );
  }

  if (cause === "temporarily_unavailable") {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Couldn&apos;t reach Gmail right now. We&apos;ll keep checking.
      </Alert>
    );
  }

  return null;
}
