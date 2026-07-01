import {
  getAuth,
  unauthorized,
  badRequest,
  ensureSeeded,
  bumpVersion,
} from "@/lib/llm/engines/tailor-lite/library/apiSupport";
import {
  validateTaxonomy,
  validateFocusArea,
  validateSkillGroup,
} from "@/lib/llm/engines/tailor-lite/library/validate";

export const runtime = "nodejs";

// Bulk-insert reviewed suggestions from /api/library/extract. Validates each item,
// skips taxonomy canonicals that already exist (case-insensitive), and bumps the
// library version once at the end.
export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest(["Invalid JSON body."]);
  }
  await ensureSeeded(supabase, userId);

  const added = { taxonomy: 0, focusAreas: 0, skillGroups: 0 };
  const skipped = [];
  let order = Math.floor(Date.now() / 1000);

  // --- Taxonomy (skip existing canonicals) ---
  const taxItems = Array.isArray(body.taxonomy) ? body.taxonomy : [];
  if (taxItems.length) {
    const { data: existing } = await supabase.from("tailor_taxonomy").select("canonical").eq("user_id", userId);
    const have = new Set((existing || []).map((r) => String(r.canonical).toLowerCase()));
    const rows = [];
    for (const item of taxItems) {
      const v = validateTaxonomy(item);
      if (!v.ok) { skipped.push(`Buzzword "${item.canonical || ""}": ${v.errors.join(" ")}`); continue; }
      if (have.has(v.value.canonical.toLowerCase())) { skipped.push(`Buzzword "${v.value.canonical}": already exists`); continue; }
      have.add(v.value.canonical.toLowerCase());
      rows.push({ user_id: userId, sort_order: order++, ...v.value });
    }
    if (rows.length) {
      const { error } = await supabase.from("tailor_taxonomy").insert(rows);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      added.taxonomy = rows.length;
    }
  }

  // --- Focus areas ---
  const faItems = Array.isArray(body.focusAreas) ? body.focusAreas : [];
  for (const item of faItems) {
    const v = validateFocusArea(item);
    if (!v.ok) { skipped.push(`Focus area "${item.name || ""}": ${v.errors.join(" ")}`); continue; }
    const { error } = await supabase.from("tailor_focus_areas").insert({ user_id: userId, sort_order: order++, ...v.value });
    if (error) { skipped.push(`Focus area "${v.value.name}": ${error.message}`); continue; }
    added.focusAreas += 1;
  }

  // --- Skill groups ---
  const sgItems = Array.isArray(body.skillGroups) ? body.skillGroups : [];
  for (const item of sgItems) {
    const v = validateSkillGroup(item);
    if (!v.ok) { skipped.push(`Skill group "${item.heading || ""}": ${v.errors.join(" ")}`); continue; }
    const { error } = await supabase.from("tailor_skill_groups").insert({ user_id: userId, sort_order: order++, ...v.value });
    if (error) { skipped.push(`Skill group "${v.value.heading}": ${error.message}`); continue; }
    added.skillGroups += 1;
  }

  await bumpVersion(supabase, userId);
  return Response.json({ added, skipped });
}
