import { createInputs } from "./workbench";

const MAX_BYTES = 512 * 1024;
const STAGE_IDS = new Set(["brief", "role", "company", "interviewer", "candidacy", "examples", "practical", "questions", "mock", "repair", "reference", "followup", "sample", "repairSuggestion"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function workspaceKey(userId, applicationId) {
  return `interview-preparation:v1:${userId ? `account-${encodeURIComponent(userId)}` : "guest"}:${applicationId ? `application-${encodeURIComponent(applicationId)}` : "manual"}`;
}
export function createWorkspace() {
  return { version: 1, inputs: createInputs(), artifacts: {}, attempts: [], sources: { articles: [] }, candidate: { contextId: null, sourceMode: null, supplements: [] }, reviewHistory: [], reviewAttempts: [], revision: 0, updatedAt: null };
}
function bounded(value, depth = 0) {
  if (depth > 12) throw new Error("Workspace nesting is too deep.");
  if (typeof value === "string") { if (value.length > 24000) throw new Error("A workspace field is too long (24,000 characters maximum)."); return; }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Invalid workspace number."); return; }
  if (Array.isArray(value)) { if (value.length > 60) throw new Error("Workspace history is too large (60 entries maximum)."); value.forEach((entry) => bounded(entry, depth + 1)); return; }
  if (record(value)) { if (Object.keys(value).length > 100) throw new Error("Workspace has too many fields."); Object.entries(value).forEach(([key, entry]) => { if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid workspace field."); bounded(entry, depth + 1); }); return; }
  throw new Error("Unsupported workspace value.");
}
function stringList(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`Invalid ${name} list.`);
}
function validateReview(review) {
  if (!record(review) || !record(review.heuristic) || !record(review.checks)) throw new Error("Invalid answer review structure.");
  const heuristic = review.heuristic;
  if (!Number.isFinite(heuristic.score) || heuristic.score < 0 || heuristic.score > 100 || typeof heuristic.verdict !== "string") throw new Error("Invalid heuristic review result.");
  for (const key of ["strengths", "improvements", "missing", "delivery"]) stringList(heuristic[key], `review ${key}`);
  if (heuristic.star !== null && (!record(heuristic.star) || Object.values(heuristic.star).some((value) => typeof value !== "boolean"))) throw new Error("Invalid review example structure.");
  if (heuristic.source !== undefined && typeof heuristic.source !== "string") throw new Error("Invalid review source.");
  const checkNames = ["directness", "specificity", "ownership", "relevance", "brevity"];
  if (Object.keys(review.checks).some((key) => !checkNames.includes(key))) throw new Error("Invalid manual review criterion.");
  for (const name of checkNames) {
    const rating = review.checks[name];
    if (!(rating === null || (Number.isInteger(rating) && rating >= 1 && rating <= 5))) throw new Error("Invalid manual review rating.");
  }
  if (!Number.isFinite(review.seconds) || review.seconds < 0 || typeof review.reviewedAt !== "string" || typeof review.label !== "string") throw new Error("Invalid review timing or label.");
}
function validateEnvelope(envelope) {
  if (!record(envelope) || !record(envelope.host) || !record(envelope.review) || typeof envelope.contextId !== "string" || typeof envelope.bundleId !== "string" || !["clean", "changes-required", "advisory"].includes(envelope.review.status) || !Array.isArray(envelope.review.findings) || !Array.isArray(envelope.review.probes) || !Array.isArray(envelope.review.coveredDraftIds)) throw new Error("Invalid saved semantic review envelope.");
  for (const finding of envelope.review.findings) {
    if (!record(finding) || !["blocker", "warning", "advice"].includes(finding.severity) || typeof finding.id !== "string" || typeof finding.reason !== "string" || typeof finding.recommendation !== "string" || !Array.isArray(finding.drafts) || !finding.drafts.length || !Array.isArray(finding.sources)) throw new Error("Invalid saved adversarial finding.");
    for (const citation of finding.drafts) if (!record(citation) || typeof citation.draftId !== "string" || !Number.isInteger(citation.start) || !Number.isInteger(citation.end) || citation.start < 0 || citation.end - citation.start !== citation.quote?.length || typeof citation.quote !== "string") throw new Error("Invalid saved draft citation.");
    for (const citation of finding.sources) if (!record(citation) || typeof citation.evidenceId !== "string" || typeof citation.quote !== "string") throw new Error("Invalid saved source citation.");
  }
  for (const probe of envelope.review.probes) if (!record(probe) || typeof probe.draftId !== "string" || typeof probe.question !== "string") throw new Error("Invalid saved interviewer probe.");
}
function validated(value) {
  if (!record(value) || value.version !== 1) throw new Error("This saved workspace version is not supported. Export or reset it to recover.");
  if (!record(value.inputs) || !record(value.artifacts) || !Array.isArray(value.attempts) || !record(value.sources)) throw new Error("Saved workspace has an invalid structure.");
  value = { ...value, candidate: value.candidate === undefined ? { contextId: null, sourceMode: null, supplements: [] } : value.candidate, reviewHistory: value.reviewHistory === undefined ? [] : value.reviewHistory, reviewAttempts: value.reviewAttempts === undefined ? [] : value.reviewAttempts };
  if (!record(value.candidate) || !(value.candidate.contextId === null || typeof value.candidate.contextId === "string") || ![null, "manual", "application"].includes(value.candidate.sourceMode) || !Array.isArray(value.candidate.supplements) || value.candidate.supplements.length > 12) throw new Error("Invalid candidate context record.");
  for (const fact of value.candidate.supplements) if (!record(fact) || typeof fact.text !== "string" || fact.text.length > 1000 || typeof fact.confirmed !== "boolean") throw new Error("Invalid confirmed supplemental experience.");
  if (!Array.isArray(value.reviewHistory) || value.reviewHistory.length > 12 || !Array.isArray(value.reviewAttempts) || value.reviewAttempts.length > 12) throw new Error("Review history is invalid or full.");
  for (const envelope of value.reviewHistory) validateEnvelope(envelope);
  for (const attempt of value.reviewAttempts) if (!record(attempt) || typeof attempt.status !== "string" || typeof attempt.at !== "string" || typeof attempt.error !== "string" || !(attempt.envelope === null || record(attempt.envelope))) throw new Error("Invalid saved semantic review attempt.");
  const defaults = createInputs();
  for (const [key, expected] of Object.entries(defaults)) {
    if (Array.isArray(expected)) { if (!Array.isArray(value.inputs[key])) throw new Error(`Invalid ${key} list.`); }
    else if (typeof value.inputs[key] !== "string") throw new Error(`Invalid ${key} field.`);
  }
  if (value.inputs.examples.length > 8 || value.inputs.facts.length > 12) throw new Error("Keep up to eight examples and twelve source facts.");
  for (const fact of value.inputs.facts) {
    if (!record(fact) || ["text", "title", "url", "publishedAt", "eventAt"].some((key) => typeof fact[key] !== "string") || typeof fact.confirmed !== "boolean") throw new Error("Invalid source fact.");
  }
  for (const example of value.inputs.examples) {
    if (!record(example) || ["title", "context", "responsibility", "decision", "action", "result", "learning"].some((key) => typeof example[key] !== "string") || typeof example.verified !== "boolean") throw new Error("Invalid example.");
  }
  for (const [id, artifact] of Object.entries(value.artifacts)) {
    if (!STAGE_IDS.has(id) || !record(artifact) || typeof artifact.draft !== "string") throw new Error("Invalid preparation draft.");
    if (artifact.version === undefined) artifact.version = 1;
    if (artifact.contextId === undefined) artifact.contextId = null;
    if (artifact.claimEvidence === undefined) artifact.claimEvidence = [];
    if (artifact.history === undefined) artifact.history = [];
    if (!Number.isInteger(artifact.version) || artifact.version < 1 || !(artifact.contextId === null || typeof artifact.contextId === "string") || !Array.isArray(artifact.claimEvidence) || !Array.isArray(artifact.history) || artifact.history.length > 12) throw new Error("Invalid grounded artifact version/history.");
    for (const claim of artifact.claimEvidence) if (!record(claim) || !Number.isInteger(claim.start) || !Number.isInteger(claim.end) || typeof claim.quote !== "string" || artifact.draft.slice(claim.start, claim.end) !== claim.quote || !Array.isArray(claim.evidenceIds) || claim.evidenceIds.some((id) => typeof id !== "string")) throw new Error("Invalid saved claim evidence.");
    for (const historical of artifact.history) if (!record(historical) || !Number.isInteger(historical.version) || typeof historical.text !== "string" || !(historical.contextId === null || typeof historical.contextId === "string") || !Array.isArray(historical.claimEvidence)) throw new Error("Invalid retained draft version.");
    if (artifact.acceptedBasis !== undefined && typeof artifact.acceptedBasis !== "string") throw new Error("Invalid draft basis.");
    if (artifact.suggestion !== null && artifact.suggestion !== undefined) {
      if (!record(artifact.suggestion) || typeof artifact.suggestion.text !== "string" || typeof artifact.suggestion.basis !== "string") throw new Error("Invalid preparation suggestion.");
      if (artifact.suggestion.missing !== undefined) stringList(artifact.suggestion.missing, "suggestion missing inputs");
    }
  }
  if (!Array.isArray(value.sources.articles)) throw new Error("Invalid research articles.");
  for (const article of value.sources.articles) {
    if (!record(article) || ["title", "summary", "url"].some((key) => typeof article[key] !== "string")) throw new Error("Invalid research article.");
    for (const key of ["id", "source", "date", "publishedAt", "suggestion"]) if (article[key] !== undefined && typeof article[key] !== "string") throw new Error("Invalid research article metadata.");
  }
  if (value.sources.existingPrep !== undefined && (!record(value.sources.existingPrep) || ["about", "why", "questions", "status"].some((key) => typeof value.sources.existingPrep[key] !== "string"))) throw new Error("Invalid existing prep snapshot.");
  for (const attempt of value.attempts) {
    if (!record(attempt) || ["id", "answer", "question"].some((key) => typeof attempt[key] !== "string")) throw new Error("Invalid rehearsal answer.");
    for (const key of ["category", "createdAt", "parentId", "previousAnswer"]) if (attempt[key] !== undefined && typeof attempt[key] !== "string") throw new Error("Invalid rehearsal answer metadata.");
    if (attempt.seconds !== undefined && (!Number.isFinite(attempt.seconds) || attempt.seconds < 0)) throw new Error("Invalid answer duration.");
    if (attempt.review !== undefined && attempt.review !== null) validateReview(attempt.review);
  }
  for (const attempt of value.reviewAttempts) if (attempt.envelope !== null) validateEnvelope(attempt.envelope);
  if (!Number.isInteger(value.revision) || value.revision < 0 || !(value.updatedAt === null || typeof value.updatedAt === "string")) throw new Error("Invalid workspace revision.");
  bounded(value);
  return value;
}
export function serializeWorkspace(workspace) {
  const text = JSON.stringify(validated(workspace), null, 2);
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("Workspace exceeds the 512 KB limit. Export your notes and shorten the draft.");
  return text;
}
export function loadWorkspace(storage, key) {
  let text = null;
  try {
    text = storage.getItem(key);
    if (text === null) return { workspace: createWorkspace(), error: "", corrupt: false };
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("Saved workspace exceeds the 512 KB limit.");
    return { workspace: validated(JSON.parse(text)), error: "", corrupt: false };
  } catch (error) {
    return { workspace: createWorkspace(), error: error?.message || "Could not read this browser's workspace.", corrupt: text !== null, readFailure: text === null, recoveryText: text };
  }
}
export function saveWorkspace(storage, key, workspace) {
  try { storage.setItem(key, serializeWorkspace(workspace)); return { ok: true, error: "" }; }
  catch (error) { return { ok: false, error: error?.message || "Could not save this workspace in this browser." }; }
}
