// ---------------------------------------------------------------------------
// Ashby source adapter for the Live Feed.
//
// Ashby exposes a public JSON board API per company:
//   https://api.ashbyhq.com/posting-api/job-board/{slug}
// Returns { jobs: [...] }. We normalize each into the same shape as the
// Greenhouse path so the rest of the pipeline is source-agnostic.
// ---------------------------------------------------------------------------

import {
  stripHtml,
  snippetFrom,
  remoteTypeFor,
  extractMinYearsRequired,
} from "@/lib/feed/normalize";

function normalizeAshbyPosting(raw, companyName) {
  const sourcePostingId = `ashby-${raw.id}`;
  const location = raw.location || raw.address?.postalAddress?.addressLocality || "";
  const fullDescription = raw.descriptionPlain
    ? stripHtml(raw.descriptionPlain)
    : stripHtml(raw.descriptionHtml || "");
  const url = raw.jobUrl || raw.applyUrl || null;
  const remoteType = raw.isRemote ? "remote" : remoteTypeFor(location);
  const tags = [raw.department, raw.team, raw.employmentType].filter(Boolean);

  return {
    dedup_key: `ashby:${sourcePostingId}`,
    source: "ashby",
    source_posting_id: sourcePostingId,
    title: raw.title || null,
    company: companyName || null,
    location: location || null,
    remote_type: remoteType,
    employment_type: raw.employmentType || null,
    salary_min: null,
    salary_max: null,
    description_snippet: snippetFrom(fullDescription),
    min_years_required: extractMinYearsRequired(
      `${raw.title || ""} ${fullDescription}`,
    ),
    url,
    tags: tags.slice(0, 8),
    posted_at: raw.publishedAt || null,
    raw_data: {
      id: sourcePostingId,
      title: raw.title || "",
      company: companyName || "",
      location,
      url: url || "",
      isRemote: remoteType === "remote",
      description: fullDescription,
      postedAt: raw.publishedAt || null,
    },
  };
}

export async function fetchAshbyPostings(slug, name) {
  try {
    const res = await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 0 } },
    );
    if (!res.ok) {
      return { ok: false, postings: [], error: `HTTP ${res.status}`, label: slug };
    }
    const data = await res.json();
    const list = Array.isArray(data.jobs) ? data.jobs : [];
    const postings = list.map((j) => normalizeAshbyPosting(j, name));
    return { ok: true, postings, error: null, label: slug };
  } catch (err) {
    return { ok: false, postings: [], error: String(err?.message || err), label: slug };
  }
}
