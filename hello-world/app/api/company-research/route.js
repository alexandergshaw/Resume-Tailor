import { NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";

export const runtime = "nodejs";

const MAX_POSTING_CHARS = 6000;
const MAX_ARTICLE_CHARS = 6000;
const WANT = 3;

// Pull the first JSON array (or {articles:[...]}) out of a model text response.
// Gemini's googleSearch tool is incompatible with responseMimeType:json, so the
// model returns prose around a fenced JSON block — parse defensively.
export function parseArticles(rawText) {
  const text = String(rawText || "");
  const candidates = [];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) candidates.push(arrMatch[0]);
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.articles) ? parsed.articles : null;
      if (!list) continue;
      return list
        .map((a, i) => ({
          id: `art-${i}`,
          title: String(a?.title || "").trim(),
          source: String(a?.source || a?.publisher || "").trim(),
          date: String(a?.date || "").trim(),
          url: String(a?.url || a?.link || "").trim(),
          summary: String(a?.summary || "").trim(),
          suggestion: String(a?.suggestion || "").trim(),
        }))
        .filter((a) => a.title && a.summary);
    } catch {
      // try the next candidate
    }
  }
  return [];
}

// Real source links Gemini grounded on (proof it actually searched). Returns the
// grounded web URIs/titles, used to gate hallucination and enrich missing URLs.
export function extractGroundingSources(response) {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const out = [];
  for (const c of chunks) {
    const web = c?.web;
    if (web?.uri) out.push({ uri: String(web.uri), title: String(web.title || "") });
  }
  return out;
}

function buildPrompt({ company, jobTitle, posting }) {
  return [
    "You are a research assistant helping a job applicant.",
    `Using Google Search, find exactly ${WANT} DISTINCT, recent (published within roughly the last 18 months) news articles or reputable posts that portray the company "${company}" in a POSITIVE light`,
    "— for example: growth, funding, new products or launches, awards and recognition, strong culture, leadership, or social/community impact. Avoid anything negative, controversial, or older than ~2 years.",
    jobTitle ? `The applicant is applying for the "${jobTitle}" role, so prefer angles relevant to that role.` : "",
    "",
    "For each article return:",
    "- title: the headline",
    "- source: the publication/site name",
    "- date: the approximate publication date (e.g. \"March 2026\")",
    "- url: the direct article URL",
    "- summary: 1-2 sentences on the positive angle",
    "- suggestion: ONE natural sentence the applicant could put in a cover letter to reference it (first person, sincere, not flattery-stuffed).",
    "",
    `Output ONLY a JSON object: {"articles": [ {"title": "", "source": "", "date": "", "url": "", "summary": "", "suggestion": ""} ]} with exactly ${WANT} items. No commentary outside the JSON.`,
    posting ? `\nJob posting context (for relevance only):\n${String(posting).slice(0, MAX_POSTING_CHARS)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// A user-supplied article URL → one source card. Fetches the page and, when
// Gemini is configured, summarizes it into {title, source, date, summary,
// suggestion}; otherwise returns a title-only card with a blank suggestion to edit.
async function researchUrl({ url, company, jobTitle }) {
  const scraped = await fetchUrlContent(url);
  if (scraped.error) {
    return NextResponse.json(
      { error: `Couldn't read that URL (${scraped.error}).` },
      { status: 502 },
    );
  }
  const baseArticle = {
    id: "art-url",
    title: scraped.title || hostOf(url) || "Article",
    source: hostOf(url),
    date: "",
    url,
    summary: "",
    suggestion: "",
  };

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return NextResponse.json({
      articles: [baseArticle],
      grounded: [{ uri: url, title: baseArticle.title }],
      warnings: ["Added without an AI summary (no Gemini key) — write the suggestion yourself."],
    });
  }

  const prompt = [
    "You are helping a job applicant reference a news article in a cover letter.",
    `The applicant is applying${company ? ` to "${company}"` : ""}${jobTitle ? ` for the "${jobTitle}" role` : ""}.`,
    "From the article text below, produce one JSON object describing it for the applicant to reference.",
    'Return ONLY: {"articles":[{"title":"","source":"","date":"","url":"","summary":"","suggestion":""}]}',
    "- summary: 1-2 sentences on the relevant, positive angle.",
    "- suggestion: ONE first-person sentence the applicant could use in a cover letter to reference it (sincere, specific, not flattery).",
    `- url: ${url}`,
    "",
    `Article (title: ${baseArticle.title}):`,
    String(scraped.description || "").slice(0, MAX_ARTICLE_CHARS),
  ].join("\n");

  try {
    const response = await client.models.generateContent({ model, contents: prompt });
    const parsed = parseArticles(response?.text || "");
    const a = parsed[0];
    if (!a) return NextResponse.json({ articles: [baseArticle], grounded: [{ uri: url }], warnings: [] });
    return NextResponse.json({
      articles: [{ ...baseArticle, ...a, url, source: a.source || baseArticle.source }],
      grounded: [{ uri: url, title: a.title || baseArticle.title }],
      warnings: [],
    });
  } catch {
    return NextResponse.json({ articles: [baseArticle], grounded: [{ uri: url }], warnings: [] });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const company = typeof body?.company === "string" ? body.company.trim() : "";
  const jobTitle = typeof body?.jobTitle === "string" ? body.jobTitle.trim() : "";
  const posting = typeof body?.posting === "string" ? body.posting : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  // Custom-URL mode: the user pasted an article they found.
  if (url) {
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "Enter a valid http(s) article URL." }, { status: 400 });
    }
    return researchUrl({ url, company, jobTitle });
  }

  if (!company) {
    return NextResponse.json({ error: "A company name is required to research." }, { status: 400 });
  }

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return NextResponse.json(
      { error: "Company research needs the Gemini API key to be configured." },
      { status: 503 },
    );
  }

  try {
    const response = await client.models.generateContent({
      model,
      contents: buildPrompt({ company, jobTitle, posting }),
      tools: [{ googleSearch: {} }],
    });

    const articles = parseArticles(response?.text || "");
    const grounded = extractGroundingSources(response);
    const warnings = [];
    if (grounded.length === 0) {
      warnings.push("Could not confirm these via live search — verify the source links before using them.");
    }
    if (articles.length === 0) {
      return NextResponse.json(
        { error: "No usable articles were found for that company. Try again or refine the company name." },
        { status: 502 },
      );
    }
    return NextResponse.json({ articles: articles.slice(0, WANT), grounded, warnings });
  } catch (err) {
    console.error("Company research failed:", err);
    return NextResponse.json(
      { error: err?.message || "Company research failed. Please try again." },
      { status: 502 },
    );
  }
}
