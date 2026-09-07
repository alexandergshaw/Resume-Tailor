#!/usr/bin/env node
// ONE-OFF BACKFILL for research reports written before commit 77d9664.
//
//   Dry run (default, reads only):
//     node --env-file=.env.local scripts/backfillResearchReportCitationLabels.mjs --user <uuid>
//   Write:
//     node --env-file=.env.local scripts/backfillResearchReportCitationLabels.mjs --user <uuid> --apply
//
// WHY A SCRIPT AND NOT A REPAIR-ON-READ. lib/tracking/ repairs citation labels
// when they are read, because one function is the only reader of a structured
// column. This surface is the opposite on both counts: the label is baked into
// `experience_pages.body` as MARKDOWN at write time by
// lib/experience/researchReport.js, and the only reader
// (lib/experience/markdown.js, via MarkdownPreview) renders a link's children
// verbatim. There is no read path left to fix it in. So every report generated
// before 77d9664 still carries, permanently:
//
//   1. A FALSE PUBLISHER LABEL. Gemini's legacy grounding metadata returns
//      `web.uri` as a `vertexaisearch.cloud.google.com` REDIRECT and
//      `web.title` as the publisher's BARE DOMAIN. The old Sources builder
//      paired them verbatim — `- [${g.title || g.uri}](${g.uri})` — so a line
//      DISPLAYS "reuters.com" over a Google API redirect. Its `|| g.uri` tail
//      is the same defect's other face: an untitled source was stored under
//      its own URL as its NAME, the fourth fallback citationLabel.js says does
//      not exist.
//   2. POSSIBLY A LIVE INJECTED LINK, and this is why the backfill is not
//      cosmetic. markdown.js's link branch takes the FIRST `]` after `[` with
//      no escape handling, so a vendor title of
//      `Analysis ](https://evil.example/x) more` was stored as
//      `- [Analysis ](https://evil.example/x) more](<the real redirect>)` and
//      renders as a working anchor to evil.example inside the user's own
//      saved document. Pinned in this script's test against the REAL
//      `parseMarkdown`, before and after.
//
// ------------------------------------------------------------- HOW IT WORKS
//
// THE RULE IS IMPORTED, NEVER RESTATED. `reconcileCitations` — the shipped
// writer itself — is used as the ORACLE: the Sources block is parsed back into
// the `{uri, title}` records it was built from, handed to `reconcileCitations`
// with an empty body, and the `## Sources` lines it emits are the corrected
// ones. Nothing here decides what a citation may be called, applies a bracket
// strip, or computes a hidden host. That matters beyond tidiness:
// `nonPublisherHosts`' clause (b) needs the WHOLE source set to decide, so the
// records are handed over together, exactly as the writer hands them over.
//
// SCOPE: THE `## Sources` BLOCK, AND NOTHING ELSE. Deliberate, on two grounds.
//   * It is the entire injection surface. The other label path — a surviving
//     inline citation — takes its label from the model's own link TEXT, which
//     by construction (`[^\]]*`) can never contain a `]`, so no inline label
//     can carry an injection.
//   * Rewriting prose is the one unrecoverable mistake available here. Running
//     `reconcileCitations` over the body as well would also DEMOTE any link
//     whose URL is not in the grounded set — including a link the user added
//     by hand after the report was saved. That is data loss, so the prose is
//     never touched. See OPEN QUESTION at the bottom of this comment.
//
// SAFETY, in the order it is enforced:
//   * DRY RUN unless `--apply` is spelled out, and `--user` is mandatory, so a
//     bare invocation cannot write and cannot even read.
//   * The read is KEYSET-paginated and stops only on an EMPTY page, never on a
//     short one — PostgREST's `db-max-rows` truncates a response to a PREFIX
//     regardless of `.limit()`, and a loop that stops on a short page silently
//     backfills a subset and reports success. An independent exact count is
//     read first and any disagreement is reported.
//   * EVERY statement carries `.eq("user_id", …)`. The client is the
//     SERVICE-ROLE one (lib/supabase/admin.js) because a backfill has no user
//     session to borrow, and service role bypasses RLS entirely — so the
//     tenant filter has to be in the statement, and it is, on the count, on
//     every page read, and on every update.
//   * A body the rule does not govern comes back BYTE-IDENTICAL and is never
//     written. Anything this script cannot decompose and re-emit line-for-line
//     is SKIPPED whole and reported, never partially rewritten.
//   * The UPDATE is optimistic: `.eq("body", <the body that was read>)`. A row
//     a user edited between the read and the write matches nothing, is counted
//     as a conflict, and keeps their text.
//
// IF IT DIES HALF-WAY: nothing to undo. Each row is its own independent,
// self-contained UPDATE — there is no cross-row transaction and no cursor to
// persist. Re-running is the recovery: the rewrite is idempotent (proven in
// the test, not asserted here), so already-repaired rows come back "unchanged"
// and are not written a second time.
//
// OPEN QUESTION FOR THE OWNER, not guessed at here: whether any stored report
// has a SURVIVING INLINE citation whose label the rule would change. On the
// legacy grounding surface it should be none — an inline link survives only if
// its URL matches a grounded key, and there every grounded key is a
// vertexaisearch redirect, which a model does not write into its own prose.
// That could not be checked from a checkout with no data in it.

import { pathToFileURL } from "node:url";
import { reconcileCitations } from "../lib/experience/researchReport.js";

export const TABLE = "experience_pages";
export const GENERATED_KIND = "research";
export const SOURCES_HEADING = "## Sources";
export const DEFAULT_PAGE_SIZE = 500;

const PREFIX = "backfill-citation-labels";
const SOURCES_MARKER = `\n\n${SOURCES_HEADING}\n`;

// How much of any one string may reach a terminal. A research report body runs
// to tens of thousands of characters and a redirect URL to hundreds; printing
// either whole turns a review into a scroll.
const MAX_EXCERPT = 160;
const MAX_EXAMPLE_LINES = 3;
const MAX_EXAMPLE_PAGES = 10;

const USAGE = `Usage:
  node --env-file=.env.local scripts/backfillResearchReportCitationLabels.mjs --user <uuid> [--page-size N]
  node --env-file=.env.local scripts/backfillResearchReportCitationLabels.mjs --user <uuid> --apply

  --user <uuid>    REQUIRED. The owner whose research reports to inspect. Every
                   statement is filtered on it; there is no all-tenants mode.
  --apply          Write. Without it this only reports, and touches nothing.
  --page-size N    Rows per read (default ${DEFAULT_PAGE_SIZE}). The loop pages until an
                   empty page comes back, so this is a request-size knob only.

Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
environment. Neither is ever printed.

Node prints "[MODULE_TYPELESS_PACKAGE_JSON] Warning ... Reparsing as ES module"
on startup. That is expected and harmless: this app's package.json has no
"type": "module" (Next needs it that way), so Node sniffs the lib/ modules this
script imports. Do not "fix" it by editing package.json.`;

// A single Sources line, ANCHORED at both ends, with a GREEDY label.
//
// Greedy is the whole point, and it is the opposite of the bug being repaired.
// markdown.js takes the FIRST `]`, which on an injected title
// (`Analysis ](https://evil.example/x) more`) lands inside the label and hands
// the anchor to somebody else's URL. Taking the LAST `](` that still leaves a
// url and a closing `)` at end-of-line recovers the ORIGINAL `(title, uri)`
// pair the buggy writer was handed — which is exactly what the fixed writer
// needs as input. Anchoring is what makes it safe: a Sources line holds exactly
// one link by construction, so a greedy match cannot swallow a neighbour the
// way it would in prose.
const SOURCE_LINE_RE = /^- \[(.*)\]\((.*)\)$/;

/**
 * The `{label, url}` a stored Sources line was built from, or null if the line
 * is not one.
 *
 * @param {unknown} line
 * @returns {{label: string, url: string}|null}
 */
export function parseSourceLine(line) {
  if (typeof line !== "string") return null;
  const match = SOURCE_LINE_RE.exec(line);
  return match === null ? null : { label: match[1], url: match[2] };
}

// The corrected Sources lines for a whole record set, produced by the SHIPPED
// writer. `markdown: ""` because only the Sources half is wanted: the body
// half of reconcileCitations also demotes links, which must never happen to a
// user's stored prose (see the header). Returns null when the writer refused
// every record, in which case it emits the "not grounded" notice and no
// Sources section at all.
function canonicalSourceLines(records) {
  const { markdown } = reconcileCitations({ markdown: "", groundedSources: records });
  const at = markdown.lastIndexOf(SOURCES_MARKER);
  if (at === -1) return null;
  const tail = markdown.slice(at + SOURCES_MARKER.length);
  return tail === "" ? [] : tail.split("\n");
}

/**
 * relabelReportBody(body) -> {body, changes, status, reason}
 *
 * `status` is one of:
 *   "changed"   — `body` is the repaired markdown; `changes` lists the lines.
 *   "unchanged" — `body` is the input STRING ITSELF, byte-identical.
 *   "skipped"   — same, plus a `reason`: something about this document could
 *                 not be decomposed and re-emitted safely, so nothing was done.
 *
 * The unchanged case is not an optimisation. citationLabel.js's argument for a
 * rule instead of a comparison is that a title naming its own host and a title
 * naming somebody else's have the SAME correct outcome; the empirical form of
 * that claim is `[reuters.com](https://www.reuters.com/…)` coming back
 * character-for-character identical, which this file's test pins.
 *
 * @param {unknown} body
 */
export function relabelReportBody(body) {
  const src = typeof body === "string" ? body : "";
  const unchanged = (reason) => ({ body: src, changes: [], status: "unchanged", reason });
  const skipped = (reason) => ({ body: src, changes: [], status: "skipped", reason });

  // markdown.js normalises CRLF at RENDER time, so a body carrying carriage
  // returns displays fine and this script has no business rewriting the line
  // endings in a user's stored text as a side effect of a label repair.
  if (src.includes("\r")) return skipped("carriage-returns");

  const lines = src.split("\n");
  const headingIndex = lines.lastIndexOf(SOURCES_HEADING);
  if (headingIndex === -1) return unchanged("no-sources-section");

  // The writer appends the Sources block LAST, with no trailing newline. Blank
  // lines after it can only have come from a hand edit; they are carried
  // through verbatim rather than trimmed away.
  const region = lines.slice(headingIndex + 1);
  let end = region.length;
  while (end > 0 && region[end - 1].trim() === "") end -= 1;
  const sourceLines = region.slice(0, end);
  const trailer = region.slice(end);
  if (sourceLines.length === 0) return unchanged("no-source-lines");

  const records = [];
  for (const line of sourceLines) {
    const parsed = parseSourceLine(line);
    // ALL-OR-NOTHING. A partial record set would give nonPublisherHosts'
    // clause (b) a different set than the writer had, so the labels it
    // produced would not be the writer's either.
    if (parsed === null) return skipped("unparseable-source-line");
    records.push({ uri: parsed.url, title: parsed.label });
  }

  const rebuilt = canonicalSourceLines(records);
  if (rebuilt === null || rebuilt.length !== records.length) return skipped("oracle-mismatch");
  // Alignment proof, not decoration: the rule NEVER changes an href, so if a
  // re-emitted line's url is not the one that went in at that index, the
  // decomposition was wrong and nothing may be written.
  for (let i = 0; i < rebuilt.length; i += 1) {
    const parsed = parseSourceLine(rebuilt[i]);
    if (parsed === null || parsed.url !== records[i].uri) return skipped("oracle-mismatch");
  }

  const changes = [];
  for (let i = 0; i < rebuilt.length; i += 1) {
    if (rebuilt[i] !== sourceLines[i]) {
      changes.push({ line: headingIndex + 2 + i, before: sourceLines[i], after: rebuilt[i] });
    }
  }
  if (changes.length === 0) return unchanged(null);

  return {
    body: [...lines.slice(0, headingIndex + 1), ...rebuilt, ...trailer].join("\n"),
    changes,
    status: "changed",
    reason: null,
  };
}

/**
 * Every research page belonging to one user, read to the END of the list.
 *
 * KEYSET pagination (`order(id) + gt(id, cursor) + limit`), and the loop stops
 * ONLY on an empty page. That is the whole defence against PostgREST's
 * `db-max-rows`, which caps a response to a PREFIX with no error and no
 * header this client surfaces: a short page then advances the cursor less far
 * rather than ending the walk. `.range()` is deliberately not used — an offset
 * window over a table being written to can skip rows, and this repo's
 * in-memory fake refuses to model it at all.
 *
 * An independent exact count is read FIRST, the same idiom
 * lib/experience/knowledgeLoad.js uses for `truncatedRead`, so a disagreement
 * between "what the count says exists" and "what the walk saw" is reportable
 * instead of invisible.
 */
export async function readAllResearchPages({ supabase, userId, pageSize = DEFAULT_PAGE_SIZE, maxRequests = 100000 } = {}) {
  if (typeof userId !== "string" || userId === "") {
    return {
      rows: [],
      rowCount: null,
      requests: 0,
      reachedEnd: false,
      error: "Refusing to read: a user id is required. It is the only tenant filter a service-role client has.",
    };
  }
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;

  const counted = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("generated_kind", GENERATED_KIND);
  if (counted.error) {
    return {
      rows: [],
      rowCount: null,
      requests: 0,
      reachedEnd: false,
      error: counted.error.message || "Could not count this user's research pages.",
    };
  }
  const rowCount = typeof counted.count === "number" ? counted.count : null;

  const rows = [];
  let cursor = null;
  let requests = 0;

  while (requests < maxRequests) {
    let query = supabase
      .from(TABLE)
      .select("id, title, body")
      .eq("user_id", userId)
      .eq("generated_kind", GENERATED_KIND)
      .order("id", { ascending: true })
      .limit(size);
    if (cursor !== null) query = query.gt("id", cursor);

    const { data, error } = await query;
    requests += 1;
    if (error) {
      return { rows, rowCount, requests, reachedEnd: false, error: error.message || "Could not read a page of rows." };
    }
    const batch = Array.isArray(data) ? data : [];
    if (batch.length === 0) return { rows, rowCount, requests, reachedEnd: true, error: null };
    for (const row of batch) rows.push(row);
    cursor = batch[batch.length - 1].id;
  }

  return {
    rows,
    rowCount,
    requests,
    reachedEnd: false,
    error: `Gave up after ${requests} requests without reaching the end of the list. Nothing was written.`,
  };
}

// One line's worth of any string, never more than `max` characters of it.
function excerpt(value, max = MAX_EXCERPT) {
  const oneLine = String(value ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

/**
 * Replace any secret VALUE present in `text` with a mention of its NAME.
 *
 * A client error message can carry the key that was used; printing it into a
 * terminal, a CI log or a pasted bug report is how a service-role key escapes.
 * The short-value guard stops an empty or absent variable from turning every
 * character of the output into a redaction marker.
 */
export function redactSecrets(text, secrets = {}) {
  let out = String(text ?? "");
  for (const [name, value] of Object.entries(secrets || {})) {
    if (typeof value === "string" && value.length >= 8) out = out.split(value).join(`[redacted:${name}]`);
  }
  return out;
}

/**
 * The whole job: read this user's research pages, report what the rule would
 * change, and — only with `apply: true` — write it.
 *
 * `log` is injected so the test can assert on what reaches a terminal, which
 * is the only place "never dump a whole document" can be checked.
 */
export async function runBackfill({
  supabase,
  userId,
  apply = false,
  pageSize = DEFAULT_PAGE_SIZE,
  maxExampleLines = MAX_EXAMPLE_LINES,
  maxExamplePages = MAX_EXAMPLE_PAGES,
  log = console.log,
} = {}) {
  const say = (line = "") => log(line);
  const summary = {
    userId,
    apply,
    matched: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    linesAffected: 0,
    written: 0,
    conflicts: 0,
    writeErrors: 0,
    rowCount: null,
    requests: 0,
    reachedEnd: false,
    reports: [],
    error: null,
  };

  say(
    apply
      ? `${PREFIX}: WRITING. --apply was given, so matching rows WILL be modified.`
      : `${PREFIX}: DRY RUN. Nothing is written. Re-run with --apply to write.`,
  );
  say(`${PREFIX}: user ${userId || "(missing)"}`);
  say(`${PREFIX}: ${TABLE} where generated_kind = '${GENERATED_KIND}', scoped by user_id on every statement`);

  const read = await readAllResearchPages({ supabase, userId, pageSize });
  summary.rowCount = read.rowCount;
  summary.requests = read.requests;
  summary.reachedEnd = read.reachedEnd;
  if (read.error) {
    summary.error = read.error;
    say(`${PREFIX}: READ FAILED — ${excerpt(read.error, 240)}`);
    say(`${PREFIX}: nothing was written.`);
    return summary;
  }

  summary.matched = read.rows.length;
  say(
    `${PREFIX}: read ${read.rows.length} page(s) over ${read.requests} request(s); ` +
      `exact count ${read.rowCount === null ? "unavailable" : read.rowCount}; ` +
      "end of list confirmed by an empty page.",
  );
  if (read.rowCount !== null && read.rowCount !== read.rows.length) {
    say(
      `${PREFIX}: WARNING — the exact count says ${read.rowCount} but the walk saw ${read.rows.length}. ` +
        "Rows may have been inserted or deleted while it ran; re-run to confirm.",
    );
  }

  for (const row of read.rows) {
    const result = relabelReportBody(row.body);
    const entry = {
      id: row.id,
      title: row.title,
      status: result.status,
      reason: result.reason,
      changes: result.changes,
      body: result.body,
      original: typeof row.body === "string" ? row.body : "",
      write: null,
    };
    summary.reports.push(entry);
    if (result.status === "changed") {
      summary.changed += 1;
      summary.linesAffected += result.changes.length;
    } else if (result.status === "skipped") {
      summary.skipped += 1;
    } else {
      summary.unchanged += 1;
    }
  }

  const notable = summary.reports.filter((entry) => entry.status !== "unchanged");
  let shown = 0;
  for (const entry of notable) {
    if (shown >= maxExamplePages) break;
    shown += 1;
    say("");
    say(`  ${entry.status === "skipped" ? "SKIP  " : "CHANGE"} ${entry.id}  ${excerpt(entry.title, 60)}`);
    if (entry.status === "skipped") {
      say(`    left alone — ${entry.reason}`);
      continue;
    }
    for (const change of entry.changes.slice(0, maxExampleLines)) {
      say(`    line ${change.line}`);
      say(`      before: ${excerpt(change.before)}`);
      say(`      after:  ${excerpt(change.after)}`);
    }
    const hidden = entry.changes.length - Math.min(entry.changes.length, maxExampleLines);
    if (hidden > 0) say(`      … and ${hidden} more changed line(s) on this page`);
  }
  if (notable.length > shown) {
    say("");
    say(`  … and ${notable.length - shown} more affected page(s) not shown`);
  }

  say("");
  say(
    `${PREFIX}: ${summary.matched} page(s) matched — ${summary.changed} would change ` +
      `(${summary.linesAffected} line(s)), ${summary.unchanged} already correct, ${summary.skipped} skipped.`,
  );

  if (!apply) {
    say(`${PREFIX}: DRY RUN — no statement other than a SELECT was issued.`);
    return summary;
  }

  for (const entry of summary.reports) {
    if (entry.status !== "changed") continue;
    const { data, error } = await supabase
      .from(TABLE)
      .update({ body: entry.body })
      .eq("id", entry.id)
      .eq("user_id", userId)
      // Optimistic concurrency: this only matches while the stored body is
      // still the one that was read and reasoned about.
      .eq("body", entry.original)
      .select("id");

    if (error) {
      summary.writeErrors += 1;
      entry.write = "error";
      say(`  ERROR ${entry.id} — ${excerpt(error.message || "update failed", 200)}`);
      continue;
    }
    if ((Array.isArray(data) ? data.length : 0) === 1) {
      summary.written += 1;
      entry.write = "written";
      continue;
    }
    summary.conflicts += 1;
    entry.write = "conflict";
    say(`  CONFLICT ${entry.id} — its body changed since it was read; left untouched.`);
  }

  say(
    `${PREFIX}: wrote ${summary.written} page(s); ${summary.conflicts} conflict(s), ${summary.writeErrors} error(s). ` +
      "Re-running is safe — the rewrite is idempotent.",
  );
  return summary;
}

/**
 * The command line. Dry run is not a flag; it is what happens when `--apply` is
 * absent, and `--user` is mandatory, so `node scripts/…mjs` on its own reads
 * nothing and writes nothing. An argument this does not recognise is an ERROR
 * rather than something ignored: a mistyped flag must not quietly become the
 * default behaviour of some other run.
 */
export function parseArgs(argv = []) {
  const base = { userId: "", apply: false, pageSize: DEFAULT_PAGE_SIZE, help: false, error: null };
  const args = Array.isArray(argv) ? argv.map((a) => String(a)) : [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      base.help = true;
      continue;
    }
    if (arg === "--apply") {
      base.apply = true;
      continue;
    }
    if (arg === "--user") {
      base.userId = args[i + 1] === undefined ? "" : args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--page-size") {
      const raw = args[i + 1] === undefined ? "" : args[i + 1];
      i += 1;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ...base, error: `--page-size wants a positive whole number, got "${raw}".` };
      }
      base.pageSize = parsed;
      continue;
    }
    return { ...base, error: `Unrecognised argument "${arg}". Nothing was read and nothing was written.` };
  }

  if (base.help) return base;
  if (base.userId === "") {
    return { ...base, error: "Missing --user <uuid>. This script is scoped to one owner and will not run without one." };
  }
  return base;
}

function redactEnvSecrets(text) {
  return redactSecrets(text, {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.error) {
    console.error(`${PREFIX}: ${args.error}`);
    console.error("");
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  // Imported lazily so that merely importing this module — which the test
  // does — never constructs, or even loads, a real database client.
  //
  // SERVICE ROLE, stated plainly: a backfill has no user session to borrow, so
  // it cannot use the RLS-scoped client every request path uses. That client
  // bypasses RLS completely, which is exactly why `--user` is mandatory and
  // why the tenant filter is written into every statement above rather than
  // left to the database.
  let supabase;
  try {
    const { createAdminClient } = await import("../lib/supabase/admin.js");
    supabase = createAdminClient();
  } catch (err) {
    console.error(`${PREFIX}: ${redactEnvSecrets(err?.message || String(err))}`);
    process.exitCode = 2;
    return;
  }

  const summary = await runBackfill({
    supabase,
    userId: args.userId,
    apply: args.apply,
    pageSize: args.pageSize,
    log: (line) => console.log(redactEnvSecrets(line)),
  });

  if (summary.error || summary.writeErrors > 0) process.exitCode = 1;
}

// Only when run as a program. Importing this file (the test does) must have no
// effect at all — no argv parsing, no client, no output. Under vitest
// `process.argv[1]` is the runner, so the two URLs differ and nothing runs.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error(`${PREFIX}: ${redactEnvSecrets(err?.message || String(err))}`);
    process.exitCode = 1;
  });
}
