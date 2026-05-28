import { google } from "googleapis";
import { getCached, setCached } from "../cache/jobCache";
import { getServerEnv } from "../config/env";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REDIS_TOKEN_PREFIX = "gmail_tokens:";
const INBOX_CACHE_TTL_SECONDS = 15 * 60; // 15 minutes
const INBOX_CACHE_PREFIX = "gmail_inbox:";

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

/** Redis key for a user's cached inbox results */
function inboxCacheKey(userId) {
  return `${INBOX_CACHE_PREFIX}${userId}`;
}

/** Delete the inbox cache for a user (called on force refresh). */
export async function clearInboxCache(userId) {
  const { kvRestApiUrl, kvRestApiToken } = getServerEnv();
  if (!kvRestApiUrl || !kvRestApiToken) return;
  await fetch(`${kvRestApiUrl}/del/${inboxCacheKey(userId)}`, {
    headers: { Authorization: `Bearer ${kvRestApiToken}` },
  });
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
 * Fetch Gmail messages related to job applications.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string[]} companyNames - tracked company names to use as primary filter
 * @param {object} [opts]
 * @param {number}  [opts.maxResults=25]  - max messages to return per page
 * @param {string}  [opts.pageToken]       - Gmail page token for cursor pagination
 * @param {string}  [opts.userId]          - user ID for Redis caching
 * @param {boolean} [opts.force=false]     - bypass Redis cache
 * @returns {Promise<{ messages: object[], nextPageToken: string|null }>}
 */
export async function fetchJobRelatedMessages(auth, companyNames = [], opts = {}) {
  const { maxResults = 25, pageToken = null, userId = null, force = false } = opts;

  // Serve from Redis cache on first-page requests (not paginated, not forced)
  if (userId && !force && !pageToken) {
    const cached = await getCached(inboxCacheKey(userId));
    if (cached) {
      try {
        return typeof cached === "string" ? JSON.parse(cached) : cached;
      } catch { /* fall through to live fetch */ }
    }
  }

  const gmail = google.gmail({ version: "v1", auth });

  // Build query: company-first (tight) when we have tracked companies,
  // falling back to broad job-signal subject search.
  let query;
  if (companyNames.length > 0) {
    // Build company filter, capped at ~400 chars to stay within Gmail query limits
    const companyParts = [];
    let len = 0;
    for (const c of companyNames) {
      const part = `"${c}"`;
      if (len + part.length > 400) break;
      companyParts.push(part);
      len += part.length + 4; // " OR "
    }
    // Require company mention AND at least one job-signal word (much tighter than OR)
    query = `(${companyParts.join(" OR ")}) (application OR interview OR offer OR recruiter OR position OR opportunity OR hiring)`;
  } else {
    query = "subject:(application OR interview OR offer OR recruiter OR position OR opportunity OR hiring OR job)";
  }

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
    ...(pageToken ? { pageToken } : {}),
  });

  const stubs = listRes.data.messages || [];
  const nextPageToken = listRes.data.nextPageToken || null;

  // Fetch all message metadata in parallel — metadata-only requests are lightweight
  const settled = await Promise.allSettled(
    stubs.map((msg) =>
      gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      }),
    ),
  );

  const messages = settled
    .map((r, i) => {
      if (r.status === "rejected") return null;
      const headers = r.value.data.payload?.headers || [];
      const get = (name) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
      return {
        id: stubs[i].id,
        threadId: stubs[i].threadId,
        subject: get("Subject"),
        from: get("From"),
        date: get("Date"),
        snippet: r.value.data.snippet || "",
      };
    })
    .filter(Boolean);

  const result = { messages, nextPageToken };

  // Cache first-page results per user (15 min TTL)
  if (userId && !pageToken) {
    await setCached(inboxCacheKey(userId), JSON.stringify(result), INBOX_CACHE_TTL_SECONDS);
  }

  return result;
}
