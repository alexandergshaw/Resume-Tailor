import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "./middleware.js";
import { config as rootMiddlewareConfig } from "../../middleware.js";

// This file exists because `updateSession` is the authentication gate for the
// WHOLE app and had no test at all, while carrying an ordering that looks
// redundant and is not: `auth.getUser()` runs BEFORE the `isApiRoute` early
// return, and it is that call — not the redirect logic below it — that
// refreshes an expiring session and writes the rotated cookie onto the
// response. Every assertion here is a characterization of behaviour that
// shipped; none of it is new. What it defends against is the plausible
// "optimization" of hoisting the API early return above the `getUser()` call.
//
// Nothing here touches the network: `globalThis.fetch` is replaced with a
// recorder, so the GoTrue request COUNT is itself an assertion. Every secret
// below is an obvious fake.

const PROJECT_URL = "https://demoproject.supabase.co";
const ANON_KEY = "fake-anon-key-not-a-secret";
const COOKIE = "sb-demoproject-auth-token"; // sb-<url hostname's first label>-auth-token

let calls;
let originalFetch;
let originalUrl;
let originalKey;

/** An unsigned, well-formed JWT so auth-js's LOCAL aal decode works (no HTTP). */
function accessToken(aal = "aal1") {
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "user-1", aal })}.fakesig`;
}

/** The cookie @supabase/ssr writes: `base64-` + base64url of the session JSON. */
function sessionCookie({ expiresInSec, aal = "aal1" }) {
  const json = JSON.stringify({
    access_token: accessToken(aal),
    refresh_token: "fake-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    expires_in: expiresInSec,
    token_type: "bearer",
    user: { id: "user-1", aud: "authenticated", role: "authenticated", factors: [] },
  });
  return `base64-${Buffer.from(json, "utf8").toString("base64url")}`;
}

function request(path, cookies = {}) {
  const req = new NextRequest(new Request(`https://app.test${path}`));
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = PROJECT_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;

  globalThis.fetch = vi.fn(async (url, init) => {
    const href = typeof url === "string" ? url : url.url;
    calls.push(`${init?.method ?? "GET"} ${href.replace(PROJECT_URL, "")}`);
    const json = (body) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (href.includes("grant_type=refresh_token")) {
      return json({
        access_token: accessToken("aal1"),
        refresh_token: "fake-rotated-refresh-token",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "user-1", aud: "authenticated", role: "authenticated", factors: [] },
      });
    }
    if (href.includes("/auth/v1/user")) {
      return json({ id: "user-1", aud: "authenticated", role: "authenticated", factors: [] });
    }
    return json({});
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("updateSession — what an anonymous request actually costs", () => {
  it("spends ZERO GoTrue requests on an /api/* route with no cookie", async () => {
    const res = await updateSession(request("/api/applied"));

    // The load-bearing number. auth-js short-circuits with
    // AuthSessionMissingError before any I/O when there is no session cookie,
    // so the middleware's getUser() on the anonymous API path is free. A
    // reading of this code as "every anonymous /api call costs a GoTrue
    // round trip in the middleware plus another in the route" is wrong: with
    // no cookie both halves are zero.
    expect(calls).toEqual([]);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("spends ZERO GoTrue requests when the request carries an unrelated cookie", async () => {
    await updateSession(request("/api/applied", { theme: "dark" }));
    expect(calls).toEqual([]);
  });

  it("spends ZERO GoTrue requests on a page route with no cookie, and still redirects", async () => {
    const res = await updateSession(request("/dashboard"));

    expect(calls).toEqual([]);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login?redirect=%2Fdashboard");
  });

  it("costs exactly ONE GoTrue request when the cookie is an attacker-shaped, unexpired session", async () => {
    // auth-js's validity check only asks that access_token, refresh_token and
    // expires_at exist — all attacker-supplied — so a forged cookie does buy
    // one pass-through request. THIS is the case where the middleware and the
    // route each pay once; it is not the plain anonymous case.
    await updateSession(request("/api/applied", { [COOKIE]: sessionCookie({ expiresInSec: 3600 }) }));
    expect(calls).toEqual(["GET /auth/v1/user"]);
  });
});

describe("updateSession — the getUser() call above the API early return is load-bearing", () => {
  it("refreshes an expiring session on an /api/* route and returns the rotated cookie", async () => {
    // The whole reason `getUser()` must stay ABOVE `if (isApiRoute) return`.
    // Hoisting the early return would make both assertions below fail.
    const res = await updateSession(
      request("/api/applied", { [COOKIE]: sessionCookie({ expiresInSec: -60 }) }),
    );

    expect(calls).toContain("POST /auth/v1/token?grant_type=refresh_token");
    expect(res.cookies.get(COOKIE)).toBeDefined();
    // ...and it is the REFRESHED value that rides out, not the stale one.
    expect(res.cookies.get(COOKIE).value).not.toContain("fake-refresh-token\"");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("refreshes an expiring session on a page route without logging the user out", async () => {
    const res = await updateSession(
      request("/dashboard", { [COOKIE]: sessionCookie({ expiresInSec: -60 }) }),
    );

    expect(calls).toContain("POST /auth/v1/token?grant_type=refresh_token");
    expect(res.cookies.get(COOKIE)).toBeDefined();
    // Not redirected: the refresh is what keeps a navigation from silently
    // signing the user out. Swapping getUser() for getSession() breaks this.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("keeps a signed-in user on the page they asked for", async () => {
    const res = await updateSession(
      request("/dashboard", { [COOKIE]: sessionCookie({ expiresInSec: 3600 }) }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends a signed-in user away from /login", async () => {
    const res = await updateSession(
      request("/login", { [COOKIE]: sessionCookie({ expiresInSec: 3600 }) }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/");
  });

  it("carries the refreshed cookie onto a REDIRECT, not just onto a pass-through", async () => {
    // A refresh and a redirect can happen on the same request. If the redirect
    // response is built without copying the cookies Supabase just wrote, the
    // rotated token is dropped and the very next request presents a refresh
    // token the server has already retired.
    const res = await updateSession(
      request("/login", { [COOKIE]: sessionCookie({ expiresInSec: -60 }) }),
    );

    expect(calls).toContain("POST /auth/v1/token?grant_type=refresh_token");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/");
    expect(res.cookies.get(COOKIE)).toBeDefined();
  });
});

describe("updateSession — MFA step-up", () => {
  const withFactor = (expiresInSec) => {
    const raw = sessionCookie({ expiresInSec });
    const json = JSON.parse(Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8"));
    json.user.factors = [{ id: "factor-1", status: "verified", factor_type: "totp" }];
    return `base64-${Buffer.from(JSON.stringify(json), "utf8").toString("base64url")}`;
  };

  it("challenges an aal1 session that has a verified factor", async () => {
    const res = await updateSession(request("/dashboard", { [COOKIE]: withFactor(3600) }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login?redirect=%2Fdashboard");
  });

  it("does not bounce the challenged user off /login itself", async () => {
    // Otherwise the step-up redirect is an infinite loop.
    const res = await updateSession(request("/login", { [COOKIE]: withFactor(3600) }));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("fails OPEN when the assurance-level lookup throws", async () => {
    // An undecodable access token makes auth-js throw out of the aal lookup.
    // The deliberate choice here is to let the user through rather than lock
    // out every signed-in account on a transient fault; inverting it to
    // fail closed is a self-inflicted outage.
    const json = JSON.stringify({
      access_token: "not-a-jwt",
      refresh_token: "fake-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "user-1", aud: "authenticated", role: "authenticated", factors: [] },
    });
    const cookie = `base64-${Buffer.from(json, "utf8").toString("base64url")}`;

    const res = await updateSession(request("/dashboard", { [COOKIE]: cookie }));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves the auth routes reachable while signed out", async () => {
    for (const path of ["/login", "/auth/callback"]) {
      const res = await updateSession(request(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});

describe("the root matcher decides whether any of the above runs at all", () => {
  const matches = (path) => {
    const [pattern] = rootMiddlewareConfig.matcher;
    return new RegExp(`^${pattern}$`).test(path);
  };

  it("covers /api/* — which is why the middleware pays a cookie cost there at all", () => {
    expect(matches("/api/applied")).toBe(true);
    expect(matches("/api/health")).toBe(true);
  });

  it("covers the page routes it gates", () => {
    for (const path of ["/", "/dashboard", "/login", "/copilot", "/auth/callback"]) {
      expect(matches(path)).toBe(true);
    }
  });

  it("excludes static assets, so they never pay for a session lookup", () => {
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.svg", "/hero.png"]) {
      expect(matches(path)).toBe(false);
    }
  });
});
