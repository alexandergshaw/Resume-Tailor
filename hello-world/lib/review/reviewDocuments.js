// The one shared document-weakness analyzer. Given one or more drafts (each an
// array of app-minted spans), the posting's requirements and the candidate's
// real material, it returns:
//
//   { flags, unresolvedQualifications, coverage }
//
// Three properties are structural rather than promised:
//
//   Containment. Every flag - from a detector OR from the injected judge - goes
//   through emit(), the only writer to the output flags, which runs
//   assertContainedFlag first and DROPS a flag that fails. The core never mints
//   a span id, so a fabricated or merged id cannot reach a consumer.
//
//   Honest coverage. `complete` is derived once, in computeCoverage, from the
//   categories actually evaluated. Nothing here, and nothing a judge returns,
//   can set it. A judge that throws leaves the review mechanical-only; a judge
//   that resolves with a malformed evaluatedCategories is treated as having
//   reported none.
//
//   Purity. The core imports no network, filesystem or runtime-state module.
//   Anything model-backed arrives through options.judge; with no judge the
//   result is a pure function of the input.

import { LLM_CATEGORIES, assertContainedFlag, computeCoverage } from "./contract.js";
import {
  computeUnresolvedQualifications,
  detectAuthoritySkeleton,
  detectConsistencySkeleton,
  detectMissingKeyword,
  detectRepetition,
  detectUnverifiableMetric,
  detectVagueUnsupported,
} from "./mechanicalDetectors.js";
import { selectAuthorityReference } from "./referenceSelect.js";

// Serialise with object keys in a fixed order, so equal content always yields an
// equal string (used for the sort key and for dropping exact duplicates).
function stableStringify(value) {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// A total order determined by flag CONTENT, never by where a span happened to
// sit in the input.
function compareFlags(a, b) {
  return (
    compare(a.draftKind, b.draftKind) ||
    compare(a.spanId, b.spanId) ||
    compare(a.category, b.category) ||
    compare(stableStringify(a.evidenceRef), stableStringify(b.evidenceRef)) ||
    compare(a.message, b.message)
  );
}

// The id sets every flag is checked against, built once from the input.
function buildIndex(drafts, posting, realMaterial) {
  const draftSpanIds = new Map();
  for (const d of drafts) {
    const ids = new Set();
    for (const s of Array.isArray(d?.spans) ? d.spans : []) {
      if (s && typeof s.id === "string") ids.add(s.id);
    }
    draftSpanIds.set(d.kind, ids);
  }
  const idsOf = (list) =>
    new Set((Array.isArray(list) ? list : []).filter((x) => x && typeof x.id === "string").map((x) => x.id));
  return {
    draftSpanIds,
    postingIds: idsOf(posting?.requirements),
    realMaterialIds: idsOf(realMaterial?.spans),
  };
}

// What the judge receives: the raw input plus, per draft, the authority
// reference the core selected, so the judge never re-derives which yardstick
// applies to which draft.
function buildJudgeRequest(drafts, posting, realMaterial) {
  return {
    drafts: drafts.map((d) => {
      const { mode, referenceSpans } = selectAuthorityReference(d, realMaterial);
      return {
        kind: d.kind,
        spans: d.spans,
        authorityReference: d.authorityReference,
        authorityReferenceSpans: referenceSpans,
        referenceMode: mode,
      };
    }),
    posting,
    realMaterial,
  };
}

// Copy a contained flag down to exactly the contract's fields, so a judge cannot
// smuggle extra keys (or a draftKind on a non-draft evidenceRef) into the output.
function normalizeFlag(flag) {
  const out = {
    draftKind: flag.draftKind,
    spanId: flag.spanId,
    category: flag.category,
    message: typeof flag.message === "string" ? flag.message : "",
  };
  if (flag.evidenceRef) {
    const ref = flag.evidenceRef;
    out.evidenceRef = { origin: ref.origin };
    if (ref.draftKind !== undefined && ref.draftKind !== null) out.evidenceRef.draftKind = ref.draftKind;
    out.evidenceRef.spanId = ref.spanId;
  }
  return out;
}

export async function reviewDocuments(input, options = {}) {
  const drafts = (Array.isArray(input?.drafts) ? input.drafts : []).filter(
    (d) => d && typeof d.kind === "string",
  );
  const posting = input?.posting ?? { requirements: [] };
  const realMaterial = input?.realMaterial ?? null;
  const index = buildIndex(drafts, posting, realMaterial);

  // The ONLY writer to the output flags: contained or dropped, no third path.
  const flags = [];
  const emit = (flag) => {
    if (!assertContainedFlag(flag, index)) return;
    flags.push(normalizeFlag(flag));
  };

  // 1. The deterministic floor, plus the consistency and authority skeletons.
  for (const draft of drafts) {
    for (const flag of [
      ...detectMissingKeyword(draft, posting),
      ...detectRepetition(draft),
      ...detectUnverifiableMetric(draft),
      ...detectVagueUnsupported(draft),
      ...detectAuthoritySkeleton(draft, realMaterial),
    ]) {
      emit(flag);
    }
  }
  for (const flag of detectConsistencySkeleton(drafts)) emit(flag);

  const unresolvedQualifications = computeUnresolvedQualifications(drafts, posting, realMaterial);

  // 2. The injected judge, if any. It can fail in two different ways and the two
  // are NOT the same: a judge that throws (or rejects, or times out) produced
  // nothing, so the whole review is mechanical-only; a judge that resolves with
  // a missing or garbage evaluatedCategories ran but reported nothing usable.
  let seamResolved = false;
  let judgeFlags = [];
  let reported = [];
  if (options?.judge) {
    try {
      const verdict = await options.judge(buildJudgeRequest(drafts, posting, realMaterial));
      seamResolved = true;
      judgeFlags = Array.isArray(verdict?.flags) ? verdict.flags : [];
      reported = Array.isArray(verdict?.evaluatedCategories) ? verdict.evaluatedCategories : [];
    } catch {
      seamResolved = false;
    }
  }

  // The floor categories belong to the deterministic core entirely, so a judge
  // flag in one of them is dropped before it reaches the containment check.
  for (const flag of judgeFlags) {
    if (flag && LLM_CATEGORIES.has(flag.category)) emit(flag);
  }
  const reportedLlmCategories = [...new Set(reported)].filter((c) => LLM_CATEGORIES.has(c));

  // 3. A stable total order, with exact duplicates removed.
  const seen = new Set();
  const ordered = flags
    .filter((f) => {
      const key = stableStringify(f);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareFlags);

  return {
    flags: ordered,
    unresolvedQualifications,
    coverage: computeCoverage({ seamResolved, reportedLlmCategories }),
  };
}
