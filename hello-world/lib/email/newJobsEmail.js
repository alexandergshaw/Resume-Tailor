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
 * Group emailable jobs by destination address. Jobs whose saved search has a
 * `notifyEmail` override go to that address; the rest fall back to the account
 * email. Jobs with no resolvable recipient are dropped.
 * @param {Array<object>} emailable
 * @param {string|null} fallbackEmail
 * @returns {Map<string, Array<object>>}
 */
export function groupJobsByRecipient(emailable, fallbackEmail) {
  const map = new Map();
  for (const job of Array.isArray(emailable) ? emailable : []) {
    const override = typeof job?.notifyEmail === "string" ? job.notifyEmail.trim() : "";
    const to = override || (fallbackEmail || "").trim();
    if (!to) continue;
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
