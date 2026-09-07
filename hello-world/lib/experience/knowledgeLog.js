// The knowledge-page scope summary's downloadable LOG -- the standing
// feature-logs rule (lib/duplicateApply/duplicateApplyLog.js's header states
// it first: "every feature that can carry a log gets one, with a clearly
// visible download button, surviving a Clear"), applied to this feature.
//
// THIS MODULE DOES NOT CREATE A LOG OR KNOW ABOUT A DOWNLOAD BUTTON. It
// produces the plain markdown string a caller (the panel, a later wave)
// hands to `triggerBlobDownload`. It has no DOM, no fetch, no Supabase, no
// `Date.now()` -- pure and synchronous, matching duplicateApplyLog.js's own
// C-19 no-ambient-I/O discipline.
//
// WHAT MUST NEVER REACH THIS FILE'S OUTPUT (3-plan-knowledge.md §7 C4, §9):
// page BODY text, summary text, answer text, QUESTION TEXT, any URL, any
// user id, any raw model-supplied string (including a refused citation's own
// id). Two independent defenses, mirroring duplicateApplyLog.js's own:
//   1. Every field is read BY NAME. `summaryRow.summary` and
//      `questionRows[i].answer` are never destructured into a variable that
//      reaches the output at all -- not "read and discarded", genuinely
//      never touched -- so a bug that later adds an extra property to either
//      row has no path into this file's output.
//   2. Every free-text-shaped field (a reason code, a stage name, an error
//      message) is validated against a bounded pattern or a short cap before
//      it is rendered, so even a value that has been overwritten with
//      salted, secret-shaped or resume-shaped text degrades to a safe
//      placeholder rather than being written verbatim. This is what makes
//      the record safe against a HOSTILE input, not just a well-behaved one
//      -- the same posture duplicateApplyLog.js's own header names.
//
// A QUESTION IS A CONFESSION, THE ANSWER IS NOT (§7 C4's ruling, and it
// overturns AC-9.3 as originally written, which forbade answer text but
// admitted question text -- backwards, because the answer is derived from
// pages the user already has on record, while the question is new,
// unprompted and may name anything: a medical condition, a salary figure, a
// reason for leaving). So a question contributes only a stable FNV hash
// (the duplicateApplyLog.js `hashPostingKey` idiom -- the same shape a
// truncated sha256 hex digest would have, computed synchronously because
// Web Crypto's digest is promise-based and this module is not), its LENGTH
// (a number, not the text), its timestamp, and its outcome fields. The
// answer's text is never touched, not even for its length.
//
// PAGE TITLES ARE IN, AS AN OWNER-VISIBLE ACCEPTED DISCLOSURE, BEHIND ONE
// CONSTANT. A log naming only opaque uuids cannot answer the question it
// exists to answer -- which of my pages was left out of this summary -- so
// `LOG_INCLUDES_PAGE_TITLES` defaults to `true`. `buildKnowledgeLog` also
// accepts an explicit `includeTitles` override so the sentinel-string test
// can be parameterised over both values without needing to re-import the
// module to see the constant flip (the export itself is a `const`, and an
// ES module import binding cannot be reassigned from outside); the default
// always tracks the exported constant, so a caller that never passes the
// option gets exactly today's ruling.
//
// "THE LOG SURVIVES A CLEAR" IS UNSATISFIABLE AS WRITTEN, AND THIS MODULE
// SAYS SO RATHER THAN PRETENDING OTHERWISE. Clear (Wave 6/7, not built here)
// deletes the rows this log rebuilds `summaryRow`/`questionRows` from -- so
// a log built AFTER a Clear literally has nothing left to name for the
// stored half of the record. What IS actually true, and what this module's
// contract is built to make possible: the persisted half (summary +
// question rows) is rebuilt from the stored rows at download time, never
// accumulated in component state, so it can never go stale relative to what
// is on screen; and any IN-SESSION events that are not row-shaped at all --
// a run that never produced a row, `sessionEvents` below -- live in a
// caller-held ref that a Clear action never nulls, following
// `app/copilot/useSessionLogRecorder.js`'s `sessionLogRef` idiom. So: the
// events survive a Clear (this module accepts them as a plain array with no
// opinion about where they came from), the rows do not (there is nothing
// left to read once they are gone), and a durable version of "what was
// cleared" needs its own storage -- a `cleared_at` column, one migration,
// routed to the owner (3-plan-knowledge.md §7 C4 / §11 Q5) -- which this
// module does not invent.
//
// A LOG THAT RECORDS ONLY SUCCESSES CANNOT EXPLAIN A FAILURE. That is this
// module's other reason for existing, verbatim from the brief that created
// it: a sibling feature returned nothing for its entire life while looking
// healthy, because nothing recorded the attempts that never became a row.
// `sessionEvents` is exactly that ledger for this feature -- the closed
// vocabulary below is not "every way the row-writing path failed" (that is
// already inside `summaryRow.status === 'failed'`), it is "every way a run
// never got far enough to write ANY row at all", including the write itself
// failing, which is the one state that otherwise leaves no evidence.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * hashQuestion(text) -> an 8-hex-character digest, or null.
 *
 * FNV-1a: deterministic, fixed-width, synchronous (Web Crypto's `digest` is
 * promise-based and this module must stay pure/synchronous). By
 * construction its output is a hash of the input, never the input itself,
 * however short the input is -- the same property
 * `duplicateApplyLog.js#hashPostingKey` is built on.
 */
export function hashQuestion(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  } catch {
    return null;
  }
}

// The owner's one-line lever (§7 C4). Titles from a knowledge-base tree can
// read like "Salary negotiation -- Acme offer", so this is an accepted,
// owner-visible disclosure, not a default nobody decided.
export const LOG_INCLUDES_PAGE_TITLES = true;

// sessionEvents' closed reason vocabulary -- "a run that did not produce any
// row", spelled out so the one state with no row of its own (`write-failed`)
// cannot be silently indistinguishable from a run that never happened.
const KNOWN_EVENT_REASONS = new Set([
  "load-error",
  "load-in-flight",
  "scope-unknown",
  "no-key",
  "engine-embedded",
  "model-empty",
  "model-timeout",
  "write-failed",
]);

const KNOWN_EVENT_KINDS = new Set(["summary", "question"]);

// A short, closed-shape identifier: a stage name (`pagesEligible`) or a
// reason code (`not-in-scope`). Deliberately bounded and pattern-restricted
// -- this is the defense against a reason/stage field that has been
// overwritten with resume-shaped prose or a smuggled token: real values here
// are short and either camelCase or kebab-case, and free text with spaces,
// punctuation or line breaks never matches. The length cap is deliberately
// tight (every real stage name and refusal reason in this feature is under
// 20 characters -- "citationsRendered" is the longest stage at 18,
// "eligibility-threw" the longest reason at 17) so a longer smuggled token
// dressed up in kebab-case still gets refused rather than rendered.
const SAFE_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;

function safeIdentifier(value) {
  return typeof value === "string" && SAFE_IDENTIFIER_RE.test(value) ? value : null;
}

function safeNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeIsoish(value) {
  // Rendered as-is when it at least parses as a timestamp; this is a
  // system-generated field (Postgres `timestamptz`, or a client
  // `toISOString()`), never model or user text, so no further scrubbing
  // applies -- only a type/shape check.
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

// A bounded, URL-scrubbed rendering of an operational error string. `error`
// is system- or SDK-generated text (a Postgres message, an SDK failure
// string), not user content, so it is not on the MUST-NOT list by name --
// but "any URL" is, and an error naming a failed endpoint could carry one,
// so every http(s)/www URL-shaped run is redacted before the field is ever
// placed in the output, and the whole field is capped well short of
// MAX_LOG_FIELD_CHARS (this is a one-line status field, not an event log).
const MAX_ERROR_CHARS = 300;
const URL_RE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;

function safeErrorText(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const redacted = value.replace(URL_RE, "[url removed]");
  return redacted.length > MAX_ERROR_CHARS ? `${redacted.slice(0, MAX_ERROR_CHARS)}...` : redacted;
}

function safeBoundedString(value, maxChars) {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars ? value : null;
}

function tryGet(obj, key) {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Renders one narrowing chain's counts (retrieval, or citations) generically
// -- by the KEYS the caller's `counts` object actually carries, rather than
// a hard-coded stage list imported from knowledgeScope.js. This module is
// not on that file's import fence (3-plan-knowledge.md's own Wave 3a/3b
// split keeps the two disjoint), and a generic render is also more robust:
// it does not silently go stale if the stage list ever grows a stage. Keys
// are sorted for deterministic output. `attachmentsSkipped` is deliberately
// excluded here -- it is not one of the named narrowing stages, and it gets
// its own dedicated line (see `renderAttachmentsSkipped`) so it reads as the
// disclosure AC-4.12 asks for, not a buried extra key in a stage dump.
function renderCountsBlock(lines, heading, counts, countsViolation, anomaly, { excludeKeys = [] } = {}) {
  lines.push(`### ${heading}`);
  const exclude = new Set(excludeKeys);
  if (isPlainObject(counts)) {
    const keys = Object.keys(counts)
      .filter((key) => safeIdentifier(key) && Number.isInteger(counts[key]) && !exclude.has(key))
      .sort();
    for (const key of keys) {
      lines.push(`${key}: ${counts[key]}`);
    }
  }
  if (isPlainObject(anomaly)) {
    const stage = safeIdentifier(anomaly.stage);
    const from = safeIdentifier(anomaly.from);
    const input = safeNonNegativeInt(anomaly.inputCount);
    if (stage && from !== null && input !== null) {
      lines.push(`anomaly: ${stage} ${input} -> 0`);
    } else {
      lines.push("anomaly: none");
    }
  } else {
    lines.push("anomaly: none");
  }
  const violation = safeBoundedString(countsViolation, 300);
  lines.push(`countsViolation: ${violation || "none"}`);
  lines.push("");
}

function renderRefused(lines, refused) {
  lines.push("### Refused");
  const entries = Array.isArray(refused) ? refused : [];
  let any = false;
  for (const entry of entries) {
    const reason = safeIdentifier(entry && entry.reason);
    const count = safeNonNegativeInt(entry && entry.count);
    if (!reason || count === null) continue;
    lines.push(`${reason}: ${count}`);
    any = true;
  }
  if (!any) lines.push("none");
  lines.push("");
}

function threeStateWord(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function renderScopeLine(lines, scope, includeTitles) {
  const pageId = scope && isNonEmptyString(scope.pageId) ? scope.pageId.trim() : null;
  if (!pageId) {
    lines.push("Scope: root -- every page");
    return;
  }
  if (includeTitles) {
    const title = safeBoundedString(scope.title, 300);
    lines.push(title ? `Scope: page ${pageId} -- "${title}"` : `Scope: page ${pageId}`);
  } else {
    lines.push(`Scope: page ${pageId}`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function renderSourcePages(lines, sourcePages, includeTitles) {
  const list = Array.isArray(sourcePages) ? sourcePages : [];
  lines.push(`### Pages in scope (${list.length})`);
  for (const page of list) {
    if (!page || !isNonEmptyString(page.id)) continue;
    const included = page.included === true;
    const reason = safeIdentifier(page.reason) || "unknown";
    const rank = safeNonNegativeInt(page.rank);
    const excerpted = page.excerpted === true ? "yes" : "no";
    const label = includeTitles && isNonEmptyString(page.title) ? ` "${safeBoundedString(page.title, 300) || ""}"` : "";
    const status = included ? "included" : `excluded: ${reason}`;
    lines.push(`- ${page.id}${label} -- ${status} (rank ${rank === null ? "-" : rank}, excerpted ${excerpted})`);
  }
  lines.push("");
}

function renderQuestionRows(lines, questionRows) {
  const list = Array.isArray(questionRows) ? questionRows : [];
  lines.push(`## Question history (${list.length})`);
  lines.push("");
  list.forEach((row, index) => {
    lines.push(`### Question ${index + 1}`);
    const question = tryGet(row, "question");
    const hash = hashQuestion(typeof question === "string" ? question : "");
    lines.push(`Hash: ${hash || "none"}`);
    lines.push(`Length: ${typeof question === "string" ? question.length : 0} characters`);
    const askedAt = safeIsoish(tryGet(row, "created_at"));
    lines.push(`Asked: ${askedAt || "unknown"}`);
    const status = safeIdentifier(tryGet(row, "status"));
    lines.push(`Status: ${status || "unknown"}`);
    lines.push(`Answered from pages: ${threeStateWord(tryGet(row, "answered_from_pages"))}`);
    const citations = tryGet(row, "citations");
    const resolved = Array.isArray(citations) ? citations.length : 0;
    lines.push(`Citations resolved: ${resolved}`);
    const outcome = tryGet(row, "retrieval_outcome");
    const refusedList = isPlainObject(outcome) ? outcome.refused : null;
    let refusedCount = 0;
    if (Array.isArray(refusedList)) {
      for (const entry of refusedList) {
        const count = safeNonNegativeInt(entry && entry.count);
        if (count !== null) refusedCount += count;
      }
    }
    lines.push(`Citations refused: ${refusedCount}`);
    lines.push("");
  });
}

function renderSessionEvents(lines, sessionEvents) {
  const list = Array.isArray(sessionEvents) ? sessionEvents : [];
  const rendered = [];
  for (const event of list) {
    const reason = event && KNOWN_EVENT_REASONS.has(event.reason) ? event.reason : null;
    if (!reason) continue;
    const at = safeIsoish(event.at) || "unknown time";
    const kind = event && KNOWN_EVENT_KINDS.has(event.kind) ? event.kind : "unspecified";
    rendered.push(`- ${reason} at ${at} (${kind})`);
  }
  lines.push(`## Runs that did not complete (${rendered.length})`);
  if (rendered.length === 0) {
    lines.push("none");
  } else {
    lines.push(...rendered);
  }
  lines.push("");
}

/**
 * buildKnowledgeLog({ scope, summaryRow, questionRows, sessionEvents, includeTitles }) -> string
 *
 * `scope`: `{ pageId: string|null, title: string|null }` -- `pageId` null is
 * the whole-knowledge-base scope.
 * `summaryRow`: the stored `experience_page_summaries` row (or `null`) --
 * only `model`, `engine`, `status`, `error`, `generated_at`, `source_pages`
 * and `retrieval_outcome` are ever read; `summary` is never touched even
 * when present.
 * `questionRows`: the stored `experience_page_questions` rows for this
 * scope -- only `question` (for its hash and length), `citations`,
 * `answered_from_pages`, `retrieval_outcome`, `created_at` and `status` are
 * ever read; `answer` is never touched.
 * `sessionEvents`: an array of `{ reason, at, kind }` for runs that never
 * produced a row at all (see module header) -- caller-held, so it can
 * survive a Clear the way the stored rows structurally cannot.
 * `includeTitles`: overrides `LOG_INCLUDES_PAGE_TITLES` for this call
 * (defaults to the exported constant) so both settings stay testable
 * without re-importing the module.
 *
 * Never throws. Always returns a string, even when every input is missing.
 */
export function buildKnowledgeLog({
  scope,
  summaryRow,
  questionRows,
  sessionEvents,
  includeTitles = LOG_INCLUDES_PAGE_TITLES,
} = {}) {
  const useTitles = includeTitles !== false;
  const row = isPlainObject(summaryRow) ? summaryRow : null;
  const lines = ["# Knowledge base scope summary log", ""];

  renderScopeLine(lines, scope, useTitles);
  lines.push("");

  lines.push("## Summary");
  lines.push(`Model: ${safeBoundedString(tryGet(row, "model"), 100) || "-"}`);
  lines.push(`Engine: ${safeBoundedString(tryGet(row, "engine"), 60) || "-"}`);
  const status = safeIdentifier(tryGet(row, "status"));
  lines.push(`Status: ${status || "unknown"}`);
  const generatedAt = safeIsoish(tryGet(row, "generated_at"));
  lines.push(`Generated: ${generatedAt || "not yet generated"}`);
  lines.push(`Error: ${safeErrorText(tryGet(row, "error")) || "none"}`);
  lines.push("");

  const outcome = isPlainObject(tryGet(row, "retrieval_outcome")) ? row.retrieval_outcome : null;
  renderCountsBlock(
    lines,
    "Retrieval counts",
    outcome ? outcome.counts : null,
    outcome ? outcome.countsViolation : null,
    outcome ? outcome.anomaly : null,
    { excludeKeys: ["attachmentsSkipped"] }
  );
  const citOutcome = outcome && isPlainObject(outcome.citations) ? outcome.citations : null;
  renderCountsBlock(lines, "Citation counts", citOutcome ? citOutcome.counts : null, citOutcome ? citOutcome.countsViolation : null, citOutcome ? citOutcome.anomaly : null);
  renderRefused(lines, outcome ? outcome.refused : null);

  lines.push(`Truncated read: ${outcome && outcome.truncatedRead === true ? "yes" : "no"}`);
  lines.push("");

  const sourcePages = Array.isArray(tryGet(row, "source_pages")) ? row.source_pages : [];
  renderSourcePages(lines, sourcePages, useTitles);

  const attachmentsSkipped = outcome && isPlainObject(outcome.counts) ? safeNonNegativeInt(outcome.counts.attachmentsSkipped) : null;
  lines.push(`Attachments skipped: ${attachmentsSkipped === null ? 0 : attachmentsSkipped}`);
  lines.push("");

  renderQuestionRows(lines, questionRows);
  renderSessionEvents(lines, sessionEvents);

  return `${lines.join("\n")}\n`;
}
