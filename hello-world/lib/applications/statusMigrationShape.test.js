// AC-4a — the repo's DECLARED vocabulary (the `applications_status_check`
// CHECK constraint, as written in the migrations) matches the module's
// `APPLICATION_STATUSES`. This is a source-text parse, not a live-database
// query: PART 0 of 3-plan-dataloss.md measured that no live Supabase project
// is reachable from this checkout, so this test can only prove the repo's
// OWN declaration is internally consistent — it cannot prove the migration
// was actually applied to any real database. Precedent for parsing migration
// SQL in a test: lib/supabase/driveMigrationShape.test.js.
//
// Three measured facts shape this file, all re-verified here rather than
// trusted from the plan:
//
//   1. Exactly ONE migration file mentions `applications_status_check` — so
//      "pick the latest by filename order" is dead logic that could never be
//      exercised. Rather than writing untestable tie-break code, this test
//      asserts the file COUNT is 1, so the day a second migration touches
//      the constraint, this fails loudly instead of one implementation
//      silently picking a winner nobody chose.
//   2. `applications_status_check` appears FOUR times in that one file: twice
//      in `--` comments (the migration's own header, explaining why it
//      exists) before the real `drop constraint` and `add constraint`
//      statements. A parser that does not strip comments AND anchor
//      specifically on `add constraint applications_status_check` (not
//      merely the bare name, which the `drop constraint` line also
//      contains) risks matching prose instead of SQL.
//   3. The file-count sweep in fact #1 above searched RAW file text, comments
//      included, across every migration — the same shape that let
//      lib/supabase/applicationDigestsMigrationShape.test.js false-positive
//      on a later migration that named a DIFFERENT migration by filename in
//      a header comment. No migration here currently names this constraint
//      in prose without also declaring it, so the bug was latent rather than
//      triggered — but it is the identical defect, so the sweep below now
//      searches comment-stripped text via the same shared, string-aware
//      stripper (lib/sourceScan/stripSqlComments.js) that fix introduced,
//      instead of this file's own separate, byte-for-byte-identical, naive
//      copy of a line-comment stripper.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { APPLICATION_STATUSES } from "@/lib/applications/statusVocabulary.js";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const CONSTRAINT_NAME = "applications_status_check";

// The migration's own natural order — the order the app's statuses were
// introduced in, not alphabetical. Pinned separately from the
// vocabulary-module comparison below, which compares on SORTED form.
const MIGRATION_ORDER = [
  "tracking",
  "tailored",
  "auto_tailored",
  "auto_queued",
  "applied",
  "phone_screen",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
];

// Anchors on "add constraint applications_status_check" specifically — NOT
// the bare constraint name, which also appears in a `drop constraint if
// exists` line and in prose — then reads the `status in (...)` value list
// that follows. Returns null if the anchor is not found, so a parser that
// silently matched nothing is distinguishable from one that found an empty
// list.
function parseStatusCheckValues(sql) {
  const stripped = stripSqlComments(sql);
  const anchor = `add constraint ${CONSTRAINT_NAME}`;
  const anchorIdx = stripped.indexOf(anchor);
  if (anchorIdx === -1) return null;
  const tail = stripped.slice(anchorIdx);
  const inMarker = "status in (";
  const inIdx = tail.indexOf(inMarker);
  if (inIdx === -1) return null;
  const afterIn = tail.slice(inIdx + inMarker.length);
  const closeIdx = afterIn.indexOf(")");
  if (closeIdx === -1) return null;
  const listText = afterIn.slice(0, closeIdx);
  return [...listText.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

// Comment-stripped before searching — see fact #3 above. A migration
// mentioning this constraint only in prose (e.g. naming this file by
// filename the way 20260906000000_applications_user_position_key.sql names
// application_digest_citation_outcome.sql) must NOT count as "mentions it".
function mentionsStatusCheck(sql) {
  return stripSqlComments(sql).includes(CONSTRAINT_NAME);
}

let migrationFiles = null;
let matchingFiles = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  matchingFiles = migrationFiles.filter((f) => mentionsStatusCheck(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")));
});

describe("[src] applications_status_check migration shape — AC-4a", () => {
  it("[control] the migrations directory was actually read and is non-trivial", () => {
    expect(migrationFiles.length).toBeGreaterThan(10);
  });

  it("exactly ONE migration file mentions applications_status_check — the tie-break is dead code otherwise", () => {
    expect(matchingFiles).toEqual(["20260610020000_applications_status_auto_queued.sql"]);
  });

  describe("[fixture] the sweep is comment-aware, not just currently lucky", () => {
    it("a header comment naming this constraint in prose, with no real DDL, does not count as a mention", () => {
      const prose = [
        "-- Unlike applications_status_check (see",
        "-- 20260610020000_applications_status_auto_queued.sql), this constraint",
        "-- has no idempotent add.",
        "alter table public.other_table add column if not exists x int;",
      ].join("\n");
      expect(mentionsStatusCheck(prose)).toBe(false);
    });

    it("[must stay red] a second migration that genuinely adds this exact constraint still trips the sweep", () => {
      const genuineSecond = "alter table public.other_table add constraint applications_status_check check (status in ('x'));";
      expect(mentionsStatusCheck(genuineSecond)).toBe(true);
    });
  });

  it("[canary] the bare constraint name appears FOUR times in that file — 2 comments, 1 drop, 1 add", () => {
    // Proves the anchoring below is load-bearing, not decorative: a naive
    // "first occurrence" search would hit a comment, not the real
    // constraint.
    const raw = readFileSync(path.join(MIGRATIONS_DIR, matchingFiles[0]), "utf8");
    const rawCount = (raw.match(new RegExp(CONSTRAINT_NAME, "g")) || []).length;
    expect(rawCount).toBe(4);
  });

  describe("parseStatusCheckValues", () => {
    it("[canary] returns null when the anchor is absent — not an empty list, and not a thrown error", () => {
      expect(parseStatusCheckValues("-- add constraint applications_status_check\nselect 1;")).toBeNull();
      expect(parseStatusCheckValues("create table t (id int);")).toBeNull();
    });

    it("[canary] skips a comment-only mention and does not match the DROP statement", () => {
      const src = [
        "-- applications_status_check explains the drop below",
        "drop constraint if exists applications_status_check;",
        "add constraint applications_status_check check (status in ('a', 'b'));",
      ].join("\n");
      expect(parseStatusCheckValues(src)).toEqual(["a", "b"]);
    });

    it("parses the real migration file's value list", () => {
      const raw = readFileSync(path.join(MIGRATIONS_DIR, matchingFiles[0]), "utf8");
      const parsed = parseStatusCheckValues(raw);
      expect(parsed).not.toBeNull();
      // Control: 11 entries and a known member, so a parser that matched the
      // anchor but extracted nothing (or extracted junk) cannot pass as
      // success.
      expect(parsed.length).toBe(11);
      expect(parsed).toContain("auto_queued");
    });
  });

  describe("the parsed value list vs. the vocabulary module", () => {
    let parsed;
    beforeAll(() => {
      const raw = readFileSync(path.join(MIGRATIONS_DIR, matchingFiles[0]), "utf8");
      parsed = parseStatusCheckValues(raw);
    });

    it("is pinned to the migration's own natural (non-alphabetical) order", () => {
      expect(parsed).toEqual(MIGRATION_ORDER);
    });

    it("AC-4a: toEqual APPLICATION_STATUSES on SORTED form — same 11 values, module sorts, migration does not", () => {
      // APPLICATION_STATUSES is exported already sorted (pinned by
      // statusVocabulary.test.js); the migration's own declared order is the
      // order statuses were introduced, not alphabetical (see
      // MIGRATION_ORDER above). "toEqual APPLICATION_STATUSES" therefore
      // compares SORTED forms — a positional compare would fail on order
      // alone despite the sets being identical, which is not what this
      // criterion is checking.
      expect([...parsed].sort()).toEqual(APPLICATION_STATUSES);
    });

    it("[control] the comparison can fail — an extra or missing value breaks it", () => {
      const wrong = [...parsed, "screening"];
      expect([...wrong].sort()).not.toEqual(APPLICATION_STATUSES);
      const missing = parsed.slice(1);
      expect([...missing].sort()).not.toEqual(APPLICATION_STATUSES);
    });
  });
});
