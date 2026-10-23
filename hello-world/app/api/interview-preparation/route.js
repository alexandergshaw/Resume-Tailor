import { randomUUID } from "node:crypto";
import { getAuth } from "@/lib/experience/apiAuth";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { loadCandidateSources } from "@/lib/interviewPreparation/candidateContextStore";
import { createCandidateContext, sha256 } from "@/lib/interviewPreparation/candidateContext";
import { createReviewTarget, validateReviewResult } from "@/lib/interviewPreparation/reviewContract";
import { buildReviewPrompt } from "@/lib/interviewPreparation/reviewPrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const limiter = createRateLimiter({ limit: 6, windowMs: 600000, prefix: "interview-preparation-review" });
const inFlight = new Map(); // Per instance, not a fleet-wide spending guarantee.
const BODY_LIMIT = 128 * 1024;
const WATCHDOG_MS = 45000;
function response(status, error, state = "error", extra = {}, headers = {}) {
  return Response.json({ status: state, error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
const validId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function sizedString(value, maximum) { return typeof value === "string" && value.length <= maximum; }
async function readBody(request) {
  if (Number(request.headers.get("content-length")) > BODY_LIMIT) throw Object.assign(new Error("Review request is too large. Shorten the materials."), { httpStatus: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A review request body is required.");
  const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) { await reader.cancel(); throw Object.assign(new Error("Review request is too large. Shorten the materials."), { httpStatus: 413 }); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function validateBody(body) {
  if (!object(body) || body.action !== "review" || !["application", "manual"].includes(body.sourceMode)) throw new Error("Invalid review action or source mode.");
  if (body.engine != null && !["embedded", "gemini", "external"].includes(body.engine)) throw new Error("Unsupported review engine.");
  if (!sizedString(body.expectedContextId, 80) || !/^sha256:[a-f0-9]{64}$/.test(body.expectedContextId)) throw new Error("A current context identity is required.");
  const strength = body.requestedStrength;
  if (!object(strength) || !Number.isInteger(strength.aggressiveness) || strength.aggressiveness < 1 || strength.aggressiveness > 5 || !["", "ideal"].includes(strength.tailorMode)) throw new Error("Choose a valid current tailoring strength.");
  if (!object(body.job) || !sizedString(body.job.title, 1000) || !sizedString(body.job.company, 1000) || !sizedString(body.job.description, 8000)) throw Object.assign(new Error("Job information is invalid or exceeds the review limit."), { httpStatus: 413 });
  if (!Array.isArray(body.supplements) || body.supplements.length > 12 || body.supplements.some(s => !object(s) || !sizedString(s.text, 1000) || typeof s.confirmed !== "boolean")) throw Object.assign(new Error("Supplemental experience is invalid or exceeds the review limit."), { httpStatus: 413 });
  if (!Array.isArray(body.bundle) || !body.bundle.length || body.bundle.length > 12) throw new Error("Review requires one to twelve drafts.");
  let total = 0;
  for (const draft of body.bundle) {
    if (!object(draft) || !sizedString(draft.text, 12000)) throw Object.assign(new Error("A draft is invalid or exceeds the review limit."), { httpStatus: 413 });
    total += draft.text.length;
  }
  if (total > 24000) throw Object.assign(new Error("Shorten the bundle to 24,000 characters before review."), { httpStatus: 413 });
  if (body.sourceMode === "application") {
    if (!validId(body.applicationId) || body.manualDocuments != null) throw new Error("Choose an application without manual replacement documents.");
  } else {
    if (body.applicationId != null || !object(body.manualDocuments)) throw new Error("Manual review requires supplied documents and no application.");
    if (!sizedString(body.manualDocuments.resume, 24000) || !sizedString(body.manualDocuments.cover, 24000)) throw Object.assign(new Error("Supplied documents exceed the review limit."), { httpStatus: 413 });
  }
}
async function manualSnapshot(userId, documents) {
  async function doc(kind, text) {
    if (!text.trim()) return { kind, state: "missing", origin: "manual-user-supplied", documentId: null, contentIdentity: null, text: "", createdAt: null, error: null };
    const hash = await sha256(text);
    return { kind, state: "ready", origin: "manual-user-supplied", documentId: `manual:${kind}:${hash}`, contentIdentity: `sha256:${hash}`, text, createdAt: null, error: null };
  }
  const [resume, cover] = await Promise.all([doc("resume", documents.resume), doc("cover", documents.cover)]);
  return { accountId: userId, applicationId: null, mode: "manual", status: resume.state === "ready" && cover.state === "ready" ? "ready" : "partial", resume, cover,
    observedAt: new Date().toISOString(), consistency: "manual-captured", historicalStrength: { resume: null, cover: null } };
}
function sourceFailure(snapshot) {
  if (snapshot.status === "stale") return response(409, snapshot.error || "Application documents changed while loading. Reload sources.", "stale");
  if (snapshot.code === "not-found") return response(404, "Application not found.");
  if (snapshot.status === "error") return response(500, snapshot.error || "Application sources could not be loaded.");
  return null;
}
export async function GET(request) {
  try {
    const { supabase, userId } = await getAuth();
    if (!userId) return response(401, "Unauthorized");
    const applicationId = new URL(request.url).searchParams.get("applicationId");
    if (!validId(applicationId)) return response(400, "A valid application ID is required.");
    const snapshot = await loadCandidateSources(supabase, { userId, applicationId });
    return sourceFailure(snapshot) || Response.json({ status: snapshot.status, snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch { return response(500, "Application sources could not be loaded. Try again."); }
}
export async function POST(request) {
  let auth;
  try { auth = await getAuth(); } catch { return response(503, "Authentication is temporarily unavailable. Draft retained."); }
  const { supabase, userId } = auth;
  if (!userId) return response(401, "Unauthorized");
  let body;
  try { body = await readBody(request); validateBody(body); }
  catch (error) { return response(error.httpStatus || 400, error instanceof SyntaxError ? "Invalid review JSON." : error.message); }
  const decision = await limiter.check(identify(request, { userId }));
  if (!decision.allowed) return response(429, "Too many review attempts. Wait and try again. Draft retained.", "error", {}, rateLimitHeaders(decision));
  if (inFlight.has(userId)) return response(429, "A review is still running. Wait for it to settle before trying again.");
  if (wantsEmbedded(body.engine)) return response(503, "Independent semantic review is unavailable on Embedded. Draft retained.", "unavailable");
  let env;
  try { env = getServerEnv(); } catch { return response(503, "Independent semantic review is not configured. Draft retained.", "unavailable"); }
  const lease = Symbol("review"); inFlight.set(userId, lease);
  let releaseOnReturn = true;
  const release = () => { if (inFlight.get(userId) === lease) inFlight.delete(userId); };
  try {
    const snapshot = body.sourceMode === "manual" ? await manualSnapshot(userId, body.manualDocuments) : await loadCandidateSources(supabase, { userId, applicationId: body.applicationId });
    const failure = sourceFailure(snapshot); if (failure) return failure;
    if (snapshot.resume.state !== "ready" || snapshot.cover.state !== "ready") return response(422, "Both resume and cover letter are needed for independent review. Draft retained.");
    if (snapshot.resume.text.length > 24000 || snapshot.cover.text.length > 24000) return response(413, "Selected documents exceed review limits. Draft retained.");
    const contextInput = { snapshot, job: body.job, requestedStrength: body.requestedStrength, supplements: body.supplements };
    let context, target;
    try { context = await createCandidateContext(contextInput); target = await createReviewTarget(context, body.bundle); }
    catch { return response(400, "Review context, evidence or draft locators are invalid."); }
    if (context.id !== body.expectedContextId) return response(409, "Preparation sources or settings changed. Reload and review again.", "stale");
    const prompt = buildReviewPrompt({ context, bundle: body.bundle, target });
    const controller = new AbortController();
    const host = { invocationId: randomUUID(), authorContextId: `deterministic-author:${target.bundleId}`, reviewerContextId: randomUUID(), role: "adversarial-reviewer",
      provider: "gemini", requestedModel: env.geminiModel, observedModel: null, separateInvocation: true, createdAt: null };
    // Keep the lease through underlying settlement. Abort is not proof of provider termination.
    const call = Promise.resolve().then(() => getGeminiClient().models.generateContent({ model: env.geminiModel,
      contents: prompt.contents, config: { systemInstruction: prompt.systemInstruction, responseMimeType: "application/json",
        abortSignal: controller.signal, httpOptions: { timeout: WATCHDOG_MS, retryOptions: { attempts: 1 } } } }));
    let timer;
    const settled = call.then(value => ({ value }), () => ({ failed: true }));
    let outcome;
    try { outcome = await Promise.race([settled, new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), WATCHDOG_MS); })]); }
    finally { clearTimeout(timer); }
    if (outcome.timedOut) {
      controller.abort(); releaseOnReturn = false; void settled.then(release);
      return response(504, "Independent review timed out. Draft retained. The provider request may still be settling.");
    }
    if (outcome.failed) return response(502, "Independent review failed. Draft retained; retry explicitly.");
    const rawText = outcome.value?.text;
    if (typeof rawText !== "string" || rawText.length > 128000) return response(502, "Independent review returned unusable content. Draft retained.");
    const checked = validateReviewResult(parseModelJson(rawText), { context, bundle: body.bundle });
    if (!checked.ok) return response(502, "Independent review returned invalid findings or citations. Draft retained.");
    host.observedModel = typeof outcome.value.modelVersion === "string" ? outcome.value.modelVersion : null;
    host.createdAt = new Date().toISOString();
    const envelope = { schemaVersion: 1, contextId: context.id, bundleId: target.bundleId, host, review: checked.value };
    if (body.sourceMode === "application") {
      const refreshed = await loadCandidateSources(supabase, { userId, applicationId: body.applicationId });
      let current = null;
      if (["ready", "partial"].includes(refreshed.status)) {
        try { current = await createCandidateContext({ ...contextInput, snapshot: refreshed }); } catch { /* fail stale below */ }
      }
      if (current?.id !== context.id) return response(409, "Application sources changed during review. Reload and review again.", "stale", { historicalEnvelope: envelope });
    }
    return Response.json({ status: "reviewed", envelope }, { headers: { "Cache-Control": "no-store" } });
  } catch { return response(502, "Independent review could not complete. Draft retained."); }
  finally { if (releaseOnReturn) release(); }
}
