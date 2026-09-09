// THE SHARED REQUEST PROLOGUE for copilot routes that ground in a tracked
// application.
//
// WHY THIS EXISTS AT ALL, and it is not tidiness. The answer context cache is
// keyed `${userId}::${applicationId}` (answerContext.js), off a value the
// answer route normalises by trimming and capping. A second route that writes
// `String(body.applicationId)`, or drops the trim, or omits the cap, computes
// a DIFFERENT key for the same posting. Nothing looks broken: the expansion
// endpoint simply misses the cache forever and pays a full Supabase fan-out
// every time, which is seven round trips, so five expansions of one answer
// cost thirty-five queries instead of zero.
//
// The structural fix would be for the answer route to call this too. This
// chunk is not permitted to modify that file, so the guarantee is the next
// best mechanical one instead of a comment: this module owns the
// normalisation, and answerRequestPrologue.test.js READS the answer route's
// source and fails the moment its normalisation stops matching.
//
// ONE DELIBERATE DIFFERENCE FROM THE ROUTE, and it is a tightening. The answer
// route writes `(body?.applicationId ?? "").toString()`, which turns an object
// into "[object Object]" and caches under it. This module refuses a non-string
// instead of coercing one, which is the posture questionVocabulary.js takes
// and the one a newer route should start from. The normalised RESULT for every
// legitimate string input is identical, so the cache key still matches.

import { MAX_QUESTION_CHARS } from "./questionVocabulary.js";
import { normalizeInterviewType } from "./interviewTypes.js";
import { normalizeCodeLanguageChoice } from "./codeLanguages.js";

// Both mirrored from app/api/copilot/answer/route.js, and both pinned against
// that file by this module's drift test rather than trusted.
export const MAX_APPLICATION_ID_CHARS = 100;
export const MAX_PROFILE_CHARS = 8000;

function str(value) {
  return typeof value === "string" ? value : "";
}

/**
 * The scalars every grounded copilot request carries, normalised once.
 *
 * NOTE WHAT IS NOT HERE: no resume, no cover letter, no page bodies, no
 * posting. The answer route fetches its documents itself from `applicationId`
 * and never reads a client-supplied one, so a client cannot inject arbitrary
 * text labelled "submitted resume" into a prompt. This function returns
 * exactly five fields and has no slot for grounding, which is a stronger
 * guarantee than a route that merely happens not to read one today.
 *
 * Total by construction: never throws, whatever it is handed.
 */
export function answerRequestFields(body) {
  const source = body && typeof body === "object" ? body : {};
  return {
    question: str(source.question).trim().slice(0, MAX_QUESTION_CHARS),
    profile: str(source.profile).slice(0, MAX_PROFILE_CHARS),
    interviewType: normalizeInterviewType(source.interviewType),
    codeLanguage: normalizeCodeLanguageChoice(source.codeLanguage),
    applicationId: str(source.applicationId).trim().slice(0, MAX_APPLICATION_ID_CHARS),
  };
}
