// The monotone-chain primitive: given the counts a pipeline recorded at each
// narrowing stage, say whether a stage ate everything (an ANOMALY) and whether
// the counts are internally impossible (a VIOLATION).
//
// NOT lib/tracking/stages.js. That module is interview-stage constants for the
// tracking UI and shares nothing with this one but the word.
//
// THE INVARIANT, stated here because this is now the one place that enforces
// it, and lib/tracking/digestCitations.js's header — which stated it first —
// still carries the story of the defect that earned it:
//
//   Every stage that can narrow a set records its INPUT count beside its
//   OUTPUT count, the pair travels into storage together, and the chain is
//   monotone.
//
//   A NON-ZERO INPUT BECOMING A ZERO OUTPUT IS A REPORTABLE ANOMALY, not a
//   normal empty. It is only a normal empty when the input was also zero.
//
// WHY THIS IS A PARAMETERISED MODULE AND NOT A SECOND HAND-COPY.
// `citationCountsAnomaly` and `citationCountsViolation` closed over a
// module-level stage list and took no chain, so the second feature that needed
// this shape could only get it by copying the engine — a second recogniser of
// the same rule, which is the exact class of defect the citation work exists to
// close, and which nothing would catch because both copies would be green
// against their own tests. The knowledge-page scope summary needs THREE chains
// (page retrieval, citation resolution, and the digest's own), so the
// parameterisation is paid for at its first caller rather than on a promise.
//
// The two functions answer DIFFERENT questions about the same numbers and
// neither subsumes the other:
//
//   * `stageAnomaly` — the pipeline ran and one stage silently consumed
//     everything. The counts are perfectly consistent; the OUTCOME is not.
//   * `stageViolation` — the counts cannot describe any real run (a later
//     stage exceeds an earlier one, or a count is missing). This is a wiring
//     bug upstream.
//
// A chain can be both at once, and each reports its own finding. Neither ever
// repairs anything: a count that has to be clamped to satisfy the invariant
// reproduces the failure mode the record exists to expose — an arithmetic that
// always looks consistent and therefore proves nothing.

/**
 * The sentence for counts that are not a plain object at all.
 *
 * Exported so a caller with its own published vocabulary can RELABEL this one
 * verdict without restating the rule that produces it. `digestCitations.js`
 * does exactly that, because its wording is already stored verbatim in
 * `application_digests.citation_outcome`.
 */
export const COUNTS_NOT_OBJECT = "counts are missing or not an object";

const EMPTY = Object.freeze([]);

/**
 * The adjacent pairs of a stage list, as a frozen chain.
 *
 * ADJACENT, not head-against-everything: the point of the chain is to name
 * WHICH stage consumed the difference, and a pair that skips a stage blames
 * the wrong one — which `digestCitations.js`'s header calls worse than naming
 * none. Frozen because every call site holds the result as a module constant.
 *
 * @param {unknown} stages
 * @returns {ReadonlyArray<readonly [string, string]>}
 */
export function transitionsFor(stages) {
  if (!Array.isArray(stages) || stages.length < 2) return EMPTY;
  const pairs = [];
  for (let i = 1; i < stages.length; i += 1) {
    pairs.push(Object.freeze([stages[i - 1], stages[i]]));
  }
  return Object.freeze(pairs);
}

// One transition, in either accepted shape.
//
// A caller may supply `{stage, from, to}` — a chain whose transitions have
// names of their own, like the digest's "url-control" between `annotations`
// and `urlsUsable` — or a bare `[from, to]` pair from `transitionsFor`. A bare
// pair has no separate name for the process, so the stage that produced the
// zero NAMES ITSELF; the log line reads "<stage> N -> 0" either way.
function normalizeTransition(transition) {
  if (Array.isArray(transition)) {
    const [from, to] = transition;
    if (typeof from !== "string" || typeof to !== "string") return null;
    return { stage: to, from, to };
  }
  if (!transition || typeof transition !== "object") return null;
  const { from, to } = transition;
  if (typeof from !== "string" || typeof to !== "string") return null;
  return { stage: typeof transition.stage === "string" ? transition.stage : to, from, to };
}

// A stage that reported nothing at all, or reported something that is not a
// count, did not report a healthy number. It reads as zero HERE — where the
// question is "did this stage produce anything" — and as a defect in
// `stageViolation`, where the question is "are these counts possible at all".
// The two readings are deliberate and they are what let one malformed record
// be both an anomaly and a violation.
function countOf(counts, name) {
  const value = counts[name];
  return Number.isInteger(value) ? value : 0;
}

/**
 * The first transition where a non-zero input became a zero output, or null.
 *
 * FIRST BREACH ONLY. Once a stage has eaten everything, every later zero is an
 * honest consequence of that stage rather than a second finding.
 *
 * Pure, so a route can log exactly the verdict it stored rather than a second
 * opinion about it. Never throws, never mutates its arguments.
 *
 * @param {unknown} counts       an object of stage name -> integer count
 * @param {unknown} transitions  `transitionsFor(stages)`, or `{stage, from, to}` objects
 * @returns {{stage: string, from: string, to: string, inputCount: number, outputCount: number}|null}
 */
export function stageAnomaly(counts, transitions) {
  if (!Array.isArray(transitions)) return null;
  const src = counts && typeof counts === "object" ? counts : {};
  for (const raw of transitions) {
    const transition = normalizeTransition(raw);
    if (!transition) continue;
    const inputCount = countOf(src, transition.from);
    const outputCount = countOf(src, transition.to);
    if (inputCount > 0 && outputCount === 0) {
      return { ...transition, inputCount, outputCount };
    }
  }
  return null;
}

/**
 * The first way `counts` breaks the monotone chain, as a sentence, or null.
 *
 * A violation is RECORDED, never repaired — see this module's header.
 *
 * Every count is type-checked BEFORE any pair is compared, deliberately:
 * `undefined` loses every numeric comparison silently, so a chain missing its
 * first count would otherwise read as healthy.
 *
 * @param {unknown} counts
 * @param {unknown} stages  the stage names, in narrowing order
 * @returns {string|null}
 */
export function stageViolation(counts, stages) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    return COUNTS_NOT_OBJECT;
  }
  if (!Array.isArray(stages)) return null;
  for (const stage of stages) {
    if (!Number.isInteger(counts[stage]) || counts[stage] < 0) {
      return `${stage} is not a non-negative integer`;
    }
  }
  for (let i = 1; i < stages.length; i += 1) {
    const previous = stages[i - 1];
    const current = stages[i];
    if (counts[current] > counts[previous]) {
      return `${current} (${counts[current]}) exceeds ${previous} (${counts[previous]})`;
    }
  }
  return null;
}
