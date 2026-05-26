/**
 * Upserts a job posting into the shared `positions` table using the provided
 * Supabase client. Returns the position UUID on success, or null on failure.
 * Errors are silently swallowed — position persistence must never block UX.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} job - normalized job object from Greenhouse or JSearch API
 * @returns {Promise<string|null>} position UUID or null
 */
export async function upsertPosition(supabase, job) {
  if (!job || typeof job !== "object" || !job.id) return null;

  try {
    const { data, error } = await supabase
      .from("positions")
      .upsert(
        {
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
        },
        { onConflict: "external_id" },
      )
      .select("id")
      .single();

    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}
