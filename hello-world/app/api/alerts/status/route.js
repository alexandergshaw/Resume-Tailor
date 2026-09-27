import { createClient } from "@/lib/supabase/server";
import { emailAlertsAvailable } from "@/lib/email/emailConfigStatus";
import { readAlertsPaused } from "@/lib/email/alertPause";

export const runtime = "nodejs";

// N60 S5 (AC-E5) -- the server-reported email-alert config status. A client
// cannot see RESEND_API_KEY / EMAIL_FROM, so guessing availability client-side
// is how "alerts are on" becomes a second lie; this route is the one place
// that reads the real env and reports it, gated to the signed-in owner.
//
// N60 S6 (AC-E4) -- also reports the account's own pause state, read through
// the user's own session client (RLS select-own), so the settings control has
// one place to read its initial state from.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { available, reason } = emailAlertsAvailable(process.env);
  const pause = await readAlertsPaused(supabase, user.id);
  return Response.json({ emailConfigured: available, reason, alertsPaused: pause.paused });
}
