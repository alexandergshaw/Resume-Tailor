/**
 * emailUtils.js
 *
 * Utilities for matching Gmail messages to tracked job applications.
 * All functions are pure (no API calls) — they operate on data already fetched.
 */

/**
 * Normalize a string for fuzzy comparison: lowercase, collapse whitespace,
 * strip common punctuation.
 */
function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize a normalized string into meaningful words (strips stop words).
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "at", "to", "for",
  "is", "are", "was", "be", "with", "we", "you", "your", "our",
  "re", "fwd", "fw", "hi", "hello", "dear", "thanks", "thank",
  "please", "regarding", "update", "following", "up",
]);

function tokenize(str) {
  return normalize(str)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Score how well a Gmail message matches a single application.
 *
 * Scoring (positive):
 *  +10  Company name match in subject/from/snippet (proportional for multi-word names)
 *  +5   Subject contains "your application" — strong personal signal
 *  +4   Subject contains high-signal phrases (interview, offer, next steps, etc.)
 *  +3   Per job-title token that appears in subject
 *  +2   Any other job-signal word in subject
 *
 * Scoring (negative — these reduce score and can make message drop below threshold):
 *  -6   From address contains "no-reply", "noreply", or "donotreply" — bulk/automated
 *  -4   From address contains "notifications", "mailer", "bounce", "alert"
 *  -3   Subject starts with "re:" or "fwd:" (replies, not recruiter outreach)
 *
 * Returns a numeric score; messages below threshold in matchMessagesToApplications are dropped.
 */

// Phrases in the FROM that indicate bulk/automated mail (lower relevance)
const MAILER_PATTERNS = [/\bnotifications?\b/, /\bmailer\b/, /\bbounce\b/, /\balerts?\b/];

// High-confidence subject phrases that mean it's about this person's application
const HIGH_SIGNAL_SUBJECTS = [
  "your application", "application received", "application update",
  "application status", "we received your", "thank you for applying",
  "thank you for your application", "interview invitation", "interview request",
  "offer letter", "job offer", "next steps", "moving forward",
];

const JOB_SIGNAL_WORDS = [
  "application", "applied", "interview", "offer", "recruiter",
  "position", "opportunity", "hiring", "job", "role", "candidate",
  "screening", "assessment", "decision", "rejected", "moved forward",
  "background check", "onboarding",
];

export function scoreMessageForApplication(message, application) {
  const { subject = "", from = "", snippet = "" } = message;
  const fromNorm = normalize(from);
  const subjectNorm = normalize(subject);
  const searchableText = normalize(`${subject} ${from} ${snippet}`);

  let score = 0;

  // --- Signals ---

  // generic mailer/notification addresses (unsubscribe-style bulk mail)
  if (MAILER_PATTERNS.some((re) => re.test(fromNorm))) score -= 4;

  // Reply/forward threads are rarely new recruiter contact
  if (/^\s*(re|fwd?)\s*:/.test(subjectNorm)) score -= 3;

  // --- Positive signals ---

  // Company name match in any part of the message
  const company = normalize(application.company || "");
  if (company && company.length > 2) {
    const companyTokens = tokenize(company);
    const matched = companyTokens.filter((t) => searchableText.includes(t));
    if (matched.length > 0) {
      score += 10 * (matched.length / companyTokens.length);
    }
  }

  // "Your application" and similar high-confidence phrases in subject
  for (const phrase of HIGH_SIGNAL_SUBJECTS) {
    if (subjectNorm.includes(phrase)) {
      score += 5;
      break; // count once
    }
  }

  // Job title token overlap with subject
  const jobTitle = normalize(application.job_title || application.title || "");
  if (jobTitle) {
    const titleTokens = tokenize(jobTitle);
    const subjectTokens = tokenize(subjectNorm);
    for (const token of titleTokens) {
      if (subjectTokens.includes(token)) score += 3;
    }
  }

  // Generic job-signal words in subject
  for (const signal of JOB_SIGNAL_WORDS) {
    if (subjectNorm.includes(signal)) {
      score += 2;
      break; // count once
    }
  }

  return score;
}

/**
 * Given a list of Gmail messages and a list of applications,
 * return messages annotated with the best-matching application and score,
 * filtered to only messages that score above the threshold,
 * sorted by score desc then date desc.
 *
 * @param {Array<{id, threadId, subject, from, date, snippet}>} messages
 * @param {Array<{id, company, job_title, title}>} applications
 * @param {number} [threshold=5] - minimum score to include
 * @returns {Array<{message, application, score}>}
 */
export function matchMessagesToApplications(messages, applications, threshold = 5) {
  const results = [];

  for (const message of messages) {
    let bestScore = 0;
    let bestApp = null;

    for (const app of applications) {
      const score = scoreMessageForApplication(message, app);
      if (score > bestScore) {
        bestScore = score;
        bestApp = app;
      }
    }

    if (bestScore >= threshold) {
      results.push({ message, application: bestApp, score: bestScore });
    }
  }

  // Sort by score desc, then by date desc
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.message.date) - new Date(a.message.date);
  });

  return results;
}

/**
 * Extract unique company names from applicationData for use as the
 * companyNames hint when fetching Gmail messages.
 *
 * @param {Array<{company}>} applications
 * @returns {string[]}
 */
export function getCompanyNamesFromApplications(applications) {
  return [...new Set(applications.map((a) => a.company).filter(Boolean))];
}

/**
 * Format a Gmail message date for display (relative if recent, absolute otherwise).
 * @param {string} dateStr - RFC 2822 date string from Gmail
 * @returns {string}
 */
export function formatMessageDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

/**
 * Classify a Gmail message into one of four categories:
 *   "confirmation"  — application received / acknowledged
 *   "rejection"     — application declined
 *   "interview"     — interview invitation or scheduling request
 *   null            — unable to classify
 *
 * Searches subject, snippet, and body (first 2000 chars fetched by gmailClient).
 *
 * @param {{ subject?: string, snippet?: string, body?: string }} message
 * @returns {"confirmation" | "rejection" | "interview" | null}
 */

// Ordered from most-specific to least-specific. First match wins.
const CLASSIFICATION_RULES = [
  {
    type: "interview",
    patterns: [
      /interview\s+(invitation|request|scheduled|confirmed|reminder)/,
      /invit(e|ing|ation)\s+.{0,40}\s*interview/,
      /schedule\s+(an?\s+)?interview/,
      /we\s+(would\s+like|want)\s+to\s+(meet|speak|chat|talk|connect)\s+with\s+you/,
      /phone\s+(screen|call|interview)/,
      /video\s+(call|interview|meeting)/,
      /technical\s+(screen|assessment|interview)/,
      /hiring\s+manager\s+interview/,
      /next\s+(step|round|stage)\s*:\s*.{0,30}interview/,
      /onsite\s+interview/,
      /take.?home\s+(assessment|challenge|test)/,
      /coding\s+(challenge|assessment|test)/,
    ],
  },
  {
    type: "rejection",
    patterns: [
      // "we won't be moving forward" / "will not be proceeding"
      /we\s+(will\s+not|won'?t|are\s+not|aren'?t)\s+be?\s+(moving|proceeding|continuing)/,
      // "decided not to move forward" (Reddit style)
      /decided\s+not\s+to\s+(move\s+forward|proceed|continue)/,
      // "have decided to move forward with other candidates"
      /we\s+have\s+(decided|chosen)\s+to\s+(pursue|move\s+forward\s+with)\s+other\s+(candidates|applicants)/,
      // "not moving forward" / "not selected" / "not a fit"
      /not\s+(selected|moving\s+forward|a\s+(good\s+)?fit|chosen|advancing)/,
      // "regret to inform you"
      /regret\s+to\s+(inform|let\s+you\s+know|tell)/,
      // "unfortunately, we won't be moving" — dot-all match across punctuation
      /unfortunately[,.]?\s+we\s+(won'?t|will\s+not|are\s+not)/,
      /unfortunately[\s\S]{0,80}(not\s+moving|won'?t\s+be|will\s+not\s+be)/,
      // "position has been filled/closed"
      /position\s+has\s+been\s+(filled|closed)/,
      /we\s+(have\s+)?(closed|filled)\s+the\s+position/,
      // "after careful consideration … not"
      /after\s+careful(ly)?\s+(consideration|review|considering)[\s\S]{0,120}(not|other\s+candidates)/,
      // "wish you the best in your search"
      /wish\s+you\s+(the\s+best|luck|well)\s+in\s+your\s+(search|future)/,
      /keep\s+your\s+(resume|profile)\s+on\s+file/,
    ],
  },
  {
    type: "confirmation",
    patterns: [
      /application\s+(received|submitted|confirmed|complete)/,
      /we\s+(received|got)\s+your\s+application/,
      /thank\s+you\s+for\s+(applying|your\s+application|submitting)/,
      /successfully\s+(applied|submitted|received)/,
      /your\s+application\s+(is|has\s+been)\s+(received|submitted|under\s+review|in\s+review)/,
      /we\s+will\s+(review|be\s+in\s+touch|follow\s+up)/,
      // "the time you took to apply" (Pinterest-style acknowledgement)
      /time\s+you\s+took\s+to\s+apply/,
      // "we are (carefully) reviewing (each|your) application"
      /we\s+are\s+(carefully\s+)?reviewing\s+(each|your)\s+application/,
      // "appreciate your interest" paired with apply context
      /appreciate\s+(the\s+time|your\s+interest).{0,60}appl(y|ied|ication)/,
      // "thank you for your interest" + apply in same message (Pinterest outro)
      /thank\s+you\s+for\s+your\s+interest.{0,200}appl(y|ied|ication)/s,
    ],
  },
];

export function classifyMessage(message) {
  const { subject = "", snippet = "", body = "" } = message;
  // Include up to 2000 chars of body so rejection/interview phrases buried past the
  // snippet boundary are still reachable without the full email in memory.
  const text = normalize(`${subject} ${snippet} ${body.slice(0, 2000)}`);

  for (const { type, patterns } of CLASSIFICATION_RULES) {
    if (patterns.some((re) => re.test(text))) return type;
  }

  return null;
}
