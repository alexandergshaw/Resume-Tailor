// N60 second chunk, Step C -- the deriver that turns a natural-language "jobs,
// frequency" message into a feed configuration object. It PROPOSES; it never
// writes (app/api/feed-config/apply/route.js, Step B, owns the write, through
// sanitizeChatDerivedSavedSearch, which this module's output is shaped for).
//
// Engine choice governs egress like every other auxiliary AI feature
// ([[embedded-aux-features]]): wantsEmbedded() selected -> a deterministic,
// zero-model-call parse; otherwise -> one structured Gemini call. The Gemini
// path is what makes the chat route a model-reacher (it imports
// getGeminiClient, one of the three MODEL_MODULES the transitive rate-limit
// sweep keys on -- see app/api/feed-config/chat/route.guards.test.js).
//
// GARBAGE IN (brief item 7): whatever the model returns -- extra/dangerous
// keys, wrong-typed fields, or text that is not JSON at all -- is clamped or
// refused HERE, before it ever reaches the apply route's sanitizer (defense
// in depth, deliberately, over Step B). coerceModelReply() below is a
// WHITELIST: it builds the output object field by field from only the names
// this module's own contract declares, so a model reply can add whatever
// keys it likes and none of them ride through. Invalid JSON never throws and
// never passes raw text through -- it degrades to the same deterministic
// parse the embedded path uses, driven off the ORIGINAL user message.
//
// NEVER RETURNS auto_tailor_enabled / autoTailorEnabled, in any form, for any
// input (brief item 4) -- the whitelist simply has no such field to copy.
//
// UNSET STAYS UNSET (brief item 2): a cadence the message/reply never
// mentions comes back null, not the 60-minute default -- the default is
// applied only at STORE time, by sanitizeChatDerivedSavedSearch's own
// clampIntervalMinutes(null) call (Step B). This module clamps only a
// PROPOSED value (brief item 3): a sub-floor ask comes back as the value that
// will actually be delivered, via the shared clampIntervalMinutes, never a
// literal.
//
// This module deliberately does NOT call getServerEnv() for the Gemini model
// name -- that helper enforces a required Gemini_LLM_API_Key and would throw
// on a deploy (or a test) that has none, before this module ever gets to
// decide whether the key even matters. Reading GEMINI_MODEL directly, the
// same bypass lib/config/env.js's own getDeepgramApiKey()/
// getLlmSearchIntervalMinutes() use for optional configuration, keeps this
// module's own control flow (call the client, handle what comes back) the
// single place that decides what a missing/broken model call means for a
// deriver whose job is to always return something usable.

import { getGeminiClient } from "@/lib/llm/geminiClient";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { clampIntervalMinutes } from "@/lib/feed/cronSchedule";

// Function words filtered out of the embedded path's keyword extraction.
// Deliberately NOT a domain stopword list (no "job", "apply", "remote", ...)
// -- the deterministic parse is allowed to be coarse; it must never be empty.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "in", "on", "at", "for", "to",
  "of", "with", "without", "is", "are", "was", "were", "be", "been", "being",
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "this", "that",
  "these", "those", "from", "as", "by", "about", "into", "over", "also",
  "just", "like", "please", "want", "would", "should", "could", "will", "can",
  "not", "no",
]);

function tokenize(message) {
  return String(message || "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function extractKeywords(message) {
  const seen = new Set();
  const keywords = [];
  for (const token of tokenize(message)) {
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    if (/^[0-9.]+$/.test(token)) continue; // a bare number is not a job keyword
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
    if (keywords.length >= 12) break;
  }
  return keywords;
}

// Only "every N minutes/hours" is recognized -- a message that instead says
// "every 30 seconds" is treated as NOT stating a cadence (brief item 2: an
// unrecognized ask is unset, not a guess), and the clamp below still catches
// it once it reaches the sanitizer's own DEFAULT.
const CADENCE_PATTERN = /every\s+(\d+(?:\.\d+)?)\s*(minute|minutes|hour|hours)\b/i;

function extractCadenceMinutes(message) {
  const match = CADENCE_PATTERN.exec(String(message || ""));
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const isHours = match[2].toLowerCase().startsWith("hour");
  return clampIntervalMinutes(isHours ? n * 60 : n);
}

// The deterministic, zero-model-call path (AC2-S7). Always returns a
// non-empty `name` for any non-empty message, so "usable" never depends on
// keyword extraction finding something -- the message itself is the fallback
// label, the same way a person titling their own saved search would use their
// own words if nothing narrower were parsed out of them.
function deriveEmbedded(message) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  return {
    name: trimmed ? trimmed.slice(0, 80) : null,
    jobKeywords: extractKeywords(trimmed),
    maxYearsExp: "any",
    selectedCategories: [],
    selectedCompanies: [],
    excludedCompanies: [],
    excludedTitleKeywords: [],
    autoTailorMinIntervalMinutes: extractCadenceMinutes(trimmed),
    emailOnNewJobs: /\bemail\b/i.test(trimmed),
  };
}

function toStringArray(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

// A proposed interval is clamped the moment it is read (brief item 3); an
// absent one stays null (brief item 2) rather than falling through to
// clampIntervalMinutes(null), which would answer with the STORE-time default
// (60) and erase the "you didn't say" / "I chose for you" distinction.
function deriveCadenceFromReply(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampIntervalMinutes(n);
}

// The WHITELIST (brief item 7). Only these nine fields are ever read off a
// parsed model reply; everything else -- auto_tailor_enabled, notify_email,
// auto_tailor_daily_cap, or any junk key a hostile/careless reply adds -- has
// no line here that would copy it, so it cannot ride through by omission of a
// filter someone forgets to update.
function coerceModelReply(raw) {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 200) || null : null;
  const maxYearsExp =
    typeof raw.maxYearsExp === "string"
      ? raw.maxYearsExp.slice(0, 20)
      : typeof raw.max_years_exp === "string"
        ? raw.max_years_exp.slice(0, 20)
        : "any";
  return {
    name,
    jobKeywords: toStringArray(raw.jobKeywords ?? raw.job_keywords),
    maxYearsExp,
    selectedCategories: toStringArray(raw.selectedCategories ?? raw.selected_categories),
    selectedCompanies: toStringArray(raw.selectedCompanies ?? raw.selected_companies),
    excludedCompanies: toStringArray(raw.excludedCompanies ?? raw.excluded_companies),
    excludedTitleKeywords: toStringArray(raw.excludedTitleKeywords ?? raw.excluded_title_keywords),
    autoTailorMinIntervalMinutes: deriveCadenceFromReply(
      raw.autoTailorMinIntervalMinutes ?? raw.auto_tailor_min_interval_minutes,
    ),
    emailOnNewJobs: !!(raw.emailOnNewJobs ?? raw.email_on_new_jobs),
  };
}

function safeParseJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildPrompt(message) {
  return [
    "A job seeker is describing, in their own words, the jobs they want to be",
    "notified about and how often to check for them. Turn their message into a",
    "JSON object of exactly this shape (omit a field the message does not",
    "address; do not invent values for fields it never mentions):",
    "",
    '{ "name": string, "jobKeywords": string[], "maxYearsExp": string,',
    '  "selectedCategories": string[], "selectedCompanies": string[],',
    '  "excludedCompanies": string[], "excludedTitleKeywords": string[],',
    '  "autoTailorMinIntervalMinutes": number, "emailOnNewJobs": boolean }',
    "",
    "Rules:",
    "- name: a short label for this search, drawn from the message.",
    "- jobKeywords: the roles, skills, and technologies mentioned.",
    "- autoTailorMinIntervalMinutes: only if the message states how often to",
    "  check, expressed in minutes (convert hours to minutes). Omit otherwise.",
    "- You have no say over enabling automated applying, spend caps, or a",
    "  third-party notification address -- do not include fields for them.",
    "",
    "MESSAGE:",
    String(message || ""),
  ].join("\n");
}

// GEMINI_MODEL is read directly (see the module header) rather than through
// getServerEnv(), which enforces a Gemini_LLM_API_Key this module has no
// business requiring up front -- getGeminiClient() itself is where a missing
// key becomes a real failure, and that failure is caught below like any other
// model-call failure.
function geminiModelName() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

async function deriveViaGemini(message) {
  let response;
  try {
    const client = getGeminiClient();
    response = await client.models.generateContent({
      model: geminiModelName(),
      contents: buildPrompt(message),
      config: { responseMimeType: "application/json" },
    });
  } catch {
    // The model call itself failed (no key, network, provider error) -- the
    // deriver still owes a usable config, so it degrades to the deterministic
    // parse rather than refusing outright.
    return deriveEmbedded(message);
  }

  const parsed = safeParseJson(typeof response?.text === "string" ? response.text : "");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // Invalid JSON, or valid JSON that is not an object shape at all: never
    // thrown, never passed through raw (brief item 7) -- degrade the same way.
    return deriveEmbedded(message);
  }
  return coerceModelReply(parsed);
}

/**
 * Derive a feed configuration from a chat message. Never writes anything;
 * the caller (app/api/feed-config/chat/route.js) returns the result for the
 * person to review and correct before app/api/feed-config/apply/route.js
 * stores it.
 *
 * @param {string} message
 * @param {{ engine?: string, env?: object }} [options]
 * @returns {Promise<{
 *   name: string|null, jobKeywords: string[], maxYearsExp: string,
 *   selectedCategories: string[], selectedCompanies: string[],
 *   excludedCompanies: string[], excludedTitleKeywords: string[],
 *   autoTailorMinIntervalMinutes: number|null, emailOnNewJobs: boolean,
 * }>}
 */
export async function deriveFeedConfig(message, { engine, env = process.env } = {}) {
  if (wantsEmbedded(engine, env)) {
    return deriveEmbedded(message);
  }
  return deriveViaGemini(message);
}
