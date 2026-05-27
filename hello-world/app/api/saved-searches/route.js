import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DEFAULT_DAILY_CAP = 10;
const MIN_DAILY_CAP = 1;
const MAX_DAILY_CAP = 100;

function sanitizeStringArray(value, { maxItems = 50, maxLen = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > maxLen) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizeCap(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_CAP;
  return Math.max(MIN_DAILY_CAP, Math.min(MAX_DAILY_CAP, n));
}

function sanitizeIncoming(body) {
  if (!body || typeof body !== "object") return null;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) return null;
  return {
    name,
    job_keywords: sanitizeStringArray(body.jobKeywords ?? body.job_keywords, { maxItems: 25, maxLen: 100 }),
    max_years_exp:
      typeof body.maxYearsExp === "string"
        ? body.maxYearsExp.slice(0, 20)
        : typeof body.max_years_exp === "string"
          ? body.max_years_exp.slice(0, 20)
          : "any",
    selected_categories: sanitizeStringArray(body.selectedCategories ?? body.selected_categories, { maxItems: 50, maxLen: 100 }),
    selected_companies: sanitizeStringArray(body.selectedCompanies ?? body.selected_companies, { maxItems: 200, maxLen: 200 }),
    excluded_companies: sanitizeStringArray(body.excludedCompanies ?? body.excluded_companies, { maxItems: 200, maxLen: 200 }),
    excluded_title_keywords: sanitizeStringArray(body.excludedTitleKeywords ?? body.excluded_title_keywords, { maxItems: 50, maxLen: 100 }),
    auto_tailor_enabled: !!(body.autoTailorEnabled ?? body.auto_tailor_enabled),
    auto_tailor_daily_cap: sanitizeCap(body.autoTailorDailyCap ?? body.auto_tailor_daily_cap),
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ searches: data || [] });
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sanitized = sanitizeIncoming(body);
  if (!sanitized) {
    return Response.json({ error: "Missing or invalid 'name'." }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("saved_searches")
    .insert({ user_id: user.id, ...sanitized })
    .select("*")
    .single();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ search: data });
}
