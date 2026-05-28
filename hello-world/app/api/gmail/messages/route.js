import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, fetchJobRelatedMessages } from "@/lib/gmail/gmailClient";
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

  const { maxResults = 50 } = body;

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/gmail/oauth2callback`;

  const auth = await getAuthenticatedClient(user.id, redirectUri);
  if (!auth) {
    return NextResponse.json(
      { error: "Gmail not connected. Please connect your Gmail account first." },
      { status: 403 },
    );
  }

  // Pull the user's tracked companies + job titles from the DB so we only
  // fetch Gmail messages that mention one of them.
  const { data: appRows } = await supabase
    .from("applications")
    .select("positions(company, title)")
    .eq("user_id", user.id);

  const companyNames = [
    ...new Set((appRows || []).map((r) => r.positions?.company).filter(Boolean)),
  ];
  const jobTitles = [
    ...new Set((appRows || []).map((r) => r.positions?.title).filter(Boolean)),
  ];

  if (companyNames.length === 0 && jobTitles.length === 0) {
    return NextResponse.json({ messages: [] });
  }

  try {
    const messages = await fetchJobRelatedMessages(auth, {
      companyNames,
      jobTitles,
      maxResults,
    });

    console.log(`[Gmail messages fetch] fetched ${messages.length} messages for user ${user.id}`);

    if (messages.length > 0) {
      await upsertGmailMessages(user.id, messages);
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
