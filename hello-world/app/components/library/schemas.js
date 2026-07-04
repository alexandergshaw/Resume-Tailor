// Field schemas for the Library CRUD tabs and the tab metadata (label + help).
// Consumed by LibraryEditor / EntityTab. Pure data.

export const TAXONOMY_SCHEMA = (categories) => [
  { key: "canonical", type: "text", label: "Canonical", help: "The display text inserted/surfaced in the résumé & cover letter." },
  { key: "category", type: "select", label: "Category", options: categories, help: "How the term is grouped (technology, domain, soft_skill, …)." },
  { key: "aliases", type: "chips", label: "Aliases", help: "Synonyms matched in the posting (lowercased). Avoid ultra-generic single words." },
  { key: "match_canonical", type: "switch", label: "Match canonical", default: true, help: "Whether the canonical text itself is matched, or only the aliases." },
];

export const FOCUS_SCHEMA = [
  { key: "name", type: "text", label: "Name", help: "A label for the area (e.g. 'Solution Architecture')." },
  { key: "match", type: "chips", label: "Match terms", help: "Discriminative role/discipline phrases that activate this area when a posting names them." },
  { key: "subjects", type: "chips", label: "Subjects", help: "Lead the skills row + summary when the area is active." },
  { key: "job_emphases", type: "chips", label: "Job emphases", help: "The per-role parenthetical emphases on the résumé." },
  { key: "technical_capabilities", type: "chips", label: "Technical capabilities", help: "Tech shown in the opening 'hands-on work with …' line." },
  { key: "domain_capabilities", type: "chips", label: "Domain capabilities", help: "Domain expertise shown in the cover letter + summary." },
];

export const SKILLGROUP_SCHEMA = [
  { key: "heading", type: "text", label: "Heading", help: "The group's name (used for ranking, not shown verbatim)." },
  { key: "categories", type: "chips", label: "Categories", help: "Fallback category membership used for ranking." },
  { key: "keywords", type: "chips", label: "Keywords", help: "Your exact skill strings — kept verbatim, nothing invented." },
  { key: "conditional", type: "switch", label: "Conditional", help: "If on, these only surface when the posting asks for them." },
];

export const CONTENT_SCHEMA = [
  { key: "frag_id", type: "text", label: "Fragment id", help: "A unique slug id for this fragment." },
  { key: "slots", type: "chips", label: "Slots", help: "The placeholder slot names this fragment can fill." },
  { key: "text", type: "textarea", label: "Text", help: "Inserted verbatim — keep it grammatical for the sentence." },
  { key: "tags", type: "chips", label: "Tags", help: "Taxonomy terms; the best-tagged fragment wins per posting." },
  { key: "fabricated", type: "switch", label: "Fabricated", help: "Invented metrics/spin — only used at high aggressiveness." },
];

export const PERSONA_VALUE_FIELDS = [
  { key: "PRIMARY_FUNCTION", label: "Headline role (summary)", placeholder: "Finance Instructor" },
  { key: "SPECIALIZATION", label: "Specialization (job titles)", placeholder: "Finance" },
  { key: "FUNCTION", label: "Short function (job titles)", placeholder: "Instructor" },
  { key: "SOLUTION_TYPES", label: "What you build / teach (summary)", placeholder: "online finance courses and curricula" },
  { key: "SCALE_DESCRIPTOR", label: "Scale descriptor (summary)", placeholder: "rigorous, outcomes-based" },
  { key: "ENVIRONMENT_TYPES", label: "Environment (summary)", placeholder: "online, higher-education" },
  { key: "LEADERSHIP_SCOPE", label: "Leadership scope (summary)", placeholder: "adjunct faculty and students" },
  { key: "YEARS_OF_EXPERIENCE", label: "Years of experience", placeholder: "7" },
];

export const TABS = [
  { label: "Buzzwords", help: "The taxonomy — canonical terms and the aliases matched in postings. This is what the engine recognizes and surfaces." },
  { label: "Focus Areas", help: "Per-role retargeting. When a posting's match terms clear the threshold, the area reframes the résumé + cover letter." },
  { label: "Skill Groups", help: "Your skills, grouped. Conditional groups only surface when a posting asks for them." },
  { label: "Content Library", help: "Tagged accomplishment/bullet fragments the engine slots into the résumé." },
  { label: "Profile", help: "Static placeholder values (name, rank, scale figures, skills-row headings) the posting can't supply." },
  { label: "Personas", help: "Named identities that reframe the résumé + cover letter per posting — e.g. a 'Finance Educator' persona. Your base profile stays unchanged." },
  { label: "Preview", help: "Render the résumé + cover letter from a pasted posting against your current library — verify edits without AI." },
];
