// N103 Step 3 - THE shared review chokepoint (AC-11), async but offline.
//
// The preview modal and the Ask-AI chat both reach the document reviewer through
// this one function and consume only its ReviewOutcome. Neither imports the
// analyzer, the span-minter or the verdict rule, so the two surfaces cannot
// drift apart on any of: how a document is split into spans, which authority
// yardstick applies, what counts as complete, or what an empty document means.
//
//   runDocumentReview(request) -> ReviewOutcome
//
//   request = { kind, title, resultLines?, text?, posting?, realMaterial?,
//               realMaterialLines? }
//     kind               "applicationReady" | "hypothetical"
//     title              the subject's name; returned so a verdict is never
//                        separate from the document it describes
//     resultLines/text   the document (lines win when both are given)
//     posting            { requirements: [{ id, text }] } | null
//     realMaterial       { spans: [{ id, text, contextKey }] } | null
//     realMaterialLines  the candidate's real resume as lines, minted into spans
//                        here, so no surface ever mints spans itself
//
//   ReviewOutcome =
//     { status: "empty" }
//   | { status: "reviewed", draftKind, title, flags, unresolvedQualifications,
//       verdictKind, missingChecks, checkedChecks, engineMode, lineCount,
//       inputs: { posting, realMaterial } }
//
// `inputs` says whether the surface actually GAVE the reviewer what two checks
// need. Coverage only says which checks ran; with no posting requirements the
// keyword check is "evaluated" over an empty list, a vacuous pass. Each flag is
// true only for a non-empty list of well-formed items, never for a key that is
// merely present.
//
// No judge is passed: the default path is the deterministic mechanical floor, so
// it needs no key, touches no network and is the same on every run. When a judge
// is wired (N110) it enters at the single reviewDocuments call below.

import { decomposeToSpans } from "../llm/ideal/spanDocument.js";
import { reviewDocuments } from "./reviewDocuments.js";
import { reviewVerdict } from "./reviewVerdict.js";
import { resolveFlagExcerpts } from "./resolveFlagExcerpts.js";
import { DRAFT_KIND } from "./flagPresentation.js";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const wellFormed = (item) => isObject(item) && typeof item.id === "string" && typeof item.text === "string" && item.text.trim() !== "";

// The authority yardstick is chosen here and nowhere else: a hypothetical is
// judged by its own internal consistency (never against the candidate's real
// material, or legitimate ambition reads as "unsupported"); a real document is
// judged against the candidate's material.
const authorityReferenceFor = (kind) => (kind === DRAFT_KIND.HYPOTHETICAL ? "internal-consistency" : "user-material");

function textTable(list) {
  return Object.fromEntries((Array.isArray(list) ? list : []).filter(wellFormed).map((item) => [item.id, item.text]));
}

function realMaterialFor(request, kind) {
  // A hypothetical never consults real material, so none is supplied for it.
  if (kind === DRAFT_KIND.HYPOTHETICAL) return { spans: [] };
  if (isObject(request.realMaterial) && Array.isArray(request.realMaterial.spans)) return request.realMaterial;
  if (Array.isArray(request.realMaterialLines)) return { spans: decomposeToSpans(null, request.realMaterialLines).spans };
  return { spans: [] };
}

export async function runDocumentReview(request) {
  const req = isObject(request) ? request : {};
  const kind = req.kind === DRAFT_KIND.HYPOTHETICAL ? DRAFT_KIND.HYPOTHETICAL : DRAFT_KIND.APPLICATION_READY;

  const { spans } = decomposeToSpans(req.text, req.resultLines);
  // The empty gate runs BEFORE the reviewer: "there was no document" is a
  // different fact from "a document was reviewed and nothing was found".
  if (spans.length === 0) return { status: "empty" };

  const posting = isObject(req.posting) && Array.isArray(req.posting.requirements) ? req.posting : { requirements: [] };
  const realMaterial = realMaterialFor(req, kind);

  const review = await reviewDocuments({
    drafts: [{ kind, spans, authorityReference: authorityReferenceFor(kind) }],
    posting,
    realMaterial,
  });
  const verdict = reviewVerdict(review);

  const spanTexts = {
    [kind]: textTable(spans),
    realMaterial: textTable(realMaterial.spans),
    posting: textTable(posting.requirements),
  };
  const flags = resolveFlagExcerpts(review.flags, spanTexts).filter((flag) => flag.draftKind === kind);

  return {
    status: "reviewed",
    draftKind: kind,
    title: typeof req.title === "string" ? req.title : "",
    flags,
    unresolvedQualifications: review.unresolvedQualifications,
    verdictKind: verdict.kind,
    missingChecks: verdict.missingChecks,
    checkedChecks: verdict.checkedChecks,
    engineMode: review.coverage?.engineMode,
    lineCount: spans.length,
    inputs: {
      posting: posting.requirements.some(wellFormed),
      realMaterial: realMaterial.spans.some(wellFormed),
    },
  };
}
