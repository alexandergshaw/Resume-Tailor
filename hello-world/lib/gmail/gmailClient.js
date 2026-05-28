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
 * Fetch Gmail messages whose subjects/bodies mention job-related keywords.
 * Returns an array of simplified message objects.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string[]} companyNames - filter messages mentioning these companies
 * @param {number} [maxResults=50]
 */
export async function fetchJobRelatedMessages(auth, companyNames = [], maxResults = 50) {
  const gmail = google.gmail({ version: "v1", auth });

  // Build a query covering common recruiter / job correspondence signals
  const companyQuery =
    companyNames.length > 0
      ? companyNames.map((c) => `"${c}"`).join(" OR ")
      : "";

  const baseQuery =
    "subject:(application OR interview OR offer OR recruiter OR position OR opportunity OR hiring OR job)";

  const query = companyQuery ? `(${baseQuery}) OR (${companyQuery})` : baseQuery;

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages || [];

  const results = await Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const get = (name) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: get("Subject"),
        from: get("From"),
        date: get("Date"),
        snippet: detail.data.snippet || "",
      };
    }),
  );

  return results;
}
