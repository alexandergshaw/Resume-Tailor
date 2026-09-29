import { createClient } from "../supabase/client";
import { fetchDocumentVersions } from "../supabase/documentVersions";

// Split out of app/hooks/useDocumentPreview.js (N68/L4) so that hook's two
// new backgrounded-persistence methods (reloadVersionsForPosition,
// notePersistFailure) have room under its line ceiling
// (useDocumentPreview.wiring.test.js) -- imported back there, not
// duplicated.

// Resolve the position row backing a tracked job's external id. Returns null
// (never throws) when signed out or the job has no position row yet -- both
// are normal, unremarkable states here (AC-7), not errors.
export async function resolvePositionId(currentUser, jobId) {
  if (!currentUser?.id || !jobId) return null;
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("positions")
      .select("id")
      .eq("external_id", String(jobId))
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

// Fetch each scope's version history for an already-resolved position row.
export async function fetchVersionScopes(positionId, scopesToLoad) {
  const supabase = createClient();
  return Promise.all(scopesToLoad.map((s) => fetchDocumentVersions(supabase, s, positionId)));
}
