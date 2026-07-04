// Pure converters between DB rows and the in-memory library shapes the engine
// consumes. No Supabase, no network — so they are unit-testable in isolation and
// reused by both the loader (rows -> shapes) and the seeder (shapes -> rows).
//
// The engine consumes the exact shapes the bundled JSON has today:
//   taxonomy      -> { entries: [{ canonical, category, aliases, match_canonical? }] }
//   profile       -> { values, default_teaching_subjects, focus_areas: [...] }
//   skillGroups   -> { groups: [{ heading, categories, keywords, conditional? }] }
//   contentLibrary-> { entries: [{ id, slots, text, tags, fabricated? }] }
// Optional flags (match_canonical:false, conditional:true, fabricated:true) are only
// emitted when set, so a round-trip reproduces the original JSON exactly.

const bySortOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

// DB rows (per user) -> the library object the engine consumes.
export function rowsToLibrary({
  taxonomyRows = [],
  focusAreaRows = [],
  skillGroupRows = [],
  contentLibraryRows = [],
  editRuleRows = [],
  personaRows = [],
  profileRow = null,
} = {}) {
  return {
    // Persistent recurring hand-edits (the user's "template" edits), applied
    // document-wide at render. Case-sensitive { before -> after } pairs.
    editRules: [...editRuleRows]
      .sort(bySortOrder)
      .map((r) => ({ before: r.before, after: typeof r.after === "string" ? r.after : "" })),
    // Named personas: profile-reframing identities (values, teaching subjects,
    // focus area, cover variant) that reframe the résumé/letter per posting.
    personas: [...personaRows].sort(bySortOrder).map((r) => ({
      name: r.name,
      values: (r.values && typeof r.values === "object") ? r.values : {},
      default_teaching_subjects: r.default_teaching_subjects || [],
      focus_area: r.focus_area || "",
      cover_variant: r.cover_variant || "",
    })),
    taxonomy: {
      entries: [...taxonomyRows].sort(bySortOrder).map((r) => {
        const entry = { canonical: r.canonical, category: r.category, aliases: r.aliases || [] };
        if (r.match_canonical === false) entry.match_canonical = false;
        return entry;
      }),
    },
    profile: {
      values: (profileRow && profileRow.values) || {},
      default_teaching_subjects: (profileRow && profileRow.default_teaching_subjects) || [],
      focus_areas: [...focusAreaRows].sort(bySortOrder).map((r) => ({
        name: r.name,
        match: r.match || [],
        subjects: r.subjects || [],
        job_emphases: r.job_emphases || [],
        technical_capabilities: r.technical_capabilities || [],
        domain_capabilities: r.domain_capabilities || [],
      })),
    },
    skillGroups: {
      groups: [...skillGroupRows].sort(bySortOrder).map((r) => {
        const group = { heading: r.heading, categories: r.categories || [], keywords: r.keywords || [] };
        if (r.conditional) group.conditional = true;
        return group;
      }),
    },
    contentLibrary: {
      entries: [...contentLibraryRows].sort(bySortOrder).map((r) => {
        const entry = { id: r.frag_id, slots: r.slots || [], text: r.text, tags: r.tags || [] };
        if (r.fabricated) entry.fabricated = true;
        return entry;
      }),
    },
  };
}

// A library object -> per-user DB rows (for seeding). `sort_order` preserves the
// authored order. Returns one object per table; arrays plus a single profile row.
export function libraryToRows(library, userId) {
  const taxonomy = library.taxonomy || {};
  const profile = library.profile || {};
  const skillGroups = library.skillGroups || {};
  const contentLibrary = library.contentLibrary || {};
  return {
    taxonomy: (taxonomy.entries || []).map((e, i) => ({
      user_id: userId,
      canonical: e.canonical,
      category: e.category,
      aliases: e.aliases || [],
      match_canonical: e.match_canonical !== false,
      sort_order: i,
    })),
    focusAreas: (profile.focus_areas || []).map((f, i) => ({
      user_id: userId,
      name: f.name,
      match: f.match || [],
      subjects: f.subjects || [],
      job_emphases: f.job_emphases || [],
      technical_capabilities: f.technical_capabilities || [],
      domain_capabilities: f.domain_capabilities || [],
      sort_order: i,
    })),
    skillGroups: (skillGroups.groups || []).map((g, i) => ({
      user_id: userId,
      heading: g.heading,
      categories: g.categories || [],
      keywords: g.keywords || [],
      conditional: !!g.conditional,
      sort_order: i,
    })),
    contentLibrary: (contentLibrary.entries || []).map((e, i) => ({
      user_id: userId,
      frag_id: e.id,
      slots: e.slots || [],
      text: e.text,
      tags: e.tags || [],
      fabricated: !!e.fabricated,
      sort_order: i,
    })),
    profile: {
      user_id: userId,
      values: profile.values || {},
      default_teaching_subjects: profile.default_teaching_subjects || [],
    },
  };
}
