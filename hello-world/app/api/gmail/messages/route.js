import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, fetchJobRelatedMessages, clearInboxCache } from "@/lib/gmail/gmailClient";

/**
 * POST /api/gmail/messages
 *
 * Fetches job-related Gmail messages for the current user.
 * Body: { companyNames?: string[], maxResults?: number, pageToken?: string, force?: boolean }
 *
 * Response: { messages: Array<{ id, threadId, subject, from, date, snippet }>, nextPageToken: string|null }
 */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // body is optional
  }

  const { companyNames = [], maxResults = 25, pageToken = null, force = false } = body;

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/gmail/oauth2callback`;

  const auth = await getAuthenticatedClient(user.id, redirectUri);
  if (!auth) {
    return NextResponse.json(
      { error: "Gmail not connected. Please connect your Gmail account first." },
      { status: 403 },
    );
  }

  // Bust Redis cache before fetching if forced
  if (force) {
    await clearInboxCache(user.id);
  }

  try {
    const result = await fetchJobRelatedMessages(auth, companyNames, {
      maxResults,
      pageToken,
      userId: user.id,
      force,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Gmail messages fetch error:", err?.message || err, err?.stack);
    return NextResponse.json(
      { error: "Failed to fetch Gmail messages.", detail: err?.message },
      { status: 500 },
    );
  }
}
