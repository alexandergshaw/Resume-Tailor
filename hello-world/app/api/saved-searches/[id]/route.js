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

function sanitizeEmail(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 320);
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizePartial(body) {
  if (!body || typeof body !== "object") return {};
  const out = {};
  if (typeof body.name === "string") out.name = body.name.trim().slice(0, 200);
  if ("jobKeywords" in body || "job_keywords" in body) {
    out.job_keywords = sanitizeStringArray(body.jobKeywords ?? body.job_keywords, { maxItems: 25, maxLen: 100 });
  }
  if ("maxYearsExp" in body || "max_years_exp" in body) {
    const v = body.maxYearsExp ?? body.max_years_exp;
    out.max_years_exp = typeof v === "string" ? v.slice(0, 20) : "any";
  }
  if ("selectedCategories" in body || "selected_categories" in body) {
    out.selected_categories = sanitizeStringArray(body.selectedCategories ?? body.selected_categories, { maxItems: 50, maxLen: 100 });
  }
  if ("selectedCompanies" in body || "selected_companies" in body) {
    out.selected_companies = sanitizeStringArray(body.selectedCompanies ?? body.selected_companies, { maxItems: 200, maxLen: 200 });
  }
  if ("excludedCompanies" in body || "excluded_companies" in body) {
    out.excluded_companies = sanitizeStringArray(body.excludedCompanies ?? body.excluded_companies, { maxItems: 200, maxLen: 200 });
  }
  if ("excludedTitleKeywords" in body || "excluded_title_keywords" in body) {
    out.excluded_title_keywords = sanitizeStringArray(body.excludedTitleKeywords ?? body.excluded_title_keywords, { maxItems: 50, maxLen: 100 });
  }
  if ("autoTailorEnabled" in body || "auto_tailor_enabled" in body) {
    out.auto_tailor_enabled = !!(body.autoTailorEnabled ?? body.auto_tailor_enabled);
  }
  if ("autoTailorDailyCap" in body || "auto_tailor_daily_cap" in body) {
    out.auto_tailor_daily_cap = sanitizeCap(body.autoTailorDailyCap ?? body.auto_tailor_daily_cap);
  }
  if ("emailOnNewJobs" in body || "email_on_new_jobs" in body) {
    out.email_on_new_jobs = !!(body.emailOnNewJobs ?? body.email_on_new_jobs);
  }
  if ("notifyEmail" in body || "notify_email" in body) {
    out.notify_email = sanitizeEmail(body.notifyEmail ?? body.notify_email);
  }
  return out;
}

export async function PUT(request, { params }) {
  const { id } = await params;
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
  const updates = sanitizePartial(body);
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No valid fields to update." }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("saved_searches")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ search: data });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { error } = await supabase
    .from("saved_searches")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
