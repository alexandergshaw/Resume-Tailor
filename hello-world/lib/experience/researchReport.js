// Pure logic for the "how could current technology improve this project"
// research report (chunk 9). No I/O here on purpose — everything that talks
// to Supabase or Gemini lives in app/api/experience/research/route.js, which
// imports these two functions and nothing else from this file.
//
// reconcileCitations is the honesty-critical half. app/api/company-research/
// route.js already learned this lesson the expensive way, in its own words:
// model-supplied links 404 and model-supplied dates are invented. So a
// citation the model wrote into its markdown only survives if the search
// tool's OWN grounding metadata (the URLs it actually visited) corroborates
// it — anything else is demoted from a link to plain text, never silently
// kept and never silently dropped along with the sentence it was attached
// to. See lib/experience/researchReport.test.js for the full behavioral
// contract this file exists to satisfy.
//
// WHAT A SURVIVING CITATION IS CALLED IS A SEPARATE DECISION, AND IT IS NOT
// MADE HERE. lib/tracking/citationLabel.js owns it, for every surface in this
// repo: a title that names a host is not a name, and the only domain that may
// appear as a citation's label is the one `citationHost` derives from that
// citation's OWN href. This file used to answer the question itself, in one
// expression — `- [${g.title || g.uri}](${g.uri})` — and answered it wrongly
// twice over. Gemini's legacy grounding metadata returns `web.uri` as a
// `vertexaisearch.cloud.google.com` REDIRECT proxy and `web.title` as the
// PUBLISHER'S BARE DOMAIN, so pairing them verbatim wrote a Sources line
// reading "reuters.com" whose href reaches a Google API redirect — a claim
// about who published this research that the link does not support, stored
// permanently in experience_pages.body and catchable only by hovering. And its
// final fallback stored the raw URL as a source's NAME, which a URL is not.
//
// That was the same defect commit 7075a12 fixed in lib/tracking/, and this was
// its other half: the module the defect was first named against, left standing
// because it lives outside that directory. There is now ONE rule, imported by
// both, rather than a tracking rule and an experience rule that drift.
//
// The href is untouched on every path below. What changed is what is SAID
// about a citation, never where the link goes — refusing the citation outright
// would discard a source the search really visited.

import { citationLabel, citationTitle } from "../tracking/citationLabel.js";
import { nonPublisherHosts } from "../tracking/citationHref.js";

const LINK_RE = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;

// The copy THIS surface shows for a citation that may not be named. It belongs
// here rather than in citationLabel.js, which returns `kind: "unnamed"` with an
// empty string precisely so each surface can spell the state in its own words.
// The wording matches DigestPanel's, because a reader who meets both should not
// have to learn two names for the same fact.
const UNNAMED_SOURCE = "Source (unnamed)";

// THE ONE THING THIS SURFACE NEEDS THAT THE DIGEST PANEL DOES NOT, and it is an
// encoding step for the medium rather than a second opinion about names.
//
// The panel puts a label into a React text node, where a "]" is a character.
// This module puts it into MARKDOWN, and lib/experience/markdown.js's link
// branch takes the FIRST "]" after "[" with no escape handling — a backslash
// does not help, because `indexOf("]")` finds the escaped one just the same.
// So a "]" inside a label closes our anchor early and the remainder of the
// label can open somebody else's: a vendor title of
// `Analysis ](https://evil.example/x) and more` renders as a live link to
// evil.example sitting in the user's stored report. Brackets are removed AFTER
// the rule has decided the label, so this can only ever narrow what is shown.
//
// An IPv6 host arrives from `citationHost` bracketed ("[2001:db8::1]") and
// loses its brackets here. That is a cosmetic loss on a string still derived
// from the citation's own href, and the alternative is a broken link.
function markdownSafeLabel(text) {
  return text.replace(/[[\]]/g, "").trim();
}

/**
 * The one name a citation in this report may be given.
 *
 * The DECISION is `citationLabel`'s, imported whole: the entry's own admissible
 * title, else the host derived from its OWN href and not suppressed as a
 * non-publisher, else nothing. Nothing here re-decides it, and there is
 * deliberately no title-versus-host comparison to get wrong — a title naming
 * the citation's own host is redundant with that host, so a match and a
 * mismatch have the same correct outcome.
 *
 * Two adjustments, both applied AFTER the rule, neither a relaxation:
 *   - an admitted title is used UNCAPPED. `citationLabel`'s 80-character cut is
 *     for a label a screen reader speaks; this string is STORED markdown that
 *     the reader sees in full, and citationLabel.js says as much itself.
 *   - brackets are stripped — see `markdownSafeLabel`. A label left empty by
 *     either step falls to the unnamed copy rather than to an empty anchor.
 *
 * @param {{url: unknown, title: unknown}} record
 * @param {Set<string>} hiddenHosts
 * @returns {string}
 */
function sourceLabel(record, hiddenHosts) {
  const { text, kind } = citationLabel(record, hiddenHosts);
  const label = markdownSafeLabel(kind === "title" ? citationTitle(record.title) : text);
  return label === "" ? UNNAMED_SOURCE : label;
}

// http(s) only. A dangerous scheme (javascript:, data:, …) must never reach
// the rendered report even if it somehow arrived via groundingMetadata —
// this check runs on BOTH the model's own citations and the grounded
// sources used to corroborate them, so it is never the weaker of the two
// lines of defense the report's own markdown renderer also provides.
function safeUrl(raw) {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

// host + path, "www." and case folded out of the host, a trailing slash
// folded out of the path, query string and fragment ignored entirely.
// Grounding metadata routinely wraps a citation in tracking parameters or a
// redirect, and folding those away is what lets a real citation survive
// comparison instead of being dropped for looking "different" from the
// model's own copy of the same URL. A bare host match is deliberately NOT
// enough — see the reconcileCitations test for the host-only false positive
// this would otherwise let through.
function normalizeKey(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}`.toLowerCase();
}

// The prompt sent to Gemini with the googleSearch grounding tool. Built from
// only what the user actually wrote (title, body, breadcrumb, child page
// titles, attachment names + notes) — never attachment bytes, since this is
// a text research task and shipping e.g. video bytes into a search-grounded
// prompt would be pure cost for no signal (the model cannot search on file
// contents anyway).
//
// Asks explicitly for engineering guidance — what the user chose over
// resume/interview phrasing — because a report that drifts toward "how to
// talk about this project" is silently the OTHER feature this app already
// has, not a worse version of this one.
export function buildResearchPrompt({ page, breadcrumb = [], childTitles = [], attachments = [] } = {}) {
  const title = String(page?.title || "").trim() || "Untitled project";
  const body = String(page?.body || "").trim();
  const crumbLine = (Array.isArray(breadcrumb) ? breadcrumb : []).filter(Boolean).join(" / ");
  const children = (Array.isArray(childTitles) ? childTitles : []).filter(Boolean);
  const atts = (Array.isArray(attachments) ? attachments : [])
    .map((a) => ({ name: String(a?.name || "").trim(), notes: String(a?.notes || "").trim() }))
    .filter((a) => a.name || a.notes);

  const lines = [
    "You are a senior engineer researching how CURRENT technology could improve a real, already-in-progress project. Use Google Search so your suggestions reflect what genuinely exists and is current today, not stale training knowledge.",
    "This report is for the person who will DO the engineering work. Write concrete, actionable guidance, not a pitch or a summary for someone else.",
    "",
    `Project: ${title}`,
  ];
  if (crumbLine) lines.push(`Where this sits in the user's work: ${crumbLine}`);
  lines.push("", "Project notes:", body || "(no notes recorded)");

  if (children.length > 0) {
    lines.push("", "Sub-pages already under this project:");
    for (const c of children) lines.push(`- ${c}`);
  }

  if (atts.length > 0) {
    lines.push("", "Attachments on this project (name and any notes only — the files themselves are not included):");
    for (const a of atts) lines.push(`- ${a.name || "(untitled attachment)"}${a.notes ? `: ${a.notes}` : ""}`);
  }

  lines.push(
    "",
    "Using Google Search, research specific current technologies — tools, libraries, platforms, or architectural patterns — that could genuinely improve THIS project. Write a markdown report with exactly this shape:",
    "",
    "1. One paragraph describing what this project appears to be, so the reader can immediately tell whether you understood it.",
    "2. Specific current technologies that apply. For EACH one: what it would replace or add, why it fits THIS project specifically rather than being generically fashionable, and the honest trade-off or cost of adopting it.",
    "3. A concrete first step that could be taken this month.",
    "4. A Sources section citing, as markdown links, the pages you actually found via search.",
    "",
    "Be concrete and specific to this project. Do not pad with generic advice that would apply to any project.",
  );

  return lines.join("\n");
}

// Checks the model's own markdown citations against `groundedSources` — the
// URLs Gemini's googleSearch tool actually visited (see
// app/api/company-research/route.js's extractGroundingSources, which reads
// this from response.candidates[0].groundingMetadata.groundingChunks). A
// citation whose URL corroborates against that list is kept as a working
// link; anything else is demoted to plain text — its claim may still be
// worth reading, but the link must not look verified when it isn't.
//
// The Sources section is built entirely from `groundedSources`, not from
// whatever the model happened to cite in the body — every grounded source is
// a real search result regardless of whether the model referenced it inline.
//
// When grounding returned nothing at all, every citation is demoted (there
// is nothing to corroborate against) and the report is marked `grounded:
// false` with a plain-language notice appended, rather than being presented
// as researched.
export function reconcileCitations({ markdown, groundedSources } = {}) {
  const src = typeof markdown === "string" ? markdown : "";
  const groundedList = Array.isArray(groundedSources) ? groundedSources : [];

  const safeGrounded = groundedList
    .map((g) => ({ uri: String(g?.uri || "").trim(), title: String(g?.title || "").trim() }))
    .filter((g) => g.uri && safeUrl(g.uri));

  const groundedKeys = new Set(safeGrounded.map((g) => normalizeKey(g.uri)).filter(Boolean));
  const isGrounded = safeGrounded.length > 0;

  // Computed ONCE over every source this report can name, because
  // nonPublisherHosts' clause (b) — a host byte-identical across every entry of
  // a multi-entry set is a redirector by construction — needs the whole set to
  // decide. The titles handed to it are the ADMITTED ones, exactly as
  // DigestPanel hands it `entry.title`, so the two surfaces suppress the same
  // hosts for the same data. Clause (a) is what fires on the legacy grounding
  // surface, where every uri is a vertexaisearch redirect: naming Google as the
  // publisher of a candidate's research is the harm that rule exists to stop.
  const hiddenHosts = nonPublisherHosts(
    safeGrounded.map((g) => ({ href: g.uri, title: citationTitle(g.title) }))
  );

  const dropped = [];
  const body = src.replace(LINK_RE, (whole, text, url) => {
    const key = isGrounded ? normalizeKey(url) : null;
    if (key && groundedKeys.has(key)) {
      // THE SECOND PLACE A LABEL MEETS A URL, and it is not a lesser one. A
      // citation only survives here if its url matched a grounded key, and on
      // the legacy grounding surface every grounded key IS a vertexaisearch
      // redirect — so a surviving inline link's href is a redirect while its
      // label is model prose free to name any publisher it likes. Same anchor,
      // same false claim as a Sources line, so the same one rule decides it.
      //
      // `whole` is no longer returned, but the url is re-emitted from its own
      // capture byte-for-byte, and a label the rule admits comes back
      // unchanged — which is why the honest case is byte-identical output and
      // only the mismatched one changes.
      return `[${sourceLabel({ url, title: text }, hiddenHosts)}](${url})`;
    }
    dropped.push(String(url).trim());
    return text;
  });

  let out;
  if (!isGrounded) {
    const notice =
      "**Not grounded** — live search returned no verifiable sources for this report, so none of its claims are confirmed. Treat it as a starting point only, and verify anything you plan to act on.";
    out = body.trim() ? `${body.trim()}\n\n${notice}` : notice;
  } else {
    // The first place a label meets a URL. The old chain ended at `|| g.uri`,
    // so an untitled source was written into the report under its own URL as
    // its NAME — the clearest single symptom of this module having had a rule
    // of its own. There is no fourth fallback now: title, else own host, else
    // the unnamed copy.
    const sourceLines = safeGrounded.map(
      (g) => `- [${sourceLabel({ url: g.uri, title: g.title }, hiddenHosts)}](${g.uri})`
    );
    out = `${body.trimEnd()}\n\n## Sources\n${sourceLines.join("\n")}`;
  }

  return { markdown: out, dropped, grounded: isGrounded };
}
