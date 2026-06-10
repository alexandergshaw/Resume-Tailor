// ---------------------------------------------------------------------------
// Lever source adapter for the Live Feed.
//
// Lever exposes a public JSON board API per company:
//   https://api.lever.co/v0/postings/{slug}?mode=json
// Returns an array of postings. We normalize each into the same shape as the
// Greenhouse path so the rest of the pipeline (dedupe, upsert, select/queue)
// is source-agnostic.
// ---------------------------------------------------------------------------

import {
  stripHtml,
  snippetFrom,
  remoteTypeFor,
  extractMinYearsRequired,
} from "@/lib/feed/normalize";

function remoteTypeForLever(raw) {
  const wp = (raw.workplaceType || "").toLowerCase();
  if (wp.includes("remote")) return "remote";
  if (wp.includes("hybrid")) return "hybrid";
  if (wp.includes("on-site") || wp.includes("onsite")) return "onsite";
  return remoteTypeFor(raw.categories?.location || "");
}

function normalizeLeverPosting(raw, companyName) {
  const sourcePostingId = `lever-${raw.id}`;
  const location = raw.categories?.location || "";
  const fullDescription = raw.descriptionPlain
    ? stripHtml(raw.descriptionPlain)
    : stripHtml(raw.description || "");
  const url = raw.hostedUrl || raw.applyUrl || null;
  const tags = [
    raw.categories?.team,
    raw.categories?.department,
    raw.categories?.commitment,
  ].filter(Boolean);
  const postedAt = Number.isFinite(raw.createdAt)
    ? new Date(raw.createdAt).toISOString()
    : null;

  return {
    dedup_key: `lever:${sourcePostingId}`,
    source: "lever",
    source_posting_id: sourcePostingId,
    title: raw.text || null,
    company: companyName || null,
    location: location || null,
    remote_type: remoteTypeForLever(raw),
    employment_type: raw.categories?.commitment || null,
    salary_min: null,
    salary_max: null,
    description_snippet: snippetFrom(fullDescription),
    min_years_required: extractMinYearsRequired(
      `${raw.text || ""} ${fullDescription}`,
    ),
    url,
    tags: tags.slice(0, 8),
    posted_at: postedAt,
    raw_data: {
      id: sourcePostingId,
      title: raw.text || "",
      company: companyName || "",
      location,
      url: url || "",
      isRemote: remoteTypeForLever(raw) === "remote",
      description: fullDescription,
      postedAt,
    },
  };
}

export async function fetchLeverPostings(slug, name) {
  try {
    const res = await fetch(
      `https://api.lever.co/v0/postings/${slug}?mode=json`,
      { headers: { Accept: "application/json" }, next: { revalidate: 0 } },
    );
    if (!res.ok) {
      return { ok: false, postings: [], error: `HTTP ${res.status}`, label: slug };
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    const postings = list.map((j) => normalizeLeverPosting(j, name));
    return { ok: true, postings, error: null, label: slug };
  } catch (err) {
    return { ok: false, postings: [], error: String(err?.message || err), label: slug };
  }
}
