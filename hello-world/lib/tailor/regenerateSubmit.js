// N104 - the browser half of "regenerate to address weaknesses": it posts the Ideal
// tailor request again, this time carrying the run it improves on, so the server
// can re-review against the same requirement ids and compare the two reviews.
//
//   appendRegenerateFields(formData, { pinnedAnalysis, beforeReview })
//   submitRegenerate({ formData, pinnedAnalysis, beforeReview, fetchImpl? }) -> body
//   runRegenerate(request) -> { regenerated, closure, confirm, genuinelyUnqualified }
//
// The two fields are what readRegenerateFields (the server's reader) takes back:
//   pinnedAnalysis  the posting analysis the on-screen run was scored against, whole
//   beforeReview    the review of the text on screen, reduced to the fields the
//                   comparison reads (its flags, its unsupported requirements, its
//                   line count)
// The pin is all-or-nothing: an invalid or over-long one throws BEFORE anything is
// posted, because cutting a requirement would change the review and a request the
// server cannot pin would only produce a first-time generation. A refused or failed
// response rejects, so a caller never mistakes it for a result.
//
// `runRegenerate` builds the base request itself and always asks for the Ideal mode
// directly (never through the level slider's mapping, which can turn the mode into a
// standard run): a standard run is the ungated route, and the regenerate must never
// reach it. A response that carries no closure report is not a regenerate and is
// rejected rather than applied.

import { isValidPinnedAnalysis } from "@/lib/llm/ideal/pinnedAnalysis";
import { buildTemplateLinesForUpload } from "@/lib/document/docx";
import { shippedFlags } from "@/lib/review/gapIdentity";
import { TAILOR_MODE_IDEAL } from "./tailorLevel.js";

// The server reader rejects a field longer than this (regenerateRequest.js); the
// client refuses first so an over-long request is never sent.
const MAX_FIELD_CHARS = 150000;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// The review as the comparison reads it. Hypothetical-draft flags describe a file
// that is not sent, so they are left behind; the line text a flag was quoted from is
// never needed.
function reviewForRequest(review) {
  return {
    status: "reviewed",
    flags: shippedFlags(review).map((flag) => ({
      draftKind: flag.draftKind,
      spanId: flag.spanId,
      category: flag.category,
      message: flag.message,
      evidenceRef: flag.evidenceRef,
    })),
    unresolvedQualifications: (Array.isArray(review?.unresolvedQualifications) ? review.unresolvedQualifications : []).map((entry) => ({
      requirementId: entry?.requirementId,
      text: entry?.text,
    })),
    ...(Number.isFinite(review?.lineCount) ? { lineCount: review.lineCount } : {}),
  };
}

export function appendRegenerateFields(formData, { pinnedAnalysis, beforeReview } = {}) {
  if (!isValidPinnedAnalysis(pinnedAnalysis)) {
    throw new Error("The regenerate needs the posting analysis of the version on screen.");
  }
  if (!isObject(beforeReview)) throw new Error("The regenerate needs the review of the version on screen.");
  const pin = JSON.stringify(pinnedAnalysis);
  const review = JSON.stringify(reviewForRequest(beforeReview));
  if (pin.length > MAX_FIELD_CHARS || review.length > MAX_FIELD_CHARS) {
    throw new Error("The version on screen is too large to regenerate against.");
  }
  formData.append("pinnedAnalysis", pin);
  formData.append("beforeReview", review);
}

export async function submitRegenerate({ formData, pinnedAnalysis, beforeReview, fetchImpl } = {}) {
  appendRegenerateFields(formData, { pinnedAnalysis, beforeReview });
  const post = fetchImpl ?? globalThis.fetch;
  const response = await post("/api/tailor", { method: "POST", body: formData });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || "The regenerate could not finish.");
  return body;
}

// The Ideal request the modal sends for a regenerate: the posting, the user's resume
// and the engine, the same inputs a first run takes.
//
//   request = { posting, url, resumeFile, engine, additionalContext, contextFiles,
//               pinnedAnalysis, beforeReview }
async function baseFormData(request) {
  const formData = new FormData();
  if (request.posting) formData.append("jobPosting", request.posting);
  else formData.append("jobPostingUrl", request.url || "");
  formData.append("additionalContext", request.additionalContext || "");
  formData.append("tailorMode", TAILOR_MODE_IDEAL);
  formData.append("engine", request.engine);
  const templateLines = await buildTemplateLinesForUpload(request.resumeFile);
  formData.append("templateLines", JSON.stringify(templateLines));
  for (const file of request.contextFiles || []) formData.append("contextFiles", file);
  formData.append("resume", request.resumeFile);
  return formData;
}

export async function runRegenerate(request) {
  if (!request?.resumeFile) throw new Error("Upload a resume first to regenerate it.");
  if (!request.posting && !request.url) throw new Error("Couldn't find the job posting to regenerate against.");
  const body = await submitRegenerate({
    formData: await baseFormData(request),
    pinnedAnalysis: request.pinnedAnalysis,
    beforeReview: request.beforeReview,
  });
  if (!isObject(body?.closure) || !isObject(body.ideal) || !Array.isArray(body.resultLines)) {
    throw new Error("The response was not a regenerated resume.");
  }
  const { closure, confirm, genuinelyUnqualified, ...regenerated } = body;
  return { regenerated, closure, confirm, genuinelyUnqualified };
}
