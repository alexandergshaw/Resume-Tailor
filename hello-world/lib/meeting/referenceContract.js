// Reference links for a meeting discussion point — the rules that decide
// which of a model's suggested links a user is allowed to see.
//
// THE PREMISE: language models invent plausible URLs. A fabricated link read
// aloud in a real meeting ("the docs say X — here's the page") is far worse
// than no link at all, because the user stakes their credibility on it in
// front of colleagues. So the default here is REFUSAL, and a link earns its
// way onto the screen only by being corroborated against the pages Google
// actually visited (see isGroundedUrl in lib/llm/grounding.js).
//
// This is deliberately NOT lib/experience/researchReport.js's
// reconcileCitations, even though the shape of the problem is identical.
// That module DEMOTES an uncorroborated citation to plain text — the claim
// around it may still be worth reading. There is no equivalent "plain text"
// value here: a reference the user cannot open and cite out loud is not a
// milder version of a good reference, it is nothing, so it is DROPPED.

// SERVER-ONLY module: it reaches the network (see resolveGroundedSources).
// The browser half of this feature is lib/meeting/referenceClient.js, which
// deliberately does not import this file.
import { isGroundedUrl, pageIdentityKey } from "../llm/grounding.js";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { runWithConcurrency } from "@/lib/tailor/runWithConcurrency";

// A user glancing at this mid-sentence, mid-meeting can act on two or three
// links, not ten. The cap is about what is usable in the moment the insight
// appears on screen, not about API or rendering cost.
export const MAX_REFERENCES_PER_INSIGHT = 3;

// How many grounded URIs resolve concurrently. Grounding metadata is a short
// list, so this exists only to stop one slow publisher from serializing the
// batch behind it.
const RESOLVE_CONCURRENCY = 3;

// Mirrors the safeUrl half of lib/llm/grounding.js's isGroundedUrl (and
// lib/experience/researchReport.js's private copy of the same idea): http(s)
// only, so a dangerous scheme can never end up carried as a "verified" host
// below even if it somehow appears in grounding metadata.
function safeUrl(raw) {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Resolve each grounded URI to the page it ACTUALLY points at.
 *
 * This has to happen before anything is corroborated, and it is the whole
 * reason this function exists. What `groundingMetadata.groundingChunks[].web
 * .uri` holds is not consistent: parts of this repo (lib/techwatch/
 * lifecycleSearch.js, lib/feed/llmSearch.js) match against it as though it
 * were a PUBLISHER url, while others (lib/scrape/fetchUrlContent.js's
 * finalUrl, app/api/company-research/route.js's enrichArticles) treat it as a
 * vertexaisearch.cloud.google.com/grounding-api-redirect/... link — and
 * enrichArticles matches by title tokens precisely BECAUSE the urls were not
 * comparable. Comparing a model's `https://react.dev/learn/state` against a
 * raw redirect uri is false for every link forever: the feature returns zero
 * references and every card reads "N suggestions could not be verified",
 * which is indistinguishable from the model behaving badly.
 *
 * Resolving first is correct under BOTH readings: a publisher uri resolves to
 * itself, a redirect resolves to the publisher page, and either way what goes
 * into the corroboration set is a real destination.
 *
 * A uri that cannot be resolved falls back to ITSELF rather than being
 * dropped: losing it would discard evidence the model really did search that
 * page, and the unresolved uri is still a page Google actually visited.
 *
 * `fetchImpl` is injected (defaulting to the real fetcher) so tests drive
 * this with no network.
 */
export async function resolveGroundedSources(grounded, options) {
  const { fetchImpl = fetchUrlContent, concurrency = RESOLVE_CONCURRENCY } = options || {};
  const list = Array.isArray(grounded) ? grounded : [];
  const resolved = new Array(list.length);

  await runWithConcurrency(
    list.map((entry, index) => ({ entry, index })),
    concurrency,
    async ({ entry, index }) => {
      const uri = String((typeof entry === "string" ? entry : entry?.uri) ?? "").trim();
      const title = String((typeof entry === "string" ? "" : entry?.title) || "");
      // Seed the fallback BEFORE awaiting: runWithConcurrency swallows a
      // worker's throw, so a slot assigned only on success would be left
      // undefined and the evidence lost silently.
      resolved[index] = { uri, title };
      if (!uri) return;

      let scraped = null;
      try {
        scraped = await fetchImpl(uri);
      } catch {
        scraped = null;
      }
      if (scraped && !scraped.error && typeof scraped.finalUrl === "string" && scraped.finalUrl) {
        resolved[index] = { uri: scraped.finalUrl, title };
      }
    },
  );

  return resolved.filter((entry) => entry && entry.uri);
}

// normalizeReferences(raw, { grounded, cap, fetchImpl }) -> Promise<{ references, dropped, grounded }>
//
// - references: deduplicated, corroborated, capped, ready to render. Each
//   entry has { title, url, host }; title falls back to host when the model
//   gave none, because an empty link label renders as an unreadable target
//   and is unusable by a screen reader.
// - dropped: how many *distinct* candidate links were refused for being
//   unverifiable (no usable URL, or not corroborated by `grounded`). This
//   does NOT count entries trimmed off by `cap`, and does NOT count repeat
//   citations of a page already seen — kept OR refused. `dropped` drives an
//   honest "N suggestions could not be verified" message, and folding either
//   of those in would make that message a lie (a link is not "unverifiable"
//   for being the 4th good one, and ONE bad url cited three times is one
//   suggestion that could not be verified, not three).
// - grounded: whether the model searched at all (a non-empty `grounded`
//   list), independent of whether anything in THIS insight survived. The UI
//   says something different for "the search found nothing citable here"
//   than for "no search happened at all", and only this flag can tell them
//   apart once `references` is empty either way.
//
// Never throws: this runs mid-meeting against whatever the model returned,
// including outright garbage.
//
// ORDER MATTERS, and the order is: resolve -> dedupe -> corroborate -> cap.
// Resolution is done HERE rather than by the caller so the two halves cannot
// drift apart: the url a link is corroborated against is the url that ships,
// and nothing downstream is allowed to rewrite a survivor's `url` afterwards.
// An earlier version resolved AFTER corroboration and overwrote the verified
// url with wherever the fetch landed — a publisher 301 to a marketing page,
// a rebrand, or an open redirect on a grounded host all became links the user
// read aloud believing they had been checked.
export async function normalizeReferences(raw, options) {
  const {
    grounded,
    cap = MAX_REFERENCES_PER_INSIGHT,
    fetchImpl,
    concurrency,
  } = options || {};
  const list = Array.isArray(raw) ? raw : [];
  // "Did the model search at all" is a property of the RAW metadata, not of
  // how much of it we managed to resolve.
  const wasGrounded = Array.isArray(grounded) && grounded.length > 0;

  // Resolution costs one HTTP round trip per grounded uri, so it is skipped
  // when the model suggested nothing to corroborate in the first place.
  const resolvedGrounded =
    list.length > 0 ? await resolveGroundedSources(grounded, { fetchImpl, concurrency }) : [];

  const seen = new Set();
  const kept = [];
  let dropped = 0;

  for (const item of list) {
    const url = item?.url;
    // The SAME fold used for corroboration (pageIdentityKey), so two
    // spellings of one page can never be judged differently from each other.
    const key = pageIdentityKey(url);
    // A link with no usable url has no page identity, but three of them are
    // still one refusal each only if they are genuinely different strings —
    // fall back to the raw text so `""` and `null` collapse together.
    const dedupeKey = key || `raw:${String(url ?? "").trim().toLowerCase()}`;

    // Dedupe BEFORE classifying. `dropped` is documented as counting
    // DISTINCT refused links and drives an honest "N suggestions could not
    // be verified" sentence; counting first meant one fabricated url cited
    // three times (trailing slash, www., ?utm=) reported dropped: 3, which
    // makes the one sentence in this feature whose job is honesty a lie.
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (!key || !isGroundedUrl(url, resolvedGrounded)) {
      dropped += 1;
      continue;
    }

    const u = safeUrl(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const title = String(item?.title || "").trim() || host;
    kept.push({ title, url: String(url).trim(), host });
  }

  return { references: kept.slice(0, cap), dropped, grounded: wasGrounded };
}
