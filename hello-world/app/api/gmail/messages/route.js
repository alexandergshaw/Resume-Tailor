import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, fetchJobRelatedMessages } from "@/lib/gmail/gmailClient";

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
    return NextResponse.json({ messages });
  } catch (err) {
    console.error("Gmail messages fetch error:", err?.message || err, err?.stack);
    return NextResponse.json(
      { error: "Failed to fetch Gmail messages.", detail: err?.message },
      { status: 500 },
    );
  }
}
