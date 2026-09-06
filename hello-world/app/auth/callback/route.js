import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/url/safeRedirectPath";
import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Honor a post-login destination, but only a validated same-origin path --
  // see lib/url/safeRedirectPath.js for why a plain startsWith("/") check is
  // not enough.
  const next = safeRedirectPath(searchParams.get("redirect"));

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
