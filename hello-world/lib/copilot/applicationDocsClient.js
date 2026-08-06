// Browser-side loader for the résumé and cover letter actually submitted for
// one tracked application — what the "Submitted for this application" panel
// (app/copilot/SubmittedDocs.js, via app/copilot/useApplicationDocs.js) loads
// the moment a posting is selected, in both live and practice mode.
//
// Creates the browser Supabase client and resolves the signed-in user, then
// delegates the actual query to the EXISTING, isomorphic
// fetchApplicationDocs(supabase, { applicationId, userId }) in
// lib/copilot/applicationDocs.js rather than duplicating it — that module
// already takes the client as a parameter and already never throws for a
// missing application, a missing document id, or a query error; it degrades
// those to empty strings on its own.
//
// The error contract here mirrors lib/copilot/postings.js's
// fetchPracticePostings: no signed-in user degrades to empty documents
// (never throws for that case), while an auth lookup failure throws a plain
// Error so the caller can tell "you have nothing submitted" apart from "the
// load itself failed" and offer a retry for the latter.

import { createClient } from "@/lib/supabase/client";
import { fetchApplicationDocs } from "./applicationDocs";

const EMPTY_DOCS = { resume: "", coverLetter: "" };

export async function loadApplicationDocs(applicationId) {
  // Mirrors fetchApplicationDocs's own guard — no applicationId means no
  // query is possible, so this returns before even resolving the user.
  if (!applicationId) return EMPTY_DOCS;

  const supabase = createClient();
  const {
    data: { user } = {},
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    throw new Error(userError.message);
  }
  if (!user?.id) return EMPTY_DOCS;

  return fetchApplicationDocs(supabase, { applicationId, userId: user.id });
}
