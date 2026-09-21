/**
 * The migration corpus records what the repo's migration FILES say today,
 * not what the live database actually ran. One migration in this repo,
 * 20260915000000_interview_prep_spend_lockdown.sql, was applied by an
 * Action at commit 3d9bb27; commit 0e83c97 (the last commit to touch that
 * file) then ADDED four statement groups to that file IN PLACE -- the
 * one-time cross-tenant cleanup do-block, two `... from anon;` EXECUTE
 * revokes, and one table-level anon revoke, folded in alongside the file's
 * `from public;` lines -- and NONE OF THEM RAN: `db push` keys on the
 * version stamp, which did not change, so the edit was skipped. Every
 * grant-replay reader in this repo (migrationGrantReplay.js's
 * replayFunctionExecute/replayTableGrants) reads migration TEXT, so without
 * this module it silently certifies four statements that never ran against
 * the live schema.
 *
 * This module is the ledger of that divergence (NEVER_APPLIED_STATEMENTS)
 * plus the pure text machinery to act on it:
 *   - splitTopLevelStatements/normalizeStatement: a comment-stripped-SQL
 *     statement splitter, quote- and dollar-quote-aware, used both to build
 *     the ledger's fixed statement text and to locate it inside a file;
 *   - statementDivergence: the multiset difference between two SQL texts'
 *     normalized statements, either direction;
 *   - appliedMigrationTexts: the APPLIED VIEW of a migration corpus -- every
 *     ledgered statement blanked out of its file, so a consumer that reads
 *     this view instead of raw file text stops seeing statements that were
 *     never executed;
 *   - textsBefore: the corpus prefix strictly before a named file, by NAME
 *     comparison (never index/slice -- see its own doc).
 *
 * THE LEDGER ENTRIES ARE LITERALS, NEVER DERIVED AT RUNTIME. Each entry's
 * `statement` was produced once, outside this tree, by running this same
 * splitTopLevelStatements/normalizeStatement pair over the comment-stripped
 * committed file and the git-shown applied bytes, taking the committed-only
 * side of statementDivergence, and pasting the result with
 * JSON.stringify (so `$$`, quotes and backslashes are escaped by
 * construction rather than by a find/replace that could corrupt them). That
 * is a deliberate choice, not an oversight: if this module re-derived the
 * ledger from the migrations directory at import time, a staleness bug in
 * the committed file could never be caught by comparing the ledger against
 * that same file -- the two would always agree by construction. Fixing the
 * ledger to the applied history it describes, and reading the current
 * committed file separately (appliedMigrationTexts, and the tests that call
 * it), is what lets a stale ledger fail loudly instead of never being
 * checked at all. Accordingly this module touches no filesystem: it imports
 * only stripSqlComments, and nothing here reads a directory of migration
 * files.
 */
import { stripSqlComments } from "./stripSqlComments.js";

/** The provenance label for every ledger entry below, while no one has run
 *  the live `schema_migrations.statements` query (Q1) to confirm it
 *  directly. A future entry sourced from that query gets its own label
 *  ("schema_migrations (Q1, <date>)"); nothing here may ever read
 *  "live-confirmed" -- appliedMigrationTexts rejects it (see below). */
export const DIVERGENCE_SOURCE_GIT = "git-derived, live statements column not read";

const LOCKDOWN_MIGRATION = "20260915000000_interview_prep_spend_lockdown.sql";
const LOCKDOWN_BASE = Object.freeze({
  file: LOCKDOWN_MIGRATION,
  appliedCommit: "3d9bb27",
  committedCommit: "0e83c97",
  source: DIVERGENCE_SOURCE_GIT,
});

/**
 * @typedef {{ file: string, group: "cleanup-block" | "anon-execute-revoke" | "anon-table-revoke",
 *             statement: string, appliedCommit: string, committedCommit: string, source: string }} NeverAppliedEntry
 */

/** Exactly the four statement groups that are present in the committed text
 *  of 20260915000000_interview_prep_spend_lockdown.sql but never ran
 *  against the live database (see the module header). Order matches the
 *  file: the cleanup do-block first, then the two per-function anon EXECUTE
 *  revokes in the order they appear, then the table-level anon revoke.
 *  @type {ReadonlyArray<Readonly<NeverAppliedEntry>>} */
export const NEVER_APPLIED_STATEMENTS = Object.freeze([
  Object.freeze({
    ...LOCKDOWN_BASE,
    group: "cleanup-block",
    statement:
      "do $$ declare v_deleted_spend integer; v_deleted_packs integer; v_spend_force_rls boolean; v_packs_force_rls boolean; begin select relforcerowsecurity into v_spend_force_rls from pg_class where oid = 'public.interview_prep_spend'::regclass; if v_spend_force_rls then raise exception 'interview_prep_spend has relforcerowsecurity set -- aborting rather than silently deleting 0 row(s): with no authenticated session in a migration, auth.uid() is null and no ownership policy can match, so any cross-tenant row here would be left behind, permanently unclaimable once claim_prep_pack_slot below is installed; clear relforcerowsecurity on this table and re-run this migration'; end if; select relforcerowsecurity into v_packs_force_rls from pg_class where oid = 'public.interview_prep_packs'::regclass; if v_packs_force_rls then raise exception 'interview_prep_packs has relforcerowsecurity set -- aborting rather than silently deleting 0 row(s): with no authenticated session in a migration, auth.uid() is null and no ownership policy can match, so any cross-tenant row here would be left behind, permanently unclaimable once claim_prep_pack_slot below is installed; clear relforcerowsecurity on this table and re-run this migration'; end if; delete from public.interview_prep_spend spend using public.applications app where spend.application_id = app.id and spend.user_id <> app.user_id; get diagnostics v_deleted_spend = row_count; raise notice 'interview_prep_spend cross-tenant cleanup: % row(s) deleted', v_deleted_spend; delete from public.interview_prep_packs packs using public.applications app where packs.application_id = app.id and packs.user_id <> app.user_id; get diagnostics v_deleted_packs = row_count; raise notice 'interview_prep_packs cross-tenant cleanup: % row(s) deleted', v_deleted_packs; end; $$;",
  }),
  Object.freeze({
    ...LOCKDOWN_BASE,
    group: "anon-execute-revoke",
    statement: "revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from anon;",
  }),
  Object.freeze({
    ...LOCKDOWN_BASE,
    group: "anon-execute-revoke",
    statement: "revoke execute on function public.record_prep_model_call(uuid) from anon;",
  }),
  Object.freeze({
    ...LOCKDOWN_BASE,
    group: "anon-table-revoke",
    statement: "revoke all on table public.interview_prep_spend from anon;",
  }),
]);

/** Applied-bytes fixtures keyed by migration filename, `path` relative to
 *  hello-world/. `sha256LF` is the sha256 (hex) of the fixture file read as
 *  UTF-8 with CRLF normalized to LF and nothing else -- a BOM is NOT
 *  stripped, so a corrupted fixture with a BOM prepended fails the pin. */
export const APPLIED_FIXTURES = Object.freeze({
  [LOCKDOWN_MIGRATION]: Object.freeze({
    path: "lib/sourceScan/__fixtures__/lockdown-applied-3d9bb27.sql",
    commit: "3d9bb27",
    sha256LF: "3489faa24d916759c27e1f32424740114af0dede2a555d3516a2e0b6019338fe",
  }),
});

const DOLLAR_QUOTE_OPEN_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Splits comment-stripped SQL into top-level statements at `;`, tracking
 * `'...'` (`''` escape), `"..."` (`""` escape) and `$tag$...$tag$` bodies
 * (tag empty or `[A-Za-z_][A-Za-z0-9_]*`, closing only on the identical
 * tag) as opaque -- a `;` inside any of them never splits. A `do $$ ...
 * end $$;` block is therefore one statement no matter how many `;` its body
 * contains. `$1`-style positional parameters are not dollar-quote
 * delimiters (no closing `$` immediately follows).
 *
 * Each returned entry's `start` is the first non-whitespace character of
 * the statement and `end` is just past its terminating `;`, so
 * `strippedSql.slice(start, end) === text` always holds. A lone `;` is a
 * one-character statement. A trailing remainder with no terminating `;` is
 * returned with its trailing whitespace excluded (and dropped entirely if
 * it is whitespace-only).
 *
 * Throws "migrationDivergence: unterminated ..." on a quote or
 * dollar-quote that never closes, rather than guessing where it ends.
 * Known blind spot (shared with stripSqlComments.js): `E'...'` backslash
 * escapes are not recognized.
 *
 * @param {string} strippedSql
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function splitTopLevelStatements(strippedSql) {
  const out = [];
  const n = strippedSql.length;
  let i = 0;
  let start = -1;
  while (i < n) {
    const c = strippedSql[i];
    if (start === -1) {
      if (/\s/.test(c)) {
        i += 1;
        continue;
      }
      start = i;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error(`migrationDivergence: unterminated quote at offset ${i}`);
        if (strippedSql[j] === c) {
          if (strippedSql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = DOLLAR_QUOTE_OPEN_RE.exec(strippedSql.slice(i));
      if (m) {
        const tag = m[0];
        const close = strippedSql.indexOf(tag, i + tag.length);
        if (close === -1) throw new Error(`migrationDivergence: unterminated dollar quote at offset ${i}`);
        i = close + tag.length;
        continue;
      }
    }
    if (c === ";") {
      out.push({ text: strippedSql.slice(start, i + 1), start, end: i + 1 });
      start = -1;
      i += 1;
      continue;
    }
    i += 1;
  }
  if (start !== -1) {
    const rest = strippedSql.slice(start).trimEnd();
    if (rest) out.push({ text: rest, start, end: start + rest.length });
  }
  return out;
}

/** Collapses every whitespace run (including `\r`, `\n` and the byte-order
 *  mark, which JavaScript's `\s` matches) to one space, trims and
 *  lower-cases. Idempotent.
 *  @param {string} text  @returns {string} */
export function normalizeStatement(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** CRLF -> LF, then comments blanked. Shared by every function below that
 *  reads raw file text, so offsets computed on the result stay consistent
 *  with the text splitTopLevelStatements/appliedMigrationTexts operate on. */
function prepare(raw) {
  return stripSqlComments(raw.replace(/\r\n/g, "\n"));
}

/**
 * The multiset difference between two SQL texts' normalized top-level
 * statements, in both directions. Each input is CRLF-normalized,
 * comment-stripped, split and normalized before comparison; duplicates
 * count (two identical statements in `committedRaw` and one in
 * `appliedRaw` leaves one in `neverApplied`).
 * @param {string} committedRaw  @param {string} appliedRaw
 * @returns {{ neverApplied: string[], appliedNotCommitted: string[] }}
 */
export function statementDivergence(committedRaw, appliedRaw) {
  const committed = splitTopLevelStatements(prepare(committedRaw)).map((s) => normalizeStatement(s.text));
  const applied = splitTopLevelStatements(prepare(appliedRaw)).map((s) => normalizeStatement(s.text));
  const remaining = [...applied];
  const neverApplied = [];
  for (const statement of committed) {
    const at = remaining.indexOf(statement);
    if (at === -1) neverApplied.push(statement);
    else remaining.splice(at, 1);
  }
  return { neverApplied: neverApplied.sort(), appliedNotCommitted: remaining.sort() };
}

function validateLedger(ledger) {
  const seen = new Set();
  for (const entry of ledger) {
    const key = `${entry.file}\0${entry.statement}`;
    if (seen.has(key)) throw new Error(`migrationDivergence: duplicate ledger entry for ${entry.file}`);
    seen.add(key);
    if (normalizeStatement(entry.statement) !== entry.statement) {
      throw new Error(`migrationDivergence: ledger statement for ${entry.file} is not normalized`);
    }
    if (/live-confirmed/i.test(entry.source)) {
      throw new Error(`migrationDivergence: a ledger source may not claim live-confirmed (${entry.file})`);
    }
  }
}

/**
 * The APPLIED view of a migration corpus: every statement the ledger says
 * never ran is blanked (overwritten with spaces, newlines kept) out of its
 * file's comment-stripped text; every file the ledger does not name is
 * returned unchanged (the identical, `===`, input string). Neither
 * `filenames` nor `texts` is mutated.
 *
 * Throws (message always starts "migrationDivergence:") on: a
 * `filenames`/`texts` length mismatch; a duplicate ledger entry; a ledger
 * `statement` that is not a fixed point of normalizeStatement; a `source`
 * containing "live-confirmed"; a ledgered file absent from `filenames` or
 * present more than once ("... not in the migrations list -- the ledger is
 * stale"); a ledgered statement absent from its file's statements ("...
 * not found in <file> -- the ledger is stale", the staleness signal a
 * committed-file edit is meant to trip); or present more than once in it
 * ("... more than once in <file>", an ambiguous span).
 *
 * @param {string[]} filenames  @param {string[]} texts
 * @param {NeverAppliedEntry[]} [ledger]
 * @returns {string[]}
 */
export function appliedMigrationTexts(filenames, texts, ledger = NEVER_APPLIED_STATEMENTS) {
  if (filenames.length !== texts.length) throw new Error("migrationDivergence: filenames/texts length mismatch");
  validateLedger(ledger);
  const out = [...texts];
  const ledgerFiles = [...new Set(ledger.map((entry) => entry.file))];
  for (const file of ledgerFiles) {
    const matches = [];
    filenames.forEach((f, i) => {
      if (f === file) matches.push(i);
    });
    if (matches.length !== 1) {
      throw new Error(`migrationDivergence: ${file} not in the migrations list -- the ledger is stale`);
    }
    const idx = matches[0];
    const stripped = prepare(texts[idx]);
    const statements = splitTopLevelStatements(stripped);
    const chars = stripped.split("");
    for (const entry of ledger.filter((e) => e.file === file)) {
      const hits = statements.filter((s) => normalizeStatement(s.text) === entry.statement);
      if (hits.length === 0) {
        throw new Error(`migrationDivergence: "${entry.statement.slice(0, 60)}" not found in ${file} -- the ledger is stale`);
      }
      if (hits.length > 1) {
        throw new Error(`migrationDivergence: "${entry.statement.slice(0, 60)}" more than once in ${file}`);
      }
      for (let k = hits[0].start; k < hits[0].end; k += 1) {
        if (chars[k] !== "\n") chars[k] = " ";
      }
    }
    out[idx] = chars.join("");
  }
  return out;
}

/**
 * The texts of every migration whose FILENAME sorts strictly before
 * `filename` (plain JS string `<`, which orders this repo's 14-digit
 * stamps correctly), in input order -- deliberately by name and never by
 * `indexOf`/`slice`: with `filename` absent from `filenames` (not landed
 * yet), `indexOf` returns -1 and `slice(0, -1)` silently drops the LAST
 * real migration. Works whether or not `filename` itself is present.
 * @param {string[]} filenames  @param {string[]} texts  @param {string} filename
 * @returns {string[]}
 */
export function textsBefore(filenames, texts, filename) {
  if (filenames.length !== texts.length) throw new Error("migrationDivergence: filenames/texts length mismatch");
  return texts.filter((_, i) => filenames[i] < filename);
}
