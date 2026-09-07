import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { listPages, updatePage, deletePage } from "@/lib/supabase/experiencePages";
import { purgeAncestorScopes } from "@/lib/supabase/experienceKnowledgePurge";

export const runtime = "nodejs";

// Body: { title?, body? }. 404 when the page is not the caller's own — the
// data layer scopes the update by user_id, so a page belonging to someone
// else is indistinguishable from one that does not exist.
export async function PATCH(request, { params }) {
  const { id } = await params;
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { page, error } = await updatePage(supabase, userId, id, {
    title: body?.title,
    body: body?.body,
  });
  if (error) return Response.json({ error }, { status: 500 });
  if (!page) return notFound("That page could not be found.");
  return Response.json({ page });
}

// The ONE server path every page delete goes through - a single delete from
// DeletePageDialog and each iteration of ExperienceTab's bulk delete both land
// here - which is why the knowledge purge lives at this level rather than in
// either caller.
//
// THE PURGE, AND WHY IT IS NOT THE DATABASE'S JOB. The knowledge tables'
// composite FKs cascade a page delete onto that page's own scope and, through
// experience_pages' own self-FK, onto every descendant scope. They cannot
// reach an ANCESTOR scope - an ancestor's row names the ancestor, not the
// deleted page - and they can never reach the root scope, which has no
// scope_page_id at all. supabase/migrations/20260906010000_experience_knowledge.sql's
// header states that boundary and names this route as the layer that closes
// it. lib/supabase/experienceKnowledgePurge.js is that layer.
//
// THREE ORDERING DECISIONS, each of which is a defect the other way round:
//
//  1. THE TREE IS READ FIRST. An ancestor walk needs the deleted page to still
//     be in the tree; after the delete its breadcrumb is unknowable.
//  2. THE PURGE RUNS BEFORE THE DELETE. A crash between the two then leaves a
//     regenerable gap (a summary that has to be written again) rather than
//     model-authored prose about a page that no longer exists. The stated cost
//     is the 404 path below: a delete for a page the caller does not own still
//     purges the caller's OWN root scope, because a page missing from `pages`
//     is indistinguishable from one dropped by a truncated read, and every
//     statement is scoped to the caller's own user_id either way.
//  3. A FAILED PURGE DOES NOT BLOCK THE DELETE. Refusing would turn a
//     derived-data outage into "you cannot delete your own content", which is
//     a worse failure than the one it prevents. It is reported instead - in
//     the response and in the server log - because silence is the third
//     option and the only unacceptable one.
export async function DELETE(_request, { params }) {
  const { id } = await params;
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let knowledgePurgeError = null;
  const { pages, error: listError } = await listPages(supabase, userId);
  if (listError) {
    knowledgePurgeError = listError;
  } else {
    const purge = await purgeAncestorScopes(supabase, userId, { pages, pageId: id });
    if (purge.error) knowledgePurgeError = purge.error;
  }

  const { deleted, error } = await deletePage(supabase, userId, id);
  if (error) return Response.json({ error }, { status: 500 });
  if (!deleted) return notFound("That page could not be found.");

  if (knowledgePurgeError) {
    // Named in the log with its scope so a 2am ticket has something to go on;
    // the message itself is a store error, never a caller-supplied id.
    console.error(`[experience] ancestor knowledge purge failed on page delete: ${knowledgePurgeError}`);
    return Response.json({ ok: true, knowledgePurgeError });
  }
  return Response.json({ ok: true });
}
