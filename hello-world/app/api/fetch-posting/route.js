import { NextResponse } from "next/server";
import { getAuth, unauthorized } from "@/lib/experience/apiAuth";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";

const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS/GCP metadata
];

const BLOCKED_IP_PREFIXES = ["10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31."];

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

// ---------------------------------------------------------------------------
// THE OUTBOUND-REQUEST CEILING.
//
// THIS ROUTE IS DIFFERENT FROM THE MODEL ROUTES BOUNDED ALONGSIDE IT, and the
// difference is the whole reason for the number. It spends no model money at
// all; what an abusive loop here spends is bandwidth and, far more importantly,
// OUR outbound reputation -- every request leaves this server aimed at a host
// the CALLER chose, so a loop is a scan that a third party sees coming from us.
// The gate above is therefore the real fix and this bound is the follow-on: it
// makes that scan attributable to one account and finite.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it (lib/rateLimit/index.js's header states
// this as the one way to adopt it catastrophically wrong). This route's suite
// pins both halves.
//
// 20 fetches per 10 minutes, per authenticated user, and 20 is generous on
// purpose: this route has ZERO callers anywhere in the app -- the in-product
// scraping all goes through `lib/scrape/fetchUrlContent.js`, which has the
// stronger SSRF checks (`checkRequestUrl`, `isBlockedHost`, `parseIPv4` /
// `parseIPv6`) that the inline hostname list below does not. So no legitimate
// traffic exists to clip, and the right follow-up is to decide whether this
// endpoint should exist at all rather than to tune its limit.
//
// HONEST ABOUT WHAT THIS BUYS: `createMemoryStore` is per-instance, so on
// serverless this bounds a caller to 20 x instanceCount, not 20.
// ---------------------------------------------------------------------------
const fetchPostingLimiter = createRateLimiter({ limit: 20, windowMs: 600_000, prefix: "fetch-posting" });

const RATE_LIMITED_MESSAGE = "Too many pages fetched in a short window. Wait a moment and try again.";

export async function GET(request) {
  // ORDER IS LOAD-BEARING BELOW.
  //
  // 1. IDENTITY, from `auth.getUser()` by way of the shared `getAuth()`. Never
  //    `getSession()`: that call makes ZERO network requests
  //    (app/api/health/route.js:204-210 records the measurement), so gating on
  //    it is not a weak check, it is a total bypass.
  //
  //    Ahead of the SSRF checks below, not after them, and that ordering is
  //    itself a fix: answering a blocked host with 400 and a reachable one with
  //    502-or-200 handed an ANONYMOUS caller a free oracle over this network's
  //    address space. With the gate first, every unauthenticated probe gets the
  //    same 401 and learns nothing.
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  // 2. THE BOUND, keyed on the id step 1 resolved to -- never on the caller's
  //    access token, and never before the auth resolves. Checked ahead of URL
  //    validation on purpose: an invalid request is still a request, and a
  //    caller hammering this endpoint with junk should exhaust its own
  //    allowance rather than get an unmetered lane.
  const decision = await fetchPostingLimiter.check(identify(request, { userId }));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url parameter." }, { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json(
      { error: "Only HTTP and HTTPS URLs are supported." },
      { status: 400 },
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.includes(hostname) ||
    BLOCKED_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))
  ) {
    return NextResponse.json({ error: "That URL is not allowed." }, { status: 400 });
  }

  try {
    const response = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ResumeTailor/1.0; +https://github.com/alexandergshaw/Resume-Tailor)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL (status ${response.status}).` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return NextResponse.json(
        { error: "URL did not return an HTML or text page." },
        { status: 422 },
      );
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.byteLength + chunk.byteLength);
        merged.set(acc);
        merged.set(chunk, acc.byteLength);
        return merged;
      }, new Uint8Array(0)),
    );

    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch URL." },
      { status: 502 },
    );
  }
}
