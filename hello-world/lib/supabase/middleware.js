import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Refreshes the Supabase session on every request AND gates the app: any page
// route requires an authenticated session, and accounts with a verified TOTP
// factor must complete the MFA challenge (step up to aal2) before entering.
//
// API routes are never redirected — they enforce auth themselves and return
// JSON — and the auth routes (/login, /auth/*) stay public so sign-in can work.
export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isApiRoute = path.startsWith("/api");
  const isAuthRoute = path === "/login" || path.startsWith("/auth");

  // API routes manage their own auth; don't turn a 401 into an HTML redirect.
  if (isApiRoute) return supabaseResponse;

  // Build a redirect that preserves the cookies Supabase just refreshed.
  const redirectTo = (pathname, withReturn = false) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    if (withReturn && path !== "/login") url.searchParams.set("redirect", path);
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  if (!user) {
    return isAuthRoute ? supabaseResponse : redirectTo("/login", true);
  }

  // Signed in — require MFA step-up when the account has a verified factor.
  let needsMfa = false;
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    needsMfa = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";
  } catch {
    needsMfa = false; // fail open on transient errors rather than lock the user out
  }

  if (needsMfa) {
    return path === "/login" ? supabaseResponse : redirectTo("/login", true);
  }

  // Fully authenticated: keep them off the login page.
  if (path === "/login") return redirectTo("/");

  return supabaseResponse;
}
