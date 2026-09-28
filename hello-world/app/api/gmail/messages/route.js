import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, fetchJobRelatedMessages } from "@/lib/gmail/gmailClient";
import { upsertGmailMessages } from "@/lib/supabase/upsertGmailMessages";
import { GMAIL_AUTH_CAUSES } from "@/lib/gmail/authFailure";

// Canned human copy per coarse cause. Route-local: the client keys on `cause`,
// never on this string, so there is no reason to share it across modules.
const HUMAN_BY_CAUSE = {
  not_connected: "Gmail not connected. Please connect your Gmail account first.",
  reauth_required: "Gmail access expired or was revoked. Please reconnect your Gmail account.",
  temporarily_unavailable: "Couldn't reach Gmail right now. Please try again shortly.",
};

/**
 * POST /api/gmail/messages
 *
 * Fetches job-related Gmail messages for the current user.
 * Body (optional): { companyNames: string[], maxResults: number }
 *
 * Response:
 *   200 { messages: Array<{ id, threadId, subject, from, date, snippet }> }
 *   401 { error }                      — unauthenticated, no cause field
 *   403 { error, cause }               — refused; cause is one of
 *     not_connected | reauth_required | temporarily_unavailable, produced
 *     only after auth succeeds so it can only ever describe the caller's own
 *     account
 *   500 { error }                      — Gmail API call itself failed
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

  const result = await getAuthenticatedClient(user.id, redirectUri);
  if (!result.ok) {
    // Defensive: the cause must stay inside the closed vocabulary the client
    // keys on (AC-2/AC-11). If a future change to getAuthenticatedClient ever
    // produced something outside GMAIL_AUTH_CAUSES, fall back to the no-remedy
    // transient cause rather than forwarding an unrecognised string.
    const cause = GMAIL_AUTH_CAUSES.includes(result.cause) ? result.cause : "temporarily_unavailable";
    return NextResponse.json(
      { error: HUMAN_BY_CAUSE[cause], cause },
      { status: 403 },
    );
  }
  const auth = result.client;

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
      { error: "Failed to fetch Gmail messages." },
      { status: 500 },
    );
  }
}
