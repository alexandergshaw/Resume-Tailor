/**
 * Map a normalized job object into a `positions`-shaped row.
 *
 * This is `upsertPosition`'s mapping, lifted out unchanged so the API route
 * can build the same row from a browser payload without importing anything
 * server-only. Its source inference is the ID-PREFIX one, deliberately NOT
 * lib/feed/tailorAndQueue.js's `jobToPositionRow` (which prefers `job.source`
 * when the feed row carried one): the callers on this path — app/page.js,
 * app/hooks/useManualTailor.js, app/hooks/useApplicationDialogs.js,
 * app/api/feed/apply — build jobs that carry no `source`, and honouring one if
 * it ever appeared would silently reclassify their rows.
 *
 * Safe in a client bundle: pure, no imports, no I/O.
 *
 * @param {object} job normalized job (Greenhouse / JSearch / synthetic)
 * @returns {object} a positions row
 */
export function positionRowFromJob(job) {
  return {
    external_id: String(job.id),
    source: String(job.id).startsWith("gh-") ? "greenhouse" : "jsearch",
    title: job.title ?? null,
    company: job.company ?? null,
    location: job.location ?? null,
    is_remote: job.isRemote ?? null,
    employment_type: job.employmentType ?? null,
    description: job.description ?? null,
    url: job.url ?? null,
    salary_min: job.salaryMin ?? null,
    salary_max: job.salaryMax ?? null,
    posted_at: job.postedAt ?? null,
    raw_data: job,
  };
}
