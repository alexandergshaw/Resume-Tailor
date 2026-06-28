import { NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { fetchUrlContent, extractUrls } from "@/lib/scrape/fetchUrlContent";
import { lookupAtsPostingUrl } from "@/lib/scrape/atsLookup";

export const runtime = "nodejs";
// Reading + searching + pulling a posting can chain several network calls; give
// the function room so it isn't killed mid-request (which surfaces client-side
// as a bare "Failed to fetch").
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB — screenshots are well under this
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_URL_CANDIDATES = 5;

// Pull the first JSON object out of a model response. The vision call uses JSON
// mime so this is usually clean, but parse defensively all the same.
export function parseVisionJson(rawText) {
  const text = String(rawText || "");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      jobTitle: String(parsed.jobTitle || "").trim(),
      company: String(parsed.company || "").trim(),
      location: String(parsed.location || "").trim(),
      postingText: String(parsed.postingText || "").trim(),
      searchQuery: String(parsed.searchQuery || "").trim(),
    };
  } catch {
    return null;
  }
}

// Real source links Google grounded on while searching for the posting URL.
function groundingUris(response) {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const out = [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (uri) out.push(String(uri));
  }
  return out;
}

// Sites we'd rather not link to as the canonical posting. LinkedIn gates the
// posting behind a login wall (so we usually can't scrape it anyway) and isn't
// the original source — prefer the company's careers page or an open job board.
const DEPRIORITIZED_HOSTS = ["linkedin.com", "lnkd.in"];

function isDeprioritizedHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return DEPRIORITIZED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Stable reorder that pushes de-prioritized hosts (e.g. LinkedIn) to the end
// while preserving the model's relative ordering otherwise, so resolvePosting
// tries the original/open sources first and only falls back to LinkedIn.
export function rankCandidates(urls) {
  const list = Array.isArray(urls) ? urls : [];
  return [
    ...list.filter((u) => !isDeprioritizedHost(u)),
    ...list.filter((u) => isDeprioritizedHost(u)),
  ];
}

// Ordered, de-duplicated URL candidates for the posting: prefer direct URLs the
// model wrote out, then fall back to the grounded redirect links (which resolve
// to the real source when followed). LinkedIn-style hosts sink to the bottom.
export function candidateUrls(searchResponse) {
  const fromText = extractUrls(searchResponse?.text || "", MAX_URL_CANDIDATES);
  const fromGrounding = groundingUris(searchResponse);
  const seen = new Set();
  const out = [];
  for (const u of [...fromText, ...fromGrounding]) {
    const cleaned = String(u || "").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_URL_CANDIDATES) break;
  }
  return rankCandidates(out);
}

function visionPrompt() {
  return [
    "You are reading a screenshot of an online job posting. Extract only what is VISIBLE in the image.",
    'Return ONLY a JSON object: {"jobTitle":"","company":"","location":"","postingText":"","searchQuery":""}',
    "- jobTitle: the ROLE TITLE ONLY (e.g. \"Senior Software Engineer\"). Exclude the company name, salary or pay range, location, work mode (remote/hybrid/onsite), employment type (full-time/contract), seniority pay bands, requisition IDs, and dates.",
    "- company: the hiring company or organization NAME ONLY — no tagline, location, salary, or industry.",
    "- location: the location if shown, otherwise \"\".",
    "- postingText: ALL readable posting text in the image (summary, responsibilities, qualifications) as plain text.",
    "- searchQuery: a concise web-search query that would locate THIS exact posting — include the title, the company, and one distinctive phrase.",
    "Never invent details that are not visible in the image.",
  ].join("\n");
}

// Strip salary figures, parentheticals, and dangling separators so a value is
// clean enough to put in a file name. Used for the job title and company so the
// downloaded files read "<Company> - <Role> - Resume.docx", not the page's
// salary-laden <title>.
export function tidyField(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    // $120k, $120,000, $120k–$150k, 120k/yr, etc.
    .replace(/\$\s?[\d.,]+\s?[kKmM]?(?:\s*[-–—]\s*\$?\s?[\d.,]+\s?[kKmM]?)?(?:\s*(?:\/|per)\s*(?:yr|year|hr|hour|mo|month|wk|week))?/g, " ")
    .replace(/\b\d{2,3}\s?[kK]\b(?:\s*[-–—]\s*\d{2,3}\s?[kK]\b)?/g, " ")
    .replace(/\s+/g, " ")
    // collapse separators left dangling where a salary chunk was removed
    .replace(/(\s*[-–—|·•,]\s*){2,}/g, " - ")
    .replace(/^\s*[-–—|·•,]+\s*/g, "")
    .replace(/\s*[-–—|·•,]+\s*$/g, "")
    .trim();
}

function urlSearchPrompt({ jobTitle, company, location, postingText, searchQuery }) {
  return [
    "Using Google Search, find the live URL of this exact job posting.",
    searchQuery ? `Search hint: ${searchQuery}` : "",
    jobTitle ? `Title: ${jobTitle}` : "",
    company ? `Company: ${company}` : "",
    location ? `Location: ${location}` : "",
    postingText ? `Distinctive text from the posting: ${postingText.slice(0, 240)}` : "",
    "",
    "Return the single best DIRECT URL to the posting's own page. Prefer the company's own careers site, or an openly accessible job board (Greenhouse, Lever, Ashby, Workday, Indeed, etc.).",
    "Avoid LinkedIn unless the posting appears nowhere else — LinkedIn requires a login and is not the original source.",
    "Output ONLY the URL on its own line, nothing else. If you cannot confidently find it, output NONE.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Resolve & validate the candidate URLs by fetching them: the first that yields
// real posting text wins (and gives us a clean final URL + scraped metadata).
async function resolvePosting(candidates) {
  for (const candidate of candidates.slice(0, MAX_URL_CANDIDATES)) {
    let scraped;
    try {
      scraped = await fetchUrlContent(candidate);
    } catch {
      continue;
    }
    if (scraped && !scraped.error && String(scraped.description || "").trim().length > 80) {
      return {
        url: scraped.finalUrl || candidate,
        postingText: scraped.description,
        title: scraped.title || "",
        company: scraped.company || "",
      };
    }
  }
  return null;
}

export async function POST(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const image = formData.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "An image file is required." }, { status: 400 });
  }
  const mimeType = (image.type || "").toLowerCase();
  if (!ALLOWED_MIME.includes(mimeType)) {
    return NextResponse.json({ error: "Upload a PNG, JPG, or WebP screenshot." }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "That image is too large — keep screenshots under 12MB." }, { status: 400 });
  }

  // Reading the screenshot + finding the posting always use Gemini; the selected
  // tailoring engine (e.g. Embedded) only governs the downstream document
  // generation, not this step.
  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return NextResponse.json(
      { error: "Reading screenshots needs the Gemini API key to be configured." },
      { status: 503 },
    );
  }

  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");

  // 1) Read the screenshot → { jobTitle, company, location, postingText, searchQuery }.
  let fields;
  try {
    const visionResponse = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType, data: base64 } },
            { text: visionPrompt() },
          ],
        },
      ],
      config: { responseMimeType: "application/json" },
    });
    fields = parseVisionJson(visionResponse?.text || "");
  } catch (err) {
    console.error("Screenshot read failed:", err);
    return NextResponse.json({ error: err?.message || "Couldn't read that screenshot." }, { status: 502 });
  }

  if (!fields || (!fields.jobTitle && !fields.postingText)) {
    return NextResponse.json(
      { found: false, reason: "Couldn't recognize a job posting in that image." },
      { status: 200 },
    );
  }

  // 2) Find the live posting URL: the company's ATS board first (deterministic,
  // canonical, never LinkedIn), then Gemini's grounded Google Search.
  const found = [];
  try {
    const ats = await lookupAtsPostingUrl({ company: fields.company, jobTitle: fields.jobTitle });
    if (ats?.url) found.push(ats.url);
  } catch (err) {
    console.error("ATS posting lookup failed:", err);
  }
  try {
    const searchResponse = await client.models.generateContent({
      model,
      contents: urlSearchPrompt(fields),
      tools: [{ googleSearch: {} }],
    });
    found.push(...candidateUrls(searchResponse));
  } catch (err) {
    console.error("Posting URL search failed:", err);
  }
  const candidates = rankCandidates([...new Set(found.filter(Boolean))]);

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        found: false,
        jobTitle: fields.jobTitle,
        company: fields.company,
        reason: "Couldn't find the live posting URL for this screenshot.",
      },
      { status: 200 },
    );
  }

  // 3) Resolve + pull the posting from the found URL.
  const resolved = await resolvePosting(candidates);
  // Name the documents from the screenshot's own title/company (what the user
  // saw) rather than the scraped page <title>, which often carries salary,
  // location, and the site name. Fall back to the scrape only when vision missed.
  if (resolved) {
    return NextResponse.json({
      found: true,
      url: resolved.url,
      jobTitle: tidyField(fields.jobTitle || resolved.title),
      company: tidyField(fields.company || resolved.company),
      location: fields.location,
      postingText: resolved.postingText,
    });
  }

  // A live URL was located but we couldn't scrape it (e.g. a WAF 403). We still
  // have the posting's own text from the screenshot — tailor from that, keeping
  // the located URL for tracking and research.
  if (fields.postingText.length > 80) {
    return NextResponse.json({
      found: true,
      url: candidates[0],
      jobTitle: tidyField(fields.jobTitle),
      company: tidyField(fields.company),
      location: fields.location,
      postingText: fields.postingText,
    });
  }

  return NextResponse.json(
    {
      found: false,
      jobTitle: fields.jobTitle,
      company: fields.company,
      url: candidates[0],
      reason: "Found a posting link but couldn't read the posting from it.",
    },
    { status: 200 },
  );
}
