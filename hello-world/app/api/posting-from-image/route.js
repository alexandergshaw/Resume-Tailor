import { NextResponse } from "next/server";
import { getAuth, unauthorized } from "@/lib/experience/apiAuth";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { fetchUrlContent, extractUrls } from "@/lib/scrape/fetchUrlContent";
import { lookupAtsPostingUrl } from "@/lib/scrape/atsLookup";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { readScreenshotOffline } from "@/lib/scrape/screenshotOcr";
import { searchPostingUrls } from "@/lib/scrape/webSearch";

export const runtime = "nodejs";
// Reading + searching + pulling a posting can chain several network calls; give
// the function room so it isn't killed mid-request (which surfaces client-side
// as a bare "Failed to fetch").
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB — screenshots are well under this
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_URL_CANDIDATES = 5;

// ---------------------------------------------------------------------------
// THE SPEND CEILING, on the most expensive single request in the product:
// vision (or Tesseract OCR) over an uploaded image, then a grounded web search,
// then up to five outbound page fetches. Until this change the 12MB upload cap
// was the ONLY thing throttling a loop against it, and the caller did not need
// an account.
//
// BUILT AT MODULE SCOPE, AND THAT IS LOAD-BEARING. A limiter constructed inside
// the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. lib/rateLimit/index.js's header states
// this as the one way to adopt it catastrophically wrong, and this route's
// suite pins BOTH halves -- a behavioural case that fires 31 requests and
// expects the 31st to be denied, and a static case that this declaration
// precedes `POST`.
//
// 30 screenshots per 10 minutes, per authenticated user, and the number is
// argued from the client rather than from the per-call cost. Screenshots are
// processed by a SERIAL loop (app/hooks/useScreenshots.js:133) that, for each
// item, runs this whole pipeline and THEN a full tailoring call before starting
// the next -- tens of seconds per item -- so the largest batch that loop can
// physically push through a ten-minute window is well under 30, and a real
// user dropping a folder of postings is never clipped. What 30 does buy is the
// difference between a scripted loop costing thousands of vision calls and
// costing sixty. A DENIED REQUEST STILL INCREMENTS (see the module's header):
// the bound is 30 ATTEMPTS, not 30 successes.
//
// HONEST ABOUT WHAT THIS BUYS: `createMemoryStore` is per-instance, so on
// serverless this bounds a caller to 30 x instanceCount, not 30. It is worth
// having anyway, but it is not a fleet-wide guarantee and must not be described
// as one. Swapping in a Redis-backed store satisfying the same two-method
// interface needs no change here.
// ---------------------------------------------------------------------------
const screenshotLimiter = createRateLimiter({ limit: 30, windowMs: 600_000, prefix: "posting-from-image" });

const RATE_LIMITED_MESSAGE =
  "Too many screenshots read in a short window. Wait a moment and try the rest again.";

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

// Aggregators we'd rather not link to as the canonical posting: they gate
// content behind logins/CAPTCHAs, geo-block, or expire their job URLs, so the
// link often doesn't work for the user. Prefer the company's own careers page or
// the ATS board it's posted on.
const DEPRIORITIZED_HOSTS = [
  "linkedin.com",
  "lnkd.in",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "simplyhired.com",
];

function isDeprioritizedHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return DEPRIORITIZED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Stable reorder that pushes de-prioritized hosts (LinkedIn, Indeed, etc.) to
// the end while preserving the model's relative ordering otherwise, so
// resolvePosting tries the original/open sources first and only falls back to
// an aggregator when nothing else resolves.
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
    "- location: the location if shown (include the state/region when visible, e.g. \"Omaha, NE\"), otherwise \"\".",
    "- postingText: ALL readable posting text in the image (summary, responsibilities, qualifications) as plain text.",
    "- searchQuery: a concise web-search query that would locate THIS exact posting — include the title, the company, the location WITH its state/region, and any visible job or requisition number (these disambiguate similarly named employers).",
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
    "Return the single best DIRECT URL to the posting's own page. Strongly prefer the company's own careers site or the ATS board it's hosted on (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, NEOGOV/governmentjobs, etc.).",
    "Use the location — city AND state — to pick the RIGHT employer: many organizations share a name (e.g. there are several 'Douglas County' governments in different states).",
    "Only return a URL that actually appears in the search results — never construct, guess, or edit a URL (do not invent or alter the path, slug, or job id).",
    "Avoid aggregators like LinkedIn, Indeed, Glassdoor, and ZipRecruiter unless the posting appears nowhere else — they require logins/CAPTCHAs, expire, and are not the original source.",
    "Output ONLY the URL on its own line, nothing else. If you cannot confidently find it, output NONE.",
  ]
    .filter(Boolean)
    .join("\n");
}

// A URL with no real path — a site homepage / landing page. Never a job posting,
// and a common wrong fallback (e.g. governmentjobs.com/ instead of the posting).
export function isBareDomain(url) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path === "";
  } catch {
    return false;
  }
}

// Resolve & validate the candidate URLs by fetching them. Returns:
//   resolved  — the first candidate that yields real posting text (with its
//               clean final URL + scraped metadata), or null.
//   validUrl  — the best URL to surface even when no text was scraped: a
//               confirmed-reachable non-homepage page, else a blocked-but-
//               plausible one. Candidates that REDIRECT to a homepage (e.g. an
//               expired governmentjobs job id) are excluded entirely, so we
//               never display a deep URL that bounces to the site root.
async function resolvePosting(candidates) {
  let liveUrl = ""; // fetched OK, lands on a real (non-homepage) page
  let maybeUrl = ""; // non-homepage candidate we couldn't reach (WAF/timeout)
  for (const candidate of candidates.slice(0, MAX_URL_CANDIDATES)) {
    if (isBareDomain(candidate)) continue;
    let scraped;
    try {
      scraped = await fetchUrlContent(candidate);
    } catch {
      scraped = { error: "fetch failed" };
    }
    if (!scraped || scraped.error) {
      if (!maybeUrl) maybeUrl = candidate;
      continue;
    }
    const finalUrl = scraped.finalUrl || candidate;
    if (isBareDomain(finalUrl)) continue; // redirected to the homepage — dead
    if (!liveUrl) liveUrl = finalUrl;
    if (String(scraped.description || "").trim().length > 80) {
      return {
        resolved: {
          url: finalUrl,
          postingText: scraped.description,
          title: scraped.title || "",
          company: scraped.company || "",
        },
        validUrl: finalUrl,
      };
    }
  }
  return { resolved: null, validUrl: liveUrl || maybeUrl };
}

export async function POST(request) {
  // ORDER IS LOAD-BEARING BELOW.
  //
  // 1. IDENTITY, from `auth.getUser()` by way of the shared `getAuth()`. Never
  //    `getSession()`: that call makes ZERO network requests
  //    (app/api/health/route.js:204-210 records the measurement), so gating on
  //    it is not a weak check, it is a total bypass. Ahead of the MULTIPART
  //    READ on purpose -- `request.formData()` buffers up to 12MB, and an
  //    anonymous caller must not get this server to do that, never mind run
  //    vision over the result.
  //
  //    Nothing legitimate is locked out by this. The only caller is
  //    app/hooks/useScreenshots.js on `/`, a PAGE route, and
  //    lib/supabase/middleware.js redirects any page route to /login without a
  //    session -- there is no signed-out onboarding path through here.
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  // 2. THE BOUND, keyed on the id step 1 resolved to -- never on the caller's
  //    access token, and never before the auth resolves. Checked ahead of the
  //    upload validation on purpose: an invalid request is still a request, and
  //    a caller hammering this endpoint with junk should exhaust its own
  //    allowance rather than get an unmetered lane.
  const decision = await screenshotLimiter.check(identify(request, { userId }));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

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

  // Reading the screenshot + finding the posting normally use Gemini. The
  // Embedded engine instead reads it offline with Tesseract OCR and finds the
  // URL with a keyless web search, so this works with no Gemini key.
  const embedded = wantsEmbedded(formData.get("engine")?.toString() || "");

  let model;
  let client;
  if (!embedded) {
    try {
      model = getServerEnv().geminiModel;
      client = getGeminiClient();
    } catch {
      return NextResponse.json(
        {
          error:
            "Reading screenshots needs the Gemini API key to be configured, or switch to the Embedded engine.",
        },
        { status: 503 },
      );
    }
  }

  const buffer = Buffer.from(await image.arrayBuffer());

  // 1) Read the screenshot → { jobTitle, company, location, postingText, searchQuery }.
  let fields;
  if (embedded) {
    try {
      fields = await readScreenshotOffline(buffer);
    } catch (err) {
      console.error("Offline screenshot OCR failed:", err);
      return NextResponse.json({ error: err?.message || "Couldn't read that screenshot." }, { status: 502 });
    }
  } else {
    const base64 = buffer.toString("base64");
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
  }

  if (!fields || (!fields.jobTitle && !fields.postingText)) {
    return NextResponse.json(
      { found: false, reason: "Couldn't recognize a job posting in that image." },
      { status: 200 },
    );
  }

  // 2) Find the live posting URL: the company's ATS board first (deterministic,
  // canonical, never LinkedIn), then either Gemini's grounded Google Search or,
  // for the Embedded engine, a keyless web search.
  const found = [];
  try {
    const ats = await lookupAtsPostingUrl({ company: fields.company, jobTitle: fields.jobTitle });
    if (ats?.url) found.push(ats.url);
  } catch (err) {
    console.error("ATS posting lookup failed:", err);
  }
  if (embedded) {
    try {
      const query =
        fields.searchQuery || [fields.jobTitle, fields.company].filter(Boolean).join(" ");
      if (query.trim()) {
        found.push(...(await searchPostingUrls({ query, limit: MAX_URL_CANDIDATES })));
      }
    } catch (err) {
      console.error("Offline posting URL search failed:", err);
    }
  } else {
    try {
      const searchResponse = await client.models.generateContent({
        model,
        contents: urlSearchPrompt(fields),
        // `tools` LIVES INSIDE `config`. DO NOT FLATTEN IT BACK OUT.
        // `GenerateContentParameters` has exactly THREE properties — `model`,
        // `contents`, `config` — and `tools` belongs to
        // `GenerateContentConfig`. The SDK's parameter transformer reads only
        // those three keys and DISCARDS everything else before building the
        // request body, with no warning, so a top-level `tools` never reaches
        // Google. Here the failure hid behind the fallback below: with no
        // search the model guesses a live posting URL from training data, and
        // the route quietly settles for the OCR text — working, worse,
        // forever. Pinned on the wire by route.wire.test.js.
        config: { tools: [{ googleSearch: {} }] },
      });
      found.push(...candidateUrls(searchResponse));
    } catch (err) {
      console.error("Posting URL search failed:", err);
    }
  }
  const candidates = rankCandidates([...new Set(found.filter(Boolean))]);

  // The URL search is a best-effort enhancement on the embedded path: OCR
  // already read the posting off the screenshot, so when search comes up empty
  // (offline, rate-limited, obscure employer) tailor from that text instead of
  // failing — the pipeline completes with zero network beyond the upload.
  const embeddedTextFallback = () =>
    NextResponse.json({
      found: true,
      url: "",
      jobTitle: tidyField(fields.jobTitle),
      company: tidyField(fields.company),
      location: fields.location,
      postingText: fields.postingText,
    });
  const canFallBackToOcrText = embedded && fields.postingText.trim().length > 80;

  if (candidates.length === 0) {
    if (canFallBackToOcrText) return embeddedTextFallback();
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
  const { resolved, validUrl } = await resolvePosting(candidates);
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

  // A real posting URL was located but we couldn't scrape it (WAF 403 / thin
  // SPA). validUrl is never a homepage-bouncing link — tailor from the posting
  // text already read off the screenshot, keeping the working URL.
  if (validUrl && fields.postingText.length > 80) {
    return NextResponse.json({
      found: true,
      url: validUrl,
      jobTitle: tidyField(fields.jobTitle),
      company: tidyField(fields.company),
      location: fields.location,
      postingText: fields.postingText,
    });
  }

  // Embedded: candidates existed but none survived resolution — same OCR-text
  // fallback as when the search found nothing at all.
  if (canFallBackToOcrText) return embeddedTextFallback();

  return NextResponse.json(
    {
      found: false,
      jobTitle: fields.jobTitle,
      company: fields.company,
      url: validUrl,
      reason: validUrl
        ? "Found a posting link but couldn't read the posting from it."
        : "Couldn't pin down the exact posting URL (the link found wasn't the right one). Try again, or paste it in the Posting URL tab.",
    },
    { status: 200 },
  );
}
