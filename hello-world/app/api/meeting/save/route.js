import { getAuth, unauthorized, badRequest } from "@/lib/experience/apiAuth";
import { createPage, updatePage } from "@/lib/supabase/experiencePages";

export const runtime = "nodejs";

// Saves a finished (or in-progress) meeting as an ordinary Experience page.
// The client has already built `title` and `body` — this route's own job is
// exactly app/api/experience/research/route.js's create-then-update
// sequence (createPage has no `body` field on insert; updatePage is the only
// place that can set it) and nothing more.

const MAX_TITLE_CHARS = 300;
// Generous: a meeting body is a running transcript-derived write-up, not a
// short note — this only exists as a hard backstop against a pathological
// request, not a realistic ceiling. Matches the order of magnitude
// lib/copilot/projectStories.js's own MAX_STORIES_CHARS budgets a single
// page at.
const MAX_BODY_CHARS = 100000;

export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, MAX_TITLE_CHARS) : "";
  const pageBody = typeof body?.body === "string" ? body.body.slice(0, MAX_BODY_CHARS) : "";
  if (!title) return badRequest("Missing title.");

  // A plain, clear message the client can retry on — createPage/updatePage
  // never throw (lib/supabase/experiencePages.js's own contract: every
  // failure comes back as { error } data, not an exception), so both of
  // these are genuine "the write didn't happen" cases, not a bug in this
  // route, and worth telling the user to just try again.
  const { page: created, error: createError } = await createPage(supabase, userId, { title, parentId: null });
  if (createError) return Response.json({ error: createError }, { status: 500 });
  if (!created) return Response.json({ error: "Could not create the meeting page. Please try again." }, { status: 500 });

  const { page: saved, error: saveError } = await updatePage(supabase, userId, created.id, { body: pageBody });
  if (saveError) return Response.json({ error: saveError }, { status: 500 });

  // Deliberately NOT setting generated_kind/generated_at, unlike
  // app/api/experience/research/route.js's own create-then-update sequence,
  // which this route otherwise mirrors closely. That is not an oversight —
  // it is the one decision in this file worth spelling out:
  //
  // The research route marks its output `generated_kind: "research"`
  // because a research report IS a model's claims about the industry, and
  // both lib/copilot/projectStories.js and lib/experience/tailorSources.js
  // deliberately exclude ANY page with generated_kind set from résumé
  // tailoring and interview-copilot material — exactly so a model's own
  // invented claims can never get replayed as the candidate's lived
  // experience.
  //
  // A recorded meeting is not that. The user directed that a meeting they
  // actually sat in — transcribed, then saved as a page — IS their own
  // experience, the same way lib/meeting/meetingContext.js's own eligibility
  // rule already treats it (archived-or-not, and nothing else: a meeting
  // page is ordinary material like any other page in the tree, not
  // second-class because of how it was created). Setting generated_kind
  // here would not break anything visibly — the page would still save, still
  // render, still look normal — it would just silently vanish from exactly
  // the two features a recorded meeting exists to feed: tailoring a résumé
  // to a real project just discussed, and drawing on it in a future
  // interview. That failure mode has no error message and no test would
  // catch it from this route alone, which is exactly why it is written out
  // here instead of left to be rediscovered.
  return Response.json({ page: saved || created });
}
