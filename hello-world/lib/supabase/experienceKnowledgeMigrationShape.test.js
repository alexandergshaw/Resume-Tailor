// The DDL shape of 20260906010000_experience_knowledge.sql -- a source-text
// parse, not a live-database query. No live Supabase project is reachable
// from this checkout, so this test can only prove the repo's OWN declaration
// is internally consistent; it cannot prove the migration was ever applied.
// Precedent for parsing migration SQL in a test:
// lib/supabase/applicationDigestsMigrationShape.test.js (a whole migration's
// DDL shape, including a no-default pin and a comment-aware mentions-sweep)
// and lib/applications/statusMigrationShape.test.js (a CHECK constraint's
// value list). Both disciplines are followed here: every absence assertion
// is paired with a positive control proving the checker finds the real thing
// when it exists, and every parse is anchored on a statement rather than a
// bare identifier that also appears in prose.
//
// This migration's own header names the two properties that are easiest to
// get wrong and hardest to notice wrong, and this file exists to pin both:
//
//   1. `scope_key` on BOTH tables is `generated always as (...) stored` --
//      the fix for a nullable upsert arbiter (see the migration's "WHY
//      scope_key EXISTS" section). A regression here (dropping GENERATED, or
//      making the column writable) silently reopens the duplicate-row defect
//      the migration's header proves at length.
//   2. The composite FK `(user_id, scope_page_id) references
//      public.experience_pages (user_id, id)` is on BOTH tables, not just
//      experience_page_summaries. This closes a real, specifically-measured
//      cross-tenant hole on experience_page_questions (SEC-K7 in this
//      feature's security review) -- an implementer "simplifying" the
//      questions table's FK to `references experience_pages (id)` would
//      compile, look identical at a glance, and reopen it. The mutation-gate
//      test below proves this checker would actually catch that edit.
//
// A NOTE ON `retrieval_outcome` AND `answered_from_pages`: this file does
// NOT reuse applicationDigestsMigrationShape.test.js's whole-ALTER-block
// "must not match /\bdefault\b/i" technique. That technique is correct for
// a migration whose ONLY statement is the one `alter table` adding the
// no-default columns -- here, both `create table` bodies legitimately
// contain the word "default" many times, for other columns entirely, so a
// blanket ban would either false-positive on `id uuid ... default
// gen_random_uuid()` or (if scoped loosely) miss a real regression. Instead,
// each column is anchored individually: `<name>\s+<type>\s*,` must match
// with nothing between the type and the terminating comma, which a
// regression that adds `default ...` to that exact column breaks by
// construction (the anchor stops matching), while every OTHER column's
// legitimate default is left alone.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "../sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const MIGRATION_NAME = "20260906010000_experience_knowledge.sql";

const SUMMARIES_TABLE = "public.experience_page_summaries";
const QUESTIONS_TABLE = "public.experience_page_questions";

// Positive controls, each a sibling migration that legitimately has the
// property being checked, so an empty/absent result on the real file cannot
// be mistaken for a broken checker.
const SELF_FK_CONTROL_NAME = "20260812000000_experience_pages.sql"; // composite self-FK + RLS + 4 policies
const GUARD_CONTROL_NAME = "20260906000000_applications_user_position_key.sql"; // guarded `add constraint`
const NO_DEFAULT_CONTROL_NAME = "20260905000000_application_digest_citation_outcome.sql"; // nullable jsonb, no default
const STATUS_CHECK_CONTROL_NAME = "20260817000000_application_digests.sql"; // named status CHECK constraint shape

function countOccurrences(haystack, needle) {
  if (needle instanceof RegExp) {
    const re = new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : needle.flags + "g");
    return (haystack.match(re) || []).length;
  }
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// Extracts one `create table if not exists <table> ( ... )` statement, from
// its anchor to the matching closing paren, by tracking paren DEPTH rather
// than reading to the next semicolon -- a `create table` body can legally
// contain nested parens (default expressions, the generated column's
// `coalesce(...)`) that a semicolon-anchored reader would not need to skip,
// but depth tracking is the correct general technique and is what a
// generated-column body specifically requires. String literals are tracked
// with SQL's `''` escape so a stray `(`/`)` inside one (none occur in this
// migration's DDL, but the sentinel UUID does sit inside a string) can never
// desync the depth count. Returns null when the anchor is absent or the
// parens never close, so "not found" is distinguishable from "found empty".
function createTableStatement(sql, table) {
  const stripped = stripSqlComments(sql);
  const anchor = `create table if not exists ${table} (`;
  const anchorIdx = stripped.indexOf(anchor);
  if (anchorIdx === -1) return null;

  let i = anchorIdx + anchor.length - 1; // sits on the opening '('
  let depth = 0;
  let inStr = false;
  for (; i < stripped.length; i++) {
    const c = stripped[i];
    if (inStr) {
      if (c === "'") {
        if (stripped[i + 1] === "'") { i += 1; continue; }
        inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) { i += 1; break; }
    }
  }
  if (depth !== 0) return null; // parens never balanced back to zero
  return stripped.slice(anchorIdx, i);
}

// The composite-FK check, factored out so the mutation-gate test below can
// run it against a synthetic fixture and prove it actually distinguishes
// right from wrong, not just that it matches the real file by coincidence.
function hasCompositeExperiencePagesFk(block) {
  return /foreign key \(user_id, scope_page_id\) references public\.experience_pages \(user_id, id\) on delete cascade/.test(
    block,
  );
}

let migrationFiles = null;
let raw = null;
let stripped = null;
let summariesBlock = null;
let questionsBlock = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  raw = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_NAME), "utf8");
  stripped = stripSqlComments(raw);
  summariesBlock = createTableStatement(raw, SUMMARIES_TABLE);
  questionsBlock = createTableStatement(raw, QUESTIONS_TABLE);
});

describe("[src] 20260906010000_experience_knowledge.sql shape", () => {
  it("[control] the migrations directory and the migration file were actually read", () => {
    expect(migrationFiles.length).toBeGreaterThan(20);
    expect(migrationFiles).toContain(MIGRATION_NAME);
    expect(raw.length).toBeGreaterThan(1000);
    expect(summariesBlock).not.toBeNull();
    expect(questionsBlock).not.toBeNull();
  });

  it("[canary] createTableStatement returns null on a missing anchor, and balances parens through a generated-column expression", () => {
    expect(createTableStatement("select 1;", SUMMARIES_TABLE)).toBeNull();
    // A comment-only mention is not a statement.
    expect(
      createTableStatement(`-- create table if not exists ${SUMMARIES_TABLE} (id uuid);`, SUMMARIES_TABLE),
    ).toBeNull();
    // Nested parens (a generated column's own coalesce(...) call, itself
    // containing a string literal) must not desync the depth counter.
    const nested = `create table if not exists ${SUMMARIES_TABLE} (\n  a uuid generated always as (coalesce(b, '00000000-0000-0000-0000-000000000000'::uuid)) stored,\n  b uuid\n);\nselect 1;`;
    const parsed = createTableStatement(nested, SUMMARIES_TABLE);
    expect(parsed).not.toBeNull();
    expect(parsed).toContain("coalesce(b,");
    expect(parsed.endsWith(")")).toBe(true);
    expect(parsed).not.toContain("select 1");
  });

  describe("scope_key -- the generated column that makes the upsert arbiter never null", () => {
    it("both tables declare the identical generated-always-stored expression, exactly once each", () => {
      // Whitespace-flexible between the column name and its type: the real
      // file column-aligns types across each table's longest column name, so
      // the number of spaces differs between the two tables (and would shift
      // again if a column were renamed) — that alignment is cosmetic and
      // must not be what this assertion depends on.
      const expr =
        /scope_key\s+uuid generated always as \(coalesce\(scope_page_id, '00000000-0000-0000-0000-000000000000'::uuid\)\) stored/;
      expect(countOccurrences(summariesBlock, expr)).toBe(1);
      expect(countOccurrences(questionsBlock, expr)).toBe(1);
    });

    it("the coalesce target is the nil UUID specifically, not any other sentinel", () => {
      expect(summariesBlock).toContain("coalesce(scope_page_id, '00000000-0000-0000-0000-000000000000'::uuid)");
      expect(questionsBlock).toContain("coalesce(scope_page_id, '00000000-0000-0000-0000-000000000000'::uuid)");
    });

    it("[pinned] the migration's header explains why scope_key must never be written to", () => {
      // Postgres itself refuses a supplied value for a generated column; this
      // pins that the migration says so, so a future whitelist test does not
      // treat scope_key's absence from a payload as an oversight. Both
      // substrings are picked to sit entirely within one `--` comment LINE of
      // the raw file (not spanning a line-wrap), since raw (unstripped) text
      // keeps the newline + `-- ` prefix between wrapped lines.
      expect(raw).toContain("scope_key MUST NEVER BE WRITTEN TO");
      expect(raw).toContain("In INSERT or UPDATE commands");
    });
  });

  describe("the sole upsert arbiter", () => {
    it("experience_page_summaries has a unique index on (user_id, scope_key)", () => {
      expect(
        countOccurrences(
          stripped,
          /create unique index if not exists experience_page_summaries_user_scope_key\s*\n?\s*on public\.experience_page_summaries \(user_id, scope_key\);/,
        ),
      ).toBe(1);
    });

    it("experience_page_questions declares NO unique index and no unique key at all -- history is many rows per scope", () => {
      // Positive control on the pattern itself: it does find a unique index
      // when one is actually there (summaries' own).
      expect(stripped).toMatch(/create unique index/);
      // The questions table's own create-table body names no `unique`
      // keyword anywhere, and no `create unique index ... experience_page_questions`
      // statement exists in the file.
      expect(questionsBlock).not.toMatch(/\bunique\b/i);
      expect(stripped).not.toMatch(/create unique index[^;]*experience_page_questions/);
    });
  });

  describe("the composite FK to experience_pages(user_id, id) -- SEC-K7, both tables", () => {
    it("experience_page_summaries' FK is composite and cascades on delete", () => {
      expect(hasCompositeExperiencePagesFk(summariesBlock)).toBe(true);
    });

    it("experience_page_questions' FK is ALSO composite and ALSO cascades on delete -- the specific gap this migration closes", () => {
      expect(hasCompositeExperiencePagesFk(questionsBlock)).toBe(true);
    });

    it("[mutation gate] a FK weakened to reference experience_pages by (id) alone is detected as wrong by this same check", () => {
      const weakened =
        "create table if not exists public.experience_page_questions (\n  scope_page_id uuid,\n  foreign key (user_id, scope_page_id) references public.experience_pages (id) on delete cascade\n)";
      expect(hasCompositeExperiencePagesFk(weakened)).toBe(false);
      // And the canary in the other direction: the checker does recognise
      // the correct shape when it is actually present, so the false result
      // above is not just a checker that always returns false.
      const correct =
        "create table if not exists public.experience_page_questions (\n  scope_page_id uuid,\n  foreign key (user_id, scope_page_id) references public.experience_pages (user_id, id) on delete cascade\n)";
      expect(hasCompositeExperiencePagesFk(correct)).toBe(true);
    });

    it("[positive control] the precedent this reasoning is copied from really does use a composite self-FK", () => {
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, SELF_FK_CONTROL_NAME), "utf8");
      expect(stripSqlComments(controlRaw)).toMatch(
        /foreign key \(user_id, parent_id\) references public\.experience_pages \(user_id, id\) on delete cascade/,
      );
    });

    it("each table declares exactly one foreign key, and it is the composite one -- no second, weaker FK sits alongside it", () => {
      expect(countOccurrences(summariesBlock, /foreign key/g)).toBe(1);
      expect(countOccurrences(questionsBlock, /foreign key/g)).toBe(1);
    });
  });

  describe("retrieval_outcome and answered_from_pages carry NO DEFAULT", () => {
    it("experience_page_summaries.retrieval_outcome is bare jsonb, nothing between the type and the comma", () => {
      expect(countOccurrences(summariesBlock, /retrieval_outcome\s+jsonb\s*,/)).toBe(1);
    });

    it("experience_page_questions.retrieval_outcome is bare jsonb, nothing between the type and the comma", () => {
      expect(countOccurrences(questionsBlock, /retrieval_outcome\s+jsonb\s*,/)).toBe(1);
    });

    it("experience_page_questions.answered_from_pages is bare boolean, nothing between the type and the comma", () => {
      expect(countOccurrences(questionsBlock, /answered_from_pages\s+boolean\s*,/)).toBe(1);
    });

    it("[positive control] the same anchoring technique DOES find a real default on a sibling column, so the absences above are not a broken pattern", () => {
      // source_pages legitimately has a default; proves the regex style
      // finds a default when the column actually has one.
      expect(summariesBlock).toMatch(/source_pages\s+jsonb not null default '\[\]'::jsonb,/);
    });

    it("[pinned] the migration states, in the schema itself, that these columns must never gain a default", () => {
      // "NEVER GAIN A" (without requiring a specific case or exact spacing on
      // the leading word, since one occurrence reads "must NEVER GAIN A" and
      // the others "Must NEVER GAIN A", and one wraps "A" / "DEFAULT" across
      // a line) appears once per column this rule applies to: summaries'
      // retrieval_outcome, questions' retrieval_outcome, and questions'
      // answered_from_pages.
      expect(countOccurrences(raw, "NEVER GAIN A")).toBeGreaterThanOrEqual(3);
    });

    it("[precedent check] the no-default discipline named in this migration's header is real, not invented", () => {
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, NO_DEFAULT_CONTROL_NAME), "utf8");
      expect(stripSqlComments(controlRaw)).not.toMatch(/citation_outcome\s+jsonb[^,]*default/);
    });
  });

  describe("model is free text with no CHECK constraint, on both tables", () => {
    it("neither table's model column is followed by a check", () => {
      expect(countOccurrences(summariesBlock, /model\s+text\s*,/)).toBe(1);
      expect(countOccurrences(questionsBlock, /model\s+text\s*,/)).toBe(1);
      expect(summariesBlock).not.toMatch(/model[^,]*check/i);
      expect(questionsBlock).not.toMatch(/model[^,]*check/i);
    });
  });

  describe("status is a closed vocabulary on both tables: ready or failed", () => {
    it("both tables declare a named status_check constraint over exactly ('ready', 'failed')", () => {
      expect(summariesBlock).toContain(
        "constraint experience_page_summaries_status_check check (status in ('ready', 'failed'))",
      );
      expect(questionsBlock).toContain(
        "constraint experience_page_questions_status_check check (status in ('ready', 'failed'))",
      );
    });

    it("[positive control] the named-constraint style is copied from a real shipped migration, not invented here", () => {
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, STATUS_CHECK_CONTROL_NAME), "utf8");
      expect(stripSqlComments(controlRaw)).toMatch(/constraint application_digests_status_check check \(status in/);
    });
  });

  describe("RLS + four owner-scoped policies, both tables", () => {
    for (const table of [SUMMARIES_TABLE, QUESTIONS_TABLE]) {
      it(`${table}: RLS enabled and select/insert/update/delete policies all present, exactly once each`, () => {
        expect(countOccurrences(stripped, `alter table ${table} enable row level security;`)).toBe(1);
        for (const cmd of ["select_own", "insert_own", "update_own", "delete_own"]) {
          const policyName = `${table.replace("public.", "")}_${cmd}`;
          expect(countOccurrences(stripped, `create policy "${policyName}" on ${table}`)).toBe(1);
          expect(countOccurrences(stripped, `drop policy if exists "${policyName}" on ${table};`)).toBe(1);
        }
        expect(countOccurrences(stripped, `grant select, insert, update, delete on table ${table} to authenticated;`)).toBe(
          1,
        );
        expect(countOccurrences(stripped, `grant all on table ${table} to service_role;`)).toBe(1);
      });
    }

    it("[positive control] the four-policy shape is copied from the tree's own migration", () => {
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, SELF_FK_CONTROL_NAME), "utf8");
      const controlStripped = stripSqlComments(controlRaw);
      expect(countOccurrences(controlStripped, /create policy "experience_pages_\w+_own" on public\.experience_pages/g)).toBe(
        4,
      );
    });
  });

  describe("the guarded precondition -- unique (user_id, id) on public.experience_pages", () => {
    it("guards `add constraint experience_pages_user_id_key unique (user_id, id)` behind an `if not exists (select ... from pg_constraint ...)` check", () => {
      expect(stripped).toMatch(
        /do \$\$\s*begin\s*if not exists \(\s*select 1\s*from pg_constraint\s*where conname = 'experience_pages_user_id_key'\s*and conrelid = 'public\.experience_pages'::regclass\s*\) then\s*alter table public\.experience_pages\s*add constraint experience_pages_user_id_key\s*unique \(user_id, id\);\s*end if;\s*end \$\$;/,
      );
    });

    it("every `alter table ... add constraint|add column|alter column` targets experience_pages ONLY -- the two new tables are only ever CREATEd, never structurally altered", () => {
      // `alter table ... enable row level security` legitimately targets
      // BOTH new tables (expected, asserted elsewhere) and is deliberately
      // excluded from this check -- it is not a structural change to the
      // table's columns or constraints, unlike add constraint/add
      // column/alter column, which this migration reserves for the one
      // guarded precondition on the pre-existing experience_pages table.
      const structuralAlters = stripped.match(/alter table (\S+)\s+(add constraint|add column|alter column)/g) || [];
      expect(structuralAlters.length).toBeGreaterThanOrEqual(1);
      for (const a of structuralAlters) {
        expect(a.startsWith("alter table public.experience_pages")).toBe(true);
      }
    });

    it("both new tables are altered only to enable row level security -- never structurally", () => {
      const rlsAlters = stripped.match(/alter table (public\.experience_page_summaries|public\.experience_page_questions) enable row level security;/g) || [];
      expect(rlsAlters.length).toBe(2);
    });

    it("[positive control] the guard shape is copied from a real precedent, not invented here", () => {
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, GUARD_CONTROL_NAME), "utf8");
      const controlStripped = stripSqlComments(controlRaw);
      expect(controlStripped).toMatch(/if not exists \(\s*select 1\s*from pg_constraint\s*where conname = /);
    });

    it("[pinned] this migration explains why, unlike its precedent, it needs no duplicate-row pre-check", () => {
      // Picked to sit entirely within one `--` comment line of the raw file.
      expect(raw).toContain("to a column that is already globally unique on its own can never");
      // And it explicitly does NOT declare the precedent's `having count(*) > 1`
      // duplicate-detection block, because it does not need one.
      expect(stripped).not.toMatch(/having count\(\*\) > 1/);
    });
  });

  describe("additive only -- no destructive statement anywhere", () => {
    // Anchored on the actual SQL STATEMENT shape (`delete FROM`, `update ...
    // SET`), not a bare keyword at the start of a line. This migration's own
    // column comments are natural, multi-line, human-readable prose inside
    // SQL string literals (`comment on column ... is '...'`) -- stripSqlComments
    // correctly leaves string literal CONTENTS untouched (only `--` comments
    // are blanked), so a wrapped comment line can legitimately start with an
    // ordinary English word like "update" (e.g. "...there is no\n   update).
    // It exists so...") with no SQL statement anywhere nearby. A bare
    // `/^\s*update\b/` genuinely false-positives on that prose; requiring the
    // real statement's trailing keyword (`from` / `set`) does not.
    const DESTRUCTIVE = [
      /^\s*drop table\b/im,
      /^\s*delete\s+from\b/im,
      /^\s*update\s+\S+\s+set\b/im,
      /^\s*truncate\b/im,
      /^\s*alter\s+table\s+\S+\s+alter\s+column\b/im,
    ];

    it("declares no drop table, delete, update, truncate, or column type change", () => {
      for (const re of DESTRUCTIVE) expect(stripped).not.toMatch(re);
      // Canary: the patterns can match the shape they look for, so the
      // absences above are not dead regexes.
      expect("delete from public.x where 1=1;").toMatch(DESTRUCTIVE[1]);
      expect("update public.x set y = 1;").toMatch(DESTRUCTIVE[2]);
      expect("alter table public.x alter column y type text;").toMatch(DESTRUCTIVE[4]);
    });

    it("[canary] confirms the false positive this anchoring avoids: a bare keyword-at-line-start check WOULD wrongly flag this file's own prose", () => {
      // Not a claim that the naive check is used anywhere in this repo's
      // shipped tests today -- it demonstrates why it could not safely be
      // used on THIS migration, which is why the anchors above are more
      // specific than lib/supabase/applicationDigestsMigrationShape.test.js's
      // DESTRUCTIVE array needed to be (that migration has no multi-line
      // string-literal comments to false-positive on).
      expect(stripped).toMatch(/^\s*update\b/im);
    });

    it("the only `drop` statements are `drop policy if exists` -- reversible, idempotent, and re-created on the next line every time", () => {
      const drops = stripped.match(/drop \S+/g) || [];
      for (const d of drops) expect(d).toBe("drop policy");
      expect(drops.length).toBeGreaterThan(0);
    });
  });

  describe("what the schema does and does not do for the purge ruling", () => {
    it("[pinned] the header states the FK cascade covers the scope page and its descendants", () => {
      expect(raw).toContain("WHAT DELETING A PAGE PURGES");
      expect(raw).toContain("descendant-scope cases");
    });

    it("[pinned] the header explicitly states an ancestor scope cannot be reached by any FK cascade, and names where that must be handled instead", () => {
      expect(raw).toContain("ANCESTOR scope");
      expect(raw).toContain("no ON DELETE CASCADE, ON DELETE");
      expect(raw).toContain("DeletePageDialog.js");
    });
  });

  it("states deploy ordering and the directory-blocking risk in the header", () => {
    expect(raw).toContain("DEPLOY ORDERING IS A HARD REQUIREMENT");
    expect(raw).toContain("BLOCKS EVERY");
    expect(raw).toContain("rejects the WHOLE ROW");
  });

  describe("the mentions-sweep is comment-aware -- the false positive a sibling migration was already bitten by", () => {
    // This migration's own header discusses `citation_outcome`'s precedent
    // by pointing at "that other migration" rather than spelling out the
    // filename or column name inside any `comment on column` STRING
    // LITERAL -- because stripSqlComments does not (and must not) strip
    // string literal contents, only `--` comments. Spelling the name out
    // inside a string here would trip
    // applicationDigestsMigrationShape.test.js's own
    // "exactly ONE migration file mentions citation_outcome" sweep. This is
    // verified directly, against the real sibling file, not assumed.
    it("this migration's comment-stripped text does not contain the substring citation_outcome", () => {
      expect(stripped).not.toContain("citation_outcome");
    });

    it("[fixture] confirms why this matters: a string literal survives comment-stripping even when a `--` comment naming the same file would not", () => {
      const viaComment = "-- see 20260905000000_application_digest_citation_outcome.sql for precedent";
      const viaStringLiteral = "comment on column public.x.y is 'see citation_outcome elsewhere';";
      expect(stripSqlComments(viaComment)).not.toContain("citation_outcome");
      expect(stripSqlComments(viaStringLiteral)).toContain("citation_outcome");
    });
  });
});
