// The per-session data fan-out /api/copilot/answer needs on every question —
// the submitted résumé/cover letter, the posting description, the employer's
// name/title, and the caller's own "Professional Experience" project pages
// plus their attachment inventory — moved out of
// app/api/copilot/answer/route.js.
//
// WHY THIS IS ITS OWN MODULE: the same reason lib/copilot/answerPrompts.js
// and lib/copilot/answerAids.js were extracted from that exact file earlier —
// see either module's own header. The route was over this project's hard
// 1000-line limit, and this band of it is a self-contained cache-and-fetch
// concern: it takes a Supabase client and a few ids, and returns the raw
// fetch results (résumé/cover letter/posting already length-capped) with no
// dependency on the question, the engine, or anything ranked against either.
//
// AC-V5.2 (Group V record, Evidence E): this fan-out does not change during
// an interview, so it runs through `answerContextCache` (lib/copilot/
// answerSessionCache.js) instead of on every question. A cache miss (first
// question of a session, or a TTL expiry) runs exactly the Promise.all below;
// a hit skips all five Supabase round trips.
//
// AC-V5.2/C7/C8 (Group V architecture doc): `answerContextCache` is IMPORTED
// here, not instantiated — it is a module-scope singleton in
// answerSessionCache.js, and six route test files call `.clear()` on that
// exact instance between cases. Do not create a second cache here.
//
// WHAT THIS CACHE MUST NEVER HOLD (answerSessionCache.js's own header states
// this as the single most likely way to get it wrong): the knowledge-base
// block, the selected story, or the grounding flags. Those are ranked/scored
// against THIS question's text, so they stay in the route, computed fresh on
// every call to `loadAnswerContext` regardless of whether the fetch below hit
// the cache. Only the raw fetch results are cached — see the internal
// `fetchRawContext` below, which is the loader handed to `.get()`, and the
// slicing that happens strictly AFTER `.get()` returns.

import { fetchApplicationDocs, fetchPostingDescription, fetchPostingEmployer } from "@/lib/copilot/applicationDocs";
import { listPages } from "@/lib/supabase/experiencePages";
import { listAttachmentsByPage } from "@/lib/supabase/experienceAttachments";
import { withDerivedKind } from "@/lib/experience/attachments";
import { answerContextCache } from "@/lib/copilot/answerSessionCache";

const MAX_RESUME_CHARS = 12000;
const MAX_COVER_LETTER_CHARS = 6000;
// The posting description is mined for buzzwords only, never interpolated
// into a prompt, so this cap exists purely to bound the keyword extractor's
// work on a pathologically long description.
const MAX_POSTING_CHARS = 20000;

// `${userId}::${applicationId}` — the ONE place this string is formed. The
// route computes it AFTER `supabase.auth.getUser()` has already resolved —
// never before, and never on the caller's access token instead of the id it
// resolved to (see answerSessionCache.js's own header on why
// `auth.getUser()` itself is never the thing being cached). `applicationId`
// may be empty (no posting selected) and is still a real, cacheable key:
// listPages/listAttachmentsByPage are scoped to the user alone and every
// other fetch here short-circuits to empty with no round trip on an empty
// id.
export function answerContextKey(userId, applicationId) {
  return `${userId}::${applicationId}`;
}

// The RAW fan-out, byte-for-byte what route.js ran inline before this move:
// same Promise.all, same 5 members, same order, same
// `fetchApplicationDocs(supabase, { applicationId, userId })` argument shape
// (route.latency.test.js reads `call[1].userId` — a positional change would
// break it). This is the function handed to `answerContextCache.get(...)`,
// so its return value is exactly what gets cached — no caps, no derived
// fields.
async function fetchRawContext(supabase, { applicationId, userId }) {
  const [docs, postingDescription, employer, pagesResult, attachmentsResult] = await Promise.all([
    fetchApplicationDocs(supabase, { applicationId, userId }),
    fetchPostingDescription(supabase, { applicationId, userId }),
    // AC-V4/C8: fetched and cached now so the company-facts search (which
    // needs the employer's name) has it with no extra round trip.
    fetchPostingEmployer(supabase, { applicationId, userId }),
    listPages(supabase, userId),
    listAttachmentsByPage(supabase, userId),
  ]);
  const rawPages = Array.isArray(pagesResult?.pages) ? pagesResult.pages : [];
  // Graft the attachment inventory onto its page — exactly
  // app/api/meeting/insights/route.js:127-131's own pattern, using the same
  // shared withDerivedKind (AC-4.4: no second private copy of the kind
  // derivation). Done HERE, inside the cached loader, because it is a pure
  // function of the two raw query results above and every consumer wants the
  // merged shape — computing it fresh on every cache HIT would just be
  // repeated work with nothing gained.
  const attachmentsByPageId = attachmentsResult.byPageId;
  const pages = rawPages.map((page) => {
    const rows = attachmentsByPageId.get(page?.id) || [];
    if (rows.length === 0) return page;
    return { ...page, attachments: rows.map(withDerivedKind) };
  });
  return { resume: docs.resume, coverLetter: docs.coverLetter, posting: postingDescription, employer, pages };
}

// The route's own entry point. Caches the raw fan-out under `cacheKey` (see
// `answerContextKey` above), then applies the résumé/cover-letter/posting
// caps AFTER `.get()` returns — never inside the cached loader, so the cache
// itself only ever holds the raw fetch results the module header names.
export async function loadAnswerContext(supabase, { userId, applicationId, cacheKey }) {
  const raw = await answerContextCache.get(
    cacheKey,
    () => fetchRawContext(supabase, { applicationId, userId }),
    { now: Date.now() },
  );
  return {
    resume: raw.resume.slice(0, MAX_RESUME_CHARS),
    coverLetter: raw.coverLetter.slice(0, MAX_COVER_LETTER_CHARS),
    posting: raw.posting.slice(0, MAX_POSTING_CHARS),
    employer: raw.employer,
    pages: raw.pages,
  };
}
