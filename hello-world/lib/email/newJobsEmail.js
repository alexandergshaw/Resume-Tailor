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
 * @param {Array<object>} jobs summary objects ({ title, company, url, savedSearchName })
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildNewJobsEmail(jobs) {
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

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#263238;line-height:1.5;">
    <p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
    <ul style="padding-left:18px;margin:0 0 16px;">${htmlItems}</ul>
    <p style="color:#90a4ae;font-size:12px;margin:0;">You're receiving this because email alerts are on for a saved search in Resume Tailor.</p>
  </div>`;

  const textItems = list
    .map((job) => {
      const search = job?.savedSearchName ? ` (${job.savedSearchName})` : "";
      const url = job?.url ? `\n   ${job.url}` : "";
      return `• ${jobLine(job)}${search}${url}`;
    })
    .join("\n");

  const text = `${intro}\n\n${textItems}\n\nYou're receiving this because email alerts are on for a saved search in Resume Tailor.`;

  return { subject, html, text };
}

// N60 S3 (AC-S2, AC-E2) -- the ceilings that govern alert-mail spend across
// BOTH send sites in app/api/cron/tailor/route.js (emailNewJobs and
// emailOnlyNewJobs), named in one place so
// lib/feed/autoTailorSpendBounds.table.test.js's reasoned numbers and the
// eventual send-site check can never quietly drift apart.
//
// Live here, not in a standalone lib/email/alertMailBounds.js, because
// nothing calls either ceiling yet -- S4's alertMailLedger.js is the first
// consumer -- and a brand-new file with no importer at all is a whole
// UNREACHABLE MODULE by lib/sourceScan/exportReachability.sweep.test.js's own
// definition (it starts from app/**/route.js et al. and follows only real
// imports out of those), not merely an unused export. This module is already
// reachable through cron/tailor/route.js's import of buildNewJobsEmail
// above, so keeping the ceilings here avoids that finding without inventing
// an import nobody needs. Both stay module-private for the same reason
// DEFAULT_MAX_QUERIES does in lib/feed/llmSearchQueries.js: exporting a
// not-yet-consumed constant would make it a test-only export and move
// lib/sourceScan/exportReachability.sweep.test.js's pinned counts (363/435).

// Alert-digest ceiling per recipient address per UTC day (AC-E2).
const MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY = 4;
// Alert-digest ceiling per account across all its addresses per UTC day
// (AC-E2). One account can hold more than one recipient address, so this is
// a separate, wider ceiling rather than a derived multiple of the one above.
const MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY = 10;

/**
 * Pure. Whether one more alert mail may be sent, given the counts S4's
 * ledger already read for today.
 *
 * Not yet called anywhere -- S4's alertMailLedger.js is the first caller.
 * Kept module-private for the same reason the constants above are.
 *
 * @param {{perAddressCount: number, accountTotal: number}} counts
 * @returns {{allowed: boolean, reason: null | "address_day_ceiling" | "account_day_ceiling"}}
 */
function maySendAlertMail({ perAddressCount, accountTotal }) {
  if (perAddressCount >= MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY) {
    return { allowed: false, reason: "address_day_ceiling" };
  }
  if (accountTotal >= MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY) {
    return { allowed: false, reason: "account_day_ceiling" };
  }
  return { allowed: true, reason: null };
}
