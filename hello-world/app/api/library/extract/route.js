import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { loadLibrary } from "@/lib/llm/engines/tailor-lite/library/loadLibrary";
import { extractPostingMeta, cleanPostingTitle } from "@/lib/llm/postingMeta";
import { getAuth, unauthorized } from "@/lib/llm/engines/tailor-lite/library/apiSupport";
import { TAXONOMY_CATEGORIES } from "@/lib/llm/engines/tailor-lite/library/validate";

export const runtime = "nodejs";

const MAX_POSTING_CHARS = 20000;

function titleCase(s) {
  return String(s).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

// Analyze a posting (URL via the shared scraper, or pasted text) and suggest
// library additions: new buzzwords (recognized canonicals the user's taxonomy
// lacks + RAKE topic phrases the taxonomy misses), plus a focus-area and a
// skill-group scaffold built from the dominant terms. Read-only; the user then
// reviews and inserts via /api/library/import.
export async function POST(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  let posting = typeof body?.posting === "string" ? body.posting.slice(0, MAX_POSTING_CHARS) : "";
  let title = "";
  let company = "";

  if (!posting && url) {
    const scraped = await fetchUrlContent(url);
    if (scraped.error) return Response.json({ error: scraped.error }, { status: 502 });
    posting = String(scraped.description || "").slice(0, MAX_POSTING_CHARS);
    title = scraped.title || "";
    company = scraped.company || "";
  }
  if (!posting.trim()) return Response.json({ error: "Provide a posting URL or paste the text." }, { status: 400 });

  if (!title || !company) {
    const meta = extractPostingMeta(posting);
    title = title || meta.jobTitle;
    company = company || meta.companyName;
  }
  title = cleanPostingTitle(title);

  // Recognize with the full bundled taxonomy so suggestions are rich even if the
  // user has trimmed their own; compare against the user's current canonicals.
  const kw = extractKeywords(posting, defaultLibraryData.taxonomy);
  const lib = await loadLibrary({ userId });
  const have = new Set((lib.taxonomy?.entries || []).map((e) => String(e.canonical).toLowerCase()));

  const byCat = {};
  const buzzwords = [];
  for (const cat of TAXONOMY_CATEGORIES) {
    const items = (kw[cat] || []).slice().sort((a, b) => b.score - a.score);
    byCat[cat] = items.map((i) => i.canonical);
    for (const it of items) {
      if (!have.has(it.canonical.toLowerCase())) {
        buzzwords.push({ canonical: it.canonical, category: cat, score: it.score });
      }
    }
  }
  // RAKE phrases the taxonomy missed -> uncategorized new-buzzword candidates.
  for (const t of (kw.topic || []).slice(0, 12)) {
    if (!have.has(String(t.canonical).toLowerCase())) {
      buzzwords.push({ canonical: titleCase(t.canonical), category: "", score: t.score });
    }
  }
  buzzwords.sort((a, b) => b.score - a.score);

  const top = (cat, n) => (byCat[cat] || []).slice(0, n);
  const domains = top("domain", 6);
  const tech = [...new Set([...top("technology", 4), ...top("tool_platform", 3)])];

  return Response.json({
    title,
    company,
    excerpt: posting.slice(0, 320),
    categories: TAXONOMY_CATEGORIES,
    buzzwords: buzzwords.slice(0, 40),
    suggestedFocusArea: {
      name: title || "",
      match: [...new Set([title, ...domains.slice(0, 3)].filter(Boolean))],
      subjects: domains,
      job_emphases: domains,
      technical_capabilities: tech,
      domain_capabilities: domains,
    },
    suggestedSkillGroup: {
      heading: title ? `${title} stack` : "Imported skills",
      categories: ["technology", "tool_platform"],
      keywords: tech,
    },
  });
}
