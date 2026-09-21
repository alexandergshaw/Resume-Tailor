// lib/interviewPrep/prepSection.js -- the pure half of N45 step S8: the
// one-section prompt builder and its reply parser. Lives in its OWN module,
// not app/api/interview-prep/route.js, purely for the standing 1000-line
// ceiling (plan §3.6) -- route.js was already 918 lines before this chunk,
// and a section prompt plus a section parser plus the merge orchestration
// would carry it past.
//
// AC-EGRESS.1 is the point of `buildSectionPrompt`: it sends EXACTLY what
// `buildPrepPrompt` (route.js) already sends today -- the posting's own text
// and the company digest -- plus the section name and that section's own
// reply schema. It never sends the other three sections' current content,
// and it never sends storedNames/candidateName/interviewerNames (N33 §4.5's
// egress boundary, applied here by the same reasoning). Widening what the
// prompt carries is backlog N8/N34, out of scope for this chunk.
//
// `parseSectionResponse` mirrors route.js's own `parsePrepResponse`'s one
// discipline: the ONE boundary where untrusted model JSON becomes pack
// content is also the ONE place a model-supplied `templateOrigin` (or any
// other stray top-level key) gets stripped -- by construction, since this
// function builds its `{ok, content, claims}` result explicitly rather than
// spreading the parsed reply. It makes NO emptiness judgement of its own:
// `completeSections`/`packStatus` (prepPack.js) decide that over the MERGED,
// normalized document, not over one section's raw reply.

import { PREP_SECTION_NAMES } from "./prepContract.js";

const SECTION_CONTENT_SCHEMA = {
  aboutYou: '{"answer": {"lines": [{"text": string, "support": {"kind": "claim", "claimId": string}|null}]}}',
  whyRole: '{"answer": {"lines": [{"text": string, "support": {"kind": "claim", "claimId": string}|null}]}}',
  askThem: '{"questions": [{"text": string, "support": {"kind": "claim", "claimId": string}|null}]}',
  stages:
    '{"stages": [{"name": string, "questions": string[], "recommendedAnswer": string, "support": {"kind": "claim", "claimId": string}|null}]}',
};

function sectionSchemaLiteral(section) {
  const contentShape = SECTION_CONTENT_SCHEMA[section] || SECTION_CONTENT_SCHEMA.aboutYou;
  return `{"section": "${section}", "content": ${contentShape}, "claims": [{"id": string, "text": string, "sourceUrl": string}]}`;
}

/**
 * The one-section prompt. Sends EXACTLY the inputs `buildPrepPrompt` sends
 * today -- the posting's own text and the company digest -- plus the section
 * name and that section's own reply schema. Does NOT send the other
 * sections' current content, and does NOT send
 * storedNames/candidateName/interviewerNames.
 *
 * @param {{position: object, digest: object|null, section: "aboutYou"|"whyRole"|"askThem"|"stages"}} args
 * @returns {string}
 */
export function buildSectionPrompt({ position, digest, section }) {
  const title = String(position?.title || "").trim() || "this position";
  const company = String(position?.company || "").trim() || "this company";
  const description = String(position?.description || "").trim() || "(no description provided)";
  const hasDigest = digest?.status === "ready" && typeof digest.markdown === "string" && digest.markdown.trim();
  const digestBlock = hasDigest ? `Company research already on file:\n${digest.markdown.trim()}` : "No company research is on file yet.";

  return [
    `You are preparing a candidate for an interview for the ${title} role at ${company}.`,
    `Produce ONLY the "${section}" section of an interview prep pack -- nothing else.`,
    "Respond with ONLY a JSON object (no prose, no markdown fences) shaped exactly like:",
    sectionSchemaLiteral(section),
    "Any support.claimId must appear as an id in claims, and every claims entry must carry a real publisher URL in sourceUrl -- never a search-redirect URL.",
    "Write in the first person where the section calls for it. Never write the candidate's own name, or any person's name.",
    "Never name, describe, or predict which specific person will conduct or attend any interview, however confident you are -- that is forbidden.",
    "Base every claim about the company on the research below; never invent a fact you cannot support.",
    `Posting:\n${description}`,
    digestBlock,
  ].join("\n\n");
}

/**
 * Parses a one-section model reply. JSON/type checks ONLY -- it makes no
 * emptiness or content judgement, because completeSections/packStatus
 * (prepPack.js) already decide that over the MERGED, normalized document.
 * Refuses a reply whose `section` names a different section than the one
 * requested. Never reads or copies any top-level key other than `section`,
 * `content` and `claims`, so a model-supplied `templateOrigin` cannot reach
 * a pack through this door.
 *
 * @param {*} response the provider response object -- `{text}`, the same
 *   shape route.js's own parsePrepResponse takes.
 * @param {"aboutYou"|"whyRole"|"askThem"|"stages"} expectedSection
 * @returns {{ok: true, content: *, claims: *}|{ok: false, error: string}}
 */
export function parseSectionResponse(response, expectedSection) {
  const raw = response?.text;
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "The model returned no text." };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The model's reply was not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "The model's reply was not a section object." };
  }
  if (typeof parsed.section !== "string" || !parsed.section) {
    return { ok: false, error: "The model's reply did not name a section." };
  }
  if (!PREP_SECTION_NAMES.includes(parsed.section) || parsed.section !== expectedSection) {
    return { ok: false, error: `The model's reply was for "${parsed.section}", not "${expectedSection}".` };
  }
  if (parsed.content === undefined || parsed.content === null) {
    return { ok: false, error: "The model's reply carried no content." };
  }
  return { ok: true, content: parsed.content, claims: Array.isArray(parsed.claims) ? parsed.claims : [] };
}
