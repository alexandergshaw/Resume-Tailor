// Browser-side loader for practice mode's posting picker. The postings are
// the same rows the Tracking table shows: `applications` joined to
// `positions`, filtered to the signed-in user, statuses "tracking" and
// "auto_tailored" excluded, newest applied_at first. See app/page.js's
// loadApplications for the reference query this mirrors.

import { createClient } from "@/lib/supabase/client";
import { excludeTrackingTabHiddenStatuses } from "@/lib/applications/statusVocabulary.js";

function toTime(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

// Pure normalizer: application+position rows -> practice-picker options.
// Drops rows with no joined position or with neither a title nor a company.
// Duplicates (same title + company, case-insensitively) collapse to the row
// with the newest applied_at. Exported separately so it can be unit-tested
// without a Supabase client.
export function normalizePostingRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byKey = new Map();

  for (const row of list) {
    const position = row?.positions;
    if (!position) continue;

    const title = String(position.title || "").trim();
    const company = String(position.company || "").trim();
    if (!title && !company) continue;

    const key = `${title.toLowerCase()}::${company.toLowerCase()}`;
    const appliedAt = row?.applied_at || null;
    const time = toTime(appliedAt);

    const existing = byKey.get(key);
    if (existing && existing.time >= time) continue;

    const label = title && company ? `${title} — ${company}` : title || company;
    byKey.set(key, {
      time,
      posting: {
        id: row.id,
        title,
        company,
        description: position.description || "",
        url: position.url || "",
        appliedAt,
        label,
      },
    });
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.time - a.time)
    .map((entry) => entry.posting);
}

// Loads the signed-in user's tracked postings for practice mode. Returns []
// when there is no signed-in user (never throws for that case) — a Supabase
// query error, and an auth lookup error, are each thrown as a plain Error so
// the caller can show it instead of the two failure modes looking identical.
export async function fetchPracticePostings() {
  const supabase = createClient();
  const {
    data: { user } = {},
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    throw new Error(userError.message);
  }
  if (!user?.id) return [];

  const query = excludeTrackingTabHiddenStatuses(
    supabase
      .from("applications")
      .select(`
        id, status, applied_at,
        positions ( id, title, company, description, url )
      `)
      .eq("user_id", user.id),
  );
  const { data, error } = await query.order("applied_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return normalizePostingRows(data);
}
