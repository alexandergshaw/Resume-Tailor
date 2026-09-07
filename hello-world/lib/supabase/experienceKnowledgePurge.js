// The half of the owner's purge ruling that no database can do.
//
// THE RULING: deleting a knowledge page invalidates every stored summary and
// every stored answer whose scope CONTAINED it.
//
// WHAT THE SCHEMA ALREADY DOES, and this module therefore does not.
// supabase/migrations/20260906010000_experience_knowledge.sql puts
// `foreign key (user_id, scope_page_id) references public.experience_pages
// (user_id, id) on delete cascade` on BOTH new tables. Deleting a page P
// therefore removes every summary and question row whose scope_page_id = P,
// AND - because 20260812000000_experience_pages.sql's own self-referencing FK
// already cascades a page delete across the whole subtree - every row scoped
// to any DESCENDANT of P as well, transitively, for free.
//
// WHAT NO CASCADE CAN REACH, EVER, and this module exists for. An ANCESTOR
// scope. A row scoped to P's parent, P's grandparent, or the root
// (scope_page_id IS NULL) carries a scope_page_id naming the ANCESTOR, not P.
// Deleting P touches no column any such row's FK points at, so no
// ON DELETE CASCADE, no ON DELETE SET NULL and no trigger declared on P's own
// row can ever fire for it. A database-level cascade cannot express "purge
// every row whose recorded subtree, computed at generation time, happened to
// contain the page just deleted" - that is a membership question about the
// TREE, which lives in application code. The root scope is the extreme case:
// it has no scope_page_id at all, so no page delete at any depth can reach it
// through the schema, which is why the walk below ALWAYS ends at it.
//
// The migration's header states this boundary in those terms and names the
// page-delete path as the layer that must close it. This module is that layer;
// app/api/experience/pages/[id]/route.js is its only caller.
//
// WHY EVERY ANCESTOR, WITH NO CHECK OF WHAT IT ACTUALLY COVERED. An ancestor's
// scope is "that page and everything beneath it", so by construction it
// contained the deleted page - there is nothing to look up and no
// `source_pages` array to consult. Reading one would also be wrong: a summary
// written BEFORE the deleted page existed still describes a scope that now
// contains it, and would be regenerated to include it on the next run.
//
// NOTHING HERE THROWS - the same contract as every other module in this
// directory. A failed purge is data the caller logs and reports, never an
// exception that could take a page delete down with it.

import { breadcrumb } from "@/lib/experience/tree";
import { scopeKeyFor } from "@/lib/experience/knowledgeScope";
import { SUMMARY_TABLE, clearQuestions } from "./experienceKnowledge";

/**
 * ancestorScopePageIds(pages, pageId) -> (string|null)[]
 *
 * Every STRICT ancestor of `pageId`, nearest first, then `null` for the
 * whole-knowledge-base scope. Pure; `pages` is the flat row list.
 *
 * The deleted page's own id is deliberately ABSENT: that scope is the FK
 * cascade's, and re-deleting it here would mask a cascade that had stopped
 * firing. Descendants are absent for the same reason - and because a walk in
 * the wrong direction looks identical on a leaf page.
 *
 * `null` is ALWAYS the last element, including for a top-level page and
 * including for an id this list does not contain. That last case is not
 * defensive padding: `listPages` has no `.limit()`, so a read that hit
 * PostgREST's db-max-rows returns a PREFIX, and a page that genuinely exists
 * can simply be missing from `pages`. Purging the root scope is the correct
 * conservative move there, and it costs one regenerable summary.
 *
 * `breadcrumb` is cycle-safe (it carries its own `visited` set), so a
 * corrupted parent chain terminates rather than hanging.
 */
export function ancestorScopePageIds(pages, pageId) {
  const list = Array.isArray(pages) ? pages : [];
  const path = typeof pageId === "string" && pageId !== "" ? breadcrumb(list, pageId) : [];
  const ancestors = path
    .slice(0, -1)
    .map((crumb) => crumb.id)
    .reverse();
  return [...ancestors, null];
}

// One scope's summary row. No try/catch of its own, deliberately: a client
// that throws must reach purgeAncestorScopes' own catch, which is the only
// place that can honestly say the walk did not complete.
async function deleteSummaryForScope(supabase, userId, scopeKey) {
  const { data, error } = await supabase
    .from(SUMMARY_TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("scope_key", scopeKey)
    .select("id");
  if (error) return { deleted: 0, error: error.message || "Could not clear this summary." };
  return { deleted: Array.isArray(data) ? data.length : 0, error: null };
}

/**
 * purgeAncestorScopes(supabase, userId, { pages, pageId })
 *   -> { scopeKeys, summariesDeleted, questionsDeleted, error }
 *
 * BEST EFFORT, ON PURPOSE. One scope's failure does not stop the rest:
 * stopping at the first error would leave strictly MORE stale rows than
 * continuing, and the caller's only lever is to log. The first error is
 * reported; later ones are not repaired and not stacked.
 *
 * `scopeKeys` is the set this call actually walked. It comes back EMPTY when
 * the client itself threw, because at that point no claim about what was
 * purged can be made.
 *
 * Tenancy is enforced twice over on every statement: RLS, and an explicit
 * `.eq("user_id", userId)` - which is also why a missing userId refuses the
 * whole call rather than issuing an unscoped DELETE.
 */
export async function purgeAncestorScopes(supabase, userId, { pages, pageId } = {}) {
  if (typeof userId !== "string" || userId === "") {
    return { scopeKeys: [], summariesDeleted: 0, questionsDeleted: 0, error: "Missing user id." };
  }

  const scopeKeys = ancestorScopePageIds(pages, pageId).map((id) => scopeKeyFor(id));
  let summariesDeleted = 0;
  let questionsDeleted = 0;
  let error = null;

  try {
    for (const scopeKey of scopeKeys) {
      const summary = await deleteSummaryForScope(supabase, userId, scopeKey);
      if (summary.error) error = error || summary.error;
      else summariesDeleted += summary.deleted;

      // The Wave 4 primitive, unchanged: it already scopes by user_id, already
      // reads its own RETURNING projection for the count, and already never
      // throws. A second copy here would be a second place for the delete's
      // filters to drift.
      const questions = await clearQuestions(supabase, userId, scopeKey);
      if (questions.error) error = error || questions.error;
      else questionsDeleted += questions.cleared;
    }
  } catch (err) {
    return {
      scopeKeys: [],
      summariesDeleted: 0,
      questionsDeleted: 0,
      error: err?.message || "Could not clear the summaries for the pages above this one.",
    };
  }

  return { scopeKeys, summariesDeleted, questionsDeleted, error };
}
