import { getAuth, unauthorized, badRequest } from "@/lib/experience/apiAuth";
import { listPages, applyMoves } from "@/lib/supabase/experiencePages";
import { canMove, moveNode } from "@/lib/experience/tree";

export const runtime = "nodejs";

// Body: { id, newParentId, newIndex }. `newParentId` MUST be present as a
// key, even when its value is null — a caller that omits it entirely gets a
// 400 rather than silently landing at the top level, because a dropped key
// is exactly the failure mode this rule exists to catch.
//
// `id` (and `newParentId`, when not null) are resolved against this caller's
// own rows only, so a page — or a destination — the caller does not own
// comes back as the tree layer's own "unknown-page"/"unknown-parent" reason,
// never reaching the store.
export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  if (!body || !Object.prototype.hasOwnProperty.call(body, "newParentId")) {
    return badRequest("newParentId is required.");
  }

  const { pages, error } = await listPages(supabase, userId);
  if (error) return Response.json({ error }, { status: 500 });

  const check = canMove(pages || [], { id: body.id, newParentId: body.newParentId });
  if (!check.ok) {
    return Response.json(
      { error: `That page cannot be moved there (${check.reason}).`, reason: check.reason },
      { status: 400 },
    );
  }

  const updates = moveNode(pages || [], {
    id: body.id,
    newParentId: body.newParentId,
    newIndex: body.newIndex,
  });

  const { error: moveError } = await applyMoves(supabase, userId, updates);
  if (moveError) return Response.json({ error: moveError }, { status: 500 });

  // Re-read the caller's full page list rather than answering with
  // applyMoves' own return value. applyMoves only reports back the rows it
  // actually updated - zero for a no-op move, a subset for most moves - and
  // useExperiencePages.js's movePage treats whatever `pages` this route
  // sends back as the client's complete, authoritative state. Answering
  // with the partial set truncates or (for a no-op move) empties the
  // caller's view of every other page, even though the database itself was
  // never at risk. This is deliberately re-fetched here, not reconciled by
  // the client: the server is the only side that knows the true state,
  // including any change concurrent with this very request.
  const { pages: freshPages, error: reloadError } = await listPages(supabase, userId);
  if (reloadError) return Response.json({ error: reloadError }, { status: 500 });
  return Response.json({ pages: freshPages || [] });
}
