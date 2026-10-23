import { levelAriaValueText, IDEAL_STOP } from "@/lib/tailor/tailorLevel";

export function canonicalJSON(value) {
  const visit = (entry) => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry && typeof entry === "object" && Object.getPrototypeOf(entry) === Object.prototype) return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, visit(entry[key])]));
    throw new Error("Only finite plain JSON values can be bound to a context.");
  };
  return JSON.stringify(visit(value));
}
export async function sha256(text) {
  if (typeof text !== "string" || !globalThis.crypto?.subtle) throw new Error("Secure SHA-256 is unavailable. Use a secure browser context.");
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const text = (value) => typeof value === "string" ? value : "";
const numbers = /\b(?:\d+(?:\.\d+)?%?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi;
function subjectWords(value) { return new Set((value.toLowerCase().replace(numbers, "").match(/[a-z]{3,}/g) || []).filter((word) => !["the", "and", "for", "with", "was", "were", "our"].includes(word))); }
function conflictsFor(evidence) {
  const conflicts = [];
  const resume = evidence.filter((item) => item.sourceKind === "resume");
  const cover = evidence.filter((item) => item.sourceKind === "cover");
  for (const left of resume) for (const right of cover) {
    const a = left.quote.match(numbers) || []; const b = right.quote.match(numbers) || [];
    const aw = subjectWords(left.quote); const bw = subjectWords(right.quote);
    const common = [...aw].filter((word) => bw.has(word)).length;
    if (a.length && b.length && a.join(" ").toLowerCase() !== b.join(" ").toLowerCase() && common / Math.max(1, Math.min(aw.size, bw.size)) >= 0.6) {
      conflicts.push({ id: `conflict-${conflicts.length + 1}`, evidenceIds: [left.id, right.id], reason: "Related resume and cover statements contain different numbers/dates. Resolve this source conflict; neither version is assumed true." });
    }
  }
  return conflicts.slice(0, 12);
}
export async function createCandidateContext({ snapshot, job = {}, requestedStrength, supplements = [] }) {
  if (!snapshot || !["application", "manual"].includes(snapshot.mode) || typeof snapshot.accountId !== "string") throw new Error("Candidate sources require an explicit account and source origin.");
  if (["stale", "error"].includes(snapshot.status)) throw new Error("Candidate sources are stale or failed. Reload them before building linked material.");
  const level = Number(requestedStrength?.aggressiveness);
  const mode = requestedStrength?.tailorMode;
  if (!Number.isInteger(level) || level < 1 || level > 5 || !["", "ideal"].includes(mode)) throw new Error("Use the shared standard level 1–5 or its separate Ideal mode.");
  const normalizeDocument = async (raw, kind) => {
    if (!raw || raw.kind !== kind || !["ready", "missing", "error"].includes(raw.state)) throw new Error(`Invalid ${kind} source state.`);
    const origin = snapshot.mode === "manual" ? "manual-user-supplied" : "generated-application-ready";
    if (raw.origin !== origin) throw new Error("Document origin does not match this source mode; hypothetical material is not eligible.");
    if (raw.state !== "ready") return { kind, state: raw.state, origin, documentId: null, contentIdentity: null, text: "", createdAt: null, error: raw.state === "error" ? text(raw.error) || "Document lookup failed" : null };
    if (typeof raw.text !== "string" || !raw.text.trim() || raw.text.length > 24000) throw new Error(`The ${kind} document must contain at most 24,000 characters.`);
    const contentIdentity = `sha256:${await sha256(raw.text)}`;
    if (raw.contentIdentity && raw.contentIdentity !== contentIdentity) throw new Error(`The ${kind} content identity does not match its exact text.`);
    const documentId = snapshot.mode === "manual" ? `manual:${kind}:${contentIdentity.slice(7)}` : raw.documentId;
    if (typeof documentId !== "string" || !documentId) throw new Error(`The application-selected ${kind} version is missing.`);
    return { kind, state: "ready", origin, documentId, contentIdentity, text: raw.text, createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null, error: null };
  };
  const [resume, cover] = await Promise.all([normalizeDocument(snapshot.resume, "resume"), normalizeDocument(snapshot.cover, "cover")]);
  if (resume.text.length + cover.text.length > 48000 || !Array.isArray(supplements) || supplements.length > 12) throw new Error("Candidate source limits exceeded.");
  const normalizedSupplements = [];
  for (const item of supplements) {
    if (!item || typeof item.text !== "string" || item.text.length > 1000 || typeof item.confirmed !== "boolean") throw new Error("Supplemental experience must be explicit text and confirmation.");
    if (!item.text.trim()) continue;
    const id = `supplement:${await sha256(item.text)}`;
    if (!normalizedSupplements.some((entry) => entry.id === id)) normalizedSupplements.push({ id, text: item.text, confirmed: item.confirmed });
  }
  normalizedSupplements.sort((a, b) => a.id.localeCompare(b.id));
  const normalizedJob = { title: text(job.title), company: text(job.company), description: text(job.description) };
  if (normalizedJob.description.length > 8000) throw new Error("Shorten the role description to 8,000 characters for linked review.");
  const evidence = [];
  const addEvidence = async (sourceKind, sourceId, documentId, contentIdentity, sourceText, start, end) => {
    const quote = sourceText.slice(start, end);
    const locator = { sourceKind, sourceId, documentId, contentIdentity, start, end, quote };
    evidence.push({ id: `evidence:${await sha256(canonicalJSON(locator))}`, ...locator });
  };
  for (const document of [resume, cover]) {
    if (document.state !== "ready") continue;
    let count = 0;
    for (const match of document.text.matchAll(/[^\n.!?]+[.!?]?/g)) {
      const left = match[0].search(/\S/); if (left < 0) continue;
      const quote = match[0].trim(); const start = match.index + left;
      await addEvidence(document.kind, document.documentId, document.documentId, document.contentIdentity, document.text, start, Math.min(start + quote.length, start + 4000));
      if (++count >= 24) break;
    }
  }
  for (const item of normalizedSupplements.filter((entry) => entry.confirmed)) await addEvidence("supplement", item.id, null, `sha256:${await sha256(item.text)}`, item.text, 0, item.text.length);
  const context = { schemaVersion: 1, id: "", accountId: snapshot.accountId, applicationId: snapshot.mode === "application" ? snapshot.applicationId : null,
    sourceMode: snapshot.mode, resume, cover, requestedStrength: { aggressiveness: level, tailorMode: mode }, historicalStrength: { resume: null, cover: null },
    job: normalizedJob, supplements: normalizedSupplements, evidence, conflicts: conflictsFor(evidence), missing: [resume, cover].filter((item) => item.state !== "ready").map((item) => `${item.kind}: ${item.state}`), observedAt: text(snapshot.observedAt) };
  const documentIdentity = (document) => ({ kind: document.kind, state: document.state, origin: document.origin, documentId: document.documentId, contentIdentity: document.contentIdentity });
  context.id = `sha256:${await sha256(canonicalJSON({ schemaVersion: 1, accountId: context.accountId, applicationId: context.applicationId, sourceMode: context.sourceMode,
    resume: documentIdentity(resume), cover: documentIdentity(cover), requestedStrength: context.requestedStrength, historicalStrength: context.historicalStrength, job: normalizedJob, supplements: normalizedSupplements }))}`;
  return context;
}
export function candidateSourceText(context) {
  if (!context) return "";
  return context.evidence.map((entry) => `[${entry.id}; ${entry.sourceKind}; ${entry.sourceId}] ${entry.quote}`).join("\n");
}
export function contextStrength(context) {
  const level = context?.requestedStrength?.aggressiveness || 3;
  const mode = context?.requestedStrength?.tailorMode || "";
  return { level, mode, label: levelAriaValueText(mode === "ideal" ? IDEAL_STOP : level) };
}
