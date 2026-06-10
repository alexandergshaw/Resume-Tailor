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

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Resume Tailor <onboarding@resend.dev>";

/**
 * Send a single transactional email. Best-effort: when no API key is
 * configured it resolves with `{ ok: false, skipped: true }` instead of
 * throwing, so callers can stay non-fatal. Genuine API failures throw.
 *
 * @param {object} args
 * @param {string} args.to       recipient address
 * @param {string} args.subject
 * @param {string} args.html
 * @param {string} [args.text]
 * @returns {Promise<{ ok: boolean, id?: string|null, skipped?: boolean, reason?: string }>}
 */
export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  }
  if (!to || !subject) {
    return { ok: false, skipped: true, reason: "missing 'to' or 'subject'" };
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

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
