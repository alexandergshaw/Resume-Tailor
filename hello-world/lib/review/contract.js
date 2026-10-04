// The vocabulary and shape validators for the shared document reviewer. This is
// the ONE place the seven-category enum, the origin enum, the floor/LLM split,
// the span-containment predicate and the coverage derivation are defined, so the
// orchestrator, the detectors and the tests cannot drift apart on any of them.
//
// Pure: no IO, no clock, no randomness, and it imports nothing (not even from
// the rest of lib/review/), so every other module in the package can depend on
// it without a cycle.

// The seven contract categories. Frozen: the wire vocabulary is a contract with
// every consumer, so nothing may add or rename a member at runtime.
export const CATEGORY = Object.freeze({
  MISSING_KEYWORD: "missing-keyword",
  VAGUE_UNSUPPORTED: "vague-unsupported",
  REPETITION: "repetition",
  UNVERIFIABLE_METRIC: "unverifiable-metric",
  EMPLOYER_PLAUSIBILITY: "employer-plausibility",
  CONSISTENCY: "consistency",
  UNSUPPORTED_AUTHORITY: "unsupported-authority",
});

// Where an evidenceRef points: a posting requirement, a real-material span, or
// a span in one of the drafts.
export const ORIGIN = Object.freeze({
  POSTING: "posting",
  REAL_MATERIAL: "real-material",
  DRAFT: "draft",
});

// A category has exactly one FULL-DEPTH home. The deterministic floor evaluates
// these four to full depth with no model at all.
export const FLOOR_CATEGORIES = new Set([
  CATEGORY.MISSING_KEYWORD,
  CATEGORY.REPETITION,
  CATEGORY.UNVERIFIABLE_METRIC,
  CATEGORY.VAGUE_UNSUPPORTED,
]);

// These three only reach full depth when an injected judge reports them. The
// deterministic skeleton may still EMIT a consistency / unsupported-authority
// flag, but emitting a flag is not the same as having evaluated the category,
// so these never enter coverage on the strength of the skeleton.
export const LLM_CATEGORIES = new Set([
  CATEGORY.EMPLOYER_PLAUSIBILITY,
  CATEGORY.CONSISTENCY,
  CATEGORY.UNSUPPORTED_AUTHORITY,
]);

// The enum's own fixed order: how coverage.evaluatedCategories is sorted.
const CATEGORY_ORDER = Object.values(CATEGORY);
const ORIGIN_VALUES = Object.values(ORIGIN);
const ENGINE_MODES = ["full", "mechanical-only"];

// True when `evaluated` names every one of the seven categories. Every honesty
// check in this package routes through this single predicate.
function coversAllCategories(evaluated) {
  const have = new Set(evaluated);
  return CATEGORY_ORDER.every((c) => have.has(c));
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isPresent = (v) => v !== undefined && v !== null;

// AC-1, the containment chokepoint. A flag is contained when its spanId is a
// SCALAR string naming a span that exists in the flag's own draft, and (when it
// carries one) its evidenceRef names a span that exists in the origin it claims.
// draftKind is required exactly when the origin is "draft".
//
// Returns false instead of throwing: the caller drops a flag that fails, so a
// fabricated, merged ("s1+s2") or array id can never reach a consumer.
//
// `index` is { draftSpanIds: Map<kind, Set<id>>, postingIds: Set, realMaterialIds: Set }.
export function assertContainedFlag(flag, index) {
  if (!isObject(flag) || !isObject(index)) return false;
  if (typeof flag.spanId !== "string") return false;

  const ownIds = index.draftSpanIds?.get?.(flag.draftKind);
  if (!ownIds || !ownIds.has(flag.spanId)) return false;

  const ref = flag.evidenceRef;
  if (ref === undefined) return true;
  if (!isObject(ref) || typeof ref.spanId !== "string") return false;

  const hasDraftKind = isPresent(ref.draftKind);
  switch (ref.origin) {
    case ORIGIN.POSTING:
      return !hasDraftKind && Boolean(index.postingIds?.has(ref.spanId));
    case ORIGIN.REAL_MATERIAL:
      return !hasDraftKind && Boolean(index.realMaterialIds?.has(ref.spanId));
    case ORIGIN.DRAFT:
      return hasDraftKind && Boolean(index.draftSpanIds?.get?.(ref.draftKind)?.has(ref.spanId));
    default:
      return false;
  }
}

// AC-15, the universal post-condition on a whole result: every flag's category
// and evidenceRef shape, the unresolved-qualification shape, and the coverage
// honesty coupling. Span containment is assertContainedFlag's job (it needs the
// input's id index), and requirementId membership needs the posting, so neither
// is checked here.
export function assertWellFormed(result) {
  if (!isObject(result)) return false;
  if (!Array.isArray(result.flags) || !Array.isArray(result.unresolvedQualifications)) return false;

  for (const flag of result.flags) {
    if (!isObject(flag)) return false;
    if (!CATEGORY_ORDER.includes(flag.category)) return false;
    if (typeof flag.draftKind !== "string" || typeof flag.spanId !== "string") return false;
    if (flag.evidenceRef !== undefined) {
      const ref = flag.evidenceRef;
      if (!isObject(ref) || !ORIGIN_VALUES.includes(ref.origin)) return false;
      if (isPresent(ref.draftKind) !== (ref.origin === ORIGIN.DRAFT)) return false;
    }
  }

  for (const u of result.unresolvedQualifications) {
    if (!isObject(u) || typeof u.requirementId !== "string") return false;
  }

  const cov = result.coverage;
  if (!isObject(cov)) return false;
  if (!ENGINE_MODES.includes(cov.engineMode)) return false;
  if (!Array.isArray(cov.evaluatedCategories)) return false;
  if (!cov.evaluatedCategories.every((c) => CATEGORY_ORDER.includes(c))) return false;
  if (typeof cov.complete !== "boolean") return false;
  // The honesty coupling: complete is exactly "all seven evaluated", and a
  // mechanical-only run can never be complete.
  if (cov.complete !== coversAllCategories(cov.evaluatedCategories)) return false;
  if (cov.engineMode === "mechanical-only" && cov.complete) return false;
  return true;
}

// The SINGLE derivation of coverage, and the only place `complete` is assigned.
//
//   seamResolved           the injected judge was present AND returned a value
//                          (it did not throw, reject or time out).
//   reportedLlmCategories  what a RESOLVED judge reported for the LLM categories
//                          (empty when the judge was absent, failed, or returned
//                          a malformed evaluatedCategories).
//
// Nothing a detector or a judge says can set `complete`: it is derived from the
// evaluated set, so an overclaim has no code path. A resolved judge that
// reports nothing usable yields the four floor categories and complete:false,
// never an all-LLM coercion.
export function computeCoverage({ seamResolved = false, reportedLlmCategories = [] } = {}) {
  const llmPart = seamResolved
    ? (Array.isArray(reportedLlmCategories) ? reportedLlmCategories : []).filter((c) => LLM_CATEGORIES.has(c))
    : [];
  const evaluated = new Set([...FLOOR_CATEGORIES, ...llmPart]);
  const evaluatedCategories = CATEGORY_ORDER.filter((c) => evaluated.has(c));
  return {
    evaluatedCategories,
    engineMode: seamResolved ? "full" : "mechanical-only",
    complete: coversAllCategories(evaluatedCategories),
  };
}
