/**
 * Pure parsing logic behind lib/interviewPrep/interviewPrepEffectiveSchema.test.js's
 * grant/revoke and security-mode replay. Extracted out of that test file
 * (which owns every assertion built on top of these functions) purely to
 * keep that file under this repo's standing 1000-line cap once the N12
 * wave-2 adversarial-check fixes -- BLOCKER-1, BLOCKER-2, MAJOR-3, MAJOR-4,
 * MAJOR-5, minors 7-9 -- landed their own mutant-kill coverage; nothing here
 * changes behaviour that test file didn't already own. No test-framework
 * import belongs in this file -- every `describe`/`it`/`expect` stays in the
 * test file, which is this module's only caller.
 *
 * N22 wave-3 adversarial-check fixes on top of that: BLOCKER-A
 * (blankStringLiterals is now dollar-quote aware, not just `'...'`-aware --
 * see that function's own header), BLOCKER-B (a format() call that names a
 * TRACKED table literally, with only the role/privilege templated, now
 * THROWS instead of silently vanishing -- see
 * assertNoTemplatedGrantOnTrackedTable's own header for exactly what this
 * does and does not catch), MAJOR-C (lastFunctionDefinition and
 * replayFunctionExecute now both scan a blanked -- not raw -- text for
 * their own anchors, so a prose string literal can no longer fabricate or
 * swallow a real function definition or grant/revoke), and MAJOR-G
 * (extractDestructiveKeywords, a whitelist the cleanup block's own
 * destructive statements must match exactly, rather than the two named
 * DELETEs being examined in isolation while a third statement anywhere else
 * in the block goes unseen).
 *
 * N22 wave-4 adversarial-check fixes on top of that: F1 (blankStringLiterals
 * now SPLICES a genuine, non-format() `execute` literal's own content back
 * in AT ITS ORIGINAL POSITION -- recursing into a dollar-quoted CODE BODY
 * (a `do $$...$$` block or a function's `as $$...$$`) to find it, but never
 * into a plain string-argument dollar-quote such as a `raise notice`
 * message -- instead of lifting it out and appending it to the end of the
 * file, which silently reordered every dynamic statement to run after every
 * static one in the same file; liftDynamicSql and prepareForGrantReplay's
 * append are gone, this is also what closes F4 (a notice message's own
 * prose can no longer mint a phantom grant, since nothing is unblanked
 * unless a real `execute` precedes it)), F2 (assertNoTemplatedGrantOnTrackedFunction,
 * BLOCKER-B's own twin for replayFunctionExecute -- that replay had no
 * equivalent guard at all), F3 (extractFormatTemplates no longer requires
 * the literal text "execute format(" -- a format() call assigned to a
 * variable and executed separately is now seen too), F5
 * (extractDestructiveKeywords now counts over blanked, not raw, text, so a
 * destructive-shaped word inside the cleanup block's own notice message
 * cannot inflate the count), and F6 (lastFunctionDefinition's `$$` delimiter
 * search now also runs over blanked text, so a preamble literal spelling
 * out `$$` cannot be mistaken for the real opening delimiter).
 *
 * All of it is a source-text parse, not a live-database query -- see that
 * test file's own header for why (no live Supabase project is reachable
 * from this checkout).
 */
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

/** Splits a privilege list on TOP-LEVEL commas only, so a column list inside
 *  `update (attempts, updated_at)` is not itself split. */
export function splitPrivilegeList(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Every table privilege Postgres recognises (the GRANT/REVOKE reference's
 *  own list for a table) -- used only to expand a bare ALL into its
 *  components when a later statement narrows it by name (see
 *  expandPrivilege's ALL handling and replayTableGrants' cascade below). */
export const ALL_TABLE_PRIVILEGES = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];

/** Expands one privilege clause ("select", "update (attempts, updated_at)")
 *  into atomic tokens ("select", "update(attempts)", "update(updated_at)") --
 *  a column-scoped grant/revoke is tracked per column, since that is exactly
 *  the granularity 20260915000000_interview_prep_spend_lockdown.sql's own
 *  column-scoped revoke needs to be told apart from a bare one.
 *
 *  `all privileges` -- Postgres's own GRANT/REVOKE synopsis spelling -- is
 *  normalised here to the bare token "all", so every caller only ever has
 *  one spelling of the ALL shorthand to reason about (BLOCKER-1, minor-9). */
export function expandPrivilege(clause) {
  const m = /^(\w+)\s*\(([^)]*)\)$/.exec(clause);
  if (!m) {
    const bare = clause.trim().toLowerCase();
    return [/^all\s+privileges$/.test(bare) ? "all" : bare];
  }
  const verb = m[1].toLowerCase();
  return m[2]
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .map((col) => `${verb}(${col})`);
}

/** Strips a wrapping pair of double quotes off an identifier and
 *  lower-cases it -- Postgres accepts `"authenticated"` anywhere a bare
 *  `authenticated` is legal, and folds an unquoted identifier to lowercase
 *  itself, so both spellings must resolve to the same key. */
export function stripQuotes(s) {
  const t = s.trim();
  const m = /^"(.*)"$/.exec(t);
  return (m ? m[1] : t).toLowerCase();
}

/** Splits a comma-separated identifier list (a role list, a table list, or a
 *  function argument-type list) into normalised, quote-stripped, lower-cased
 *  names. None of those lists nest parentheses the way a privilege clause's
 *  column scoping does, so a plain top-level split is safe here. */
export function splitIdentifierList(raw) {
  return raw
    .split(",")
    .map((s) => stripQuotes(s))
    .filter(Boolean);
}

/** A bare table name with no schema resolves, on this project, against the
 *  caller's search_path -- which always includes `public` -- so an
 *  unqualified `interview_prep_spend` and an explicit
 *  `public.interview_prep_spend` name the SAME table. Defaulting the schema
 *  here is what stops that spelling from silently keying a different map
 *  entry than the one every assertion in this file checks. */
export function normalizeTableName(raw) {
  const name = stripQuotes(raw);
  return name.includes(".") ? name : `public.${name}`;
}

/** Strips a trailing `with grant option` / `cascade` / `restrict` clause,
 *  and a trailing dollar-quote closing tag (`$$`, `$q$`, `$p$`, ...), off
 *  the raw text between `to`/`from` and the statement's terminating `;`.
 *  The first two are keywords, not another role, and a plain comma-split
 *  would otherwise swallow one into the last role's own name. The dollar
 *  tag case is BLOCKER-1: a grant/revoke embedded in a plain (non-format())
 *  `execute $tag$ ... $tag$` dynamic-SQL string -- this repo's own idiom,
 *  e.g. 20260630000000_tailor_library.sql:108 -- is visible to the replay
 *  regexes without any unwrapping (dollar-quoting is not a literal
 *  stripSqlComments.js recognises, so its contents are never hidden), but
 *  the closing tag sits directly against the statement's own `;` with no
 *  delimiter of its own, and would otherwise be captured as part of the
 *  last role's name (e.g. "public$q$" instead of "public"). */
export function stripTrailingGrantModifiers(raw) {
  return raw
    .replace(/\s+with\s+grant\s+option\s*$/i, "")
    .replace(/\s+(cascade|restrict)\s*$/i, "")
    .replace(/\$\w*\$\s*$/, "")
    .trim();
}

/** F1: true when the text immediately preceding a literal span (within the
 *  SAME text this literal appears in -- a recursive call's own interior
 *  slice, or the top-level file text) is a real, non-`format()` `execute`
 *  keyword -- the one shape of dynamic SQL Postgres genuinely runs, as
 *  opposed to a `format()` template argument (MAJOR-3/MAJOR-4's own
 *  hazard) or plain prose (F4). The second test is technically implied by
 *  the first (a string ending "execute format(" can never also end
 *  "execute\s+", since the former ends in "(" and the latter demands
 *  trailing whitespace), but is spelled out anyway so this function's
 *  contract does not depend on that being true forever. */
function isDynamicExecuteTarget(precedingText) {
  return /\bexecute\s+$/i.test(precedingText) && !/\bexecute\s+format\s*\($/i.test(precedingText);
}

/** F1: true when a dollar-quoted span's own preceding text marks it as a
 *  CODE BODY -- the interior of a `do $$...$$` block or a function's own
 *  `language ... as $$...$$` -- the only two shapes Postgres itself parses
 *  as PL/pgSQL rather than treating as an opaque string value. Every OTHER
 *  dollar-quoted span (a `format()` template argument, a `raise
 *  notice`/`raise exception` message, ...) is just string data to Postgres,
 *  and a textually execute-shaped sentence inside one of those is prose,
 *  never a real statement (F4) -- so only a code body's own interior is
 *  worth recursing into looking for a nested real `execute`. */
function isCodeBodyDollarQuote(precedingText) {
  return /\b(?:do(?:\s+language\s+\w+)?|as)\s*$/i.test(precedingText);
}

/** Blanks the CONTENTS of every single-quoted `'...'` string literal AND
 *  every dollar-quoted `$tag$...$tag$` literal (any tag, including the bare
 *  `$$` spelling), kept intact byte-for-byte by stripSqlComments.js on
 *  purpose (see that file's own header -- it explicitly does NOT recognise
 *  dollar-quoting), while preserving the surrounding quotes/tags and the
 *  text's overall length. MAJOR-3: without this, a GRANT-shaped sentence
 *  sitting inside ordinary prose -- a `format()` call's own template
 *  argument, or a plain string literal quoting one as an example -- reads
 *  to the regexes below exactly like a real, executed statement; verified
 *  against a real occurrence, 20260630000000_tailor_library.sql:119's own
 *  `format('grant select, insert, update, delete on table public.%I to
 *  authenticated;', t)`, which mined a phantom `public.%i|authenticated`
 *  entry before this existed.
 *
 *  BLOCKER-A: the dollar-quote half of this was missing entirely --
 *  `format($p$grant ... on table public.%I to authenticated;$p$, 'x')`
 *  (this repo's OWN spelling, 20260630000000_tailor_library.sql:108,111,
 *  114,117) was neither blanked (this function only recognised `'...'`) nor
 *  lifted (liftDynamicSql deliberately excludes any `execute format(...)`
 *  spelling -- see that function's own header), so it mined the exact same
 *  phantom-grant hazard MAJOR-3 already closed for the single-quoted
 *  spelling. Fixed by treating a `$tag$...$tag$` span exactly like a
 *  single-quoted one: blank the interior, keep the delimiters. Every
 *  interior character -- including a newline -- becomes a single space,
 *  matching this function's own existing single-quote behaviour above
 *  exactly (line numbers inside a literal were never meaningful to the
 *  regexes that consume this output either way).
 *
 *  A dollar-quoted span is found by taking the tag at the CURRENT position
 *  literally (`$$`, `$p$`, `$q$`, ...) and searching forward for the next
 *  occurrence of that exact same tag -- never a shorter or longer one --
 *  which is exactly how Postgres itself resolves dollar-quote nesting: a
 *  `$$...$$` body may contain a nested `$p$...$p$` (or vice versa) because
 *  the tags differ, but a body can never contain its OWN tag unescaped
 *  (that closes it), so this scan can never desync against valid SQL.
 *
 *  F1: a span immediately preceded by a real, non-`format()` `execute`
 *  (isDynamicExecuteTarget) is no longer blanked at all -- its own content
 *  is spliced back in, IN PLACE, right-padded with spaces out to the span's
 *  original length so every index computed off this function's output
 *  (lastFunctionDefinition's own `$$`-delimiter search, MAJOR-C/F6) stays
 *  aligned with the unblanked source. This replaces the old lift-and-append
 *  scheme (liftDynamicSql, removed): appending a dynamic statement to the
 *  END of the file, rather than leaving it where it was written, silently
 *  replayed it after every static statement in the same file regardless of
 *  real order. A CODE BODY that is NOT itself an execute target (a `do
 *  $$...$$` block, or a function's own `as $$...$$`, per
 *  isCodeBodyDollarQuote) is recursed into instead, so a genuine `execute`
 *  nested one level inside it is still found; any OTHER dollar-quoted span
 *  (a `format()` template argument, a `raise notice` message, ...) is
 *  blanked in full, uniformly, exactly as before -- deliberately NOT
 *  recursed into, so a textually execute-shaped SENTENCE inside a notice
 *  message (F4) is prose, not a statement, however many levels deep it
 *  sits. */
export function blankStringLiterals(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "'") {
      const start = i;
      const splice = isDynamicExecuteTarget(sql.slice(0, start));
      let raw = "";
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          raw += "''";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        raw += sql[i];
        i += 1;
      }
      const spanLen = i - start;
      if (splice) {
        out += raw.replace(/''/g, "'").padEnd(spanLen, " ");
        continue;
      }
      out += "'";
      for (let k = 0; k < raw.length; ) {
        if (raw[k] === "'" && raw[k + 1] === "'") {
          out += "''";
          k += 2;
          continue;
        }
        out += " ";
        k += 1;
      }
      out += "'";
      continue;
    }
    if (sql[i] === "$") {
      const tagMatch = /^\$\w*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          const start = i;
          const innerRaw = sql.slice(i + tag.length, closeIdx);
          const spanLen = closeIdx + tag.length - start;
          const precedingText = sql.slice(0, start);
          if (isDynamicExecuteTarget(precedingText)) {
            out += innerRaw.padEnd(spanLen, " ");
          } else if (isCodeBodyDollarQuote(precedingText)) {
            out += tag + blankStringLiterals(innerRaw) + tag;
          } else {
            out += tag + " ".repeat(innerRaw.length) + tag;
          }
          i = closeIdx + tag.length;
          continue;
        }
      }
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Prepares one migration file's text for the table-grant replay: blanks
 *  every string literal's contents (MAJOR-3) so a prose/format() literal can
 *  never be mistaken for a real statement. F1: a genuinely dynamic,
 *  non-`format()` GRANT/REVOKE now comes back from blankStringLiterals
 *  itself, spliced in at its own original position -- there is no longer a
 *  separate lift-and-append step here (or anything to append). */
export function prepareForGrantReplay(rawText) {
  const stripped = stripSqlComments(rawText);
  return blankStringLiterals(stripped);
}

/** BLOCKER-B: the two tables this suite's grant replay actually asserts
 *  privileges on. Deliberately narrow -- see
 *  assertNoTemplatedGrantOnTrackedTable's own header for exactly what
 *  widening this list would and would not additionally catch. */
export const TRACKED_GRANT_TABLES = ["interview_prep_spend", "interview_prep_packs"];

/** Extracts the literal FIRST-argument SQL template out of every
 *  `format(...)` call in the given (comment-stripped, UNBLANKED) text --
 *  single-quoted or dollar-quoted -- ignoring the comma-separated `%I`/`%L`
 *  substitution arguments that follow it. Used only by
 *  assertNoTemplatedGrantOnTrackedTable/-Function below; kept separate so
 *  those functions' own logic reads as "for each template, ask one
 *  question" rather than a single tangled regex doing both jobs.
 *
 *  F3: no longer anchored on the literal text "execute format(" -- only on
 *  `format(` itself. A `format()` call whose RESULT is assigned to a
 *  variable and executed separately (`v_sql := format(...); execute
 *  v_sql;`) names its target table just as literally as `execute
 *  format(...)` does, and the guard below is a blind spot either way, so
 *  the widened match is unconditionally safer, not merely more convenient.
 *  Verified against the real corpus (interviewPrepEffectiveSchema.test.js's
 *  own "[control] the real migration corpus never trips this guard"): every
 *  `format(` call in this repo already reads "execute format(" anyway, so
 *  this widening changes nothing for any migration on disk today. */
export function extractFormatTemplates(strippedText) {
  const templates = [];
  const re = /\bformat\s*\(\s*(?:'((?:[^']|'')*)'|(\$\w*\$)([\s\S]*?)\2)/gi;
  let m;
  while ((m = re.exec(strippedText))) {
    templates.push(m[1] !== undefined ? m[1].replace(/''/g, "'") : m[3]);
  }
  return templates;
}

/** BLOCKER-B (the cheap option, NOT full template resolution): throws when
 *  an `execute format(...)` call's own literal template names, LITERALLY --
 *  not merely via a `%I`/`%L` placeholder -- a table this suite tracks
 *  (TRACKED_GRANT_TABLES) alongside a `grant`/`revoke` keyword.
 *
 *  WHY THIS IS NEEDED ON TOP OF blankStringLiterals: blanking correctly
 *  stops a format() template from FABRICATING a phantom grant on a
 *  placeholder table (MAJOR-3, `public.%I`) -- but when the TABLE itself is
 *  spelled out and only the ROLE or PRIVILEGE is templated, e.g.
 *  `execute format('grant update on table public.interview_prep_spend to
 *  %I;', 'authenticated')`, blanking makes a REAL grant/revoke on a REAL,
 *  named, tracked table silently INVISIBLE instead -- replayTableGrants
 *  reports no entry for it at all, and every assertion built on that state
 *  keeps reading a stale privilege set forever with no signal anything was
 *  skipped.
 *
 *  WHAT THIS CATCHES: a format() call whose FIRST-argument template
 *  literally contains a tracked table's name (`interview_prep_spend` /
 *  `interview_prep_packs`, schema-qualified or not) together with a
 *  `grant`/`revoke` keyword, anywhere in the given text.
 *
 *  WHAT THIS DOES NOT CATCH (the cost of the cheap option over fully
 *  resolving the template): it does not replay the templated statement's
 *  actual effect -- it only refuses to proceed silently, so a human
 *  resolves it by hand (confirm the real effective privilege and either
 *  extend this replay to handle it, or restate the grant without format()
 *  so it is visible to the replay directly). It also cannot catch the
 *  table name arriving through a SECOND level of indirection -- built from
 *  a concatenated literal, a CTE, or a variable never spelled out in the
 *  template text itself -- nor a table name split across more than one
 *  format() argument. And a template where the TABLE is ALSO templated via
 *  `%I` (this repo's own real shape, 20260630000000_tailor_library.sql)
 *  intentionally does not throw: that shape is the one MAJOR-3's blanking
 *  already handles correctly by omission, not the one this guard exists
 *  for. */
export function assertNoTemplatedGrantOnTrackedTable(strippedText) {
  for (const template of extractFormatTemplates(strippedText)) {
    const lower = template.toLowerCase();
    if (!/\b(grant|revoke)\b/.test(lower)) continue;
    for (const table of TRACKED_GRANT_TABLES) {
      if (new RegExp(`\\b(?:public\\.)?${table}\\b`).test(lower)) {
        throw new Error(
          `migrationGrantReplay: an "execute format(...)" call names public.${table} ` +
            `literally inside a grant/revoke template while another argument is templated ` +
            `(BLOCKER-B) -- template: ${template.trim()} -- this replay cannot safely resolve ` +
            "a templated grant/revoke, and blanking it (MAJOR-3) would otherwise make it " +
            "silently invisible to every assertion in interviewPrepEffectiveSchema.test.js. " +
            "Resolve by hand: confirm the real effective privilege this statement produces, " +
            "then either extend this replay to handle it or restate the grant without format().",
        );
      }
    }
  }
}

/** F2: the two functions replayFunctionExecute actually asserts execute
 *  privileges on -- the function-signature twin of TRACKED_GRANT_TABLES
 *  above. */
export const TRACKED_GRANT_FUNCTIONS = ["claim_prep_pack_slot", "record_prep_model_call"];

/** F2: assertNoTemplatedGrantOnTrackedTable's own guard, but for a function
 *  execute grant instead of a table grant -- BLOCKER-B closed this hazard
 *  for replayTableGrants only, leaving replayFunctionExecute with no
 *  equivalent guard at all: a `format()` call whose template names a
 *  TRACKED FUNCTION literally (with only the role templated) went silently
 *  invisible to the execute-grant replay exactly the way an unguarded table
 *  grant used to, including on the one assertion that matters most --
 *  "an unauthenticated caller cannot reach this SECURITY DEFINER function".
 *  Same cheap-option limits as that function's own header describes. */
export function assertNoTemplatedGrantOnTrackedFunction(strippedText) {
  for (const template of extractFormatTemplates(strippedText)) {
    const lower = template.toLowerCase();
    if (!/\b(grant|revoke)\b/.test(lower)) continue;
    for (const fn of TRACKED_GRANT_FUNCTIONS) {
      if (new RegExp(`\\b(?:public\\.)?${fn}\\s*\\(`).test(lower)) {
        throw new Error(
          `migrationGrantReplay: an "execute format(...)" call names public.${fn}( literally ` +
            `inside a grant/revoke template while another argument is templated (F2) -- template: ` +
            `${template.trim()} -- this replay cannot safely resolve a templated grant/revoke, and ` +
            "blanking it (MAJOR-3) would otherwise make it silently invisible to every assertion in " +
            "interviewPrepEffectiveSchema.test.js. Resolve by hand: confirm the real effective " +
            "privilege this statement produces, then either extend this replay to handle it or " +
            "restate the grant without format().",
        );
      }
    }
  }
}

/** Applies one privilege clause's expanded tokens to a (table, role) set,
 *  for one grant or revoke. Shared between a statement's own named
 *  table(s) and MAJOR-5's schema-wide fan-out, so both go through the exact
 *  same cascade rules (minor-9):
 *   - REVOKE ALL (bare, or the now-normalised "all privileges") removes
 *     EVERY privilege the role holds on the table, matching real Postgres
 *     -- not merely entries literally named "all" or "all(...)".
 *   - Revoking one specific privilege while a bare ALL is held narrows ALL
 *     down to its remaining components, rather than silently no-op'ing
 *     because the literal token was never added in the first place.
 *   - Otherwise: a bare-verb revoke also revokes that verb's column-scoped
 *     grants (Postgres's own REVOKE reference, verbatim, in the Notes
 *     section). */
function applyPrivilegeClauses(set, clauses, verb) {
  for (const clause of clauses) {
    for (const token of expandPrivilege(clause)) {
      if (verb === "grant") {
        set.add(token);
        continue;
      }
      if (token === "all") {
        set.clear();
        continue;
      }
      if (set.has("all")) {
        set.delete("all");
        for (const p of ALL_TABLE_PRIVILEGES) {
          if (p !== token) set.add(p);
        }
        continue;
      }
      set.delete(token);
      if (!token.includes("(")) {
        for (const existing of [...set]) {
          if (existing.startsWith(`${token}(`)) set.delete(existing);
        }
      }
    }
  }
}

/** Replays every `grant <privs> on [table] <table[, table...]> to
 *  <role[, role...]>;`, `revoke <privs> on [table] <table[, table...]> from
 *  <role[, role...]>;`, and `... on all tables in schema <s> ...;` statement
 *  across the given texts, IN ORDER, into a `Map<"table|role",
 *  Set<privilege>>`. This is the anti-rot mechanism a single-file
 *  `.toContain` cannot give: a later file's revoke actually removes what an
 *  earlier file granted.
 *
 *  The `table` keyword is OPTIONAL -- Postgres accepts `grant select on
 *  public.t to r;` with no `table` at all -- but the target is required NOT
 *  to start with `function`/`routine`, so a function grant/revoke (handled
 *  separately by replayFunctionExecute) is never mistaken for a table one
 *  now that the anchor which used to rule it out ("on table", literally) is
 *  gone. */
export function replayTableGrants(texts) {
  const state = new Map();
  // The privilege-list capture is bounded to `[^;]+?` (no semicolon), not
  // `[\s\S]+?` -- a statement never contains one, but WITHOUT the bound a
  // non-greedy `[\s\S]+?` will happily cross an intervening
  // `grant/revoke execute on function ...;` statement to find the next "on
  // [table]", swallowing several unrelated statements into one garbled
  // match. Verified against this file's own migrations: `revoke execute on
  // function public.claim_prep_pack_slot(...) from public;` sits directly
  // before `revoke update (attempts, updated_at) on table ... from
  // authenticated;` in 20260915000000_interview_prep_spend_lockdown.sql,
  // which reproduced exactly that failure mode before this bound was added.
  // The `(?!function\b|routine\b)` guard is the other half of that same
  // defence, now that "table" is no longer a mandatory anchor: without it,
  // making "table" optional would let this regex ALSO match a function
  // grant's own "on function ..." target as if it were a table.
  const re = /\b(grant|revoke)\s+([^;]+?)\s+on\s+(?:table\s+)?(?!function\b|routine\b)([^;]+?)\s+(to|from)\s+([^;]+?)\s*;/gi;
  for (const rawText of texts) {
    // BLOCKER-B: checked against the UNBLANKED, comment-stripped text --
    // blanking (below, inside prepareForGrantReplay) is what would
    // otherwise make exactly this hazard invisible.
    assertNoTemplatedGrantOnTrackedTable(stripSqlComments(rawText));
    const stripped = prepareForGrantReplay(rawText);
    const localRe = new RegExp(re.source, re.flags);
    let m;
    while ((m = localRe.exec(stripped))) {
      const verb = m[1].toLowerCase();
      const direction = m[4].toLowerCase();
      if ((verb === "grant" && direction !== "to") || (verb === "revoke" && direction !== "from")) continue;
      const roles = splitIdentifierList(stripTrailingGrantModifiers(m[5].trim()));
      const clauses = splitPrivilegeList(m[2].trim());
      const targetRaw = m[3].trim();
      // MAJOR-5: `grant/revoke ... on all tables in schema <s> ...` is
      // legal SQL that genuinely applies to every table already in that
      // schema -- fanned out here across every table this replay has
      // already seen there, rather than being keyed, silently and
      // wrongly, as a literal table named "all tables in schema <s>".
      const schemaWide = /^all\s+tables\s+in\s+schema\s+(\S+)\s*$/i.exec(targetRaw);
      let tables;
      if (schemaWide) {
        const schema = stripQuotes(schemaWide[1]);
        const seen = new Set();
        for (const key of state.keys()) {
          const table = key.slice(0, key.lastIndexOf("|"));
          if (table.startsWith(`${schema}.`)) seen.add(table);
        }
        tables = [...seen];
      } else {
        tables = splitIdentifierList(targetRaw).map(normalizeTableName);
      }
      for (const table of tables) {
        for (const role of roles) {
          const key = `${table}|${role}`;
          const set = state.get(key) || new Set();
          applyPrivilegeClauses(set, clauses, verb);
          state.set(key, set);
        }
      }
    }
  }
  return state;
}

/** Finds the LAST `create or replace function public.<name>(` occurrence
 *  across the given texts, in order (a later file's redefinition wins over
 *  an earlier one), and returns { preamble, body } -- preamble is everything
 *  from that occurrence up to the opening `$$`, body is everything between
 *  the `$$` delimiters. Returns null if the name is never defined.
 *
 *  MAJOR-C: the anchor itself is searched for in a BLANKED copy of the
 *  text (blankStringLiterals), not the raw stripped text -- a prose string
 *  literal containing the exact words "create or replace function
 *  public.<name>(" would otherwise read as a real (and, being textually
 *  LATER, WINNING) redefinition, silently shadowing the true one. Once a
 *  real anchor is found this way, the preamble/body slice is still taken
 *  from the ORIGINAL, unblanked `stripped` text at the SAME indices --
 *  blanking preserves length exactly, so the two stay aligned -- so the
 *  body handed back for e.g. the "claim_prep_pack_slot's effective body"
 *  assertions is the genuine, byte-for-byte source, never blanked-out
 *  spaces.
 *
 *  F6: the `$$` delimiter search below ALSO runs on the blanked text, not
 *  `found.stripped` -- blanking preserves a real `$$` tag byte-for-byte
 *  while erasing a literal's own contents, so a preamble containing a
 *  literal such as `set search_path = '$$'` (its interior now blanked to
 *  spaces) can no longer be mistaken for the function body's own opening
 *  delimiter. The indices found this way still index correctly into
 *  `found.stripped` -- same length-preservation guarantee as the anchor
 *  search above. */
export function lastFunctionDefinition(texts, name) {
  let found = null;
  const re = new RegExp(`create or replace function public\\.${name}\\s*\\(`, "gi");
  for (const text of texts) {
    const stripped = stripSqlComments(text);
    const blanked = blankStringLiterals(stripped);
    const localRe = new RegExp(re.source, re.flags);
    let m;
    let lastIdx = null;
    while ((m = localRe.exec(blanked))) lastIdx = m.index;
    if (lastIdx !== null) found = { stripped, blanked, idx: lastIdx };
  }
  if (!found) return null;
  const open = found.blanked.indexOf("$$", found.idx);
  if (open === -1) return null;
  const close = found.blanked.indexOf("$$", open + 2);
  if (close === -1) return null;
  return {
    preamble: found.stripped.slice(found.idx, open),
    body: found.stripped.slice(open + 2, close),
  };
}

/** N29/N41 -- the CHECK-constraint analogue of lastFunctionDefinition above:
 *  finds the LAST add/drop action against a named constraint across the
 *  given texts, in order, and returns `{ clause }` (the constraint's
 *  CURRENT, effective `check (...)` text) or `null` if the constraint does
 *  not exist in the replayed end state (either never declared, or dropped
 *  last with no later add -- N41(a)'s own "drop" option for
 *  `interview_prep_spend_attempts_check`).
 *
 *  Handles BOTH shapes a `constraint <name>` clause can appear in, because
 *  they share an identical grammar immediately after the name --
 *  `check (...)` -- and nothing else needs to tell them apart:
 *    - the INLINE `create table` form (`constraint <name>\n check (...)`),
 *      which is how every CHECK in the ORIGINAL migration
 *      (20260914000000_interview_prep.sql) is declared;
 *    - the `alter table ... add constraint <name> check (...)` form, this
 *      repo's own idiom for widening or replacing a CHECK without editing an
 *      already-applied migration in place
 *      (20260610020000_applications_status_auto_queued.sql's own
 *      precedent).
 *  A bare `drop constraint if exists <name>` (no following `check(`) is
 *  recognised separately as a REMOVAL -- there is no `create or replace`
 *  for a CHECK constraint, so "drop, then add" is this repo's own idiom for
 *  "replace," and the same "last one wins" property lastFunctionDefinition
 *  already established for a function applies here once every add/drop
 *  action across every text is placed in one time-ordered sequence.
 *
 *  The clause itself is found with a balanced-parenthesis scan starting at
 *  the `check`'s own opening `(` -- not a non-greedy regex -- because a real
 *  clause routinely nests parentheses of its own (`... in ('B1', 'B3')`),
 *  which a `\([^)]*\)`-shaped regex would truncate at the first inner `)`.
 *
 *  Deliberately NOT comment-aware on its own: unlike lastFunctionDefinition
 *  (which recurses through blankStringLiterals to protect against a prose
 *  match), a constraint's own name is a plain identifier, never plausible
 *  prose on its own, and every caller of this function already reads from
 *  the same `orderedTexts` this file's sibling test file
 *  (interviewPrepSpendCapRemoval.effectiveSchema.test.js) built from real,
 *  on-disk migration files -- a corpus that does not contain a migration
 *  quoting a fake CHECK inside a comment or string literal. A future caller
 *  reading untrusted or prose-heavy text should not assume this guard for
 *  free.
 *
 *  @param {string[]} texts
 *  @param {string} constraintName
 *  @returns {{ clause: string } | null}
 */
export function lastConstraintClause(texts, constraintName) {
  const escapedName = constraintName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const addAnchorRe = new RegExp(`\\bconstraint\\s+${escapedName}\\b`, "gi");
  const dropRe = new RegExp(`\\bdrop\\s+constraint\\s+(?:if\\s+exists\\s+)?${escapedName}\\b`, "gi");

  let state = null;
  for (const rawText of texts) {
    const stripped = stripSqlComments(rawText);
    const events = [];

    let m;
    const localAddRe = new RegExp(addAnchorRe.source, addAnchorRe.flags);
    while ((m = localAddRe.exec(stripped))) {
      const afterName = stripped.slice(m.index + m[0].length);
      const checkMatch = /^\s*check\s*\(/i.exec(afterName);
      if (!checkMatch) continue; // a bare "drop constraint <name>" also
      // matches this anchor -- it has no following "check(" and is left to
      // the drop scan below instead.
      const openIdx = m.index + m[0].length + checkMatch[0].length - 1;
      let depth = 0;
      let clause = null;
      for (let i = openIdx; i < stripped.length; i += 1) {
        if (stripped[i] === "(") depth += 1;
        else if (stripped[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            clause = stripped.slice(openIdx, i + 1);
            break;
          }
        }
      }
      if (clause !== null) events.push({ index: m.index, type: "add", clause });
    }

    const localDropRe = new RegExp(dropRe.source, dropRe.flags);
    while ((m = localDropRe.exec(stripped))) events.push({ index: m.index, type: "drop" });

    events.sort((a, b) => a.index - b.index);
    for (const event of events) state = event.type === "drop" ? null : { clause: event.clause };
  }
  return state;
}

/** Normalises a function signature ("public.foo(uuid, uuid)",
 *  "foo(p_id uuid)", "foo(uuid,uuid)") into a canonical
 *  "schema.name(type,type)" key: schema defaulted to public (same rule as
 *  normalizeTableName), each argument reduced to its TYPE only (a
 *  function's identity is its argument types, never a parameter's declared
 *  NAME -- `foo(p_id uuid)` and `foo(uuid)` are the same signature), and all
 *  whitespace collapsed so a no-space spelling and a spaced one agree. */
export function normalizeFunctionSignature(qualifiedName, argsRaw) {
  const name = normalizeTableName(qualifiedName.trim());
  const args = splitIdentifierList(argsRaw)
    .map((a) => {
      const tokens = a.split(/\s+/).filter(Boolean);
      return tokens[tokens.length - 1];
    })
    .join(",");
  return `${name}(${args})`;
}

/** Parses a "schema.name(args)" signature string into the same canonical key
 *  normalizeFunctionSignature produces, so a caller-supplied signature and
 *  one scraped from a grant/revoke statement can be compared for equality
 *  regardless of spacing, schema-qualification or named arguments. */
export function parseFunctionSignature(sig) {
  const m = /^([\w.]+)\s*\(([^)]*)\)$/.exec(sig.trim());
  if (!m) return null;
  return normalizeFunctionSignature(m[1], m[2]);
}

/** Replays `grant execute|all[ privileges] on function|routine <signature>
 *  to <role[, role...]>;` / `revoke execute|all[ privileges] on
 *  function|routine <signature> from <role[, role...]>;` across the given
 *  texts, in order. Seeds `public -> true` the first time the function is
 *  CREATED (Postgres's own default), then applies every subsequent
 *  explicit grant/revoke on top. Returns null if the function is never
 *  created.
 *
 *  The signature in the source text is matched by NORMALISED EQUALITY
 *  (parseFunctionSignature), not by literal substring -- `all` (and,
 *  BLOCKER-1, `all privileges`, Postgres's own GRANT/REVOKE synopsis
 *  spelling) is accepted alongside `execute`, `on routine` alongside `on
 *  function` (Postgres accepts either keyword since v11), the role list is
 *  split rather than assumed to be one word, and a trailing dollar-quote
 *  closing tag never bleeds into the last role's name
 *  (stripTrailingGrantModifiers, above). A malformed `to`/`from` pairing
 *  (minor-8) is rejected rather than half-applied, matching
 *  replayTableGrants' own guard.
 *
 *  MAJOR-C: both the creation check and the grant/revoke scan now run
 *  against `prepareForGrantReplay`'s output (blanked, with a genuine dynamic
 *  statement spliced back in -- F1), not the raw stripped text. Measured
 *  before this fix: deleting the real `revoke execute on function
 *  public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public;` and
 *  leaving behind `select 'we revoke execute on function
 *  public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public;
 *  someday';` left `state.get("public")` at `false` regardless -- the
 *  assertion that an unauthenticated caller cannot reach a SECURITY DEFINER
 *  function was satisfied by prose, not by a real revoke (and, symmetrically,
 *  a prose RE-grant could flip a genuinely-revoked PUBLIC back to `true`, a
 *  false alarm). Blanking closes both directions; splicing (BLOCKER-1, F1)
 *  keeps the genuine non-`format()` dynamic-SQL idiom -- `execute
 *  $tag$...$tag$` wrapping a real grant/revoke -- working, in its own
 *  original place in the file.
 *
 *  F2: assertNoTemplatedGrantOnTrackedFunction is called per-text, against
 *  the UNBLANKED, comment-stripped text, mirroring replayTableGrants' own
 *  BLOCKER-B call -- blanking (inside prepareForGrantReplay) is what would
 *  otherwise make a templated grant naming this function literally
 *  invisible here too. */
export function replayFunctionExecute(texts, functionName, signature) {
  let state = null;
  const createRe = new RegExp(`create or replace function public\\.${functionName}\\s*\\(`, "i");
  const grantRevokeRe =
    /\b(grant|revoke)\s+(?:execute|all(?:\s+privileges)?)\s+on\s+(?:function|routine)\s+([\w.]+)\s*\(([^)]*)\)\s+(to|from)\s+([^;]+?)\s*;/gi;
  const expectedKey = parseFunctionSignature(signature);
  for (const text of texts) {
    assertNoTemplatedGrantOnTrackedFunction(stripSqlComments(text));
    const stripped = prepareForGrantReplay(text);
    if (state === null && createRe.test(stripped)) {
      state = new Map([["public", true]]);
    }
    if (state === null) continue;
    const localRe = new RegExp(grantRevokeRe.source, grantRevokeRe.flags);
    let m;
    while ((m = localRe.exec(stripped))) {
      if (normalizeFunctionSignature(m[2], m[3]) !== expectedKey) continue;
      const verb = m[1].toLowerCase();
      const direction = m[4].toLowerCase();
      if ((verb === "grant" && direction !== "to") || (verb === "revoke" && direction !== "from")) continue;
      const roles = splitIdentifierList(stripTrailingGrantModifiers(m[5].trim()));
      for (const role of roles) state.set(role, verb === "grant");
    }
  }
  return state;
}

/** BLOCKER-2: slices the cleanup DO block's OWN text out of a
 *  comment-stripped migration file, so the DELETE assertions below can be
 *  anchored WITHIN it -- never satisfiable by, say, the `select 1 from
 *  public.applications` 40-odd lines later inside claim_prep_pack_slot's
 *  own ownership check. Returns null if the block isn't found. */
export function extractCleanupBlock(strippedText) {
  const startIdx = strippedText.search(/declare\s+v_deleted_spend\b/i);
  if (startIdx === -1) return null;
  const closeIdx = strippedText.indexOf("$$;", startIdx);
  if (closeIdx === -1) return null;
  return strippedText.slice(startIdx, closeIdx);
}

/** Extracts one `delete from public.<table> ... ;` statement out of a
 *  cleanup block (see extractCleanupBlock), normalised to single spaces so
 *  the caller's assertion can anchor on exact structure -- join table,
 *  join predicate, and the `<>` comparison -- without being sensitive to
 *  this file's own indentation. Returns null if the block is null or the
 *  table's own DELETE isn't found in it. */
export function extractDeleteStatement(block, tableName) {
  if (block === null) return null;
  const re = new RegExp(`delete\\s+from\\s+public\\.${tableName}\\b[\\s\\S]*?;`, "i");
  const m = re.exec(block);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** MAJOR-G: every destructive-statement KEYWORD (delete/truncate/update/
 *  drop/alter), in order, found ANYWHERE in the given cleanup block --
 *  not just the first match per named table extractDeleteStatement itself
 *  anchors on. extractDeleteStatement's own regex finds and validates the
 *  FIRST `delete from public.<table> ...;` for a given table; it says
 *  nothing about whether a THIRD destructive statement -- a `truncate`, a
 *  `delete` against a different table, a second `delete` against the same
 *  one, or an `update` -- also lives in the block. Five such insertions
 *  (`delete from public.interview_prep_spend;`, `delete from
 *  public.applications;`, `truncate public.interview_prep_spend;`,
 *  `update public.interview_prep_spend set attempts = 0;`) all left both
 *  real per-table assertions green before this existed, because neither one
 *  examines anything beyond its own anchor. The caller whitelists this
 *  function's output to be EXACTLY `["delete", "delete"]` -- the two named
 *  statements and nothing else -- rather than examining each in isolation.
 *  Returns `[]` if the block is null.
 *
 *  F5: the scan runs over `blankStringLiterals(block)`, not the raw block --
 *  before this, a destructive-shaped WORD inside the block's OWN `raise
 *  notice` message text (e.g. rewording it to end "... row(s) dropped; no
 *  update was applied") inflated the count exactly like a real extra
 *  statement would, failing the caller's whitelist on otherwise-correct
 *  SQL. Not exhaustive even now: `insert`, `merge`, `call` and `perform` are
 *  not on this keyword list at all, so a destructive-adjacent statement
 *  spelled with one of those verbs is not caught by this function either
 *  way. */
export function extractDestructiveKeywords(block) {
  if (block === null) return [];
  const blanked = blankStringLiterals(block);
  const re = /\b(delete|truncate|update|drop|alter)\b/gi;
  const found = [];
  let m;
  while ((m = re.exec(blanked))) found.push(m[1].toLowerCase());
  return found;
}

/** Splices one extra statement in immediately after the cleanup DO block's
 *  own `begin` -- pure text manipulation, used by
 *  interviewPrepEffectiveSchema.test.js's MAJOR-G mutants to insert a THIRD
 *  destructive statement into the block without hand-editing the migration
 *  file itself. Returns the text unchanged if the block's own anchor
 *  (extractCleanupBlock's own `declare v_deleted_spend`) isn't found. */
export function insertAfterCleanupBegin(strippedText, statement) {
  return strippedText.replace(/(declare\s+v_deleted_spend\b[\s\S]*?begin\b)/i, `$1\n  ${statement}`);
}

// ===========================================================================
// Plain functions of their arguments, used only by
// interviewPrepEffectiveSchema.test.js's own fixtures and mutants -- moved
// here (rather than defined inline in that file) for the same reason every
// other export above was: this module is the one place this test file's
// pure, non-test-framework logic lives, so the 1000-line cap on the test
// file is spent on `describe`/`it`/`expect`, not on helpers that happen not
// to need them. None of these call `expect`/`describe`/`it` themselves.
// ===========================================================================

/** Comment-aware "does this migration touch this table" check -- a migration
 *  naming the table only in prose must not count as touching it. Matches
 *  lib/applications/statusMigrationShape.test.js's and
 *  lib/supabase/applicationDigestsMigrationShape.test.js's own convention. */
export function mentionsTableLiterally(sql, tableName) {
  return stripSqlComments(sql).includes(tableName);
}

/** Returns `texts` with the entry at the same index as `excludeFilename`
 *  in `filenames` removed -- e.g. "every real migration except the lockdown
 *  one", used to prove a fix holds even before the migration that motivated
 *  it exists. */
export function textsExcludingFile(filenames, texts, excludeFilename) {
  return texts.filter((_, i) => filenames[i] !== excludeFilename);
}

/** MAJOR-D: the single, PINNED regex tying together the force-RLS cleanup
 *  guard's condition, polarity, verb (raise EXCEPTION, MAJOR-F's ruling) and
 *  message for one table ("spend" or "packs") -- so a mutant that flips only
 *  ONE of those four independently (the condition's polarity, or reverting
 *  MAJOR-F's ruling back to a warning) cannot pass by being read separately
 *  from the others, the way the pre-MAJOR-D assertions (message text alone,
 *  and the `select ... into` line alone) could be. */
export function forceRlsGuardPattern(table) {
  return new RegExp(
    `if\\s+v_${table}_force_rls\\s+then\\s+raise\\s+exception\\s+'interview_prep_${table} has relforcerowsecurity set`,
    "i",
  );
}

/** MAJOR-G: the four destructive statements that, inserted anywhere else in
 *  the cleanup DO block, must each be caught by extractDestructiveKeywords'
 *  whitelist -- a second delete against either tracked table, a truncate,
 *  or an update, none of which the two NAMED delete assertions
 *  (extractDeleteStatement) examine at all. */
export const CLEANUP_BLOCK_EXTRA_DESTRUCTIVE_STATEMENTS = [
  "delete from public.interview_prep_spend;",
  "delete from public.applications;",
  "truncate public.interview_prep_spend;",
  "update public.interview_prep_spend set attempts = 0;",
];

/** BLOCKER-2: the exact, fully-normalised shape (extractDeleteStatement's
 *  own single-spaced output) each tracked table's cleanup DELETE must match
 *  -- the join table, the join predicate, and the `<>` ownership-mismatch
 *  comparison, all three, together. */
export const SPEND_DELETE_RE =
  /^delete from public\.interview_prep_spend spend using public\.applications app where spend\.application_id\s*=\s*app\.id and spend\.user_id\s*<>\s*app\.user_id;$/i;
export const PACKS_DELETE_RE =
  /^delete from public\.interview_prep_packs packs using public\.applications app where packs\.application_id\s*=\s*app\.id and packs\.user_id\s*<>\s*app\.user_id;$/i;
