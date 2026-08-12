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

const LINK_RE = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;

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

  const dropped = [];
  const body = src.replace(LINK_RE, (whole, text, url) => {
    const key = isGrounded ? normalizeKey(url) : null;
    if (key && groundedKeys.has(key)) return whole;
    dropped.push(String(url).trim());
    return text;
  });

  let out;
  if (!isGrounded) {
    const notice =
      "**Not grounded** — live search returned no verifiable sources for this report, so none of its claims are confirmed. Treat it as a starting point only, and verify anything you plan to act on.";
    out = body.trim() ? `${body.trim()}\n\n${notice}` : notice;
  } else {
    const sourceLines = safeGrounded.map((g) => `- [${g.title || g.uri}](${g.uri})`);
    out = `${body.trimEnd()}\n\n## Sources\n${sourceLines.join("\n")}`;
  }

  return { markdown: out, dropped, grounded: isGrounded };
}
