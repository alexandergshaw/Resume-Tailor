// N60 S5 (AC-E5) -- the pure, server-side decision behind "email alerts are
// unavailable". A client cannot see a server env var, so the status a user is
// shown must be computed here, server-side, and reported through
// app/api/alerts/status/route.js -- never guessed or inferred in the browser.
//
// Mirrors the two conditions lib/email/sendEmail.js itself enforces (a missing
// RESEND_API_KEY or EMAIL_FROM refuses to send): this function is the single
// source of truth both the status route and any future caller read, so the
// two can never drift apart.

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

  return { available: true, reason: null };
}
