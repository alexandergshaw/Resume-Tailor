import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { generateTailoredResumeDraft } from "@/lib/llm/tailorResume";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 20000;
const MAX_CONTEXT_CHARS = 12000;
const MAX_CONTEXT_FILES = 10;
const DEFAULT_AGGRESSIVENESS = 3;
const MIN_AGGRESSIVENESS = 1;
const MAX_AGGRESSIVENESS = 5;
const TEXT_MIME_PREFIX = "text/";
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];
const DOCX_EXTENSIONS = [".docx"];
const DOCX_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
];

function isTextLikeFile(file) {
  if (file.type && file.type.startsWith(TEXT_MIME_PREFIX)) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function isDocxFile(file) {
  const lowerName = file.name.toLowerCase();

  if (DOCX_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return true;
  }

  return file.type ? DOCX_MIME_TYPES.includes(file.type) : false;
}

async function readResumeText(file) {
  if (!file) {
    return "";
  }

  if (isTextLikeFile(file)) {
    const rawText = await file.text();
    return rawText ? rawText.slice(0, MAX_RESUME_CHARS) : "";
  }

  if (isDocxFile(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    return value ? value.slice(0, MAX_RESUME_CHARS) : "";
  }

  return "";
}

async function readContextFile(file) {
  if (isTextLikeFile(file)) {
    const rawText = await file.text();
    return rawText ? rawText.slice(0, MAX_CONTEXT_CHARS) : "";
  }

  if (isDocxFile(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    return value ? value.slice(0, MAX_CONTEXT_CHARS) : "";
  }

  return "Unsupported file type for text extraction.";
}

async function parseContextDocuments(formData) {
  const rawFiles = formData.getAll("contextFiles");
  const contextFiles = rawFiles.filter((value) => value instanceof File).slice(0, MAX_CONTEXT_FILES);

  const documents = [];

  for (const file of contextFiles) {
    const content = await readContextFile(file);
    documents.push({
      name: file.name,
      content,
    });
  }

  return documents;
}

function parseAdditionalContext(rawAdditionalContext) {
  return rawAdditionalContext ? rawAdditionalContext.toString().trim().slice(0, MAX_CONTEXT_CHARS) : "";
}

function parseAggressiveness(rawAggressiveness) {
  const parsed = Number.parseInt(rawAggressiveness?.toString() || "", 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_AGGRESSIVENESS;
  }

  return Math.min(MAX_AGGRESSIVENESS, Math.max(MIN_AGGRESSIVENESS, parsed));
}

function parseTemplateLines(rawTemplateLines) {
  if (!rawTemplateLines) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawTemplateLines);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((line) => (typeof line === "string" ? line : ""))
      .slice(0, 600);
  } catch {
    return [];
  }
}

const URL_FETCH_BLOCKED_HOSTNAMES = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"];
const URL_FETCH_BLOCKED_IP_PREFIXES = [
  "10.", "192.168.",
  "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
];
const URL_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const URL_FETCH_MAX_DESCRIPTION_CHARS = 12000;
  if (typeof value !== "string") return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ""; }
    });
}

function htmlToText(html) {
  if (typeof html !== "string") return "";
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractMetaContent(html, attr, value) {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${value}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${value}["']`,
    "i",
  );
  const m = html.match(re) || html.match(re2);
  return m ? decodeHtmlEntities(m[1]).trim() : "";
}

function findJsonLdJobPosting(html) {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = [];
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const child of node) stack.push(child);
        continue;
      }
      const type = node["@type"];
      if (
        type === "JobPosting" ||
        (Array.isArray(type) && type.includes("JobPosting"))
      ) {
        candidates.push(node);
      }
      if (Array.isArray(node["@graph"])) {
        for (const child of node["@graph"]) stack.push(child);
      }
    }
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

async function fetchJobPostingFromUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: "Invalid URL." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Only HTTP and HTTPS URLs are supported." };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    URL_FETCH_BLOCKED_HOSTNAMES.includes(hostname) ||
    URL_FETCH_BLOCKED_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))
  ) {
    return { error: "That URL is not allowed." };
  }

  let response;
  try {
    response = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ResumeTailor/1.0; +https://github.com/alexandergshaw/Resume-Tailor)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { error: err?.message || "Failed to fetch URL." };
  }

  if (!response.ok) {
    return { error: `Failed to fetch URL (status ${response.status}).` };
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return { error: "URL did not return an HTML page." };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > URL_FETCH_MAX_BYTES) {
      reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = chunks.reduce((acc, chunk) => {
    const out = new Uint8Array(acc.byteLength + chunk.byteLength);
    out.set(acc);
    out.set(chunk, acc.byteLength);
    return out;
  }, new Uint8Array(0));
  const html = new TextDecoder().decode(merged);

  let title = "";
  let company = "";
  let description = "";

  const jobPosting = findJsonLdJobPosting(html);
  if (jobPosting) {
    if (typeof jobPosting.title === "string") title = jobPosting.title.trim();
    const org = jobPosting.hiringOrganization;
    if (org && typeof org === "object" && typeof org.name === "string") {
      company = org.name.trim();
    } else if (typeof org === "string") {
      company = org.trim();
    }
    if (typeof jobPosting.description === "string") {
      description = htmlToText(jobPosting.description);
    }
  }

  if (!title) {
    title =
      extractMetaContent(html, "property", "og:title") ||
      extractMetaContent(html, "name", "twitter:title") ||
      "";
  }
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = decodeHtmlEntities(titleMatch[1]).trim();
  }
  if (!company) {
    company = extractMetaContent(html, "property", "og:site_name") || "";
  }

  if (!description) {
    description = htmlToText(html);
  }

  if (description.length > URL_FETCH_MAX_DESCRIPTION_CHARS) {
    description = `${description.slice(0, URL_FETCH_MAX_DESCRIPTION_CHARS)}…`;
  }

  return {
    title,
    company,
    description,
  };
}

const URL_FETCH_BLOCKED_HOSTNAMES = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"];
const URL_FETCH_BLOCKED_IP_PREFIXES = [
  "10.", "192.168.",
  "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
];
const URL_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const URL_FETCH_MAX_DESCRIPTION_CHARS = 12000;
  if (typeof value !== "string") return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ""; }
    });
}

function htmlToText(html) {
  if (typeof html !== "string") return "";
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractMetaContent(html, attr, value) {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${value}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${value}["']`,
    "i",
  );
  const m = html.match(re) || html.match(re2);
  return m ? decodeHtmlEntities(m[1]).trim() : "";
}

function findJsonLdJobPosting(html) {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = [];
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const child of node) stack.push(child);
        continue;
      }
      const type = node["@type"];
      if (
        type === "JobPosting" ||
        (Array.isArray(type) && type.includes("JobPosting"))
      ) {
        candidates.push(node);
      }
      if (Array.isArray(node["@graph"])) {
        for (const child of node["@graph"]) stack.push(child);
      }
    }
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

async function fetchJobPostingFromUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: "Invalid URL." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Only HTTP and HTTPS URLs are supported." };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    URL_FETCH_BLOCKED_HOSTNAMES.includes(hostname) ||
    URL_FETCH_BLOCKED_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))
  ) {
    return { error: "That URL is not allowed." };
  }

  let response;
  try {
    response = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ResumeTailor/1.0; +https://github.com/alexandergshaw/Resume-Tailor)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { error: err?.message || "Failed to fetch URL." };
  }

  if (!response.ok) {
    return { error: `Failed to fetch URL (status ${response.status}).` };
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return { error: "URL did not return an HTML page." };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > URL_FETCH_MAX_BYTES) {
      reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = chunks.reduce((acc, chunk) => {
    const out = new Uint8Array(acc.byteLength + chunk.byteLength);
    out.set(acc);
    out.set(chunk, acc.byteLength);
    return out;
  }, new Uint8Array(0));
  const html = new TextDecoder().decode(merged);

  let title = "";
  let company = "";
  let description = "";

  const jobPosting = findJsonLdJobPosting(html);
  if (jobPosting) {
    if (typeof jobPosting.title === "string") title = jobPosting.title.trim();
    const org = jobPosting.hiringOrganization;
    if (org && typeof org === "object" && typeof org.name === "string") {
      company = org.name.trim();
    } else if (typeof org === "string") {
      company = org.trim();
    }
    if (typeof jobPosting.description === "string") {
      description = htmlToText(jobPosting.description);
    }
  }

  if (!title) {
    title =
      extractMetaContent(html, "property", "og:title") ||
      extractMetaContent(html, "name", "twitter:title") ||
      "";
  }
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = decodeHtmlEntities(titleMatch[1]).trim();
  }
  if (!company) {
    company = extractMetaContent(html, "property", "og:site_name") || "";
  }

  if (!description) {
    description = htmlToText(html);
  }

  if (description.length > URL_FETCH_MAX_DESCRIPTION_CHARS) {
    description = `${description.slice(0, URL_FETCH_MAX_DESCRIPTION_CHARS)}…`;
  }

  return {
    title,
    company,
    description,
  };
}

export async function POST(request) {
  try {
    const formData = await request.formData();

    const jobPosting = formData.get("jobPosting")?.toString().trim() || "";
    const jobPostingUrl = formData.get("jobPostingUrl")?.toString().trim() || "";
    const additionalContext = parseAdditionalContext(formData.get("additionalContext"));
    const aggressiveness = parseAggressiveness(formData.get("aggressiveness"));
    const contextDocuments = await parseContextDocuments(formData);
    const templateLines = parseTemplateLines(
      formData.get("templateLines")?.toString() || "",
    );
    const resumeFile = formData.get("resume");

    if (!jobPosting && !jobPostingUrl) {
      return NextResponse.json(
        { error: "jobPosting or jobPostingUrl is required." },
        { status: 400 },
      );
    }

    if (!(resumeFile instanceof File)) {
      return NextResponse.json(
        { error: "A resume file is required." },
        { status: 400 },
      );
    }

    if (!isTextLikeFile(resumeFile) && !isDocxFile(resumeFile)) {
      return NextResponse.json(
        {
          error:
            "Upload a resume in .txt, .md, or .docx format.",
        },
        { status: 400 },
      );
    }

    const resumeText = await readResumeText(resumeFile);

    let scrapedJobTitle = "";
    let scrapedCompany = "";
    let scrapedDescription = "";
    let effectiveJobPosting = jobPosting;
    let effectiveJobPostingUrl = jobPostingUrl;

    if (jobPostingUrl) {
      const scraped = await fetchJobPostingFromUrl(jobPostingUrl);
      if (!scraped.error) {
        scrapedJobTitle = scraped.title || "";
        scrapedCompany = scraped.company || "";
        scrapedDescription = scraped.description || "";
        // If we successfully scraped the description, prefer feeding it as
        // text to the LLM (more reliable and avoids the urlContext tool).
        if (scrapedDescription && !effectiveJobPosting) {
          effectiveJobPosting = scrapedDescription;
          effectiveJobPostingUrl = "";
        }
      }
    }

    const result = await generateTailoredResumeDraft({
      jobPosting: effectiveJobPosting,
      jobPostingUrl: effectiveJobPostingUrl,
      resumeText,
      resumeFileName: resumeFile.name,
      templateLines,
      additionalContext,
      aggressiveness,
      contextDocuments,
    });

    return NextResponse.json({
      ...result,
      jobTitle: result.jobTitle || scrapedJobTitle,
      jobDescription: scrapedDescription,
      company: scrapedCompany,
    });
  } catch (error) {
    console.error("Error generating tailored resume:", error);
    return NextResponse.json(
      {
        error:
          "Unable to generate tailored resume draft. Check server logs and environment configuration.",
      },
      { status: 500 },
    );
  }
}