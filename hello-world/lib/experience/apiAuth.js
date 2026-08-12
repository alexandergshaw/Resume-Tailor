// Auth + error-response helpers for the experience API routes. Deliberately
// NOT a re-export of tailor-lite/library/apiSupport.js: that module imports
// seed.js and loadLibrary.js at load time (coupling this feature to the
// tailoring engine) and its makeCrudHandlers bumps tailor_profile's
// library_version on every write, which has no meaning here.

import { createClient } from "@/lib/supabase/server";

export async function getAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, userId: user?.id || null };
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function badRequest(message) {
  return Response.json({ error: message || "Bad request" }, { status: 400 });
}

export function notFound(message) {
  return Response.json({ error: message || "Not found" }, { status: 404 });
}
