import { google } from "googleapis";
import { getCached, setCached } from "../cache/jobCache";
import { getServerEnv } from "../config/env";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REDIS_TOKEN_PREFIX = "gmail_tokens:";

/**
 * Build an OAuth2 client from environment credentials.
 * redirectUri must match what was registered in Google Cloud Console.
 */
export function createOAuth2Client(redirectUri) {
  const { googleClientId, googleClientSecret } = getServerEnv();

  if (!googleClientId || !googleClientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to use Gmail integration.",
    );
  }

  return new google.auth.OAuth2(googleClientId, googleClientSecret, redirectUri);
}

/**
 * Generate the Google OAuth2 authorization URL that the user visits to grant access.
 */
export function getAuthUrl(redirectUri, state) {
  const oauth2Client = createOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GMAIL_SCOPES,
    prompt: "consent", // force refresh_token on every grant
    state,
  });
}

/** Redis key for a user's Gmail tokens */
function tokenKey(userId) {
  return `${REDIS_TOKEN_PREFIX}${userId}`;
}

/** Persist tokens for a user (access_token, refresh_token, expiry_date). */
export async function saveTokens(userId, tokens) {
  await setCached(tokenKey(userId), JSON.stringify(tokens), TOKEN_TTL_SECONDS);
}

/** Load stored tokens for a user. Returns null if none found. */
export async function loadTokens(userId) {
  const raw = await getCached(tokenKey(userId));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** Delete stored tokens for a user (disconnect). */
export async function deleteTokens(userId) {
  const { kvRestApiUrl, kvRestApiToken } = getServerEnv();
  if (!kvRestApiUrl || !kvRestApiToken) return;
  // Upstash REST delete
  await fetch(`${kvRestApiUrl}/del/${tokenKey(userId)}`, {
    headers: { Authorization: `Bearer ${kvRestApiToken}` },
  });
}

/**
 * Build an authenticated OAuth2 client for a user using stored tokens.
 * Automatically refreshes the access token if expired and persists the new token.
 * Returns null if the user has no tokens stored.
 */
export async function getAuthenticatedClient(userId, redirectUri) {
  const tokens = await loadTokens(userId);
  if (!tokens) return null;

  const oauth2Client = createOAuth2Client(redirectUri);
  oauth2Client.setCredentials(tokens);

  // Proactively refresh if within 5 minutes of expiry
  if (tokens.expiry_date && tokens.expiry_date - Date.now() < 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      await saveTokens(userId, credentials);
    } catch {
      // Refresh failed — stored tokens may be revoked; caller should handle null
      return null;
    }
  }

  return oauth2Client;
}

/**
 * Fetch Gmail messages that mention one of the user's tracked companies or
 * job titles. If neither list is provided, returns an empty array — we don't
 * want to scrape the user's entire inbox.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {object} opts
 * @param {string[]} [opts.companyNames=[]]
 * @param {string[]} [opts.jobTitles=[]]
 * @param {number}   [opts.maxResults=50]
 */
export async function fetchJobRelatedMessages(auth, opts = {}) {
  const { companyNames = [], jobTitles = [], maxResults = 50 } = opts;

  if (companyNames.length === 0 && jobTitles.length === 0) {
    return [];
  }

  const gmail = google.gmail({ version: "v1", auth });

  // Build a single OR'd list of quoted company names and job titles.
  // Cap at ~450 chars total to stay safely under Gmail's query length limit.
  const terms = [];
  let len = 0;
  for (const c of [...companyNames, ...jobTitles]) {
    const trimmed = (c || "").trim();
    if (!trimmed) continue;
    const part = `"${trimmed}"`;
    if (len + part.length > 450) break;
    terms.push(part);
    len += part.length + 4; // " OR "
  }

  if (terms.length === 0) return [];

  const query = terms.join(" OR ");

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages || [];

  // Fetch details with concurrency cap (5 at a time) to avoid rate-limit 500s
  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const batch = messages.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (msg) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full",
          });

          const headers = detail.data.payload?.headers || [];
          const get = (name) =>
            headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

          // Recursively collect body parts from MIME tree.
          // Prefers text/plain; falls back to text/html (tags stripped) if none found.
          function collectPart(part, plain, html) {
            if (!part) return;
            if (part.mimeType === "text/plain" && part.body?.data) {
              plain.push(Buffer.from(part.body.data, "base64").toString("utf-8"));
            } else if (part.mimeType === "text/html" && part.body?.data) {
              html.push(Buffer.from(part.body.data, "base64").toString("utf-8"));
            }
            if (part.parts) {
              for (const child of part.parts) collectPart(child, plain, html);
            }
          }

          const plainParts = [], htmlParts = [];
          collectPart(detail.data.payload, plainParts, htmlParts);

          let bodyText = "";
          if (plainParts.length > 0) {
            bodyText = plainParts.join(" ");
          } else if (htmlParts.length > 0) {
            // Strip HTML tags and decode common entities for plain-text matching
            bodyText = htmlParts.join(" ")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, " ")
              .trim();
          }
          bodyText = bodyText.slice(0, 4000);

          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: get("Subject"),
            from: get("From"),
            date: get("Date"),
            snippet: detail.data.snippet || "",
            body: bodyText,
          };
        } catch {
          // Skip messages that fail individually
          return null;
        }
      }),
    );
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}
