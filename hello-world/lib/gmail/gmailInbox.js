/**
 * Client-side Gmail inbox utilities.
 * Calls the /api/gmail/messages API route and matches results to tracked applications.
 */

import { matchMessagesToApplications } from "./emailUtils";

/**
 * Fetch one page of job-related Gmail messages and match them to the
 * user's tracked applications.
 *
 * @param {object} opts
 * @param {string[]} opts.companyNames  - tracked company names (for query filtering)
 * @param {object[]} opts.applications  - full applicationData array from page state
 * @param {number}  [opts.maxResults=25]
 * @param {string|null} [opts.pageToken] - Gmail cursor for the next page; null for first page
 * @param {boolean} [opts.force=false]   - bypass Redis inbox cache
 * @returns {Promise<{ matched: Array<{ message: object, application: object, score: number }>, nextPageToken: string|null }>}
 */
export async function fetchGmailInboxPage({
  companyNames,
  applications,
  maxResults = 25,
  pageToken = null,
  force = false,
}) {
  const res = await fetch("/api/gmail/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyNames, maxResults, pageToken, force }),
  });

  if (!res.ok) return { matched: [], nextPageToken: null };

  const data = await res.json();
  const matched = matchMessagesToApplications(data.messages || [], applications);

  return { matched, nextPageToken: data.nextPageToken || null };
}
