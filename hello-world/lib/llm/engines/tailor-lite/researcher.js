// Composed-workflow Researcher client. The Researcher hits live external sources,
// so it is the ONLY non-deterministic input and is strictly quarantined:
//   - RÉSUMÉS: advisory only — overviews + favorable news are surfaced in the
//     report with attribution and NEVER auto-inserted, so the .docx is
//     byte-identical research-on or research-off (strict adherence preserved).
//   - COVER LETTERS: only STRUCTURED FACTS become rendered content —
//     company.profile.industry -> {{ORGANIZATION_CONTEXT}} and
//     role.responsibilities.essential_skills -> {{ROLE_FOCUS}} — turned into
//     fixed-template phrases and filled via the same occurrence-indexed path.
// Unconfigured/unreachable -> null; the caller proceeds without research.

const FIELDS = {
  company: "company",
  profile: "profile",
  industry: "industry",
  role: "role",
  responsibilities: "responsibilities",
  essentialSkills: "essential_skills",
  overviews: "overviews",
  news: "news",
};

// Map a raw research response into { advisory, facts }. Pure/deterministic given
// the snapshot. advisory is for the résumé report (never the document); facts
// feed cover-letter slots. Returns fixed-template phrases for the facts.
export function mapResearch(raw) {
  const company = raw?.[FIELDS.company] || {};
  const role = raw?.[FIELDS.role] || {};
  const industry = company?.[FIELDS.profile]?.[FIELDS.industry] || "";
  const essential = role?.[FIELDS.responsibilities]?.[FIELDS.essentialSkills];
  const skills = Array.isArray(essential) ? essential.filter(Boolean) : [];

  const advisory = {
    overviews: Array.isArray(raw?.[FIELDS.overviews]) ? raw[FIELDS.overviews] : [],
    news: Array.isArray(raw?.[FIELDS.news]) ? raw[FIELDS.news] : [],
  };

  const facts = {};
  if (industry) facts.ORGANIZATION_CONTEXT = `your work in ${industry}`;
  if (skills.length) facts.ROLE_FOCUS = skills.join(", ");

  return { advisory, facts, industry, essentialSkills: skills };
}

function getConfig() {
  return {
    url: process.env.RESEARCHER_API_URL || null,
    key: process.env.RESEARCHER_API_KEY || null,
  };
}

export function isResearcherConfigured() {
  return !!getConfig().url;
}

// Call the Researcher, or return null if unconfigured. Throws on a
// reachable-but-failing service so the caller can decide to proceed without it.
export async function fetchResearch({ posting, emphases = [], company = "" }) {
  const { url, key } = getConfig();
  if (!url) return null;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (key) headers["X-API-Key"] = key;
  const res = await fetch(url.replace(/\/+$/, ""), {
    method: "POST",
    headers,
    body: JSON.stringify({ text: posting, emphases, company }),
  });
  if (!res.ok) throw new Error(`Researcher API error: HTTP ${res.status}`);
  return mapResearch(await res.json());
}
