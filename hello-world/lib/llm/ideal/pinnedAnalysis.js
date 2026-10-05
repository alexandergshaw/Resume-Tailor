// N104 - the guard for a PINNED posting analysis (design r2 section 2, D-6).
//
// A regenerate re-reviews its new draft against the BEFORE run's grounded posting
// analysis rather than a fresh one, because requirement ids are minted by model
// output order (idealStageResult.js) and a fresh analysis re-mints them: a gap that
// is still missing would then read as closed. runIdealPipeline accepts that
// analysis as `pinnedAnalysis` and uses it only when this guard accepts it; an
// absent or malformed pin falls back to today's grounding, never to a half-pinned
// state. PURE and dependency-free, so the pipeline, the regenerate orchestrator and
// the request reader can all share it without pulling a server module along.
//
//   pinnedAnalysis = { postingAnalysis: { requirements: [{ id, text, ... }] },
//                      keywordMap: { entries: [...] } }

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function isValidPinnedAnalysis(pinnedAnalysis) {
  const requirements = isObject(pinnedAnalysis) ? pinnedAnalysis.postingAnalysis?.requirements : null;
  return (
    Array.isArray(requirements) &&
    requirements.length > 0 &&
    requirements.every((r) => isObject(r) && typeof r.id === "string" && typeof r.text === "string")
  );
}
