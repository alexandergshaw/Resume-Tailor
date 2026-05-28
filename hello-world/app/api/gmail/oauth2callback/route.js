import { NextResponse } from "next/server";
import { createOAuth2Client, saveTokens } from "@/lib/gmail/gmailClient";

/**
 * GET /api/gmail/oauth2callback
 *
 * Google redirects here after the user grants (or denies) Gmail access.
 * Exchanges the authorization code for tokens and persists them.
 */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const errorParam = searchParams.get("error");

  // User denied access
  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/?gmail_status=denied`,
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }

  // Decode state to recover the user ID
  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    userId = decoded.userId;
  } catch {
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }

  if (!userId) {
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }

  try {
    const redirectUri = `${origin}/api/gmail/oauth2callback`;
    const oauth2Client = createOAuth2Client(redirectUri);

    const { tokens } = await oauth2Client.getToken(code);
    await saveTokens(userId, tokens);

    return NextResponse.redirect(`${origin}/?gmail_status=connected`);
  } catch (err) {
    console.error("Gmail OAuth2 callback error:", err);
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }
}
