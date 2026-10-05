// N104 - the two fields a regenerate adds to an Ideal tailor POST, read and
// bounded on the server. PURE.
//
//   pinnedAnalysis  the posting analysis (requirements + keyword map) the run being
//                   improved was scored against. The server keeps nothing between
//                   requests, so the client sends it back; the new review is then
//                   scored against the same requirements and their ids cannot drift.
//   beforeReview    the review of the text on screen: its flags, the requirements
//                   its material does not support, and its line count.
//
// Both arrive as JSON in form fields, so both are untrusted input: each is capped in
// size, parsed, and rebuilt field by field from the shapes the pipeline reads, never
// passed through. A field that is present but unusable comes back as `null` (not
// absent) so the branch can tell "not a regenerate" from "a regenerate it cannot
// run" and refuse the second instead of quietly running a first-time generation.
// Over-long lists are cut (a missing flag only ever means a gap goes unclaimed);
// the pin is all-or-nothing, because cutting a requirement would change the review.
//
//   readRegenerateFields(formData) -> { pinnedAnalysis?, beforeReview? }

const MAX_FIELD_CHARS = 150000;
const MAX_REQUIREMENTS = 200;
const MAX_KEYWORDS = 400;
const MAX_FLAGS = 300;
const MAX_UNQUALIFIED = 100;
const MAX_TEXT_CHARS = 2000;
const MAX_MESSAGE_CHARS = 600;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v, max) => typeof v === "string" && v.length <= max;

function parseField(raw) {
  if (typeof raw !== "string" || raw.length > MAX_FIELD_CHARS) return null;
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pinnedAnalysisFrom(raw) {
  const requirements = raw?.postingAnalysis?.requirements;
  if (!Array.isArray(requirements) || requirements.length > MAX_REQUIREMENTS) return null;
  const kept = [];
  for (const r of requirements) {
    if (!isObject(r) || !isText(r.id, 80) || !isText(r.text, MAX_TEXT_CHARS)) return null;
    kept.push({ id: r.id, text: r.text, ...(isText(r.kind, 40) ? { kind: r.kind } : {}) });
  }
  const entries = (Array.isArray(raw.keywordMap?.entries) ? raw.keywordMap.entries : [])
    .filter((e) => isObject(e) && isText(e.keyword, 120))
    .slice(0, MAX_KEYWORDS)
    .map((e) => ({
      keyword: e.keyword,
      ...(isText(e.section, 40) ? { section: e.section } : {}),
      ...(Number.isFinite(e.priority) ? { priority: e.priority } : {}),
      ...(Number.isFinite(e.requirementIndex) ? { requirementIndex: e.requirementIndex } : {}),
      ...(isText(e.requirementId, 80) ? { requirementId: e.requirementId } : {}),
    }));
  return { postingAnalysis: { requirements: kept }, keywordMap: { entries } };
}

function flagFrom(flag) {
  if (!isObject(flag) || !isText(flag.category, 60) || !isText(flag.message, MAX_MESSAGE_CHARS)) return null;
  const ref = flag.evidenceRef;
  return {
    ...(isText(flag.draftKind, 40) ? { draftKind: flag.draftKind } : {}),
    ...(isText(flag.spanId, 80) ? { spanId: flag.spanId } : {}),
    category: flag.category,
    message: flag.message,
    ...(isObject(ref) && isText(ref.origin, 40) && isText(ref.spanId, 80)
      ? {
          evidenceRef: {
            origin: ref.origin,
            ...(isText(ref.draftKind, 40) ? { draftKind: ref.draftKind } : {}),
            spanId: ref.spanId,
          },
        }
      : {}),
  };
}

function beforeReviewFrom(raw) {
  if (!isObject(raw)) return null;
  const flags = (Array.isArray(raw.flags) ? raw.flags : []).map(flagFrom).filter(Boolean).slice(0, MAX_FLAGS);
  const unresolvedQualifications = (Array.isArray(raw.unresolvedQualifications) ? raw.unresolvedQualifications : [])
    .filter((u) => isObject(u) && isText(u.requirementId, 80) && isText(u.text, MAX_TEXT_CHARS))
    .slice(0, MAX_UNQUALIFIED)
    .map((u) => ({ requirementId: u.requirementId, text: u.text }));
  return {
    status: "reviewed",
    flags,
    unresolvedQualifications,
    ...(Number.isFinite(raw.lineCount) ? { lineCount: raw.lineCount } : {}),
  };
}

export function readRegenerateFields(formData) {
  const out = {};
  const pinned = formData.get("pinnedAnalysis");
  if (pinned !== null && pinned !== undefined) out.pinnedAnalysis = pinnedAnalysisFrom(parseField(pinned.toString()));
  const before = formData.get("beforeReview");
  if (before !== null && before !== undefined) out.beforeReview = beforeReviewFrom(parseField(before.toString()));
  return out;
}
