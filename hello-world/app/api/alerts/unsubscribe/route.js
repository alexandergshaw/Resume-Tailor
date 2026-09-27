import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/email/alertUnsubscribeToken";

export const runtime = "nodejs";

// N60 S5 (AC-E3) -- the one-click unsubscribe a recipient follows straight
// from the emailed link, with no session. Deliberately UNAUTHENTICATED: the
// token itself is the credential.
//
// An absent, malformed, or foreign (wrong-secret) token gets the exact same
// generic 200 as every other invalid token, and never reaches the database --
// so this endpoint cannot be used to enumerate which tokens/accounts exist. A
// valid token performs exactly one write (email_on_new_jobs=false, scoped to
// that account) and is safe to follow more than once.
const GENERIC_MESSAGE =
  "If that link was valid, email alerts have been turned off for the associated account.";

function genericResponse() {
  return new Response(GENERIC_MESSAGE, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  const verified = token ? verifyUnsubscribeToken(token) : { ok: false, reason: "absent" };
  if (!verified.ok) {
    return genericResponse();
  }

  const admin = createAdminClient();
  await admin
    .from("saved_searches")
    .update({ email_on_new_jobs: false })
    .eq("user_id", verified.userId);

  return new Response("Email alerts are now turned off for your account.", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
