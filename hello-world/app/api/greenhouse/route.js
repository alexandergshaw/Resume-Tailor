import { getCached, setCached } from "@/lib/cache/jobCache";
import { GREENHOUSE_COMPANIES } from "@/lib/greenhouse/companies";

export const runtime = "nodejs";

const CACHE_TTL_SECONDS = 14400; // 4 hours

function stripHtml(html) {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGreenhouseJob(raw, companyName) {
  const locationName = raw.location?.name || "";
  return {
    id: `gh-${raw.id}`,
    title: raw.title || "",
    company: companyName,
    location: locationName,
    description: stripHtml(raw.content || ""),
    url: raw.absolute_url || "",
    publisher: companyName,
    employmentType: null,
    isRemote: locationName.toLowerCase().includes("remote"),
    salaryMin: null,
    salaryMax: null,
    postedAt: raw.updated_at || null,
  };
}

async function fetchCompanyJobs(slug, name) {
  const cacheKey = `gh:jobs:v3:${slug}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
      { headers: { Accept: "application/json" }, next: { revalidate: 0 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = (data.jobs || []).map((j) => normalizeGreenhouseJob(j, name));
    await setCached(cacheKey, jobs, CACHE_TTL_SECONDS);
    return jobs;
  } catch {
    return [];
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();

  if (!query) {
    return Response.json({ error: "query parameter is required." }, { status: 400 });
  }

  const companiesParam = searchParams.get("companies");
  const selectedSlugs = companiesParam
    ? companiesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const companyList =
    selectedSlugs.length > 0
      ? GREENHOUSE_COMPANIES.filter((c) => selectedSlugs.includes(c.slug))
      : GREENHOUSE_COMPANIES;

  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);

  const allResults = await Promise.all(
    companyList.map(({ slug, name }) => fetchCompanyJobs(slug, name)),
  );

  const jobs = allResults
    .flat()
    .filter((job) => {
      const titleLower = job.title.toLowerCase();
      return queryWords.some((word) => titleLower.includes(word));
    });

  return Response.json({ jobs });
}
