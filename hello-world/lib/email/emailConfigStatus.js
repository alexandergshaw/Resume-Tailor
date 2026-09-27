// N60 S5 (AC-E5) -- the pure, server-side decision behind "email alerts are
// unavailable". A client cannot see a server env var, so the status a user is
// shown must be computed here, server-side, and reported through
// app/api/alerts/status/route.js -- never guessed or inferred in the browser.
//
// Mirrors the two conditions lib/email/sendEmail.js itself enforces (a missing
// RESEND_API_KEY or EMAIL_FROM refuses to send): this function is the single
// source of truth both the status route and any future caller read, so the
// two can never drift apart.
//
// N60 S6 -- the same invariant extended to the unsubscribe link: the cron
// refuses to send whenever it cannot mint one (`if (mailKill.disabled ||
// pause.paused || !unsubUrl) continue;`, app/api/cron/tailor/route.js), and
// unsubscribeUrl(signUnsubscribeToken(userId), RESUME_TAILOR_API_URL) is null
// unless BOTH ALERT_UNSUBSCRIBE_SECRET and RESUME_TAILOR_API_URL are set.
// Reporting "available" while either is missing would tell a user alerts are
// configured while the cron silently sends nothing -- the same class of lie
// this function already closes for the sender itself.

/**
 * @param {Record<string, string|undefined>} env
 * @returns {{ available: boolean, reason: string|null }}
 */
export function emailAlertsAvailable(env = {}) {
  const apiKey = typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  if (!apiKey) {
    return { available: false, reason: "RESEND_API_KEY is not set" };
  }

  const from = typeof env.EMAIL_FROM === "string" ? env.EMAIL_FROM.trim() : "";
  if (!from) {
    return { available: false, reason: "EMAIL_FROM is not set" };
  }

  const unsubscribeSecret =
    typeof env.ALERT_UNSUBSCRIBE_SECRET === "string" ? env.ALERT_UNSUBSCRIBE_SECRET.trim() : "";
  if (!unsubscribeSecret) {
    return { available: false, reason: "ALERT_UNSUBSCRIBE_SECRET is not set" };
  }

  const baseUrl = typeof env.RESUME_TAILOR_API_URL === "string" ? env.RESUME_TAILOR_API_URL.trim() : "";
  if (!baseUrl) {
    return { available: false, reason: "RESUME_TAILOR_API_URL is not set" };
  }

  return { available: true, reason: null };
}
