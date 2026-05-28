import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, fetchJobRelatedMessages } from "@/lib/gmail/gmailClient";
import { matchMessagesToApplications } from "@/lib/gmail/emailUtils";
import { upsertGmailMessages } from "@/lib/supabase/upsertGmailMessages";

/**
 * POST /api/gmail/messages
 *
 * Fetches job-related Gmail messages for the current user.
 * Body (optional): { companyNames: string[], maxResults: number }
 *
 * Response: { messages: Array<{ id, threadId, subject, from, date, snippet }> }
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

  const { companyNames = [], maxResults = 50 } = body;

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/gmail/oauth2callback`;

  const auth = await getAuthenticatedClient(user.id, redirectUri);
  if (!auth) {
    return NextResponse.json(
      { error: "Gmail not connected. Please connect your Gmail account first." },
      { status: 403 },
    );
  }

  try {
    const messages = await fetchJobRelatedMessages(auth, companyNames, maxResults);

    // Persist matched messages to the DB (fire-and-forget, don't block response)
    // We need applicationData from the client to score — accept it in the body.
    if (messages.length > 0 && Array.isArray(body.applicationData)) {
      const matched = matchMessagesToApplications(messages, body.applicationData, 0);
      upsertGmailMessages(user.id, matched).catch((e) =>
        console.error("[gmail/messages] upsert error:", e?.message),
      );
    }

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("Gmail messages fetch error:", err?.message || err, err?.stack);
    return NextResponse.json(
      { error: "Failed to fetch Gmail messages.", detail: err?.message },
      { status: 500 },
    );
  }
}
