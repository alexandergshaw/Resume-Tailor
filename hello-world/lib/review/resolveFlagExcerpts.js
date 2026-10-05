// N103 Step 1 - the one shared id -> text join for reviewer flags, PURE.
//
// A reviewer flag carries span IDS, never text (reviewDocuments.js normalizeFlag).
// This module joins the id -> text tables onto `excerpt` / `evidenceExcerpt` so
// ReviewFlagsPanel can quote them. It is the join N103's chokepoint
// (runDocumentReview.js) AND N105's band bridge (lib/tailor/idealSurface.js) use:
// one implementation. The single-analyzer census (lib/llm/ideal/
// singleAnalyzer.census.test.js, REVIEW_IMPORT_POLICY) names exactly that one
// N105-owned importer, because this is a pure helper and not an analyzer.

import { ORIGIN } from "./contract.js";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasText = (v) => typeof v === "string" && v.trim() !== "";
const own = (obj, key) =>
  isObject(obj) && typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;

function textAt(table, id) {
  const text = own(table, id);
  return hasText(text) ? text : "";
}

// Where an evidenceRef's id lives, by the origin it claims.
function evidenceTable(ref, spanTexts) {
  if (ref.origin === ORIGIN.POSTING) return own(spanTexts, "posting");
  if (ref.origin === ORIGIN.REAL_MATERIAL) return own(spanTexts, "realMaterial");
  if (ref.origin === ORIGIN.DRAFT) return own(spanTexts, ref.draftKind);
  return undefined;
}

/**
 * resolveFlagExcerpts(flags, spanTexts)
 *
 *   spanTexts  { [draftKind]: { [id]: text }, realMaterial: { [id]: text },
 *                posting: { [id]: text } }
 *
 * => the flags with the lines resolved onto `excerpt` and `evidenceExcerpt`. A flag
 * that already carries its own excerpt (the orchestrator may join them
 * server-side) keeps it, and an id with no entry in the tables is left unquoted.
 * Input that is not an array of flags, or tables that are not an object, come back
 * unchanged: turning unknown into "no text" would hide that the join never ran.
 * The input flags are never mutated.
 */
export function resolveFlagExcerpts(flags, spanTexts) {
  if (!Array.isArray(flags) || !isObject(spanTexts)) return flags;
  return flags.map((flag) => {
    if (!isObject(flag)) return flag;
    const next = { ...flag };
    if (!hasText(flag.excerpt)) {
      const text = textAt(own(spanTexts, flag.draftKind), flag.spanId);
      if (text) next.excerpt = text;
    }
    const ref = flag.evidenceRef;
    if (isObject(ref) && !hasText(flag.evidenceExcerpt)) {
      const text = textAt(evidenceTable(ref, spanTexts), ref.spanId);
      if (text) next.evidenceExcerpt = text;
    }
    return next;
  });
}
