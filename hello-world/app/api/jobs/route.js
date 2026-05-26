import { getServerEnv } from "@/lib/config/env";
import { getCached, setCached } from "@/lib/cache/jobCache";

export const runtime = "nodejs";

const JSEARCH_URL = "https://jsearch.p.rapidapi.com/search";
const JSEARCH_HOST = "jsearch.p.rapidapi.com";
const RESULTS_PER_PAGE = 12;
const CACHE_TTL_SECONDS = 1800; // 30 minutes

/**
 * For "today" filters, clamp TTL to seconds remaining until midnight UTC so
 * the cache never serves yesterday's results after the day rolls over.
 */
function effectiveTtl(datePosted) {
  if (datePosted !== "today") return CACHE_TTL_SECONDS;
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const secondsUntilMidnight = Math.floor((midnight - now) / 1000);
  return Math.min(CACHE_TTL_SECONDS, secondsUntilMidnight);
}

function normalizeJob(raw) {
  const locationParts = [raw.job_city, raw.job_state, raw.job_country].filter(Boolean);
  return {
    id: raw.job_id,
    title: raw.job_title || "",
    company: raw.employer_name || "",
    location: raw.job_is_remote ? "Remote" : locationParts.join(", "),
    description: raw.job_description || "",
    url: raw.job_apply_link || "",
    publisher: raw.job_publisher || null,
    employmentType: raw.job_employment_type || null,
    isRemote: raw.job_is_remote ?? false,
    salaryMin: raw.job_min_salary ?? null,
    salaryMax: raw.job_max_salary ?? null,
    postedAt: raw.job_posted_at_datetime_utc || null,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();
  const minSalary = parseInt(searchParams.get("minSalary") || "0", 10);
  const excludeNoSalary = searchParams.get("excludeNoSalary") === "1";
  const validDatePosted = ["today", "3days", "week", "month"];
  const datePosted = validDatePosted.includes(searchParams.get("datePosted"))
    ? searchParams.get("datePosted")
    : "today";

  if (!query) {
    return Response.json({ error: "query parameter is required." }, { status: 400 });
  }

  const fullQuery = `${query} remote`;
  const cacheKey = `jobs:jsearch:remote:v2:${datePosted}:${query}`;

  const cached = await getCached(cacheKey);
  if (cached) {
    return Response.json({ jobs: cached, fromCache: true });
  }

  const { rapidApiKey } = getServerEnv();

  const params = new URLSearchParams({
    query: fullQuery,
    num_pages: "1",
    page: "1",
    date_posted: datePosted,
  });

  let data;
  try {
    const response = await fetch(`${JSEARCH_URL}?${params.toString()}`, {
      headers: {
        "X-RapidAPI-Key": rapidApiKey,
        "X-RapidAPI-Host": JSEARCH_HOST,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return Response.json(
        { error: `JSearch error ${response.status}: ${text}` },
        { status: 502 },
      );
    }

    data = await response.json();
  } catch (err) {
    return Response.json({ error: `Failed to reach JSearch: ${err.message}` }, { status: 502 });
  }

  let jobs = (data.data || []).slice(0, RESULTS_PER_PAGE).map(normalizeJob);

  if (minSalary > 0) {
    jobs = jobs.filter(
      (job) => job.salaryMin === null || job.salaryMin >= minSalary,
    );
  }

  if (excludeNoSalary) {
    jobs = jobs.filter((job) => job.salaryMin !== null || job.salaryMax !== null);
  }

  await setCached(cacheKey, jobs, effectiveTtl(datePosted));

  return Response.json({ jobs, fromCache: false });
}
