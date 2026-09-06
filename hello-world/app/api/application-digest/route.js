// ---------------------------------------------------------------------------
// POST /api/application-digest — the tracking table's researched "what the
// posting does not tell you" column, computed once per application and
// re-run only on request (see lib/tracking/applicationDigest.js for the
// prompt, lib/tracking/digestCitations.js for the write-time citation pass,
// and lib/supabase/applicationDigests.js for storage).
//
// The tracking table re-renders on every load, so every gate below exists to
// avoid paying for a grounded search it does not need: auth, then a missing
// id, then someone else's application, then the embedded engine (no offline
// equivalent for live search), then a cache read that FAILED (a failed read is
// not a cache miss), then — the gate that actually matters day to day — an
// already-`ready` digest, which is returned as-is unless the caller passes
// `force: true` (what the Research button sends). Only after all of that does
// a model get asked anything.
//
// THIS IS THE ONLY GROUNDED CALL SITE IN THE REPO ON THE INTERACTIONS API.
// The other seven still use `models.generateContent`, and the two request
// shapes are INVERTED — see the comment on the call itself. Nothing about this
// file's request shape may be propagated to them, and nothing about theirs may
// be propagated here.
//
// WHY THE MIGRATION HAPPENED AT ALL: on `models.generateContent`,
// `groundingChunks[].web.uri` is a `vertexaisearch.cloud.google.com` redirect
// proxy rather than the publisher's URL, so every host comparison against a
// URL the model wrote failed, every citation was demoted, and `sources` was
// persisted `[]` on every digest for the life of the feature. On Interactions,
// `url_citation.url` is the real publisher URL and carries byte offsets into
// the response text, which is what makes footnotes possible at all.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";
import { unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import {
  extractCitationSources,
  interactionOutputText,
  interactionSearched,
  interactionStageCounts,
  interactionTruncated,
} from "@/lib/llm/interactionCitations";
import { listDigests, upsertDigest } from "@/lib/supabase/applicationDigests";
import { buildCitedDigest } from "@/lib/tracking/digestCitations";
import { buildDigestPrompt } from "@/lib/tracking/applicationDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE THREE NUMBERS BELOW ARE ONE BUDGET AND MUST BE READ TOGETHER.
//
// Measured on the installed @google/genai: the Interactions transport defaults
// to a 60 s timeout and `maxRetries ?? 2` — THREE attempts for one logical
// call — and it retries a client-side timeout as well as 429s and 5xx, so the
// unbounded worst case is 3 x 60 s + backoff ~= 182 s. `models.generateContent`
// makes ONE attempt in the same situation, so migrating this call site changed
// the timing behaviour even though nothing about the timing was asked for.
//
// The digest route set no `maxDuration`, so the platform default governed. If
// that default is under ~182 s the function is killed MID-RETRY: the catch
// below never runs, no `failed` row is written, and `selectAutoDigestTargets`
// excludes an application only when a digest row EXISTS — so every eligible
// row re-fires a full billed grounded search on every page load, silently, for
// as long as it stays inside AUTO_DIGEST_MAX_AGE_HOURS (24). That is the exact
// stampede this route's short-circuit exists to prevent, re-armed at 3x the
// billing by a change meant to close it.
//
// 45 s + backoff + 45 s ~= 92 s, comfortably inside 120 — which is what four of
// the five sibling routes that set a duration use (feed/refresh is exactly
// this number).
export const maxDuration = 120;
const GROUNDED_CALL_TIMEOUT_MS = 45_000;
// RequestOptions.maxRetries counts RETRIES, not attempts: 1 means two attempts.
//
// Record beside this, because the next person to cap retries will reach for
// the constructor instead: `httpOptions.retryOptions.attempts` means DIFFERENT
// things on the two transports. `attempts: 1` — documented as "no retries" —
// gives 1 attempt on `models.generateContent` and 2 on `interactions.create`,
// because the next-gen client passes `attempts` straight into `maxRetries`.
// Nothing sets it today, and it must stay that way: `getGeminiClient()`
// memoises a module singleton and the next-gen transport is memoised on it, so
// a client-level setting would reach SEVEN other features. These options are
// per-call, and that is not an implementation detail.
const GROUNDED_CALL_MAX_RETRIES = 1;

// A well-formed Interaction that produced no text is a failure, never a
// `ready` row: AppViewDialog gates the digest page on `markdown` being truthy,
// so a `ready` row with empty markdown is a page the user can never open,
// behind a cell that still reads "not researched yet" — and it burned a
// grounded call.
const EMPTY_RESEARCH = "The model returned no research.";
const GENERIC_FAILURE = "Company research failed. Please try again.";

// listDigests' contract is "keyed by application_id" for the multi-row
// tracking-table case, but the safest read here does not lean on that shape
// — Object.values() walks either a keyed object or a plain array the same
// way, so this keeps working if the caller passes back either.
function findDigest(digests, applicationId) {
  return Object.values(digests || {}).find((d) => d && d.application_id === applicationId) || null;
}

// The stored outcome record, or null. `null` is not a fallback here — it is the
// only honest encoding of "this row was written before the citation pipeline
// existed", and telling that apart from "the pipeline ran and found nothing"
// is what the whole legacy render path is built on.
function storedOutcome(existing) {
  const outcome = existing?.citation_outcome;
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return null;
  return outcome;
}

// What `buildCitedDigest` needs to summarise ONE generation of history.
//
// `researchedAt` is read from the `researched_at` COLUMN, never from inside
// the jsonb: research recency has exactly one home, and the record's
// `previous` block is a historical snapshot sourced FROM that home rather than
// a second copy of it. A stale `researchedAt` key on a row written by an
// earlier draft is overwritten here rather than trusted.
function previousOutcomeOf(existing) {
  const outcome = storedOutcome(existing);
  if (!outcome) return null;
  return {
    ...outcome,
    researchedAt: typeof existing?.researched_at === "string" ? existing.researched_at : null,
  };
}

// Which sentence a failed run stores. Derived from the interaction OBJECT, not
// from sniffing the thrown message: `interactionOutputText` throws for two
// different reasons and only one of them is something to tell the user about.
// `Array.isArray(steps)` is the documented discriminator for "is this even an
// Interaction" — `output_text` is not, because the SDK omits that key entirely
// when the text is empty, so `undefined` cannot tell the two apart.
function failureMessage(err, interaction) {
  if (Array.isArray(interaction?.steps) && !interaction.output_text) return EMPTY_RESEARCH;
  return err?.message || GENERIC_FAILURE;
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

  // A FAILED CACHE READ IS NOT A CACHE MISS. `listDigests` returns
  // `{ digests: null, error }` on a transient PostgREST failure; reading only
  // `digests` made that indistinguishable from "this application has no
  // digest", and the consequence is a full billed grounded call — now up to
  // two HTTP attempts — on a row that already had a ready digest, on every
  // load until the read recovers.
  const { digests: existingDigests, error: listErr } = await listDigests(supabase, userId, [applicationId]);
  if (listErr) {
    return Response.json({ error: listErr }, { status: 500 });
  }
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

  // The extraction lives INSIDE this try on purpose. It walks five levels of
  // an optional response shape and `interactionOutputText` throws rather than
  // returning "" — so a vendor shape change must land on the failure path and
  // write a row, not escape as an unhandled 500 that writes nothing.
  let built;
  let interaction = null;
  try {
    interaction = await client.interactions.create(
      {
        model,
        // `input`, not `contents`. And `tools` is TOP-LEVEL.
        //
        // THIS IS THE OPPOSITE OF THE RULE GOVERNING THE OTHER SEVEN GROUNDED
        // CALL SITES, and both rules are live in this repo at the same time.
        // On `models.generateContent`, `GenerateContentParameters` has exactly
        // three properties — `model`, `contents`, `config` — `tools` belongs to
        // `GenerateContentConfig`, and the parameter transformer DISCARDS a
        // top-level `tools` with no warning: no search, no grounding metadata,
        // a claim-only digest, and a full grounded bill. That failure is what
        // route.wire.test.js was written to catch, and its negative control
        // still pins it for the surface that still has it.
        //
        // `interactions.create` is a DIFFERENT API, not a response variant:
        // different endpoint, different transport, `tools` at the top level as
        // `{ type: "google_search" }`, and no `config` object at all. Nesting
        // it here would be silently dropped exactly the same way.
        input: prompt,
        tools: [{ type: "google_search" }],
      },
      // PER-CALL, never on the client — see GROUNDED_CALL_MAX_RETRIES.
      { timeout: GROUNDED_CALL_TIMEOUT_MS, maxRetries: GROUNDED_CALL_MAX_RETRIES },
    );

    built = buildCitedDigest({
      text: interactionOutputText(interaction),
      sources: extractCitationSources(interaction),
      searched: interactionSearched(interaction),
      truncated: interactionTruncated(interaction),
      stageCounts: interactionStageCounts(interaction),
      previousOutcome: previousOutcomeOf(existing),
    });
  } catch (err) {
    // Persisted, not just returned: a failed attempt that vanished would leave
    // the cell looking like nobody had ever researched it, and
    // selectAutoDigestTargets relies on a stored `failed` row to NOT auto-retry
    // this application on every future page load.
    //
    // markdown, sources and citation_outcome are carried forward TOGETHER, as
    // one generation. They have to move together or the record's length+hash
    // stamp stops describing the markdown it is attached to, and every marker
    // then splices at an offset computed against a different document.
    //
    // `researched_at` is DELIBERATELY NOT PASSED. The upsert is column-wise, so
    // an omitted key keeps its stored value: the last SUCCESSFUL research time
    // survives a failed re-run untouched. `updated_at` is still stamped, and
    // keeps its honest meaning of "row last written" — which is exactly why it
    // must not be read as research recency, and why six-week-old prose used to
    // render as "Researched 2 minutes ago" over a failure that happened now.
    const { digest, error: saveErr } = await upsertDigest(supabase, userId, applicationId, {
      status: "failed",
      error: failureMessage(err, interaction),
      markdown: typeof existing?.markdown === "string" ? existing.markdown : "",
      sources: Array.isArray(existing?.sources) ? existing.sources : [],
      citation_outcome: storedOutcome(existing),
      engine: "gemini",
    });
    // Logged rather than swallowed: a failed failure-write leaves NO row, which
    // is the state that re-arms the billed stampede, and it used to leave no
    // trace of why either.
    if (saveErr) console.error("application-digest: could not record a failed digest", saveErr);
    // 200, not 5xx: the failure is the answer here, not a broken route —
    // the caller (the tracking table) needs a normal response it can render
    // as "Research failed - try again" rather than a fetch error.
    return Response.json({ digest });
  }

  const { markdown, sources, outcome } = built;

  // THE JOIN THAT DID NOT EXIST. "Grounding returned chunks and zero citations
  // survived" is the single number that would have made this feature's original
  // defect loud on day one; both halves were computed one line apart here and
  // joined nowhere, so every digest silently stored an empty source list for
  // the life of the feature. The durable half is `outcome.counts` +
  // `outcome.anomaly`, which go to the database below. This is the loud half,
  // and the digest was the only route under app/api/ with no console.warn at
  // all — including both sibling grounded routes.
  //
  // COUNTS ONLY. No url, no title, no company, no user id: this names employers
  // a user may be applying to while still employed.
  if (outcome.anomaly) {
    console.warn("application-digest: citation pipeline anomaly", {
      applicationId,
      stage: outcome.anomaly.stage,
      from: outcome.anomaly.from,
      to: outcome.anomaly.to,
      inputCount: outcome.anomaly.inputCount,
      outputCount: outcome.anomaly.outputCount,
      counts: outcome.counts,
    });
  }
  // A count that breaks the monotone chain is a wiring bug upstream. It is
  // recorded and reported, never clamped: a count silently repaired to satisfy
  // the invariant makes the arithmetic always look consistent, which is the
  // exact failure this record exists to make visible.
  if (outcome.countsViolation) {
    console.warn("application-digest: citation counts violate the monotone chain", {
      applicationId,
      violation: outcome.countsViolation,
      counts: outcome.counts,
    });
  }

  const { digest, error: saveErr } = await upsertDigest(supabase, userId, applicationId, {
    status: "ready",
    markdown,
    sources,
    error: null,
    engine: "gemini",
    // One identifier, spelled citation_outcome, in all three places: the field
    // here, the key on upsertDigest's row, and the column. There is no
    // camelCase variant anywhere in this feature — a key no column matches is
    // this repo's signature silent drop, and nothing at runtime catches it.
    citation_outcome: outcome,
    // Written ONLY here, on the success path. It is not `updated_at` and it is
    // not the pre-feature discriminator (`citation_outcome is null` is that).
    // The database never writes it: no default, no trigger.
    researched_at: new Date().toISOString(),
  });
  if (saveErr) return Response.json({ error: saveErr }, { status: 500 });

  return Response.json({ digest });
}
