// AC-V4.1/V4.2/V4.7. The SERVER-ONLY half of "verified company facts": runs
// the one Gemini search call, corroborates every claim it returns against
// the pages Google actually visited, and drops everything that fails. The
// pure prompt/parse/shape functions this calls into live in
// lib/copilot/companyFacts.js, which has no idea a network exists.
//
// THE PREMISE, restated because it is the reason this module exists at all
// and not just a convenience wrapper: language models invent plausible facts
// and plausible URLs. In the session the user recorded on 2026-08-25 the
// copilot told them to say "My research indicates a strong focus on
// continuous improvement" about a company it knew nothing about — asserting
// research that never happened, for the candidate to read aloud in front of
// an interviewer. A fabricated fact is WORSE than no fact, because the
// candidate stakes their own credibility on it. So the default here is
// REFUSAL, and a claim earns its way onto the screen only by pointing at a
// page Google actually visited — the exact stance
// lib/meeting/referenceContract.js already takes for spoken-aloud meeting
// references, and its header is the reasoning this module borrows rather
// than re-derives.
//
// REUSE, NOT REIMPLEMENTATION (the corroboration order is not negotiable —
// see resolveGroundedSources below):
//   lib/llm/grounding.js            extractGroundingSources, isGroundedUrl
//   lib/meeting/referenceContract.js  resolveGroundedSources
//   lib/scrape/fetchUrlContent.js   the real page fetch, injected through
//                                    resolveGroundedSources' own fetchImpl
//
// Every dependency is INJECTED (defaulted to the real implementation), which
// is what lets this whole pipeline run under this repo's `environment:
// "node"` vitest config with no network and no Gemini key — the identical
// shape resolveGroundedSources itself already uses for ITS OWN `fetchImpl`.
import { extractGroundingSources, isGroundedUrl } from "@/lib/llm/grounding";
import { resolveGroundedSources } from "@/lib/meeting/referenceContract";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import {
  MAX_COMPANY_FACTS,
  COMPANY_FACTS_SYSTEM,
  buildCompanyFactsPrompt,
  parseFactsResponse,
  normalizeCompanyFacts,
} from "./companyFacts.js";

// Grounding metadata is a short list (a handful of search results for one
// query), so this exists only to stop one slow publisher from serializing
// the batch behind it — the same reasoning
// lib/meeting/referenceContract.js's own RESOLVE_CONCURRENCY gives.
const DEFAULT_CONCURRENCY = 3;

// AC-V4.1/V4.2/V4.7. `company` is `{ company, jobTitle }` (the shape
// lib/copilot/applicationDocs.js's fetchPostingEmployer returns, minus its
// own field renaming); `deps` carries the Gemini client/model plus every
// injectable step of the corroboration pipeline, ALL defaulted to the real
// implementation so production call sites only ever need to pass
// `{ client, model }`.
//
// NEVER REJECTS. Every failure mode — no company at all, no Gemini client
// configured, a network error, unparseable model output, zero grounding
// metadata, a grounding-resolution failure, or every candidate claim failing
// corroboration — resolves to `[]`, exactly the contract
// lib/copilot/answerAids.js's generateIdealProjectExample already keeps for
// the identical reason: this rides ALONGSIDE an answer the candidate is
// waiting on mid-question, and it must never be able to fail the request it
// rides beside.
export async function buildCompanyFacts(company, deps) {
  const {
    client,
    model,
    extractGrounded = extractGroundingSources,
    resolveGrounded = resolveGroundedSources,
    isGrounded = isGroundedUrl,
    fetchImpl = fetchUrlContent,
    concurrency = DEFAULT_CONCURRENCY,
  } = deps || {};

  const prompt = buildCompanyFactsPrompt(company);
  // No company (or no company at all) — nothing to research, and no reason
  // to spend a model call finding that out. Checked BEFORE touching `client`
  // at all, so a caller with no Gemini configured and no company selected
  // never even notices the client is missing.
  if (!prompt) return [];
  if (!client?.models?.generateContent) return [];

  try {
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: COMPANY_FACTS_SYSTEM,
        // AC-V4.2/AC-V4.8: the search tool is what makes every claim
        // checkable at all — without it there is no grounding metadata to
        // corroborate against, and this function would have nothing to do
        // but trust the model. Incompatible with a JSON response mime type
        // (the same constraint app/api/company-research/route.js documents
        // for its own googleSearch call), which is exactly why
        // parseFactsResponse, not parseModelJson, is what reads the
        // response below.
        //
        // *** `tools` LIVES INSIDE `config`. DO NOT FLATTEN IT BACK OUT. ***
        // `GenerateContentParameters` — the argument type of
        // `models.generateContent` — has exactly THREE properties: `model`,
        // `contents`, `config`. `tools` belongs to `GenerateContentConfig`.
        // The SDK's parameter transformer reads only those three keys and
        // DISCARDS everything else before building the request body, with no
        // warning and no error, so a top-level `tools` never reaches the
        // wire. Verified by stubbing `fetch` around the real @google/genai
        // and reading the bytes — see lib/copilot/companyFactsSource.wire.
        // test.js, which asserts both halves (top-level dropped, config-level
        // transmitted) precisely so this cannot silently regress.
        //
        // The consequence of getting it wrong is total and invisible: no
        // tools on the wire -> no search -> no groundingMetadata ->
        // extractGrounded returns [] -> this function short-circuits to []
        // on every call forever, while still paying for a full Gemini call.
        // Every unit test stays green, because a test using an INJECTED FAKE
        // client sees whatever object the caller hands it and can never
        // observe the layer that drops the key.
        //
        // This module was the FIRST site fixed. The other eleven in this
        // repo — including app/api/company-research/route.js, the
        // grounded-search precedent this module was told to mirror — carried
        // the identical defect and were corrected afterwards under R-267, so
        // every grounded feature here spent a long time searching nothing.
        // The lesson is worth more than the fix: "the codebase already does
        // it this way" was evidence about consistency and nothing whatever
        // about correctness.
        tools: [{ googleSearch: {} }],
      },
    });

    // AC-V4.2, THE STEP THAT IS NOT OPTIONAL: resolve every grounded URI to
    // its real destination BEFORE anything is compared against it.
    // lib/meeting/referenceContract.js's own header documents exactly why —
    // `groundingMetadata.groundingChunks[].web.uri` is sometimes a publisher
    // URL and sometimes a `vertexaisearch.cloud.google.com/grounding-api-
    // redirect/…` link, and comparing a model's
    // `https://www.purplewave.com/about` against a raw redirect is false for
    // EVERY link forever: the feature would return zero facts, forever, and
    // look indistinguishable from a model that searched nothing at all.
    // Order here is: extractGrounded -> resolveGrounded -> isGrounded, and
    // that order is load-bearing, not incidental.
    const rawGrounded = extractGrounded(response);
    if (!Array.isArray(rawGrounded) || rawGrounded.length === 0) {
      // No grounding metadata means nothing to corroborate against, which
      // means every claim in the response is unverifiable — not that every
      // claim should be trusted by default.
      return [];
    }

    const resolved = await resolveGrounded(rawGrounded, { fetchImpl, concurrency });
    if (!Array.isArray(resolved) || resolved.length === 0) return [];

    const rawFacts = parseFactsResponse(response?.text);
    const facts = normalizeCompanyFacts(rawFacts, { cap: MAX_COMPANY_FACTS });

    // AC-V4.2: keep a fact iff its URL resolves to a page Google actually
    // visited. Everything else is DROPPED — not softened, not shown with a
    // caveat. There is no milder version of a claim the candidate cannot
    // stand behind in an interview; a dropped claim is nothing, which is the
    // honest thing to show in its place.
    //
    // A KNOWN, ACCEPTED RESIDUAL of "or whose page cannot be read" (V4.2's
    // own wording): resolveGroundedSources deliberately falls back to the
    // UNRESOLVED uri when its own fetch fails ("losing it would discard
    // evidence the model really did search that page" — its own header) and
    // reports no readability flag at all, so this function cannot ask "was
    // this page actually readable" as a separate question from "did Google
    // visit it". That gap is closed for free whenever the grounding uri is a
    // vertexaisearch redirect (an unreadable redirect will not
    // pageIdentityKey-match any model url, so the fact is dropped anyway by
    // the ordinary corroboration check) — the residual is narrowly the case
    // where the grounding uri IS ALREADY the publisher url and that page
    // happens to be unreadable. In that one case, a fact is kept on the
    // strength of "Google grounded on this exact URL", not on confirmation
    // that the page's content actually supports the claim. Closing it fully
    // would mean a second round of fetchUrlContent calls over the surviving
    // facts, at double the network cost, for a marginal gain — not done
    // here (ARCH §4, contradiction C6, lays out the same trade-off for the
    // sibling meeting-references feature and reaches the same conclusion).
    return facts.filter((fact) => isGrounded(fact.url, resolved));
  } catch {
    // A network error, a malformed response, or a throwing dependency all
    // degrade the same way: no facts, never a rejected promise.
    return [];
  }
}
