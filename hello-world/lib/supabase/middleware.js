import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Refreshes the Supabase session AND gates the app: any page route requires an
// authenticated session, and accounts with a verified TOTP factor must complete
// the MFA challenge (step up to aal2) before entering.
//
// API routes are never redirected — they enforce auth themselves and return
// JSON — and the auth routes (/login, /auth/*) stay public so sign-in can work.
//
// THE ORDER BELOW IS LOAD-BEARING. `auth.getUser()` runs BEFORE the
// `if (isApiRoute) return` early return, and that is deliberate: getUser() is
// what refreshes an expiring session, and the `setAll` handler above rebuilds
// `supabaseResponse` so the ROTATED cookie rides out on whatever this function
// returns — including on the API branch, and including on a redirect (which is
// why redirectTo copies the cookies over). "Never redirected" is not "never
// touched": the refresh happens for /api/* too, on purpose.
//
// Do NOT "optimize" this by hoisting the API early return above getUser().
// 40 of the 76 route.js files under app/api never build a Supabase client at
// all, so for those this middleware is the ONLY thing that can refresh the
// session — and some are polled (app/hooks/useTechWatch.js GETs /api/techwatch
// every 15 minutes). Hoisting the return silently stops refreshing them.
// lib/supabase/middleware.test.js pins this; the hoist fails two assertions.
//
// What it COSTS, measured against the installed @supabase/ssr 0.10.3 and
// @supabase/auth-js 2.106.2 with a recording fetch stub (see the test file,
// where the request count is itself an assertion):
//   - no cookie, or an unrelated cookie      -> ZERO HTTP requests. auth-js
//     short-circuits with AuthSessionMissingError before any I/O, so a plain
//     anonymous request to any route — /api/* included — costs nothing here.
//   - an `sb-<ref>-auth-token` that decodes to an object carrying
//     access_token, refresh_token and expires_at (auth-js checks only that
//     those three keys exist, and all three are attacker-supplied) -> ONE
//     request, `GET /auth/v1/user`, while the stated expiry is in the future.
//   - the same cookie once that expiry has passed -> TWO: the refresh grant
//     and then the user fetch.
// Never a request to Postgres in any of those cases.
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
