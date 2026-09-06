// The DDL shape of 20260905000000_application_digest_citation_outcome.sql — a
// source-text parse, not a live-database query. No live Supabase project is
// reachable from this checkout, so this test can only prove the repo's OWN
// declaration is internally consistent; it cannot prove the migration was ever
// applied. Precedent for parsing migration SQL in a test:
// lib/applications/statusMigrationShape.test.js (a CHECK constraint) and
// lib/supabase/driveMigrationShape.test.js (a whole migration's DDL shape).
// The disciplines from both are followed here: every absence assertion is
// paired with a positive control proving the checker finds the real thing when
// it exists, and every parse is anchored on a statement rather than on a bare
// identifier that also appears in prose.
//
// The property this file exists for is ONE LINE of that migration:
//
//     `citation_outcome` is added with NO DEFAULT.
//
// SQL NULL in that column is the only signal separating "this row was written
// before the citation pipeline existed" from "the pipeline ran and genuinely
// found nothing to cite". A `default '{}'::jsonb` added later by anyone tidying
// the schema destroys that distinction permanently and silently, and without
// this test nothing in the repo goes red when it happens. That is the whole
// point — the rest of the assertions here are guard rails around it.
//
// Two facts shape the parsing below, both verified against the real files
// rather than assumed:
//
//   1. The migration's own header comment repeatedly says the words "default",
//      "drop", "policy" and "grant" IN PROSE, explaining why it has none of
//      them — and the two `comment on column` statements contain the phrase
//      "MUST NEVER BE GIVEN A DEFAULT" inside a STRING LITERAL, which a
//      line-comment stripper does not remove. A checker that searches the
//      whole file for "default" therefore reports a false positive on a
//      correct migration. Every DDL assertion below is anchored on the
//      `alter table` statement specifically.
//   2. The migration adds TWO columns in one `alter table`, so the anchor must
//      read to the statement's terminating `;`, not to the end of a line.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const MIGRATION_NAME = "20260905000000_application_digest_citation_outcome.sql";
const TABLE = "public.application_digests";

// A sibling migration that legitimately DOES declare column defaults, used as
// the positive control for the no-default parser below: the same extractor,
// pointed at this file, must find defaults. Without it, "no default found"
// cannot be told apart from "the extractor is broken".
const DEFAULTS_CONTROL_NAME = "20260826000000_experience_attachment_text.sql";
const DEFAULTS_CONTROL_TABLE = "public.experience_attachments";

// The migration that CREATED this table — the positive control for the
// RLS/policy/grant absence assertions, since it legitimately has all three.
const POLICY_CONTROL_NAME = "20260817000000_application_digests.sql";

function stripSqlLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

// The `alter table <table>` statement, from its anchor to the terminating `;`.
// Returns null when the anchor is absent, so "no statement found" is
// distinguishable from "found an empty statement".
function alterStatement(sql, table) {
  const stripped = stripSqlLineComments(sql);
  const anchor = `alter table ${table}`;
  const anchorIdx = stripped.indexOf(anchor);
  if (anchorIdx === -1) return null;
  const tail = stripped.slice(anchorIdx);
  const semi = tail.indexOf(";");
  if (semi === -1) return null;
  return tail.slice(0, semi + 1);
}

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

let migrationFiles = null;
let raw = null;
let stripped = null;
let alterBlock = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  raw = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_NAME), "utf8");
  stripped = stripSqlLineComments(raw);
  alterBlock = alterStatement(raw, TABLE);
});

describe("[src] 20260905000000_application_digest_citation_outcome.sql shape", () => {
  it("[control] the migrations directory and the migration file were actually read", () => {
    expect(migrationFiles.length).toBeGreaterThan(20);
    expect(migrationFiles).toContain(MIGRATION_NAME);
    expect(raw.length).toBeGreaterThan(1000);
    expect(alterBlock).not.toBeNull();
  });

  it("[canary] alterStatement returns null on a missing anchor, and reads to the terminating semicolon", () => {
    expect(alterStatement("select 1;", TABLE)).toBeNull();
    // A comment-only mention is not a statement.
    expect(alterStatement(`-- alter table ${TABLE} add column x int;`, TABLE)).toBeNull();
    // Multi-line statements are read whole, not line by line.
    const twoLines = `alter table ${TABLE}\n  add column if not exists a jsonb,\n  add column if not exists b timestamptz;\nselect 1;`;
    const parsed = alterStatement(twoLines, TABLE);
    expect(parsed).toContain("a jsonb");
    expect(parsed).toContain("b timestamptz");
    expect(parsed).not.toContain("select 1");
  });

  describe("the columns it adds", () => {
    it("adds citation_outcome as jsonb, idempotently, exactly once", () => {
      expect(countOccurrences(alterBlock, /add column if not exists\s+citation_outcome\s+jsonb/)).toBe(1);
    });

    it("adds researched_at as timestamptz, idempotently, exactly once", () => {
      expect(countOccurrences(alterBlock, /add column if not exists\s+researched_at\s+timestamptz/)).toBe(1);
    });

    it("adds exactly those two columns and nothing else", () => {
      expect(countOccurrences(alterBlock, /add column/)).toBe(2);
    });

    it("touches only public.application_digests — one alter statement, one table", () => {
      expect(countOccurrences(stripped, /^alter table/im)).toBe(1);
      expect(countOccurrences(alterBlock, TABLE)).toBe(1);
      expect(stripped).not.toMatch(/alter table (?!public\.application_digests)/);
    });
  });

  describe("citation_outcome has NO DEFAULT — the whole reason this file exists", () => {
    it("the alter statement declares no default of any kind", () => {
      // Absence...
      expect(alterBlock).not.toMatch(/\bdefault\b/i);
      // ...paired with a positive control on the SAME extractor: a sibling
      // migration that legitimately declares defaults must be seen to have
      // them, so an empty result above cannot be a broken parser.
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, DEFAULTS_CONTROL_NAME), "utf8");
      const controlBlock = alterStatement(controlRaw, DEFAULTS_CONTROL_TABLE);
      expect(controlBlock).not.toBeNull();
      expect(controlBlock).toMatch(/\bdefault\b/i);
      expect(countOccurrences(controlBlock, /\bdefault\b/i)).toBeGreaterThanOrEqual(4);
    });

    it("[pinned] the RAW file DOES say 'default' in prose — proving the anchoring is load-bearing, not vacuous", () => {
      // A naive whole-file search for "default" WOULD flag this migration.
      // Both the header comment and the `comment on column` string literal
      // (which no line-comment stripper removes) talk about the absent
      // default at length, on purpose.
      expect(raw).toMatch(/\bdefault\b/i);
      expect(raw).toContain("MUST NEVER BE GIVEN A DEFAULT");
    });

    it("declares neither column NOT NULL — a pre-feature row must read back as SQL NULL", () => {
      expect(alterBlock).not.toMatch(/\bnot null\b/i);
      // Positive control: the same pattern finds the real `not null`
      // declarations in the sibling migration.
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, DEFAULTS_CONTROL_NAME), "utf8");
      expect(alterStatement(controlRaw, DEFAULTS_CONTROL_TABLE)).toMatch(/\bnot null\b/i);
    });

    it("carries a prominent in-file warning against ever adding a default", () => {
      expect(countOccurrences(raw, "citation_outcome MUST NEVER GAIN A DEFAULT")).toBe(1);
      expect(raw).toContain("data-destroying change dressed as housekeeping");
    });
  });

  describe("it only ADDS — no destructive statement anywhere", () => {
    const DESTRUCTIVE = [/^drop\b/im, /^delete\b/im, /^update\b/im, /^truncate\b/im, /^insert\b/im];

    it("declares no drop, delete, update, truncate or insert statement", () => {
      for (const re of DESTRUCTIVE) expect(stripped).not.toMatch(re);
      // Positive controls, two-fold: the anchored patterns DO match real
      // statements (so they are not dead regexes), and the migration that
      // created this table really does contain a line-anchored `drop`.
      expect("drop policy if exists x on public.y;").toMatch(DESTRUCTIVE[0]);
      const policyControl = readFileSync(path.join(MIGRATIONS_DIR, POLICY_CONTROL_NAME), "utf8");
      expect(stripSqlLineComments(policyControl)).toMatch(DESTRUCTIVE[0]);
    });

    it("changes no column's type — no `alter column`, no `using`", () => {
      expect(alterBlock).not.toMatch(/\balter column\b/i);
      expect(alterBlock).not.toMatch(/\btype\b/i);
      // Canary: the pattern can match the shape it is looking for.
      expect("alter table public.x alter column y type text;").toMatch(/\balter column\b/i);
    });
  });

  describe("it does not touch RLS, policies, grants or indexes", () => {
    it("declares no policy, no RLS toggle, no grant and no index", () => {
      // Absence...
      expect(stripped).not.toMatch(/create policy/i);
      expect(stripped).not.toMatch(/row level security/i);
      expect(stripped).not.toMatch(/^grant\b/im);
      expect(stripped).not.toMatch(/^revoke\b/im);
      expect(stripped).not.toMatch(/^create index/im);
      // ...paired with a positive control: the migration that CREATED this
      // table legitimately has all of them, and the same patterns find them
      // there, so the absences above are real rather than mis-scoped.
      const controlStripped = stripSqlLineComments(
        readFileSync(path.join(MIGRATIONS_DIR, POLICY_CONTROL_NAME), "utf8"),
      );
      expect(countOccurrences(controlStripped, /create policy/i)).toBe(4);
      expect(controlStripped).toMatch(/row level security/i);
      expect(controlStripped).toMatch(/^grant\b/im);
      expect(controlStripped).toMatch(/^create index/im);
    });
  });

  describe("the column comments", () => {
    it("comments both new columns, exactly once each", () => {
      expect(countOccurrences(stripped, `comment on column ${TABLE}.citation_outcome is`)).toBe(1);
      expect(countOccurrences(stripped, `comment on column ${TABLE}.researched_at is`)).toBe(1);
    });

    it("records in the schema itself that NULL means the row predates the feature", () => {
      expect(raw).toContain("NULL means the row predates the");
    });

    it("records that researched_at is NOT the pre-feature discriminator", () => {
      expect(raw).toContain("this column is NOT the pre-feature discriminator");
    });
  });

  it("states the deploy ordering in the file, because that is where the next reader will be", () => {
    // The migration must merge and go green BEFORE the code that writes these
    // columns: PostgREST rejects a row naming an unknown column, so the WHOLE
    // upsert fails and no row is written at all — which re-arms a billed
    // grounded search on every page load.
    expect(countOccurrences(raw, "DEPLOY ORDERING MATTERS")).toBe(1);
    expect(raw).toContain("rejects the WHOLE ROW");
    expect(raw).toContain("billed grounded search");
  });

  it("exactly ONE migration file mentions citation_outcome — a second one must fail loudly here", () => {
    const matching = migrationFiles.filter((f) =>
      readFileSync(path.join(MIGRATIONS_DIR, f), "utf8").includes("citation_outcome"),
    );
    expect(matching).toEqual([MIGRATION_NAME]);
  });

  describe("the column names are snake_case, and the DDL offers no second spelling", () => {
    it("the DDL declares citation_outcome and researched_at, with no camelCase variant", () => {
      // The silent-drop failure this repo has already been bitten by: a writer
      // naming `citationOutcome` sends a key no column matches, PostgREST
      // rejects the whole row, and nothing says so. The DDL is the contract,
      // so it must carry exactly one spelling of each name.
      expect(alterBlock).toContain("citation_outcome");
      expect(alterBlock).toContain("researched_at");
      expect(alterBlock).not.toMatch(/citationOutcome/);
      expect(alterBlock).not.toMatch(/researchedAt/);
      // Canary: the patterns can match the shape they are looking for, so the
      // absences above are not two dead regexes.
      expect("add column if not exists citationOutcome jsonb").toMatch(/citationOutcome/);
      expect("add column if not exists researchedAt timestamptz").toMatch(/researchedAt/);
    });

    it("[pinned] the header prose DOES say `researchedAt` — deliberately, and only as the jsonb KEY", () => {
      // Scoping this assertion to the DDL rather than to the whole file is
      // load-bearing, not laziness. The header explains why research recency
      // is a real column instead of a jsonb field, and to do that it has to
      // name the jsonb field — `citation_outcome->>'researchedAt'` — which is
      // a genuine camelCase identifier inside the JSON record and NOT a column
      // name. A whole-file ban would fail on a correct migration; this pins
      // that the mention exists and is confined to prose.
      expect(raw).toMatch(/researchedAt/);
      expect(raw).toContain("(citation_outcome->>'researchedAt')::timestamptz");
      expect(stripSqlLineComments(raw)).not.toMatch(/researchedAt/);
    });
  });
});
