// Vulnerabilities - and workarounds - from OSV.dev.
//
// OSV advisory `details` follows the GitHub Security Advisory markdown
// template (heading, body, heading, body, ...). The naive read - "take the
// first paragraph of details" - looks reasonable and is wrong: real advisories
// put the heading on its own line with the body one newline below it, so a
// paragraph split (on blank lines) yields the heading text itself ("###
// Impact") as the "paragraph", or picks up an unrelated trailing sentence from
// the same block. Splitting on heading LINES instead of blank lines is what
// lets rootCause/workaround/remedy actually land on the section a human would
// point to.

import { normalizeItem, withinWindow } from "../item.js";

const MAX_SNIPPET_LENGTH = 400;
const MAX_SOURCES = 6;

const ROOT_CAUSE_HEADING_RE = /^(impact|summary|details?|description)$/i;
const WORKAROUND_HEADING_RE = /workaround|mitigation/i;
const FIX_HEADING_RE = /^(fix|patch(es)?)$/i;

const REFERENCE_LABELS = {
  ADVISORY: "Advisory",
  FIX: "Fix",
  REPORT: "Report",
  PACKAGE: "Package",
};

// Splits a markdown body into sections keyed by ATX heading ("## Summary").
// The block *before* the first heading (if any) is kept under `heading: null`
// so callers can still treat "no headings at all" as its own case. Body lines
// are joined back with "\n" and left otherwise raw - cleaning (link
// flattening, whitespace collapse, truncation) happens in renderSnippet, not
// here, so a caller that wants the whole section (possibly several
// paragraphs) and one that wants just the first paragraph can share this.
function splitMarkdownSections(text) {
  const sections = [];
  let current = { heading: null, bodyLines: [] };
  for (const line of text.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) {
      sections.push(current);
      current = { heading: match[1].trim(), bodyLines: [] };
    } else {
      current.bodyLines.push(line);
    }
  }
  sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.bodyLines.join("\n") }));
}

// Removes heading LINES only - not the section they introduce. Stripping the
// whole block would delete the body along with the heading, which is exactly
// backwards for the "no matching heading" fallback: that path wants the prose
// with the "## Foo" clutter gone, not the prose gone too.
function stripHeadingLines(text) {
  return text
    .split("\n")
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join("\n");
}

function firstParagraph(text) {
  const [head] = text.split(/\n\s*\n/);
  return head || "";
}

// The one cleanup helper used everywhere card-facing prose is derived from
// OSV markdown: flatten `[text](url)` links so no raw URL leaks into a card,
// then collapse all whitespace (including the newlines a two-paragraph
// section still carries) to single spaces so it reads as one line, then
// truncate on a word boundary so a 400-char cut never lands mid-word or
// leaves a dangling space before the ellipsis.
function renderSnippet(rawText) {
  const flattened = String(rawText || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const collapsed = flattened.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_SNIPPET_LENGTH) return collapsed;
  const slice = collapsed.slice(0, MAX_SNIPPET_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

// rootCause: prefer the section a human would actually call the "why" -
// Impact/Summary/Details/Description - and take its full body (which may be
// more than one paragraph, per the Summary+"Learn more" advisory in the
// fixture). Only when the advisory has no headings at all do we fall back to
// a first-paragraph read of the raw text.
function extractRootCause(details) {
  if (!details) return "";
  const sections = splitMarkdownSections(details);
  const match = sections.find((s) => s.heading && ROOT_CAUSE_HEADING_RE.test(s.heading));
  if (match) return renderSnippet(match.body);
  return renderSnippet(firstParagraph(stripHeadingLines(details)));
}

// workaround: the one field no other Tech Watch source can supply. About half
// of real advisories carry one; a blank result here is the truth, not a
// parser gap.
function extractWorkaround(details) {
  if (!details) return "";
  const sections = splitMarkdownSections(details);
  const match = sections.find((s) => s.heading && WORKAROUND_HEADING_RE.test(s.heading));
  return match ? renderSnippet(match.body) : "";
}

function collectFixedVersions(affected) {
  const seen = new Set();
  const out = [];
  for (const pkg of Array.isArray(affected) ? affected : []) {
    for (const range of Array.isArray(pkg?.ranges) ? pkg.ranges : []) {
      for (const event of Array.isArray(range?.events) ? range.events : []) {
        const fixed = event && typeof event.fixed === "string" ? event.fixed : "";
        if (fixed && !seen.has(fixed)) {
          seen.add(fixed);
          out.push(fixed);
        }
      }
    }
  }
  return out;
}

// remedy: a published fixed version is the only claim we're willing to make
// unprompted. Without one, fall back to a Fix/Patch(es) section if the
// advisory bothered to write one; otherwise say nothing rather than invent a
// remedy that was never published.
function extractRemedy(affected, details) {
  const fixedVersions = collectFixedVersions(affected);
  if (fixedVersions.length > 0) return `Upgrade to ${fixedVersions.join(", ")}`;
  if (!details) return "";
  const sections = splitMarkdownSections(details);
  const match = sections.find((s) => s.heading && FIX_HEADING_RE.test(s.heading));
  return match ? renderSnippet(match.body) : "";
}

// affected: only the FIRST range's events, rendered as a bound a reader can
// act on today ("upgrade past X"). introduced "0" means "since the beginning
// of time" and is not worth printing as a lower bound.
function formatAffectedRange(affected) {
  const range = Array.isArray(affected) && affected[0]?.ranges ? affected[0].ranges[0] : null;
  const events = Array.isArray(range?.events) ? range.events : [];
  const parts = [];
  for (const event of events) {
    if (!event) continue;
    if (typeof event.introduced === "string" && event.introduced !== "0") {
      parts.push(`>= ${event.introduced}`);
    }
    if (typeof event.fixed === "string" && event.fixed) {
      parts.push(`< ${event.fixed}`);
    }
  }
  return parts.join(", ");
}

function mapSeverity(rawSeverity) {
  const upper = typeof rawSeverity === "string" ? rawSeverity.toUpperCase() : "";
  if (upper === "CRITICAL") return "critical";
  if (upper === "HIGH") return "high";
  if (upper === "MODERATE" || upper === "MEDIUM") return "medium";
  if (upper === "LOW") return "low";
  return "info";
}

function extractCveIds(aliases) {
  const out = [];
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (typeof alias === "string" && /^CVE-\d{4}-\d+$/i.test(alias)) {
      out.push(alias.toUpperCase());
    }
  }
  return out;
}

function labelForReference(ref) {
  const type = typeof ref?.type === "string" ? ref.type.toUpperCase() : "";
  if (REFERENCE_LABELS[type]) return REFERENCE_LABELS[type];
  try {
    return new URL(ref?.url).hostname;
  } catch {
    return "";
  }
}

function buildSources(references) {
  const list = Array.isArray(references) ? references : [];
  return list.slice(0, MAX_SOURCES).map((ref) => ({
    label: labelForReference(ref),
    url: typeof ref?.url === "string" ? ref.url : "",
  }));
}

export function parseOsvVulns(json, { entry, now, windowHours }) {
  const vulns = Array.isArray(json?.vulns) ? json.vulns : [];
  const items = [];
  for (const vuln of vulns) {
    if (!vuln || typeof vuln !== "object") continue;
    const details = typeof vuln.details === "string" ? vuln.details : "";
    const raw = {
      id: `osv:${entry.id}:${vuln.id}`,
      sourceId: "osv",
      category: "vulnerability",
      severity: mapSeverity(vuln.database_specific?.severity),
      title: typeof vuln.summary === "string" && vuln.summary.trim() ? vuln.summary : vuln.id,
      technologyId: entry.id,
      technology: entry.label,
      affected: formatAffectedRange(vuln.affected),
      occurredAt: vuln.published,
      timePrecision: "minute",
      rootCause: extractRootCause(details),
      remedy: extractRemedy(vuln.affected, details),
      workaround: extractWorkaround(details),
      cveIds: extractCveIds(vuln.aliases),
      sources: buildSources(vuln.references),
    };
    const item = normalizeItem(raw);
    if (!item) continue;
    if (!withinWindow(item, { now, windowHours })) continue;
    items.push(item);
  }
  return items;
}

export async function fetchOsvVulns({ entry, fetchImpl = globalThis.fetch, now, windowHours }) {
  if (!entry || !entry.osv) return { ok: true, items: [], error: null };
  try {
    const res = await fetchImpl("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { name: entry.osv.name, ecosystem: entry.osv.ecosystem } }),
    });
    if (!res.ok) {
      return { ok: false, items: [], error: `OSV request failed: ${res.status}` };
    }
    const json = await res.json();
    const items = parseOsvVulns(json, { entry, now, windowHours });
    return { ok: true, items, error: null };
  } catch (err) {
    return { ok: false, items: [], error: err?.message || String(err) };
  }
}
