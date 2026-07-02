// Buzzword scrape of a posting → suggested library additions. Recognizes with
// the FULL bundled taxonomy (so suggestions are rich even if the user trimmed
// theirs), diffs against the user's current canonicals, and adds RAKE topic
// phrases the taxonomy misses entirely. Read-only — callers show the results
// and commit only what the user approves via /api/library/import.
//
// Shared by /api/library/extract (the manual "analyze a posting" flow) and
// /api/tailor (the automatic low-match prompt).

import { extractKeywords } from "../keywords.js";
import { defaultLibraryData } from "./defaults.js";
import { loadLibrary } from "./loadLibrary.js";
import { extractPostingMeta, cleanPostingTitle } from "../../../postingMeta.js";
import { TAXONOMY_CATEGORIES } from "./validate.js";

const MAX_BUZZWORDS = 40;
const MAX_TOPIC_CANDIDATES = 12;

function titleCase(s) {
  return String(s).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

// Words too generic to be safe standalone aliases (the "next" → "next level"
// false-match class the validators also warn about).
const GENERIC_ALIAS = new Set([
  "next", "data", "web", "app", "api", "team", "lead", "cloud", "ai", "ml", "go", "code", "test", "design",
]);
const ACRONYM_SKIP_WORDS = new Set(["of", "and", "the", "for", "in", "to", "with", "a", "an"]);

// Deterministic alias candidates for a NEW (scraped) canonical, so an approved
// term matches more future postings than its literal spelling:
//   - acronym of multi-word phrases ("care plan documentation" → "cpd"-style,
//     only when 3-5 letters and not a generic word)
//   - hyphen/slash ↔ space variants
//   - "&" ↔ "and" variants
// Conservative by design — a wrong alias causes silent mis-matches forever.
export function aliasCandidates(canonical) {
  const c = String(canonical || "").trim();
  if (!c) return [];
  const out = new Set();
  const lower = c.toLowerCase();

  const words = lower.split(/[\s/-]+/).filter((w) => w && !ACRONYM_SKIP_WORDS.has(w));
  if (words.length >= 2 && words.length <= 5 && words.every((w) => /^[a-z][a-z0-9.]*$/.test(w))) {
    const acronym = words.map((w) => w[0]).join("");
    if (acronym.length >= 3 && acronym.length <= 5 && !GENERIC_ALIAS.has(acronym)) {
      out.add(acronym);
    }
  }
  if (/[-/]/.test(lower)) out.add(lower.replace(/[-/]+/g, " ").replace(/\s+/g, " ").trim());
  if (/\s&\s/.test(lower)) out.add(lower.replace(/\s&\s/g, " and "));
  else if (/\sand\s/.test(lower)) out.add(lower.replace(/\sand\s/g, " & "));

  out.delete(lower);
  return [...out];
}

// Analyze a posting and suggest library additions the user's taxonomy lacks.
// Returns { title, company, excerpt, categories, buzzwords, suggestedFocusArea,
// suggestedSkillGroup }. `loadLibraryImpl` is injectable for tests.
export async function buildLibrarySuggestions(
  { posting, title = "", company = "", userId } = {},
  { loadLibraryImpl = loadLibrary } = {},
) {
  const body = String(posting || "");

  let finalTitle = title;
  let finalCompany = company;
  if (!finalTitle || !finalCompany) {
    const meta = extractPostingMeta(body);
    finalTitle = finalTitle || meta.jobTitle;
    finalCompany = finalCompany || meta.companyName;
  }
  finalTitle = cleanPostingTitle(finalTitle);

  // Recognize with the full bundled taxonomy so suggestions are rich even if the
  // user has trimmed their own; compare against the user's current canonicals.
  const kw = extractKeywords(body, defaultLibraryData.taxonomy);
  const lib = await loadLibraryImpl({ userId });
  const have = new Set((lib.taxonomy?.entries || []).map((e) => String(e.canonical).toLowerCase()));

  // Bundled taxonomy entries by canonical, so recognized suggestions carry
  // their full alias web into the import ("Kubernetes" without "k8s"/"eks"
  // would match far fewer future postings than the bundled entry does).
  const bundled = new Map(
    (defaultLibraryData.taxonomy?.entries || []).map((e) => [String(e.canonical).toLowerCase(), e]),
  );

  const byCat = {};
  const buzzwords = [];
  for (const cat of TAXONOMY_CATEGORIES) {
    const items = (kw[cat] || []).slice().sort((a, b) => b.score - a.score);
    byCat[cat] = items.map((i) => i.canonical);
    for (const it of items) {
      if (!have.has(it.canonical.toLowerCase())) {
        const entry = bundled.get(it.canonical.toLowerCase());
        buzzwords.push({
          canonical: it.canonical,
          category: cat,
          score: it.score,
          aliases: Array.isArray(entry?.aliases) ? entry.aliases : [],
          ...(entry?.match_canonical === false ? { match_canonical: false } : {}),
        });
      }
    }
  }
  // RAKE phrases the taxonomy missed -> uncategorized new-buzzword candidates,
  // with deterministic alias candidates so they match more than their spelling.
  for (const t of (kw.topic || []).slice(0, MAX_TOPIC_CANDIDATES)) {
    if (!have.has(String(t.canonical).toLowerCase())) {
      const canonical = titleCase(t.canonical);
      buzzwords.push({ canonical, category: "", score: t.score, aliases: aliasCandidates(canonical) });
    }
  }
  buzzwords.sort((a, b) => b.score - a.score);

  const top = (cat, n) => (byCat[cat] || []).slice(0, n);
  const domains = top("domain", 6);
  const tech = [...new Set([...top("technology", 4), ...top("tool_platform", 3)])];

  return {
    title: finalTitle,
    company: finalCompany,
    excerpt: body.slice(0, 320),
    categories: TAXONOMY_CATEGORIES,
    buzzwords: buzzwords.slice(0, MAX_BUZZWORDS),
    suggestedFocusArea: {
      name: finalTitle || "",
      match: [...new Set([finalTitle, ...domains.slice(0, 3)].filter(Boolean))],
      subjects: domains,
      job_emphases: domains,
      technical_capabilities: tech,
      domain_capabilities: domains,
    },
    suggestedSkillGroup: {
      heading: finalTitle ? `${finalTitle} stack` : "Imported skills",
      categories: ["technology", "tool_platform"],
      keywords: tech,
    },
  };
}
