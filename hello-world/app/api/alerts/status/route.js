import { createClient } from "@/lib/supabase/server";
import { emailAlertsAvailable } from "@/lib/email/emailConfigStatus";

export const runtime = "nodejs";

// N60 S5 (AC-E5) -- the server-reported email-alert config status. A client
// cannot see RESEND_API_KEY / EMAIL_FROM, so guessing availability client-side
// is how "alerts are on" becomes a second lie; this route is the one place
// that reads the real env and reports it, gated to the signed-in owner.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { available, reason } = emailAlertsAvailable(process.env);
  return Response.json({ emailConfigured: available, reason });
}
