// lib/duplicateApply/duplicateApplyLogDocument.js
//
// THE OTHER HALF OF duplicateApplyLog.js: that module builds ONE RECORD from
// one verdict; this one turns an accumulated LEDGER of those records into the
// markdown file the download button writes, and decides what that file is
// called. The split is deliberate and matches the header duplicateApplyLog.js
// already shipped with ("this module does NOT create a log ... -- it produces
// the plain object a caller hands to" the log): the record builder stays a pure
// per-verdict function with its own test suite, and everything that is only
// true of a WHOLE SESSION -- ordering, counts, the FIFO cap, the file name --
// lives here instead of being retro-fitted into it.
//
// WHY THIS FILE EXISTS AT ALL. duplicateApplyLog.js was built, tested and then
// never called by anything: outside its own test the only references to it in
// app/ or lib/ were comments in lib/experience/knowledgeLog.js citing it as the
// pattern to copy. So the records it describes were built by nobody and
// readable by no one, and this feature did not honour the standing feature-logs
// rule (every feature that can carry a log gets one, plus a clearly visible
// download button, one shared primitive, a single .md, surviving Clear) even
// though its own header is where that rule is written down. This module plus
// app/hooks/useDuplicateApplyCheck.js's ledger and app/components/StatusBar.js's
// button close that loop.
//
// PURE AND SYNCHRONOUS, exactly like the module it completes: no Date.now(), no
// DOM, no network, no import of postingIdentity.js/companyIdentity.js/
// duplicateApplyVerdict.js. Every instant it prints arrives as a NUMBER the
// caller already read off the clock (the hook's own `Date.now()`), because the
// C-19 no-ambient-I/O rule is what makes both the record builder and this
// renderer testable without pinning a machine clock. It does not import
// triggerBlobDownload either -- that is a DOM helper for the actual click, and
// this module has no DOM.
//
// WHAT THE FILE CONTAINS, AND DELIBERATELY DOES NOT.
// The ledger it renders is made of `buildDupeLogRecord` outputs, so SEC-5's
// MUST-NOT list is already enforced upstream: no raw positions.company/title/
// url, no applied_at, no applications.id, no user_id, no token, no resume or
// posting text ever reaches a record in the first place. This module adds
// exactly three things to each record -- the KIND of thing that happened
// (`check` or `dismiss`), the instant the hook stamped, and the ordinal -- and
// nothing else. In particular it does NOT reach for the far more readable
// employer name and job title that `presentVerdict`'s notice object is holding
// a few lines away in the same hook. That is the whole privacy line for this
// artifact: a banner is a transient, on-screen thing shown to the person who is
// looking at that posting right now, while this file is a durable disclosure
// surface that gets mailed to support and dropped in shared folders. Putting
// the employer back in through this door would undo the ruling
// duplicateApplyLog.js already made when it chose to HASH a candidateKey
// precisely because a url-shaped one literally IS the posting URL. So the file
// records DECISIONS -- which signal fired, why, over how many rows, and what
// the user then did about it -- and never the application HISTORY those
// decisions were about.
//
// Two independent defenses, the same pair both sibling log modules use:
//   1. Every field is read BY NAME off the record. Nothing is spread, so an
//      extra property on a record (a bug, or a caller that skipped
//      buildDupeLogRecord entirely) has no path into the output.
//   2. Every string-shaped field is re-validated against a bounded identifier
//      pattern before it is written, so a value that has been overwritten with
//      secret-shaped text degrades to a placeholder instead of being rendered.
//      Deliberately a PATTERN and not a second copy of duplicateApplyLog.js's
//      closed verdict/reason/route sets: that module is the single source of
//      truth for those vocabularies (it already refuses anything outside them),
//      and a re-typed copy here would be a second list to keep in sync -- the
//      exact duplication lib/duplicateApply/statusVocabularyPin.test.js exists
//      to prevent elsewhere. This layer is defense in depth against a caller
//      that bypassed the builder, not a re-litigation of the vocabulary.

export const DUPE_LOG_SCHEMA = 1;

// The FIFO cap the accumulating caller applies, named here so the caller and
// the document that reports the drops agree on one number. Same size and same
// reasoning as lib/copilot/sessionLog.js's MAX_SESSION_LOG_EVENTS: a long
// session must not grow without bound, and the END of it -- where the user
// actually noticed something was wrong -- is what has to survive, so the oldest
// entries are the ones that go.
export const MAX_DUPE_LOG_ENTRIES = 500;

// The two things that can happen to a duplicate-apply verdict in one session.
const KNOWN_ENTRY_KINDS = new Set(["check", "dismiss"]);

// Short, closed-shape identifiers: a verdict (`hit`), a reason
// (`undated-match`), a route (`url`), a rows state (`ready`), a job-id prefix
// (`url-`) or an entry-point code (`E3`). Real values are all short and either
// a bare code or kebab-case; free text with spaces, punctuation or line breaks
// never matches, which is what makes this a usable last line of defense against
// a smuggled token dressed up to look like a reason. Same idiom, and the same
// reasoning, as lib/experience/knowledgeLog.js's SAFE_IDENTIFIER_RE.
const SAFE_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;

// hashPostingKey's output shape, and NOT the identifier pattern above: a digest
// is eight lowercase hex characters and very often starts with a digit, which
// SAFE_IDENTIFIER_RE deliberately refuses (a leading digit is not a code name).
// Validating a hash with the identifier rule silently blanked every digest that
// did not happen to begin with a-f -- roughly six times in ten -- which is the
// kind of near-miss that looks like a working log until the one entry you need
// is the one that came back "none".
const SAFE_HASH_RE = /^[0-9a-f]{8}$/;

const NONE = "none";

function tryGet(obj, key) {
  try {
    return obj[key];
  } catch {
    // A hostile or merely broken getter costs its own field, never the file.
    return undefined;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeIdentifier(value) {
  return typeof value === "string" && SAFE_IDENTIFIER_RE.test(value) ? value : null;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function num(value) {
  const n = safeNumber(value);
  return n === null ? "-" : String(n);
}

function ident(value) {
  return safeIdentifier(value) || NONE;
}

function hashOf(value) {
  return typeof value === "string" && SAFE_HASH_RE.test(value) ? value : NONE;
}

// An epoch-millisecond instant, printed in UTC. Deliberately NOT the machine's
// local zone: this file crosses timezones the moment it is attached to a
// support ticket, and a local stamp would make the same session read as two
// different times to two readers.
function iso(value) {
  const ms = safeNumber(value);
  if (ms === null) return "unknown";
  try {
    return new Date(ms).toISOString();
  } catch {
    // Date rejects instants outside +/-8.64e15 ms.
    return "unknown";
  }
}

function yesNo(value) {
  return value === true ? "yes" : "no";
}

// One record, read entirely by name. `record` is a buildDupeLogRecord output;
// anything else degrades field by field rather than costing the entry.
function renderRecord(lines, record) {
  const r = isPlainObject(record) ? record : {};
  const samePosition = isPlainObject(tryGet(r, "samePosition")) ? r.samePosition : {};
  const company = isPlainObject(tryGet(r, "company")) ? r.company : {};
  const diagnostics = isPlainObject(tryGet(r, "diagnostics")) ? r.diagnostics : {};

  lines.push(`- Entry point: ${ident(tryGet(r, "entryPoint"))}`);
  lines.push(`- Job id type: ${ident(tryGet(r, "jobIdPrefix"))}`);
  lines.push(`- Verdict computed at: ${iso(tryGet(r, "checkedAt"))}`);
  lines.push(`- Snapshot age: ${num(tryGet(r, "snapshotAgeMs"))} ms`);
  lines.push(
    `- Same-position: ${ident(tryGet(samePosition, "verdict"))} ` +
      `(reason ${ident(tryGet(samePosition, "reason"))}, ` +
      `route ${ident(tryGet(samePosition, "route"))}, ` +
      `matched ${yesNo(tryGet(samePosition, "matched"))})`,
  );
  lines.push(
    `- Company: ${ident(tryGet(company, "verdict"))} ` +
      `(reason ${ident(tryGet(company, "reason"))}, ` +
      `groups ${num(tryGet(company, "groups"))}, ` +
      `undatable ${num(tryGet(company, "undatableCount"))}, ` +
      `future ${num(tryGet(company, "futureCount"))}, ` +
      `evidence ${num(tryGet(company, "evidenceCount"))})`,
  );
  // The three states S-10i renders identically on screen -- a genuine `clear`,
  // a load that had not finished, and a check that threw -- are told apart HERE
  // or nowhere: by the rows state and the examined/counted pair, not by the
  // verdict, which reads "nothing found" for all three.
  lines.push(
    `- Rows: examined ${num(tryGet(diagnostics, "rowsExamined"))}, ` +
      `counted ${num(tryGet(diagnostics, "rowsCounted"))}, ` +
      `dropped ${num(tryGet(diagnostics, "rowsDropped"))}, ` +
      `state ${ident(tryGet(diagnostics, "rowsState"))}, ` +
      `window ${num(tryGet(diagnostics, "windowDays"))} days`,
  );
  lines.push(`- Candidate posting key (hashed): ${hashOf(tryGet(diagnostics, "candidateKeyHash"))}`);
  lines.push(`- Candidate company key (hashed): ${hashOf(tryGet(diagnostics, "candidateCompanyKeyHash"))}`);
}

function renderEntry(lines, entry, ordinal) {
  const kindRaw = tryGet(entry, "kind");
  const kind = typeof kindRaw === "string" && KNOWN_ENTRY_KINDS.has(kindRaw) ? kindRaw : "unknown";
  lines.push(`### ${ordinal}. ${kind} at ${iso(tryGet(entry, "at"))}`);
  renderRecord(lines, tryGet(entry, "record"));
  lines.push("");
}

// Keeps only the entries this module can meaningfully render, so a null or a
// primitive in the ledger costs its own line and not the file. Never throws:
// the array itself may come from anywhere.
function usableEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const kept = [];
  for (const entry of entries) {
    try {
      if (isPlainObject(entry)) kept.push(entry);
    } catch {
      // An element whose mere access throws is skipped.
    }
  }
  return kept;
}

function countKind(entries, kind) {
  let total = 0;
  for (const entry of entries) {
    if (tryGet(entry, "kind") === kind) total += 1;
  }
  return total;
}

function buildDocument({ entries, startedAt, dropped }) {
  const kept = usableEntries(entries);
  const checks = countKind(kept, "check");
  const dismissals = countKind(kept, "dismiss");
  const droppedCount = safeNumber(dropped) ?? 0;

  const lines = ["# Duplicate-application check log", ""];
  lines.push(`- Schema: ${DUPE_LOG_SCHEMA}`);
  lines.push(`- Session started: ${iso(startedAt)}`);
  lines.push(`- Entries recorded: ${kept.length}`);
  lines.push(`- Checks: ${checks}`);
  lines.push(`- Dismissals: ${dismissals}`);
  if (droppedCount > 0) {
    lines.push(`- Dropped ${droppedCount} older entries to stay under the ${MAX_DUPE_LOG_ENTRIES}-entry cap`);
  }
  lines.push("");

  // The file says what it is, in the file. A reader who has been handed this
  // by someone else should not have to take on trust what they are now holding.
  lines.push("## What this file contains");
  lines.push("");
  lines.push(
    "Every duplicate-application check this session ran, and every one you dismissed: which signal fired, why, and over how many of your application rows.",
  );
  lines.push(
    "It does NOT contain employer names, job titles, posting URLs, application dates, application or account ids, or any resume or posting text. Posting and company keys appear only as short one-way digests, so the same posting is recognisable across entries without the posting itself being written down.",
  );
  lines.push("");

  lines.push(`## Entries (${kept.length})`);
  lines.push("");
  if (kept.length === 0) {
    // The state this whole module exists to make legible: nothing on screen and
    // nothing in the file look identical unless the file says which it is.
    lines.push("_No duplicate-application check has been recorded in this session._");
    lines.push("");
  } else {
    kept.forEach((entry, index) => renderEntry(lines, entry, index + 1));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * renderDuplicateApplyLog({ entries, startedAt, dropped }) -> markdown string.
 *
 * `entries`: the accumulated ledger, oldest first, each
 * `{ kind: "check" | "dismiss", at: <epoch ms>, record: <buildDupeLogRecord output> }`.
 * Rendered IN THE ORDER GIVEN and never deduplicated: two identical checks a
 * few milliseconds apart are two things that happened, and a dismissal never
 * removes the check it dismissed. This is the property that makes the file a
 * ledger rather than a re-render of current state -- a verdict the user has
 * since dismissed is gone from the screen but still here.
 * `startedAt`: the instant the ledger's first entry was recorded, epoch ms.
 * `dropped`: how many entries the caller's FIFO cap has evicted.
 *
 * Never throws. Always returns a non-empty string, including for an empty or
 * entirely malformed ledger.
 */
export function renderDuplicateApplyLog(options) {
  try {
    // Deliberately NOT a destructuring default (`= {}`): that covers only
    // `undefined`, so an explicit `null` -- what a caller passes when its own
    // state was not ready -- would throw on destructure, out of reach of the
    // try/catch if it were written in the parameter list itself.
    const bag = isPlainObject(options) ? options : {};
    return buildDocument({ entries: bag.entries, startedAt: bag.startedAt, dropped: bag.dropped });
  } catch {
    return "# Duplicate-application check log\n\n_This log could not be rendered._\n";
  }
}

const FILE_STEM = "duplicate-check-log";

/**
 * duplicateApplyLogFileName({ startedAt }) -> "duplicate-check-log-YYYY-MM-DD-HHMM.md".
 *
 * Built from the SESSION's own start instant, not the clock at download time,
 * so re-downloading one session always produces the same name (the same
 * property lib/copilot/sessionLog.js's `sessionLogFileBase` has, and for the
 * same reason). Two deliberate differences from that function: the stamp is
 * UTC rather than local, and NOTHING caller-supplied is interpolated into the
 * name at all -- `sessionLogFileBase` folds a `mode` string in, but a file name
 * is itself a disclosure surface (it shows up in a download shelf, a shared
 * folder, and a support ticket's attachment list), so this one is a timestamp
 * and a constant, leaving nothing to scrub.
 */
export function duplicateApplyLogFileName(options) {
  const stamp = iso(isPlainObject(options) ? options.startedAt : undefined);
  if (stamp === "unknown") return `${FILE_STEM}-unknown-start.md`;
  // "2025-06-15T14:26:40.000Z" -> "2025-06-15-1426". Sliced off the ISO string
  // rather than re-derived from Date getters so the printed instant and the
  // file name can never disagree about which minute this was.
  const date = stamp.slice(0, 10);
  const time = `${stamp.slice(11, 13)}${stamp.slice(14, 16)}`;
  return `${FILE_STEM}-${date}-${time}.md`;
}
