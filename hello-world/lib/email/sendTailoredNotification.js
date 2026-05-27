/**
 * Send a digest email summarizing newly auto-tailored jobs.
 * Uses Resend's REST API directly so we don't need to add the SDK as a dep.
 *
 * Env:
 *   RESEND_API_KEY   - required
 *   RESEND_FROM      - "Tailor <noreply@your-domain.com>" (required)
 *   APP_BASE_URL     - used to link back to the app (optional, falls back to "")
 */

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml({ heading, summary, items, appUrl }) {
  const list = items
    .map((item) => {
      const safeTitle = escapeHtml(item.title || "Untitled role");
      const safeCompany = escapeHtml(item.company || "");
      const url = item.url ? `<a href="${escapeHtml(item.url)}">View posting</a>` : "";
      return `<li><strong>${safeTitle}</strong>${safeCompany ? ` — ${safeCompany}` : ""} ${url}</li>`;
    })
    .join("");
  const cta = appUrl
    ? `<p><a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:10px 16px;background:#0a66c2;color:#fff;border-radius:6px;text-decoration:none;">Open Resume Tailor</a></p>`
    : "";
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="margin-top:0;">${escapeHtml(heading)}</h2>
  <p>${escapeHtml(summary)}</p>
  <ul>${list}</ul>
  ${cta}
  <hr/>
  <p style="font-size:12px;color:#666;">You're receiving this because auto-tailor email notifications are enabled in your Resume Tailor settings.</p>
</body></html>`;
}

/**
 * @param {{
 *   to: string,
 *   tailoredItems: Array<{title:string, company:string, url?:string}>,
 * }} params
 */
export async function sendTailoredDigestEmail({ to, tailoredItems }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from || !to || !Array.isArray(tailoredItems) || tailoredItems.length === 0) {
    return { sent: false, reason: "missing-config-or-empty" };
  }

  const count = tailoredItems.length;
  const subject =
    count === 1
      ? `1 new tailored resume ready`
      : `${count} new tailored resumes ready`;
  const heading = subject;
  const summary =
    count === 1
      ? `We tailored your resume for a new role:`
      : `We tailored your resume for ${count} new roles:`;
  const appUrl = process.env.APP_BASE_URL || "";

  const html = renderHtml({ heading, summary, items: tailoredItems, appUrl });
  const text =
    `${heading}\n\n${summary}\n` +
    tailoredItems
      .map((j) => `- ${j.title}${j.company ? ` — ${j.company}` : ""}${j.url ? ` (${j.url})` : ""}`)
      .join("\n") +
    (appUrl ? `\n\nOpen Resume Tailor: ${appUrl}` : "");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `resend-${res.status}`, detail: body.slice(0, 500) };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: "network-error", detail: String(err?.message || err) };
  }
}
