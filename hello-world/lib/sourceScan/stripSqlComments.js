/**
 * Blanks SQL comments out of a migration file's source TEXT, leaving
 * everything else -- including string literal CONTENTS -- byte-for-byte
 * where it was, so offsets/line numbers keep lining up with the original
 * file (the same "readable" contract as tokenizeSource.js's JS/JSX
 * equivalent: comments blanked, string contents kept intact and readable).
 *
 *   -- a line comment                    -> blanked to end of line
 *   /* a block comment spanning
 *      several lines *\/                  -> blanked, newlines kept
 *   'a string literal, even one
 *    containing -- or /* or spanning
 *    several lines, with '' as its
 *    only escape'                        -> preserved verbatim
 *
 * WHY THIS EXISTS AS A SHARED, NON-TEST MODULE
 *
 * lib/supabase/applicationDigestsMigrationShape.test.js and
 * lib/applications/statusMigrationShape.test.js each carried their own
 * byte-for-byte copy of a SQL line-comment stripper (`line.indexOf("--")`,
 * per line). That copy was doing two jobs at once -- "find the real DDL"
 * and "don't get fooled by prose" -- and only ONE of its two call sites in
 * applicationDigestsMigrationShape.test.js used it: the no-default check
 * anchors on `alter table ... ;` using the stripped text, but the
 * mentions-sweep ("exactly ONE migration file mentions citation_outcome")
 * searched the RAW, unstripped file instead, and a second migration's
 * header comment naming the first migration BY FILENAME -- which contains
 * the column name as a substring -- tripped it. That is exactly the
 * forked-and-drifted shape lib/sourceScan/tokenizeSource.js's own header
 * describes for the JS sweeps it replaced, so the fix here follows the same
 * shape: one shared implementation instead of two copies (soon three, once
 * a caller needs `/* *\/` awareness the naive per-file versions never had),
 * so every caller gets the same fix instead of each needing its own.
 *
 * WHY A CHARACTER-BY-CHARACTER SCAN, NOT `line.indexOf("--")` PER LINE
 *
 * The naive version this replaces does not track string literals at all --
 * it treats the FIRST `--` on a line as a comment starting there,
 * unconditionally. A single-quoted string containing a literal `--` (legal
 * SQL; nothing stops a string from containing two dashes) would desync it:
 * everything from that accidental `--` to the end of the line would be
 * wrongly blanked, silently deleting real DDL text with no error. The
 * migration this repo just added false-positived a DIFFERENT test's
 * whole-file search for exactly this class of reason (prose containing the
 * search term), and this repo's JS sweeps already hit the same family of
 * bug once for real (see tokenizeSource.js's header on the regex-literal
 * desync in AutoApplyQueueTab.js) -- so this is written comment-and-string
 * aware from the start rather than patched reactively a second time.
 *
 * FIDELITY DECIDED FOR THIS REPO'S MIGRATIONS -- VERIFIED AGAINST EVERY
 * FILE UNDER supabase/migrations/, NOT ASSUMED:
 *
 *   - `--` line comments and `/* ... *\/` block comments are blanked
 *     wherever they occur outside a string literal.
 *   - Single-quoted string literals are tracked with SQL's standard `''`
 *     escape (a doubled quote is one literal quote, the string continues),
 *     so a `--` or `/*` inside one is never mistaken for starting a
 *     comment, and a real comment marker can never be mistaken for closing
 *     one.
 *   - Nested `/* *\/` block comments (legal in Postgres, unlike C) are NOT
 *     supported -- the first `*\/` closes the block. Grepped: no migration
 *     in this repo nests one.
 *   - Dollar-quoted bodies (`$$ ... $$`, `$tag$ ... $tag$`, used for
 *     `do $$ ... end $$;` blocks and function bodies) are NOT specially
 *     recognized -- `$` is treated as an ordinary character, so the
 *     content between the delimiters is scanned exactly like any other
 *     SQL text. That is safe for this repo's migrations specifically
 *     because it was checked, not assumed: every dollar-quoted body under
 *     supabase/migrations/ (20260612000000_feed_postings_retention.sql,
 *     20260630000000_tailor_library.sql,
 *     20260906000000_applications_user_position_key.sql) either contains
 *     no single quote at all, or contains only ordinary, evenly-paired
 *     single-quoted string literals nested inside it -- the PL/pgSQL
 *     grammar requires exactly that, since a dollar-quoted body is itself
 *     re-parsed as SQL/PL/pgSQL text once extracted, so quotes inside it
 *     still have to balance under the normal rules. None contains `--` or
 *     `/*` inside a nested string either. A future migration that put an
 *     UNBALANCED quote character inside a dollar-quoted body (legal
 *     Postgres, since dollar-quoting suspends escape processing -- e.g. a
 *     literal apostrophe meant as data rather than a string delimiter)
 *     would desync this tracker for the rest of the file; nothing here
 *     defends against that shape today.
 *   - Double-quoted identifiers (`"some ident"`) are not tracked either --
 *     Postgres allows nearly any character inside one, including `--`, but
 *     no identifier in this repo's migrations does that.
 *
 * Verified (see stripSqlComments.test.js): running this over every `.sql`
 * file in supabase/migrations/ never leaves the scan mid-string or
 * mid-block-comment at end of file (the tell for a desync), and its output
 * is always the same length as its input.
 */

/**
 * @param {string} sql
 * @returns {string}
 */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) {
        out += sql[i] === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (c === "'") {
      out += c;
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          out += "'";
          i += 1;
          break;
        }
        out += sql[i];
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

export default stripSqlComments;
