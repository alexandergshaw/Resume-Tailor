// ---------------------------------------------------------------------------
// POST /api/salary-estimate -- a user-initiated, grounded compensation
// estimate for one pinned job posting that states no pay (N65).
//
// A DEDICATED route, not grounding bolted into /api/chat: the estimate is a
// structured, cited, labelled artifact and must never share an envelope with
// a free-prose chat reply. Mirrors app/api/application-digest/route.js, the
// one other Interactions-API call site in this repo: auth -> validate ->
// embedded refusal -> stated backstop -> grounded call inside a try -> 200
// (never 5xx) on failure, so the caller renders the failure IN the chat
// transcript rather than getting a fetch error.
//
// NO RATE LIMITER (plan P-R1, OWNER-2). The owner's containment is
// structural: this is user-initiated only, from the Ask AI panel, and the
// automatic feed-ingestion path (ingestFeed.js, llmSearch.js, the tailor
// cron) gains no salary-provider call -- so unattended spend stays at zero.
//
// WRITES NOTHING TO ANY DATABASE (S11). The estimate lives only in the
// chat transcript, exactly like every other assistant turn; it is never
// written into feed_postings.salary_min/max or any field a stated-salary
// render reads.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { unauthorized, badRequest } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import {
  extractCitationSources,
  interactionOutputText,
  interactionSearched,
  interactionTruncated,
} from "@/lib/llm/interactionCitations";
import { buildSalaryEstimate } from "@/lib/salary/salaryEstimate";
import { SALARY_ESTIMATE_SYSTEM_PROMPT, buildSalaryEstimateInput } from "@/lib/salary/salaryEstimatePrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE SAME BUDGET application-digest/route.js uses, for the same reason:
// the Interactions transport's own default (60s timeout, up to 3 attempts)
// can run past a platform's default function duration and get killed
// mid-retry, which would silently re-arm the same billed search on every
// click. 45s + backoff + 45s ~= 92s, comfortably inside 120.
export const maxDuration = 120;
const GROUNDED_CALL_TIMEOUT_MS = 45_000;
// RequestOptions.maxRetries counts RETRIES, not attempts: 1 means two
// attempts. PER-CALL, never on the client -- getGeminiClient() memoises a
// module singleton shared by seven other features.
const GROUNDED_CALL_MAX_RETRIES = 1;

// The shape every non-grounded refusal returns, so every early-exit path and
// the catch below agree on one envelope. `searched`/`truncated` are honestly
// false here -- none of these paths ever asked the model anything.
function withheldEstimate(status, reason) {
  return {
    status,
    reason,
    range: null,
    basisKind: "none",
    sourceCount: 0,
    citations: [],
    searched: false,
    truncated: false,
  };
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return badRequest("Missing title.");
  const company = typeof body?.company === "string" ? body.company.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";

  // A de-escalation the offline engine has no grounded-search equivalent
  // for (S8) -- lib/chat/localAssistant.js's own extractive salary path
  // already emits no compensation figure on its own; this refuses outright
  // rather than let the offline path try to fabricate one.
  if (wantsEmbedded(body?.engine)) {
    return Response.json({ salaryEstimate: withheldEstimate("unavailable_embedded", "embedded") });
  }

  // The server-side S1 backstop. The client hides the affordance once a
  // posting already states its pay; this is the cheapest possible refusal --
  // no grounded call -- and it never re-renders the stated figure here (S11:
  // a stated salary stays owned by the posting surface).
  if (body?.salaryStated === true) {
    return Response.json({ salaryEstimate: withheldEstimate("refused_stated", "stated") });
  }

  // The grounded call and its extraction live INSIDE one try. A vendor
  // shape surprise -- a config error, a network failure, a malformed
  // Interaction -- must land on the failure path and return 200 so the
  // caller can render "couldn't retrieve" in the transcript, never an
  // unhandled 500 and never a fabricated number (S14).
  let salaryEstimate;
  try {
    const model = getServerEnv().geminiModel;
    const client = getGeminiClient();
    const interaction = await client.interactions.create(
      {
        model,
        // `input`, not `contents`. `system_instruction` and `tools` are
        // TOP-LEVEL, and there is no `config` object at all -- the OPPOSITE
        // of the rule governing `models.generateContent`. Nesting `tools`
        // in a `config` object here would be silently DROPPED by the SDK's
        // parameter transformer: no error, no search, a full grounded bill
        // for an ungrounded guess. Only route.wire.test.js can see that.
        system_instruction: SALARY_ESTIMATE_SYSTEM_PROMPT,
        input: buildSalaryEstimateInput({ title, company, location }),
        tools: [{ type: "google_search" }],
      },
      // PER-CALL, never on the client singleton.
      { timeout: GROUNDED_CALL_TIMEOUT_MS, maxRetries: GROUNDED_CALL_MAX_RETRIES },
    );

    // A well-formed Interaction that produced no text has its `output_text`
    // key OMITTED entirely by the real SDK (K4) -- interactionOutputText
    // throws on that, so it is called only when there is something to read.
    // An empty Interaction degrades to a withhold via buildSalaryEstimate's
    // own range gate, never an unhandled throw.
    const outputText = interaction?.output_text ? interactionOutputText(interaction) : "";

    salaryEstimate = buildSalaryEstimate({
      outputText,
      sources: extractCitationSources(interaction),
      searched: interactionSearched(interaction),
      truncated: interactionTruncated(interaction),
      company,
    });
  } catch {
    salaryEstimate = withheldEstimate("failed", "provider_error");
  }

  return Response.json({ salaryEstimate });
}
