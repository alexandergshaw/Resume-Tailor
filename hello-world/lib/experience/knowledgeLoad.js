// The knowledge-page scope summary's own pages+attachments fan-out —
// SERVER-ONLY: this module takes the caller's already-authenticated Supabase
// client and never resolves a session of its own. It is the one place that
// turns the two existing knowledge-base reads (public.experience_pages,
// public.experience_attachments) into the shape
// lib/experience/knowledgeScope.js and lib/experience/knowledgeBase.js
// actually consume.
//
// WHY THIS STEP EXISTS AT ALL — it is absent from the feature's criteria
// entirely. `experience_pages` has no `attachments` column: without grafting
// the attachment inventory onto each page (exactly
// lib/copilot/answerContext.js's `fetchRawContext`, re-read, and
// app/api/meeting/insights/route.js's identical pattern), every page's
// attachment list is permanently empty, `noAttachmentBytesNotice`
// (knowledgeBase.js) never fires because it is gated on `anyAttachmentShown`,
// and a prose-less page that only carries attachments silently classifies as
// "no-material" with no way to see why.
//
// `withDerivedKind` — not a private copy of the mime/name -> kind rule — is
// imported from lib/experience/attachments.js, the same function
// answerContext.js uses, so the label the model is shown here can never
// disagree with the one the attachment panel shows the user.

import { listPages } from "@/lib/supabase/experiencePages";
import { listAttachmentsByPage } from "@/lib/supabase/experienceAttachments";
import { withDerivedKind } from "@/lib/experience/attachments";

// The same table `lib/supabase/experiencePages.js` reads. There is no
// exported head-count helper on that module — every existing consumer has
// wanted the rows, not a count — so this is a second, INDEPENDENT read
// against the identical filter `listPages` uses (`user_id` + `archived_at
// is null`), never a re-use of `pages.length`. That independence is the
// whole point: see `loadScopeInput` below.
const PAGES_TABLE = "experience_pages";

// loadScopeInput(supabase, userId) -> { pages, pageRowCount, truncatedRead, error }.
//
// Runs `listPages`, `listAttachmentsByPage` and an exact head-count of
// `experience_pages` in one `Promise.all`, then grafts each page's
// attachment inventory onto it.
//
// `pageRowCount` IS NOT `pages.length`. It is a genuinely separate
// `.select("id", { count: "exact", head: true })` read (the idiom already at
// lib/supabase/experiencePages.js's `createPage`, re-read), so the retrieval
// chain this feature records does not begin at a number the feature itself
// invented by re-measuring the array it already has. `truncatedRead` is
// `pageRowCount > pages.length` — the ONLY cheap detector available for
// PostgREST's `db-max-rows` silently returning a prefix, which `listPages`
// has no `.limit()` to defend against and which would otherwise let
// `tree.js`'s orphan-promotion reshape the tree with nobody told.
//
// FAILURE SHAPE, DELIBERATELY ASYMMETRIC ACROSS THE THREE READS:
//
//   * `listPages` failing is fatal — without the page list there is no scope
//     to summarise or answer over — and is the ONLY thing that populates the
//     returned `error`, which the route turns into a 500. A failed read is
//     never reported as an empty knowledge base.
//   * The head-count query failing is NOT fatal. It rides alongside the
//     essential read purely to produce a disclosure sentence
//     (`truncatedRead`), and this module's own plan states that signal is
//     "a disclosure, not a hard failure" even for the race it exists to
//     catch — failing a whole view because the ONE extra count query
//     errored would be a worse outcome than just not disclosing a possible
//     truncation this one time. It falls back to `pageRowCount: pages.length`
//     (so `truncatedRead` reads `false`) rather than propagating an error.
//   * `listAttachmentsByPage` failing is NOT fatal either, for the identical
//     reason that module's own header gives its other caller: the pages
//     themselves are the substance, and a caller that can carry on without
//     the attachment inventory is free to. Pages come back with no
//     `attachments` key rather than the whole scope failing to load.
//
// Never throws — every failure inside `Promise.all` is already caught by
// the two `lib/supabase/*` functions it calls, and the raw count query below
// is wrapped in its own try/catch so a synchronous client error cannot
// escape either.
export async function loadScopeInput(supabase, userId) {
  try {
    const [pagesResult, attachmentsResult, countResult] = await Promise.all([
      listPages(supabase, userId),
      listAttachmentsByPage(supabase, userId),
      countPages(supabase, userId),
    ]);

    if (pagesResult.error) {
      return { pages: [], pageRowCount: 0, truncatedRead: false, error: pagesResult.error };
    }

    const rawPages = Array.isArray(pagesResult.pages) ? pagesResult.pages : [];
    const attachmentsByPageId =
      attachmentsResult && attachmentsResult.byPageId instanceof Map ? attachmentsResult.byPageId : new Map();
    const pages = rawPages.map((page) => {
      const rows = attachmentsByPageId.get(page?.id) || [];
      if (rows.length === 0) return page;
      return { ...page, attachments: rows.map(withDerivedKind) };
    });

    const pageRowCount =
      !countResult.error && typeof countResult.count === "number" ? countResult.count : pages.length;
    const truncatedRead = pageRowCount > pages.length;

    return { pages, pageRowCount, truncatedRead, error: null };
  } catch (err) {
    return { pages: [], pageRowCount: 0, truncatedRead: false, error: err?.message || "Could not load your knowledge base." };
  }
}

// The independent head-count read. Never throws — a failure here is folded
// into the non-fatal fallback in `loadScopeInput` above, never surfaced as
// this module's own `error`.
async function countPages(supabase, userId) {
  try {
    const { count, error } = await supabase
      .from(PAGES_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null);
    if (error) return { count: null, error: error.message || "Could not count pages." };
    return { count: typeof count === "number" ? count : null, error: null };
  } catch (err) {
    return { count: null, error: err?.message || "Could not count pages." };
  }
}
