// GET /api/techwatch - the hour-by-hour tech briefing scoped to the
// technologies named on the caller's own Professional Experience pages.
//
// This route is a thin composition of three already-tested layers: auth
// (lib/experience/apiAuth.js), watchlist derivation from the user's pages
// (lib/techwatch/watchlist.js), and collection against the public feeds
// (lib/techwatch/collect.js). It owns none of that logic itself - only the
// HTTP contract: status codes, query parsing, and trimming the watchlist
// down to what the client is allowed to see.

import { getAuth, unauthorized } from "@/lib/experience/apiAuth";
import { listPages } from "@/lib/supabase/experiencePages";
import { deriveWatchlist } from "@/lib/techwatch/watchlist";
import { collectTechWatch } from "@/lib/techwatch/collect";

export const runtime = "nodejs";
// Every caller's briefing depends on their own pages; a shared/edge cache in
// front of this route would serve one user's watchlist to the next.
export const dynamic = "force-dynamic";

const ALLOWED_WINDOW_HOURS = new Set([24, 72, 168]);

// A bad or missing ?windowHours never refuses the request - this is a
// read-only briefing, and "24 hours" is a perfectly good answer to a
// malformed query string.
function parseWindowHours(request) {
  const raw = new URL(request.url).searchParams.get("windowHours");
  const n = Number(raw);
  return ALLOWED_WINDOW_HOURS.has(n) ? n : 24;
}

// The client renders names, not fetch coordinates - `osv`/`eol`/`statuspage`/
// `kev`/`aliases` are internal to the collector and must never leave this
// route. Listed explicitly (not an omit/blacklist) so a new field added to
// the catalog entry shape later doesn't leak here by default.
function publicWatchlistEntry(entry) {
  return {
    id: entry.id,
    label: entry.label,
    detectedIn: entry.detectedIn,
    detectedVersions: entry.detectedVersions,
    hits: entry.hits,
  };
}

export async function GET(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const windowHours = parseWindowHours(request);

  const { pages, error: pagesError } = await listPages(supabase, userId);
  if (pagesError) return Response.json({ error: pagesError }, { status: 500 });

  const { entries, usedDefaults, truncated } = deriveWatchlist(pages);
  const now = new Date();

  let collected;
  try {
    // collectTechWatch is contracted to never throw - it swallows every
    // per-source failure into its own `sources` row - but the mock in this
    // route's own test throws to prove that contract violation still comes
    // back as a 500 instead of crashing the process.
    collected = await collectTechWatch({ entries, now, windowHours });
  } catch (err) {
    return Response.json({ error: err?.message || "Could not build the tech briefing." }, { status: 500 });
  }

  // A total source outage still answers 200 with empty arrays: the panel
  // tells "nothing happened" apart from "we could not look" using `sources`,
  // and a 500 here would erase that distinction the UI exists to show.
  const { items, lifecycle, sources } = collected;

  return Response.json({
    generatedAt: now.toISOString(),
    windowHours,
    items,
    lifecycle,
    watchlist: {
      entries: entries.map(publicWatchlistEntry),
      usedDefaults,
      truncated,
    },
    sources,
  });
}
