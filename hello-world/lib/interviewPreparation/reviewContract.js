import { canonicalJSON, sha256 } from "./candidateContext";

const HARD = new Set(["unsupported-claim", "ownership", "invented-detail", "source-conflict", "hypothetical"]);
const CATEGORIES = new Set([...HARD, "relevance", "evasion", "repetition", "framing", "other"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function checkedBundle(bundle, context) {
  if (!Array.isArray(bundle) || !bundle.length || bundle.length > 12) throw new Error("Review requires one to twelve current draft versions.");
  const ids = new Set(); let total = 0;
  for (const draft of bundle) {
    if (!object(draft) || typeof draft.id !== "string" || !draft.id || ids.has(draft.id) || typeof draft.kind !== "string" || !Number.isInteger(draft.version) || draft.version < 1 || typeof draft.text !== "string" || draft.text.length > 12000 || !Array.isArray(draft.claimEvidence)) throw new Error("Invalid review draft or duplicate version identifier.");
    ids.add(draft.id); total += draft.text.length;
    for (const claim of draft.claimEvidence) {
      if (!object(claim) || !Number.isInteger(claim.start) || !Number.isInteger(claim.end) || claim.start < 0 || claim.end <= claim.start || claim.end > draft.text.length || claim.end - claim.start !== claim.quote?.length || draft.text.slice(claim.start, claim.end) !== claim.quote || !Array.isArray(claim.evidenceIds) || claim.evidenceIds.some((id) => !context.evidence.some((entry) => entry.id === id))) throw new Error("Draft evidence locator does not resolve in this context.");
    }
  }
  if (total > 24000) throw new Error("Shorten the current review bundle to 24,000 characters.");
  return [...bundle].sort((a, b) => a.id.localeCompare(b.id));
}
export async function createReviewTarget(context, bundle) {
  if (!context?.id || !Array.isArray(context.evidence)) throw new Error("A current candidate context is required.");
  const drafts = checkedBundle(bundle, context);
  const bundleId = `sha256:${await sha256(canonicalJSON({ contextId: context.id, drafts }))}`;
  return { contextId: context.id, bundleId, draftIds: drafts.map((draft) => draft.id), authorContextId: `deterministic-author:${bundleId}` };
}
export function validateReviewResult(raw, { context, bundle }) {
  try {
    const drafts = checkedBundle(bundle, context);
    if (!object(raw) || !["clean", "changes-required", "advisory"].includes(raw.status) || !Array.isArray(raw.coveredDraftIds) || !Array.isArray(raw.findings) || raw.findings.length > 32 || !Array.isArray(raw.probes) || raw.probes.length > 32) throw new Error("Malformed semantic review response.");
    if (canonicalJSON([...raw.coveredDraftIds].sort()) !== canonicalJSON(drafts.map((draft) => draft.id).sort())) throw new Error("Review did not cover the exact current bundle.");
    const findingIds = new Set();
    for (const finding of raw.findings) {
      if (!object(finding) || typeof finding.id !== "string" || !finding.id || findingIds.has(finding.id) || !["blocker", "warning", "advice"].includes(finding.severity) || !CATEGORIES.has(finding.category) || [finding.reason, finding.recommendation].some((value) => typeof value !== "string" || !value.trim() || value.length > 1200) || !Array.isArray(finding.drafts) || !finding.drafts.length || !Array.isArray(finding.sources)) throw new Error("Malformed review finding.");
      findingIds.add(finding.id);
      if (HARD.has(finding.category) && finding.severity !== "blocker") throw new Error("A personal grounding blocker cannot be waived as style advice.");
      for (const citation of finding.drafts) {
        const draft = drafts.find((entry) => entry.id === citation?.draftId);
        if (!draft || !Number.isInteger(citation.start) || !Number.isInteger(citation.end) || citation.start < 0 || citation.end <= citation.start || citation.end > draft.text.length || citation.end - citation.start !== citation.quote?.length || typeof citation.quote !== "string" || citation.quote.length > 4000 || draft.text.slice(citation.start, citation.end) !== citation.quote) throw new Error("Review draft citation does not resolve.");
      }
      if (!finding.sources.length && (typeof finding.missingEvidence !== "string" || !finding.missingEvidence.trim() || finding.missingEvidence.length > 1200)) throw new Error("An unsupported finding needs an explicit missing-evidence reason.");
      for (const citation of finding.sources) {
        const source = context.evidence.find((entry) => entry.id === citation?.evidenceId);
        if (!source || typeof citation.quote !== "string" || !citation.quote || citation.quote.length > 4000 || !source.quote.includes(citation.quote)) throw new Error("Review source citation does not resolve.");
      }
    }
    for (const probe of raw.probes) if (!object(probe) || !drafts.some((draft) => draft.id === probe.draftId) || typeof probe.question !== "string" || !probe.question.trim() || probe.question.length > 1200) throw new Error("Invalid adversarial follow-up.");
    if (context.conflicts?.length && (raw.status !== "changes-required" || !raw.findings.some((finding) => finding.severity === "blocker" && finding.category === "source-conflict"))) throw new Error("Known unresolved source conflicts require blocking conflict findings and cannot be accepted as advice.");
    if (raw.status === "clean" && raw.findings.length) throw new Error("A clean review cannot carry unresolved findings.");
    if (raw.findings.some((finding) => finding.severity === "blocker") && raw.status !== "changes-required") throw new Error("Blocking findings require changes before acceptance.");
    return { ok: true, value: { status: raw.status, coveredDraftIds: raw.coveredDraftIds, findings: raw.findings, probes: raw.probes }, error: null };
  } catch (error) { return { ok: false, value: null, error: error?.message || "Review validation failed." }; }
}
function receiptProblem(envelope, contextId, bundleId, trustedInvocationId) {
  if (!envelope) return "No independent semantic review has been completed.";
  if (envelope.contextId !== contextId || envelope.bundleId !== bundleId) return "Draft, source or strength changed; this review is stale.";
  const host = envelope.host;
  if (!object(host) || host.role !== "adversarial-reviewer" || host.provider !== "gemini" || host.separateInvocation !== true || !host.invocationId || !host.reviewerContextId || host.authorContextId !== `deterministic-author:${bundleId}` || host.reviewerContextId === host.authorContextId) return "A distinct host-observed reviewer invocation is required.";
  if (!trustedInvocationId || trustedInvocationId !== host.invocationId) return "Saved review is historical and not a trusted current-session receipt.";
  if (envelope.schemaVersion !== 1 || typeof host.requestedModel !== "string" || !(host.observedModel === null || typeof host.observedModel === "string") || typeof host.createdAt !== "string" || !object(envelope.review) || !["clean", "changes-required", "advisory"].includes(envelope.review.status) || !Array.isArray(envelope.review.coveredDraftIds) || !Array.isArray(envelope.review.findings) || !Array.isArray(envelope.review.probes)) return "Malformed review record.";
  if (envelope.review.status === "clean" && envelope.review.findings.length) return "Clean verdict has unresolved findings.";
  for (const finding of envelope.review.findings) if (!object(finding) || !["blocker", "warning", "advice"].includes(finding.severity) || !CATEGORIES.has(finding.category) || typeof finding.id !== "string" || typeof finding.reason !== "string" || typeof finding.recommendation !== "string" || !Array.isArray(finding.drafts) || !finding.drafts.length || !Array.isArray(finding.sources)) return "Malformed review findings cannot be accepted.";
  return "";
}
export function canAcceptReview({ envelope, contextId, bundleId, trustedInvocationId, acknowledgedFindingIds = [] }) {
  const problem = receiptProblem(envelope, contextId, bundleId, trustedInvocationId);
  if (problem) return { allowed: false, status: envelope ? envelope.contextId !== contextId || envelope.bundleId !== bundleId ? "stale" : "historical-unattested" : "unreviewed", reason: problem };
  const findings = envelope.review.findings;
  if (envelope.review.status === "changes-required" || findings.some((finding) => finding.severity === "blocker" || HARD.has(finding.category))) return { allowed: false, status: "changes-required", reason: "Resolve personal grounding and other blocking findings, then request a fresh review." };
  if (findings.some((finding) => !acknowledgedFindingIds.includes(finding.id))) return { allowed: false, status: "advisory", reason: "Acknowledge retained style advice explicitly, or revise and review again." };
  return { allowed: true, status: findings.length ? "accepted-with-advice" : "reviewed", reason: findings.length ? "Advice acknowledged; this is not a clean guarantee of truth." : "No issues found in this bounded independent review; truth is not guaranteed." };
}
export function reviewStatus({ envelope, contextId, bundleId, trustedInvocationId }) {
  const result = canAcceptReview({ envelope, contextId, bundleId, trustedInvocationId });
  return result.allowed ? "reviewed" : result.status;
}
