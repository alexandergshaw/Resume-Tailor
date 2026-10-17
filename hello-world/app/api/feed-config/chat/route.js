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
import { normalizeConversationRequest, summarizeConversationConfig } from "@/lib/feedConfig/conversation";
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

  let input;
  try {
    // Stream to a hard byte cap before JSON parsing or any model work.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Invalid conversation request." }, { status: 400 });
    const decoder = new TextDecoder();
    let bytes = 0, text = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32768) {
          await reader.cancel();
          return Response.json({ error: "Conversation request is too large." }, { status: 413 });
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    input = normalizeConversationRequest(JSON.parse(text));
  } catch {
    return Response.json({ error: "Invalid conversation request. Use at most 2000 characters and a bounded user/assistant history." }, { status: 400 });
  }
  let mode = "fallback";
  const config = await deriveFeedConfig(input.message, { history: input.history, currentConfig: input.currentConfig, env: process.env, onMode: value => { mode = value; } });
  const warnings = config.needsDocumentChoice ? ["Cover-only is unavailable. Choose Resume only or Resume + cover letter before saving."] : [];
  return Response.json({ config, assistantMessage: summarizeConversationConfig(config), mode, warnings });
}
