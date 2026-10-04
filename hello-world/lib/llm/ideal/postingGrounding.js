// N105 Step 3c - AC-8 / AC-9, grounding the model's reading of the posting to the
// posting itself. PURE.
//
// The analysis stage returns what the MODEL says the posting asks for (the
// requirement list and the prioritised keyword map). The chain only checks
// their shape (idealStageResult.normalizeAnalysis); whether each item is
// actually IN the posting is checked here, because an invented requirement
// steers every later step toward something the employer never asked for.
//
// An item is grounded when it traces to ONE posting span (a line or sentence,
// never the whole posting): either the truthfulness gate's own support rule
// holds with the posting spans standing in for real material (every number,
// named entity and content stem of the item found in one span), or the item's
// words appear verbatim as a whole word in the posting. The literal route is
// what lets short keywords such as "Go", "R" or "CI/CD", which the stem rule has
// nothing to measure, stand when the posting really says them.
//
// Without posting text (a link-only posting is read inside the chain and its
// text is not handed back) nothing can be checked and the analysis passes
// through unchanged; `checked` says which happened.
import { applicationReadyGate } from "@/lib/llm/ideal/applicationReadyGate";

// One span per line, further split at sentence ends; bullet glyphs removed.
function postingSpans(postingText) {
  const spans = [];
  const lines = String(postingText ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (const line of lines) {
    for (const part of line.split(/(?<=[.!?;])\s+/)) {
      const text = part.replace(/^[\s*•▪◦-]+/, "").trim();
      if (text) spans.push({ id: `p${spans.length + 1}`, text, contextKey: "" });
    }
  }
  return spans;
}

function containsLiteral(postingLower, text) {
  const needle = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(postingLower);
}

// => boolean[] aligned with `texts`.
function groundedFlags(texts, spans, postingLower) {
  const candidateSpans = texts.map((text, i) => ({ id: `c${i}`, text, contextKey: "" }));
  const { kept } = applicationReadyGate({ candidateSpans, realMaterial: { spans } });
  const supported = new Set(kept.map((k) => k.id));
  return texts.map((text, i) => supported.has(`c${i}`) || containsLiteral(postingLower, text));
}

/**
 * groundToPosting({ postingAnalysis, keywordMap }, postingText)
 * => { postingAnalysis, keywordMap, checked }
 *
 * Ungrounded requirements and keywords are removed (order kept). A keyword whose
 * requirement was removed keeps its place in the map with `requirementId: null`.
 */
export function groundToPosting({ postingAnalysis, keywordMap } = {}, postingText) {
  const requirements = Array.isArray(postingAnalysis?.requirements) ? postingAnalysis.requirements : [];
  const entries = Array.isArray(keywordMap?.entries) ? keywordMap.entries : [];
  const spans = postingSpans(postingText);
  if (spans.length === 0) {
    return {
      postingAnalysis: { ...postingAnalysis, requirements },
      keywordMap: { ...keywordMap, entries },
      checked: false,
    };
  }

  const postingLower = spans.map((s) => s.text).join(" ").toLowerCase().replace(/\s+/g, " ");
  const reqOk = groundedFlags(requirements.map((r) => r?.text), spans, postingLower);
  const keptRequirements = requirements.filter((_, i) => reqOk[i]);
  const keptIds = new Set(keptRequirements.map((r) => r.id));

  const kwOk = groundedFlags(entries.map((e) => e?.keyword), spans, postingLower);
  const keptEntries = entries
    .filter((_, i) => kwOk[i])
    .map((e) => (e.requirementId && !keptIds.has(e.requirementId) ? { ...e, requirementId: null } : e));

  return {
    postingAnalysis: { ...postingAnalysis, requirements: keptRequirements },
    keywordMap: { ...keywordMap, entries: keptEntries },
    checked: true,
  };
}
