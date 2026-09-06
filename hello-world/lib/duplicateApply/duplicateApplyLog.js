// lib/duplicateApply/duplicateApplyLog.js
//
// Builds one LOG RECORD from a duplicate-apply verdict + run context.
// 3-plan-dupapply.md §2.5 / §3.5; rationale in 1f-admin-dupapply.md FINDING
// L-3. This module does NOT create a log and knows nothing about
// createSessionLog, its event()/snapshot(), or the download button (Wave 4)
// -- it produces the plain object a caller (app/page.js, Wave 3B) hands to
// createSessionLog(...).event("duplicate-check", buildDupeLogRecord(...))
// (lib/copilot/sessionLog.js:112, MAX_SESSION_LOG_EVENTS = 500, FIFO,
// never-throwing event()). It does not import triggerBlobDownload
// (lib/document/download.js) either -- that is a DOM helper for the actual
// click, and this module has no DOM.
//
// WHY THIS EXISTS (1f-admin-dupapply.md FINDING L-3, and the standing
// feature-logs rule): every signal here is four-valued and an
// `indeterminate` has several distinct causes -- "why did it match", "why
// didn't it match", "did it even run" are different questions, and
// evaluatePriorApplications' verdict (lib/duplicateApply/
// duplicateApplyVerdict.js) is the only place that knows the answer. A log
// that records only successes cannot explain a failure -- the standing
// example named in this chunk's brief is a citation feature that returned
// nothing for its entire life while looking healthy. So this module's job
// is specifically to make the SILENT states legible: `rows-unavailable`
// (the load hadn't finished, or had errored), `check-threw` (the call
// itself threw), and a genuine `clear` (rows were examined and none
// qualified) must all be DISTINGUISHABLE in the record, even though S-10i
// renders all three as the same "nothing" on screen.
//
// SEC-5's MUST-NOT list (this file's other reason for existing): a raw
// `positions.company`/`title`/`url`, an `applied_at`, an `applications.id`,
// a `user_id`, any session token, any resume or posting text must never
// reach this record. The log has a clearly visible download button (the
// standing feature-logs rule), so it is a disclosure surface, not an
// internal debug channel. Two independent defenses, not one:
//   1. This module never spreads or forwards an unknown key from the
//      verdict -- every field in the returned record is read BY NAME, so a
//      bug (or a hostile caller) adding an extra property anywhere on the
//      verdict object has no path into the output at all.
//   2. `verdict`/`reason`/`route` are matched against the EXACT closed sets
//      3-plan-dupapply.md §3.3 documents (4 verdicts, 10 reasons, 2 routes)
//      instead of being accepted as "any string" -- so even a reason/route
//      field that has been overwritten with secret-shaped text degrades to
//      `null` instead of reaching the output. This is what makes the record
//      safe against a SALTED verdict object, not just a well-behaved one.
// Raw evidence (positions.company/title/url, applied_at, applications.id --
// everything rawEvidenceFromRow() in duplicateApplyVerdict.js puts on a
// match/evidence entry) is represented ONLY as counts here (`matched`,
// `evidenceCount`), never its contents. `applications.id` is EXCLUDED even
// though 1f-admin-dupapply.md's earlier draft recommended keeping it for
// support triage -- 3-plan-dupapply.md §3.5's MUST-NOT list supersedes that
// recommendation, and this module follows the plan, not the earlier draft.
//
// candidateKey/candidateCompanyKey are hashed, never carried in the clear:
// a URL-based candidateKey (postingIdentity.js's "u:" prefix) literally IS
// the candidate's posting URL, and companyIdentityKey's own key is a
// normalized-but-still-recognizable company name ("a:acme"). Hashing keeps
// them useful for support triage -- the same posting/company always hashes
// the same way, so a repeat pattern is visible -- without writing the
// plaintext to a downloadable file. Likewise a jobId's TAIL is dropped:
// `url-${trimmedUrl}` IS the posting URL, so only the type-prefix survives.
//
// Pure, synchronous, side-effect free: no Date.now(), no DOM, no network, no
// import of postingIdentity.js/companyIdentity.js/duplicateApplyVerdict.js
// (this module only ever receives THEIR output, never recomputes it).

// The four verdict values 3-plan-dupapply.md §3.3 documents.
const KNOWN_VERDICTS = new Set(["hit", "clear", "indeterminate", "unavailable"]);

// The ten reason strings §3.3's table enumerates, transcribed verbatim.
// Anything not in this set -- including a reason field a bug or an
// attacker has overwritten with secret-shaped text -- is dropped to `null`
// rather than written to the record (SEC-5's second defense, see header).
const KNOWN_REASONS = new Set([
  "no-posting-identity",
  "no-company-key",
  "rows-unavailable",
  "undated-match",
  "future-or-concurrent",
  "unknown-status-match",
  "stranded-applied-row",
  "undated-company-rows",
  "future-company-rows",
  "check-threw",
]);

// findPriorSamePosting's own two route tags (duplicateApplyVerdict.js).
const KNOWN_ROUTES = new Set(["url", "extra"]);

// A-2's three rowsState values, computed by the caller as
// `applicationError ? "error" : (!applicationLoadedOnce ? "loading" : "ready")`.
const KNOWN_ROWS_STATES = new Set(["ready", "loading", "error"]);

// postingIdentity.js's job-id-shaped prefixes (3-plan-dupapply.md §3.5). A
// jobId is built as `${prefix}${somethingSensitive}` at every entry point --
// "url-" + the trimmed posting URL is the sharpest case, since it literally
// IS the URL -- so only the prefix token may ever reach the log. "other" is
// returned for any shape this list does not name, rather than a default
// case that would forward the unrecognized (and therefore unvetted) tail.
const JOB_ID_PREFIXES = ["url-", "feed-", "manual-", "shot-", "gh-"];

// Entry points are short internal code names (E1..E8-shaped), never
// free text. A value this long is being used as a smuggling channel, not an
// entry-point label, so it is dropped rather than truncated-and-kept --
// truncating would still leak a prefix of whatever was smuggled in.
const MAX_ENTRY_POINT_CHARS = 64;

function safeEnum(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function safeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeBoundedString(value, maxChars) {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars ? value : null;
}

function jobIdPrefixOf(jobId) {
  if (typeof jobId !== "string" || jobId.length === 0) return null;
  const hit = JOB_ID_PREFIXES.find((prefix) => jobId.startsWith(prefix));
  return hit ?? "other";
}

// hashPostingKey(key) -> an 8-hex-character digest, or null.
//
// "sha256[0:8] via SubtleCrypto-free sync FNV": the shape callers want is a
// short, deterministic digest -- the same shape a truncated sha256 hex
// digest would have -- but crypto.subtle.digest is PROMISE-based (Web
// Crypto has no synchronous digest), and this module is pure/synchronous by
// design (matching duplicateApplyVerdict.js's own C-19 no-ambient-I/O
// rule). FNV-1a is a standard, fast, non-cryptographic hash that meets that
// bar: deterministic, fixed-width output, and by construction its output is
// a hash of the input -- never the input itself, however short or
// hex-shaped the input happens to be.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashPostingKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Never lets a hostile/broken hash function (including one a test injects
// to prove the throw path) escape into buildDupeLogRecord's own
// never-throws guarantee.
function hashOrNull(value, hashFn) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const hashed = hashFn(value);
    return typeof hashed === "string" && hashed.length > 0 ? hashed : null;
  } catch {
    return null;
  }
}

// SEC-5's MUST-NOT list, named as the raw fields it forbids. Exported so the
// Wave-4 download sweep (duplicateApplyLog.download.test.js) plants and
// searches for exactly these values, rather than re-deriving the list from
// prose.
export const LOG_FORBIDDEN_FIELDS = Object.freeze([
  "company", // positions.company, raw
  "title", // positions.title, raw
  "url", // positions.url, raw
  "applied_at", // applications.applied_at, raw
  "id", // applications.id
  "user_id", // the Supabase tenant id
  "resumeText",
  "coverLetterText",
  "sessionToken",
  "token",
  "secret",
  "password",
]);

// Every read below goes through tryGet rather than plain dot-access. The
// verdict object crosses a boundary this module does not control -- a
// synthetic check-threw verdict built by a caller's catch block, or (as the
// negative test proves) a deliberately hostile fixture -- and a getter that
// throws on read must degrade that ONE field to `undefined`, never abort
// the whole record (matching duplicateApplyVerdict.js's own per-row
// try/catch discipline, C-19/C-25).
function tryGet(obj, key) {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

function safeSignalCore(signal) {
  const s = signal && typeof signal === "object" ? signal : {};
  return {
    verdict: safeEnum(tryGet(s, "verdict"), KNOWN_VERDICTS),
    reason: safeEnum(tryGet(s, "reason"), KNOWN_REASONS),
  };
}

/**
 * buildDupeLogRecord({ verdict, jobId, entryPoint, snapshotAgeMs, hashKey })
 * -> a plain, JSON-safe object.
 *
 * `verdict` is evaluatePriorApplications' return shape (or a caller-built
 * synthetic `check-threw` verdict of the same shape, §4 A-1). `hashKey`
 * defaults to hashPostingKey but is an explicit parameter -- matching this
 * codebase's `now = Date.now`-style dependency injection
 * (lib/copilot/sessionLog.js:112) -- so a test can substitute a
 * deterministic stub instead of depending on FNV's exact output.
 *
 * Never throws: every field is read defensively and a missing/malformed
 * input degrades individual fields to `null` (or, for counts naturally
 * zero, `0`), never the whole record. See the module header for why this
 * matters as a security property, not just robustness.
 */
export function buildDupeLogRecord({ verdict, jobId, entryPoint, snapshotAgeMs, hashKey = hashPostingKey } = {}) {
  const v = verdict && typeof verdict === "object" ? verdict : {};
  const samePositionSrc = tryGet(v, "samePosition");
  const companySrc = tryGet(v, "company");
  const diagnosticsSrc = tryGet(v, "diagnostics");
  const samePositionRaw = samePositionSrc && typeof samePositionSrc === "object" ? samePositionSrc : {};
  const companyRaw = companySrc && typeof companySrc === "object" ? companySrc : {};
  const diagnostics = diagnosticsSrc && typeof diagnosticsSrc === "object" ? diagnosticsSrc : {};
  const hashFn = typeof hashKey === "function" ? hashKey : hashPostingKey;

  const samePosition = safeSignalCore(samePositionRaw);
  const company = safeSignalCore(companyRaw);

  const rowsExamined = safeFiniteNumber(tryGet(diagnostics, "rowsExamined"));
  const rowsCounted = safeFiniteNumber(tryGet(diagnostics, "rowsCounted"));
  const evidence = tryGet(companyRaw, "evidence");

  return {
    entryPoint: safeBoundedString(entryPoint, MAX_ENTRY_POINT_CHARS),
    jobIdPrefix: jobIdPrefixOf(jobId),
    checkedAt: safeFiniteNumber(tryGet(v, "checkedAt")),
    snapshotAgeMs: safeFiniteNumber(snapshotAgeMs),

    // Which signal fired, its verdict, its reason -- never its raw evidence.
    samePosition: {
      verdict: samePosition.verdict,
      reason: samePosition.reason,
      route: safeEnum(tryGet(samePositionRaw, "route"), KNOWN_ROUTES),
      matched: Boolean(tryGet(samePositionRaw, "match")),
    },
    company: {
      verdict: company.verdict,
      reason: company.reason,
      groups: safeFiniteNumber(tryGet(companyRaw, "count")),
      undatableCount: safeFiniteNumber(tryGet(companyRaw, "undatableCount")),
      futureCount: safeFiniteNumber(tryGet(companyRaw, "futureCount")),
      evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
    },

    // The stage counts: examined, counted, and the gap between them (rows
    // that were read but did not qualify for either signal) -- plus enough
    // to tell a genuine "nothing found" (rowsState "ready") from "the check
    // could not run" (rowsState "loading"/"error", rowsExamined 0).
    diagnostics: {
      rowsExamined,
      rowsCounted,
      rowsDropped: rowsExamined !== null && rowsCounted !== null ? Math.max(0, rowsExamined - rowsCounted) : null,
      rowsState: safeEnum(tryGet(diagnostics, "rowsState"), KNOWN_ROWS_STATES),
      windowDays: safeFiniteNumber(tryGet(diagnostics, "windowDays")),
      candidateKeyHash: hashOrNull(tryGet(diagnostics, "candidateKey"), hashFn),
      candidateCompanyKeyHash: hashOrNull(tryGet(diagnostics, "candidateCompanyKey"), hashFn),
    },
  };
}
