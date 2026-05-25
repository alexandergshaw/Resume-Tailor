import { getCached, setCached } from "@/lib/cache/jobCache";
import { GREENHOUSE_COMPANIES } from "@/lib/greenhouse/companies";

export const runtime = "nodejs";

const CACHE_TTL_SECONDS = 14400; // 4 hours

const NON_US_PATTERNS = [
  /\bcanada\b/, /\buk\b/, /\bunited kingdom\b/, /\bengland\b/, /\bscotland\b/,
  /\bireland\b/, /\baustralia\b/, /\bgermany\b/, /\bfrance\b/, /\bnetherlands\b/,
  /\bindia\b/, /\bsingapore\b/, /\bspain\b/, /\bitaly\b/, /\bsweden\b/,
  /\bdenmark\b/, /\bnorway\b/, /\bfinland\b/, /\bpoland\b/, /\bbrazil\b/,
  /\bmexico\b/, /\bnew zealand\b/, /\bjapan\b/, /\bchina\b/, /\bhong kong\b/,
  /\btaiwan\b/, /\bportugal\b/, /\bbelgium\b/, /\bswitzerland\b/, /\baustria\b/,
  /\bcolombia\b/, /\bchile\b/, /\bargentina\b/, /\bisrael\b/, /\bemea\b/,
  /\bapac\b/, /\blatam\b/, /\beurope\b/, /\beu\b(?!\s*\.\s*s)/,
];

function isUsOrUnspecifiedLocation(locationName) {
  if (!locationName) return true;
  const lower = locationName.toLowerCase();
  return !NON_US_PATTERNS.some((re) => re.test(lower));
}

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
    publisher: "Greenhouse",
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
      if (!job.isRemote) return false;
      if (!isUsOrUnspecifiedLocation(job.location)) return false;
      const titleLower = job.title.toLowerCase();
      return queryWords.some((word) => titleLower.includes(word));
    });

  return Response.json({ jobs });
}
