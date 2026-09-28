// N60 second chunk, Step C -- the model-spending chat route (AC2-S6, AC2-S7).
// POST derives a feed configuration from the caller's message and RETURNS it
// for review; it never writes a saved search (app/api/feed-config/apply/
// route.js, Step B, owns that write) and never schedules unattended work.
//
// GATE ORDER, load-bearing (mirrors app/api/interview-prep/route.js's own
// numbered gates):
//   1 identity      -- getUser() BEFORE anything that could spend, so an
//                       unauthenticated caller never reaches the model
//   2 rate limit     -- identify() keyed on the authenticated id, checked
//                       BEFORE the deriver runs, so a denied request spends
//                       nothing
//   3 derive         -- app/api/feed-config/apply/route.js's own boundary
//                       (Step B) is what turns this into a stored row; this
//                       route only proposes
//
// The limiter is built at MODULE scope (never inside the handler -- see
// lib/rateLimit/index.js's own header for why that is catastrophic) at
// 12 requests / 10 minutes, the same human-paced bound
// lib/rateLimit/adoption.test.js already uses for interview-prep -- both are
// a single generation per user-triggered turn.
import { createClient } from "@/lib/supabase/server";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { deriveFeedConfig } from "@/lib/feedConfig/deriveFeedConfig";

export const runtime = "nodejs";

const limiter = createRateLimiter({ limit: 12, windowMs: 600_000, prefix: "feedconfigchat" });

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const decision = await limiter.check(identify(request, { userId: user.id }));
  if (!decision.allowed) {
    return Response.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = typeof body?.message === "string" ? body.message : "";
  const config = await deriveFeedConfig(message, { engine: body?.engine, env: process.env });
  return Response.json({ config });
}
