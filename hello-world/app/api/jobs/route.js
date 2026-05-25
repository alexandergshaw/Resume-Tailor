import { getServerEnv } from "@/lib/config/env";
import { getCached, setCached } from "@/lib/cache/jobCache";

export const runtime = "nodejs";

const JSEARCH_URL = "https://jsearch.p.rapidapi.com/search";
const JSEARCH_HOST = "jsearch.p.rapidapi.com";
const RESULTS_PER_PAGE = 12;
const CACHE_TTL_SECONDS = 1800; // 30 minutes

function normalizeJob(raw) {
  const locationParts = [raw.job_city, raw.job_state, raw.job_country].filter(Boolean);
  return {
    id: raw.job_id,
    title: raw.job_title || "",
    company: raw.employer_name || "",
    location: raw.job_is_remote ? "Remote" : locationParts.join(", "),
    description: raw.job_description || "",
    url: raw.job_apply_link || "",
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
  const location = searchParams.get("location")?.trim() || "";

  if (!query) {
    return Response.json({ error: "query parameter is required." }, { status: 400 });
  }

  const fullQuery = location ? `${query} in ${location}` : query;
  const cacheKey = `jobs:jsearch:${fullQuery}`;

  const cached = await getCached(cacheKey);
  if (cached) {
    return Response.json({ jobs: cached, fromCache: true });
  }

  const { rapidApiKey } = getServerEnv();

  const params = new URLSearchParams({
    query: fullQuery,
    num_pages: "1",
    page: "1",
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

  const jobs = (data.data || []).slice(0, RESULTS_PER_PAGE).map(normalizeJob);
  await setCached(cacheKey, jobs, CACHE_TTL_SECONDS);

  return Response.json({ jobs, fromCache: false });
}
