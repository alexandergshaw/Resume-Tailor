// Route-level contract for GET /api/fetch-posting.
//
// WHY THIS FILE EXISTS AT ALL. Until this change the route had NO test and NO
// auth: an open, unauthenticated URL-fetching proxy that anyone who could reach
// the deployment could aim at any http(s) host, with our egress address as the
// source. Its SSRF list (localhost, the link-local metadata address, the
// RFC1918 prefixes) was the only control on it, and that list is a
// STRING-PREFIX check on the hostname the caller wrote -- it cannot see a
// public name that resolves to a private address, and it does not re-check
// after `redirect: "follow"`. Those gaps are not this change's to close; what
// this change closes is that nobody had to have an account to reach any of it.
//
// The route spends bandwidth and OUR outbound reputation rather than model
// money, which is why it is bounded lower than the model routes and not higher:
// the cost of an abusive loop here is that a third party sees a scan coming
// from us.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";

const ROUTE_SOURCE = readFileSync(
  path.join(process.cwd(), "app", "api", "fetch-posting", "route.js"),
  "utf8",
);

/** The bound this route declares. Duplicated in lib/rateLimit/adoption.test.js. */
const LIMIT = 20;

// USER IDS ARE UNIQUE PER CASE, deliberately. The rate limiter is a module
// singleton, so its counters survive between `it()` blocks in this file exactly
// as they survive between requests in a running server. Sharing one id would
// let an early case's requests deny a later one -- a defect in the TEST, not in
// the bound. Same discipline as app/api/copilot/ask/route.test.js.
let userSeq = 0;
function signedIn(userId = `posting-user-${(userSeq += 1)}`) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
  return userId;
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

function get(url) {
  const target = url === undefined ? "" : `?url=${encodeURIComponent(url)}`;
  return new Request(`http://localhost/api/fetch-posting${target}`);
}

function htmlResponse(html, contentType = "text/html; charset=utf-8") {
  return new Response(html, { status: 200, headers: { "content-type": contentType } });
}

let outbound;

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  outbound = vi.fn(async () => htmlResponse("<html><body><p>Hello</p></body></html>"));
  vi.stubGlobal("fetch", outbound);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Identity -- the finding this file was written for.
// ---------------------------------------------------------------------------
describe("an anonymous caller cannot use this as an open proxy", () => {
  it("401s and makes NO outbound request", async () => {
    signedOut();
    const res = await GET(get("https://jobs.example.test/posting/1"));
    expect(res.status).toBe(401);
    // The whole point: nothing left this server on an anonymous caller's say-so.
    expect(outbound).not.toHaveBeenCalled();
  });

  it("401s before the SSRF checks, so a refusal never leaks which hosts are blocked", async () => {
    // A blocked host answered 400 while an allowed one answered 502/200 gave an
    // unauthenticated caller a free oracle over the internal address space.
    // With the gate first, every anonymous probe gets the same 401.
    signedOut();
    const blocked = await GET(get("http://169.254.169.254/latest/meta-data/"));
    const allowed = await GET(get("https://jobs.example.test/posting/1"));
    expect(blocked.status).toBe(401);
    expect(allowed.status).toBe(401);
    expect(outbound).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The behaviour the gate must not have changed.
// ---------------------------------------------------------------------------
describe("a signed-in caller still gets the scrape", () => {
  it("returns the page's text with scripts, styles and tags stripped", async () => {
    outbound.mockResolvedValue(
      htmlResponse(
        "<html><head><style>p{color:red}</style><script>alert(1)</script></head>" +
          "<body><h1>Senior Engineer</h1><p>Build&nbsp;things &amp; ship them.</p></body></html>",
      ),
    );
    const res = await GET(get("https://jobs.example.test/posting/1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toContain("Senior Engineer");
    expect(data.text).toContain("Build things & ship them.");
    expect(data.text).not.toContain("alert(1)");
    expect(data.text).not.toContain("color:red");
    expect(outbound).toHaveBeenCalledOnce();
  });

  it("400s a missing, unparseable, or non-http URL", async () => {
    expect((await GET(get(undefined))).status).toBe(400);
    expect((await GET(get("not a url"))).status).toBe(400);
    expect((await GET(get("ftp://files.example.test/x"))).status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("still refuses loopback, metadata and RFC1918 hosts", async () => {
    for (const url of [
      "http://localhost/admin",
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/internal",
      "http://192.168.1.1/router",
    ]) {
      expect((await GET(get(url))).status, url).toBe(400);
    }
    expect(outbound).not.toHaveBeenCalled();
  });

  it("422s a page that is neither HTML nor plain text", async () => {
    outbound.mockResolvedValue(htmlResponse("{}", "application/json"));
    expect((await GET(get("https://jobs.example.test/api"))).status).toBe(422);
  });

  it("502s when the upstream page is not OK", async () => {
    outbound.mockResolvedValue(new Response("nope", { status: 404 }));
    expect((await GET(get("https://jobs.example.test/gone"))).status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// The bound. Only possible now that there is an id to key on.
// ---------------------------------------------------------------------------
describe("the outbound-request ceiling actually bites", () => {
  it("denies past the bound with 429 and a Retry-After", async () => {
    signedIn("posting-greedy");

    const statuses = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      // A missing url 400s on validation -- which is deliberately AFTER the
      // bound, so a caller hammering this endpoint with junk exhausts its own
      // allowance rather than getting an unmetered lane.
      statuses.push((await GET(get(undefined))).status);
    }

    // A limiter built INSIDE the handler gets a fresh store on every request,
    // so every caller is forever on its first request and all LIMIT+1 are 400.
    expect(statuses.filter((s) => s === 400)).toHaveLength(LIMIT);
    expect(statuses[LIMIT]).toBe(429);

    const denied = await GET(get("https://jobs.example.test/posting/1"));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("RateLimit-Limit")).toBe(String(LIMIT));
    // A denial makes no outbound request: the bound precedes the fetch.
    expect(outbound).not.toHaveBeenCalled();
  });

  it("counts per authenticated user, so one caller's flood cannot deny another", async () => {
    signedIn("posting-flooder");
    for (let i = 0; i < LIMIT + 1; i += 1) await GET(get(undefined));
    expect((await GET(get(undefined))).status).toBe(429);

    signedIn("posting-bystander");
    expect((await GET(get(undefined))).status).toBe(400);
  });

  it("builds the limiter at MODULE scope, never inside the handler", () => {
    // The static half of the assertion above. A per-request limiter counts
    // nothing while looking correct, so only a construction-site check sees it.
    const declaration = /^const \w+ = createRateLimiter\(/m;
    expect(ROUTE_SOURCE).toMatch(declaration);
    const limiterAt = ROUTE_SOURCE.search(declaration);
    const handlerAt = ROUTE_SOURCE.indexOf("export async function GET");
    expect(handlerAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeLessThan(handlerAt);
    expect(ROUTE_SOURCE.slice(handlerAt)).not.toMatch(/createRateLimiter\(/);
  });
});
