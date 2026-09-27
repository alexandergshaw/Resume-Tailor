// Pure helpers for the "email me when new jobs are pulled back" feature.
//
// These functions take the per-run list of newly-queued jobs (the same summary
// objects the tailor cron already builds) and decide whether/what to email.
// Keeping them pure makes the selection + formatting logic unit-testable
// without a network or database.

/**
 * Keep only the jobs whose originating saved search opted into email alerts.
 * @param {Array<object>} queued summary objects with an `emailOnNewJobs` flag
 * @returns {Array<object>}
 */
export function selectEmailableJobs(queued) {
  if (!Array.isArray(queued)) return [];
  return queued.filter((job) => job && job.emailOnNewJobs);
}

/**
 * Group emailable jobs under the account's own email address. There is no
 * per-search recipient override (owner ruling 1): every alert goes to the
 * account email, and jobs are dropped only when there is no account address
 * to send to.
 * @param {Array<object>} emailable
 * @param {string|null} accountAddress
 * @returns {Map<string, Array<object>>}
 */
export function groupJobsForAccount(emailable, accountAddress) {
  const map = new Map();
  const to = (typeof accountAddress === "string" ? accountAddress : "").trim();
  if (!to) return map;
  for (const job of Array.isArray(emailable) ? emailable : []) {
    if (!map.has(to)) map.set(to, []);
    map.get(to).push(job);
  }
  return map;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jobLine(job) {
  const title = job?.title || "Untitled role";
  const company = job?.company ? ` — ${job.company}` : "";
  return `${title}${company}`;
}

/**
 * Build subject + HTML + plain-text bodies summarizing newly-matched jobs.
 *
 * `unsubscribeUrl` is additive (N60 S5, AC-E3): when supplied it is embedded
 * as a reachable link -- an `<a href>` in the HTML body, the absolute URL in
 * the text body -- rather than the previous footer, which named the remedy
 * ("email alerts are on for a saved search") without making it reachable.
 * Omitting it keeps the original one-argument body unchanged.
 *
 * @param {Array<object>} jobs summary objects ({ title, company, url, savedSearchName })
 * @param {{ unsubscribeUrl?: string|null }} [options]
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildNewJobsEmail(jobs, { unsubscribeUrl } = {}) {
  const list = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  const count = list.length;

  const subject =
    count === 1
      ? `New job match: ${jobLine(list[0])}`
      : `${count} new job matches from your saved searches`;

  const intro =
    count === 1
      ? "A new posting matched one of your saved searches and was queued for auto-apply:"
      : `${count} new postings matched your saved searches and were queued for auto-apply:`;

  const htmlItems = list
    .map((job) => {
      const label = escapeHtml(jobLine(job));
      const search = job?.savedSearchName
        ? ` <span style="color:#78909c;font-size:12px;">(${escapeHtml(job.savedSearchName)})</span>`
        : "";
      const link = job?.url
        ? ` — <a href="${escapeHtml(job.url)}" style="color:#1565c0;">view posting</a>`
        : "";
      return `<li style="margin:0 0 8px;">${label}${link}${search}</li>`;
    })
    .join("");

  const htmlUnsubscribe = unsubscribeUrl
    ? ` <a href="${escapeHtml(unsubscribeUrl)}" style="color:#1565c0;">Unsubscribe</a>`
    : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#263238;line-height:1.5;">
    <p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
    <ul style="padding-left:18px;margin:0 0 16px;">${htmlItems}</ul>
    <p style="color:#90a4ae;font-size:12px;margin:0;">You're receiving this because email alerts are on for a saved search in Resume Tailor.${htmlUnsubscribe}</p>
  </div>`;

  const textItems = list
    .map((job) => {
      const search = job?.savedSearchName ? ` (${job.savedSearchName})` : "";
      const url = job?.url ? `\n   ${job.url}` : "";
      return `• ${jobLine(job)}${search}${url}`;
    })
    .join("\n");

  const textUnsubscribe = unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : "";
  const text = `${intro}\n\n${textItems}\n\nYou're receiving this because email alerts are on for a saved search in Resume Tailor.${textUnsubscribe}`;

  return { subject, html, text };
}

// N60 S4: the alert-mail ceilings this file's S3 placeholder named here
// (MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY / _ACCOUNT_ / maySendAlertMail)
// were never called and are now superseded by the real, atomic reserve --
// the cap decision cannot be a client-side read-then-compare (the owner's
// atomicity ruling, see lib/email/alertMailLedger.js's header). The ceilings
// live in lib/email/alertMailBounds.js and are enforced server-side by
// reserve_alert_mail_slot via lib/email/alertMailLedger.js's reserveMailSend,
// which cron/tailor/route.js calls at both send sites. Removed rather than
// left as dead code duplicating those two constants under the same names
// (lib/feed/autoTailorSpendBounds.table.test.js requires each declared
// exactly once across the tree).
