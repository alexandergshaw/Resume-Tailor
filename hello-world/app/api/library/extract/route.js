import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { buildLibrarySuggestions } from "@/lib/llm/engines/tailor-lite/library/suggest";
import { getAuth, unauthorized } from "@/lib/llm/engines/tailor-lite/library/apiSupport";

export const runtime = "nodejs";

const MAX_POSTING_CHARS = 20000;

// Analyze a posting (URL via the shared scraper, or pasted text) and suggest
// library additions: new buzzwords (recognized canonicals the user's taxonomy
// lacks + RAKE topic phrases the taxonomy misses), plus a focus-area and a
// skill-group scaffold built from the dominant terms. Read-only; the user then
// reviews and inserts via /api/library/import. The suggestion assembly lives in
// buildLibrarySuggestions, shared with /api/tailor's low-match prompt.
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

  return Response.json(await buildLibrarySuggestions({ posting, title, company, userId }));
}
