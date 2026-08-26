// ---------------------------------------------------------------------------
// POST /api/application-digest — the tracking table's researched "what the
// posting does not tell you" column, computed once per application and
// re-run only on request (see lib/tracking/applicationDigest.js for the
// prompt/parse logic this calls, and lib/supabase/applicationDigests.js for
// storage).
//
// The tracking table re-renders on every load, so every gate below exists to
// avoid paying for a grounded search it does not need: auth, then a missing
// id, then someone else's application, then the embedded engine (no offline
// equivalent for live search), then — the gate that actually matters day to
// day — an already-`ready` digest, which is returned as-is unless the caller
// passes `force: true` (what the Research button sends). Only after all of
// that does a model get asked anything.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { extractGroundingSources } from "@/lib/llm/grounding";
import { listDigests, upsertDigest } from "@/lib/supabase/applicationDigests";
import { buildDigestPrompt, parseDigestAnswer } from "@/lib/tracking/applicationDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// listDigests' contract is "keyed by application_id" for the multi-row
// tracking-table case, but the safest read here does not lean on that shape
// — Object.values() walks either a keyed object or a plain array the same
// way, so this keeps working if the caller passes back either.
function findDigest(digests, applicationId) {
  return Object.values(digests || {}).find((d) => d && d.application_id === applicationId) || null;
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();
  const userId = user.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const applicationId = typeof body?.applicationId === "string" ? body.applicationId.trim() : "";
  if (!applicationId) return badRequest("Missing applicationId.");

  // Scoped to the caller in the query itself, not just checked after the
  // fact: RLS would return nothing for someone else's row, and a query that
  // only filtered by id would have to reproduce that check by hand.
  const { data: appRow, error: appErr } = await supabase
    .from("applications")
    .select("id, user_id, positions ( id, title, company, location, description, url )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (appErr) return Response.json({ error: appErr.message || "Could not load this application." }, { status: 500 });
  if (!appRow) return notFound("Application not found.");

  // Same refusal shape as app/api/techwatch/lifecycle/route.js and
  // app/api/experience/research/route.js: a search-grounded digest has no
  // honest offline equivalent, so the embedded engine is refused outright
  // rather than silently producing an empty or fabricated report.
  if (wantsEmbedded(body?.engine)) {
    return Response.json(
      { error: "Company research needs the Gemini engine. Switch off the embedded engine and try again." },
      { status: 503 },
    );
  }

  const force = body?.force === true;

  const { digests: existingDigests } = await listDigests(supabase, userId, [applicationId]);
  const existing = findDigest(existingDigests, applicationId);

  // The tracking table asks for this on every load; without this short
  // circuit, re-rendering the table would bill a grounded search per view.
  // `force` is what the Research button sends, and is the only way back in.
  if (existing && existing.status === "ready" && !force) {
    return Response.json({ digest: existing });
  }

  const posting = appRow.positions || {};
  const prompt = buildDigestPrompt(posting);

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ error: "Company research needs the Gemini API key to be configured." }, { status: 503 });
  }

  let response;
  try {
    response = await client.models.generateContent({
      model,
      contents: prompt,
      // `tools` LIVES INSIDE `config`. DO NOT FLATTEN IT BACK OUT.
      // `GenerateContentParameters` has exactly THREE properties — `model`,
      // `contents`, `config` — and `tools` belongs to `GenerateContentConfig`.
      // The SDK's parameter transformer reads only those three keys and
      // DISCARDS everything else before building the request body, with no
      // warning, so a top-level `tools` never reaches Google. The failure is
      // total and silent: no search -> no groundingMetadata -> every cited
      // link is stripped and the digest stores claims with nothing behind
      // them, while still paying for a full grounded call. Pinned on the wire
      // by route.wire.test.js.
      config: { tools: [{ googleSearch: {} }] },
    });
  } catch (err) {
    // Persisted, not just returned: a failed attempt that vanished would
    // leave the cell looking like nobody had ever researched it, and
    // selectAutoDigestTargets relies on a stored `failed` row to NOT
    // auto-retry this application on every future page load. Whatever was
    // there before (if this was a forced re-run) is kept rather than wiped,
    // so a transient failure never regresses an already-good digest.
    const { digest } = await upsertDigest(supabase, userId, applicationId, {
      status: "failed",
      error: err?.message || "Company research failed. Please try again.",
      markdown: existing?.markdown || "",
      sources: existing?.sources || [],
      engine: "gemini",
    });
    // 200, not 5xx: the failure is the answer here, not a broken route —
    // the caller (the tracking table) needs a normal response it can render
    // as "Research failed - try again" rather than a fetch error.
    return Response.json({ digest });
  }

  const rawText = String(response?.text || "");
  const grounded = extractGroundingSources(response);
  const { markdown, sources } = parseDigestAnswer(rawText, { grounded });

  const { digest, error: saveErr } = await upsertDigest(supabase, userId, applicationId, {
    status: "ready",
    markdown,
    sources,
    error: null,
    engine: "gemini",
  });
  if (saveErr) return Response.json({ error: saveErr }, { status: 500 });

  return Response.json({ digest });
}
