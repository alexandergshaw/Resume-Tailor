// The researched "what the posting does not tell you" digest for a tracked
// application (see app/api/application-digest/route.js for the grounded
// call this feeds, and lib/supabase/applicationDigests.js for storage).
// Everything in this file is pure — no network, no Supabase — so the two
// decisions that actually matter are unit-testable without mocking either.
//
//   * selectAutoDigestTargets is the COST gate. Each digest is one grounded
//     model call. A user opening the tracking table with sixty untouched
//     rows must not fire sixty calls, so this decides what auto-populates
//     (a row this new, with no digest at all) and what waits for the
//     Research button (everything else, including a row whose last attempt
//     failed — see that function's own comment for why a failure is not
//     auto-retried).
//   * parseDigestAnswer decides which of the model's links survive. The
//     digest is prose a user will act on, so an unsourced claim is worse
//     than a missing section. It follows the same rule as
//     lib/experience/researchReport.js's reconcileCitations — a citation
//     only survives if the search tool's own grounding metadata
//     corroborates it — but checks by host via lib/llm/grounding.js's
//     isGroundedHost rather than keeping a second host+path matcher.

import { isGroundedHost } from "@/lib/llm/grounding";

// The digest's fixed section order — fixed so two rows are comparable at a
// glance, and so buildDigestPrompt/parseDigestAnswer/the modal all agree on
// what a "complete" digest contains. Each is rendered as a markdown `##`
// heading.
export const DIGEST_SECTIONS = [
  "What the company does",
  "Size and stage",
  "How this role fits",
  "Recent signals",
  "Culture and working pattern",
  "Interview process",
  "Watch-outs",
];

// A row auto-populates only if it was tracked within this many hours of the
// page load that noticed it has no digest yet. Chosen to cover "just
// tracked this", not to backfill a long-standing table — see
// selectAutoDigestTargets.
export const AUTO_DIGEST_MAX_AGE_HOURS = 24;

// How many auto digests run at once (through lib/tailor/runWithConcurrency).
// Small on purpose: this is a background fan-out the user did not ask for
// directly, so it should never be the thing saturating the model API.
export const AUTO_DIGEST_CONCURRENCY = 2;

// Markdown link syntax: [text](url). Mirrors the regex in
// lib/experience/researchReport.js — kept as a local copy rather than an
// import because that file exports neither the regex nor a citation-safe
// URL check, and this file's grounding rule (host-only, via isGroundedHost)
// is deliberately simpler than that file's host+path rule.
const LINK_RE = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;

// The prompt sent to the model with the search-grounding tool. Shows the
// posting's own description back to the model specifically so the model can
// avoid restating it — the whole point of this feature is what the posting
// does NOT say, and a prompt that omitted the description would have no way
// to tell "new information" from "the job ad's own words, paraphrased."
export function buildDigestPrompt(posting) {
  const p = posting && typeof posting === "object" ? posting : {};
  const company = String(p.company || "").trim() || "this company";
  const title = String(p.title || "").trim() || "this role";
  const location = String(p.location || "").trim();
  const description = String(p.description || "").trim();

  const lines = [
    `You are researching ${company} and the "${title}" role${location ? ` (${location})` : ""} for a candidate who has already read the job posting below and wants to know what it leaves out.`,
    "",
    "The posting, for reference only — do not restate or summarize it, the candidate has already read every word:",
    description || "(no description was provided)",
    "",
    "Using Google Search, research the company and this role, then write a markdown report with EXACTLY these sections, each as its own `##` heading, in this order:",
  ];
  for (const section of DIGEST_SECTIONS) lines.push(`## ${section}`);
  lines.push(
    "",
    "Every section must cover only information that is not stated in the posting above — facts, context and signals that go beyond the posting, never a paraphrase of it.",
    'If you cannot find grounded, sourced information for a section, write "Not found" under that heading rather than guessing or inferring an answer.',
    "Write in plain prose with no citations of your own: no markdown links, no bracketed markers like [1], no reference-style link definitions, no raw URLs typed into the text, and no source list or bibliography at the end. The citation links shown to the reader are generated separately from Google Search's own results, not from anything you write here.",
  );
  return lines.join("\n");
}

// True only for a link whose host the search tool actually grounded on
// (isGroundedHost already treats "grounded on nothing" as false, never
// true). Kept as its own predicate so parseDigestAnswer's replace callback
// reads as "kept vs demoted" rather than a raw isGroundedHost call.
function linkIsGrounded(url, grounded) {
  return isGroundedHost(url, grounded);
}

// The grounded entry (if any) whose host matches `url` — used only to pick a
// nicer source title than the model's own link text, which the model can
// phrase however it likes. Falls back to no title; the caller then falls
// back further to the link's own text.
function groundedTitleForHost(url, grounded) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    for (const g of Array.isArray(grounded) ? grounded : []) {
      try {
        const gHost = new URL(g?.uri).hostname.toLowerCase().replace(/^www\./, "");
        if (gHost === host) return String(g?.title || "").trim();
      } catch {
        // g.uri wasn't a parseable URL — not a match, keep looking
      }
    }
  } catch {
    // url wasn't parseable — no title to offer
  }
  return "";
}

// Keeps a markdown link only if the model actually grounded on its host,
// demoting every other link to plain text — never dropping the sentence it
// was attached to, since the claim may still be worth reading even
// unsourced. `grounded` empty means every link is demoted: no grounding is
// no evidence the model searched at all (see isGroundedHost's own comment).
export function parseDigestAnswer(rawText, { grounded } = {}) {
  const src = typeof rawText === "string" ? rawText : "";
  if (!src.trim()) return { markdown: "", sources: [], dropped: [] };

  const groundedList = Array.isArray(grounded) ? grounded : [];
  const dropped = [];
  const sourcesByUrl = new Map();

  const markdown = src.replace(LINK_RE, (whole, text, url) => {
    const trimmedUrl = String(url || "").trim();
    if (trimmedUrl && linkIsGrounded(trimmedUrl, groundedList)) {
      if (!sourcesByUrl.has(trimmedUrl)) {
        const title = groundedTitleForHost(trimmedUrl, groundedList) || String(text || "").trim() || trimmedUrl;
        sourcesByUrl.set(trimmedUrl, { url: trimmedUrl, title });
      }
      return whole;
    }
    dropped.push(trimmedUrl);
    return text;
  });

  return { markdown, sources: Array.from(sourcesByUrl.values()), dropped };
}

// The tracking table cell's one-line preview: the first non-heading
// sentence, with any markdown link syntax reduced to its plain text so the
// cell never shows a raw URL. Empty input yields an empty line rather than
// throwing or showing a placeholder — the cell handles that itself (an
// empty digest means "not researched yet", the Research button's job).
export function digestSummaryLine(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  if (!text.trim()) return "";

  const lines = text.split("\n");
  const paragraph = [];
  let started = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (started) break; // blank line ends the first paragraph
      continue; // skip leading blank lines
    }
    if (/^#{1,6}\s/.test(line)) {
      if (started) break; // a heading ends the first paragraph too
      continue; // skip the heading itself, keep looking for prose
    }
    paragraph.push(line);
    started = true;
  }

  let joined = paragraph.join(" ").replace(LINK_RE, "$1");
  joined = joined.replace(/\s+/g, " ").trim();
  if (!joined) return "";

  const sentence = joined.match(/^(.*?[.!?])(?:\s|$)/);
  return sentence ? sentence[1] : joined;
}

// The cost gate: which application ids get a digest fired off automatically
// on page load, newest-tracked first. Pure and synchronous so this decision
// is unit-testable without a network or a clock mock beyond passing `now`.
//
// Deliberately narrow — auto-population is a SPEND control, not a
// completeness filter. It returns only rows with NO digest row at all
// (an existing 'ready' OR 'failed' row is excluded either way) that were
// tracked within AUTO_DIGEST_MAX_AGE_HOURS of `now`. A 'failed' row is not
// retried here on purpose: every page load would otherwise burn another
// grounded model call on the same stuck row forever, with nothing changing
// on screen — retrying a failure is what the manual Research button is for.
// An older untouched row is left for that same button rather than firing
// automatically, so a first load on a long-standing table with a backlog of
// rows can never turn into a stampede of model calls.
export function selectAutoDigestTargets(rows, digestsById, { now } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const digests = digestsById && typeof digestsById === "object" ? digestsById : {};
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const candidates = [];
  for (const row of list) {
    if (!row || row.id === undefined || row.id === null) continue;
    if (digests[row.id]) continue; // any existing digest — ready or failed — is not an auto target

    const trackedMs = Date.parse(row.tracked_at);
    if (Number.isNaN(trackedMs)) continue;

    const ageHours = (nowMs - trackedMs) / 3600000;
    if (ageHours < 0 || ageHours > AUTO_DIGEST_MAX_AGE_HOURS) continue;

    candidates.push({ id: row.id, trackedMs });
  }

  candidates.sort((a, b) => b.trackedMs - a.trackedMs);
  return candidates.map((c) => c.id);
}
