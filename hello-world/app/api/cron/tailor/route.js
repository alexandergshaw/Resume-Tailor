import { createAdminClient } from "@/lib/supabase/admin";
import { searchGreenhouseJobs } from "@/lib/greenhouse/searchJobs";
import { tailorResumeHeadless } from "@/lib/llm/tailorForUserHeadless";
import { upsertPosition } from "@/lib/supabase/upsertPosition";
import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { saveGeneratedResume } from "@/lib/supabase/saveGeneratedResume";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds, used by Vercel for long-running cron

// The cron fires four times a day (00:00 / 06:00 / 12:00 / 18:00 UTC). To
// avoid blasting the LLM and keep results trickling in, each run tailors at
// most one new resume per user across all of their saved searches.
const MAX_TAILORS_PER_USER_PER_RUN = 1;
const ABSOLUTE_USER_CAP = 100; // safety ceiling, never reached given the per-run cap above

function matchesAllKeywords(job, keywordsLower) {
  if (keywordsLower.length === 0) return true;
  const haystack = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  return keywordsLower.every((kw) => haystack.includes(kw));
}

function matchesNoExcludedTitleKeywords(job, excludedLower) {
  if (excludedLower.length === 0) return true;
  const title = (job.title || "").toLowerCase();
  return !excludedLower.some((kw) => title.includes(kw));
}

function passesMaxYears(job, maxYears) {
  if (!maxYears || maxYears === "any") return true;
  const cap = Number.parseInt(maxYears, 10);
  if (!Number.isFinite(cap)) return true;
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  // Match "5+ years", "5 years", "minimum 5 years", "at least 5 years".
  const yearMatches = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:to\s*\d{1,2}\s*)?years?/g)];
  for (const m of yearMatches) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > cap) return false;
  }
  return true;
}

function toLower(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
    .filter(Boolean);
}

/**
 * Returns true if the request is authorized for cron access.
 * Accepts:
 *   - `Authorization: Bearer ${CRON_SECRET}` (manual / Vercel cron with secret)
 *   - Vercel cron auto-header `x-vercel-cron: 1` when CRON_SECRET is unset
 */
function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") || "";
    return header === `Bearer ${secret}`;
  }
  return request.headers.get("x-vercel-cron") === "1";
}

async function loadResumeBuffer(admin, userId) {
  try {
    const { data, error } = await admin.storage
      .from("resumes")
      .download(`${userId}/resume`);
    if (error || !data) return null;
    const arr = await data.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

async function processSavedSearch({ admin, userId, savedSearch, resumeBuffer, remaining }) {
  if (remaining <= 0) {
    return { scanned: 0, tailored: [], skipped: "per-run-cap-reached" };
  }
  const keywordsLower = toLower(savedSearch.job_keywords);
  const excludedTitleLower = toLower(savedSearch.excluded_title_keywords);
  const excludedCompaniesLower = toLower(savedSearch.excluded_companies);
  const companySlugs = Array.isArray(savedSearch.selected_companies)
    ? savedSearch.selected_companies
    : [];
  // The per-saved-search cap is still respected, but the per-run cap (above)
  // takes precedence and is enforced via `remaining`.
  const perSearchCap = Math.min(
    ABSOLUTE_USER_CAP,
    Math.max(1, savedSearch.auto_tailor_daily_cap || 10),
  );
  const cap = Math.min(perSearchCap, remaining);

  if (keywordsLower.length === 0) {
    return { scanned: 0, tailored: [], skipped: "no-keywords" };
  }

  const query = keywordsLower.join(" ");
  const jobs = await searchGreenhouseJobs({ query, companySlugs });
  const scanned = jobs.length;

  const filtered = jobs.filter((job) => {
    if (excludedCompaniesLower.length > 0) {
      const companyLower = (job.company || "").toLowerCase();
      if (excludedCompaniesLower.some((c) => companyLower.includes(c))) return false;
    }
    if (!matchesNoExcludedTitleKeywords(job, excludedTitleLower)) return false;
    if (!matchesAllKeywords(job, keywordsLower)) return false;
    if (!passesMaxYears(job, savedSearch.max_years_exp)) return false;
    return true;
  });

  // Dedup against positions already linked to an application for this user.
  const externalIds = filtered.map((j) => j.id);
  let alreadyAppliedIds = new Set();
  if (externalIds.length > 0) {
    const { data: existing } = await admin
      .from("positions")
      .select("external_id, applications!inner(user_id)")
      .in("external_id", externalIds)
      .eq("applications.user_id", userId);
    alreadyAppliedIds = new Set(
      (existing || []).map((row) => row.external_id).filter(Boolean),
    );
  }

  const candidates = filtered.filter((j) => !alreadyAppliedIds.has(j.id)).slice(0, cap);
  const tailored = [];

  for (const job of candidates) {
    try {
      const positionId = await upsertPosition(admin, job);
      if (!positionId) continue;

      const draft = await tailorResumeHeadless({
        resumeBuffer,
        jobPosting: job.description || "",
        jobTitleHint: job.title || "",
      });
      if (!draft?.result) continue;

      const generatedResumeId = await saveGeneratedResume(admin, {
        userId,
        positionId,
        content: draft.result,
        contentLines: draft.resultLines,
        sourceResumePath: `${userId}/resume`,
        additionalContext: `Auto-tailored by cron from saved search "${savedSearch.name}".`,
      });

      // First upsert as "tracking" so we have an application row, then bump
      // it to "tailored" and link the generated resume. This mirrors what
      // handleTailorJob does in the UI.
      const applicationId = await upsertApplication(admin, {
        userId,
        positionId,
        status: "tracking",
      });
      if (applicationId) {
        const { error: updErr } = await admin
          .from("applications")
          .update({
            status: "tailored",
            resume_used_id: generatedResumeId || null,
          })
          .eq("id", applicationId)
          .eq("user_id", userId);
        if (updErr) {
          console.error(
            `[cron] failed to mark application ${applicationId} tailored:`,
            updErr.message,
          );
        }
      } else {
        console.error(
          `[cron] upsertApplication returned null for user=${userId} position=${positionId}`,
        );
      }

      tailored.push({
        applicationId,
        positionId,
        generatedResumeId,
        title: job.title,
        company: job.company,
        url: job.url,
      });
    } catch (err) {
      // Continue to next candidate; we surface errors in the response payload.
      console.error(
        `[cron] tailor failed for user=${userId} job=${job.id}:`,
        err?.message || err,
      );
    }
  }

  return { scanned, tailored };
}

async function processUser({ admin, userId, savedSearches }) {
  const resumeBuffer = await loadResumeBuffer(admin, userId);
  if (!resumeBuffer) {
    return { userId, skipped: "no-resume", scanned: 0, tailored: [] };
  }

  let totalScanned = 0;
  const allTailored = [];
  for (const search of savedSearches) {
    const remaining = MAX_TAILORS_PER_USER_PER_RUN - allTailored.length;
    if (remaining <= 0) break;
    const result = await processSavedSearch({
      admin,
      userId,
      savedSearch: search,
      resumeBuffer,
      remaining,
    });
    totalScanned += result.scanned || 0;
    if (Array.isArray(result.tailored)) allTailored.push(...result.tailored);

    await admin
      .from("saved_searches")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", search.id);

    if (allTailored.length >= MAX_TAILORS_PER_USER_PER_RUN) break;
  }

  if (allTailored.length === 0) {
    return { userId, scanned: totalScanned, tailored: [] };
  }

  // One bell notification per cron run summarizing all newly tailored jobs.
  const titlePart =
    allTailored.length === 1
      ? `New tailored resume ready: ${allTailored[0].title}`
      : `${allTailored.length} new tailored resumes ready`;
  const bodyPart = allTailored
    .map((t) => `• ${t.title}${t.company ? ` — ${t.company}` : ""}`)
    .join("\n");
  await admin.from("notifications").insert({
    user_id: userId,
    kind: "auto_tailor",
    title: titlePart,
    body: bodyPart,
    related_application_id: allTailored[0].applicationId || null,
    related_position_id: allTailored[0].positionId || null,
  });

  return { userId, scanned: totalScanned, tailored: allTailored };
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return Response.json(
      { error: `admin client unavailable: ${err.message}` },
      { status: 500 },
    );
  }

  // Pull every enabled saved search across all users.
  const { data: searches, error: searchErr } = await admin
    .from("saved_searches")
    .select("*")
    .eq("auto_tailor_enabled", true);
  if (searchErr) {
    return Response.json({ error: searchErr.message }, { status: 500 });
  }

  // Group by user.
  const byUser = new Map();
  for (const s of searches || []) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push(s);
  }

  const results = [];
  for (const [userId, list] of byUser.entries()) {
    try {
      const r = await processUser({ admin, userId, savedSearches: list });
      results.push(r);
    } catch (err) {
      results.push({ userId, error: String(err?.message || err) });
    }
  }

  return Response.json({
    ok: true,
    users: results.length,
    totalTailored: results.reduce(
      (acc, r) => acc + (Array.isArray(r.tailored) ? r.tailored.length : 0),
      0,
    ),
    results,
  });
}

// Vercel cron sends GETs in some configurations; accept both verbs.
export const GET = POST;
