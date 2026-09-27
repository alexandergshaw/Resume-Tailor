// Transactional email sender backed by Resend (https://resend.com).
//
// Chosen over the existing Gmail integration because that flow is read-only
// (`gmail.readonly` scope) and can't send. Resend needs only an API key — no
// extra OAuth scope or user consent — so it works cleanly from the cron, which
// runs without a user session.
//
// Configure with env vars:
//   RESEND_API_KEY  — required to actually send (otherwise sends are skipped)
//   EMAIL_FROM      — verified "From" address, e.g. "Resume Tailor <jobs@yourdomain.com>"
//
// N60 S5 (AC-E5): there is deliberately NO fallback "From" address. A missing
// EMAIL_FROM used to silently substitute Resend's shared sandbox sender
// ("onboarding@resend.dev") -- a domain this product does not control -- which
// made a broken configuration look identical to a working one. A missing
// EMAIL_FROM is now a visible, named REFUSAL: nothing is sent.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Send a single transactional email. Best-effort: when no API key is
 * configured it resolves with `{ ok: false, skipped: true }` instead of
 * throwing, so callers can stay non-fatal. A missing EMAIL_FROM resolves with
 * `{ ok: false, refused: true }` -- a distinct shape, so callers can tell "not
 * configured at all" from "configured but missing a sender" -- and never
 * reaches the network. Genuine API failures throw.
 *
 * @param {object} args
 * @param {string} args.to       recipient address
 * @param {string} args.subject
 * @param {string} args.html
 * @param {string} [args.text]
 * @returns {Promise<{ ok: boolean, id?: string|null, skipped?: boolean, refused?: boolean, reason?: string }>}
 */
export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  }
  if (!to || !subject) {
    return { ok: false, skipped: true, reason: "missing 'to' or 'subject'" };
  }

  const from = typeof process.env.EMAIL_FROM === "string" ? process.env.EMAIL_FROM.trim() : "";
  if (!from) {
    return { ok: false, refused: true, reason: "EMAIL_FROM not set" };
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }

  const data = await res.json().catch(() => ({}));
  return { ok: true, id: data?.id || null };
}
