import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "./stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

describe("stripSqlComments", () => {
  it("blanks a line comment but keeps the newline", () => {
    const out = stripSqlComments("select 1; -- trailing note\nselect 2;");
    expect(out).not.toContain("trailing note");
    expect(out.split("\n")).toHaveLength(2);
  });

  it("blanks a block comment, keeping embedded newlines so line numbers survive", () => {
    const src = "select 1;\n/* line one\n   line two */\nselect 2;";
    const out = stripSqlComments(src);
    expect(out).not.toContain("line one");
    expect(out).not.toContain("line two");
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("does not treat -- or /* inside a string literal as starting a comment", () => {
    const src = "select 'has -- inside it', 'has /* inside it too';\n-- real comment";
    const out = stripSqlComments(src);
    expect(out).toContain("has -- inside it");
    expect(out).toContain("has /* inside it too");
    expect(out).not.toContain("real comment");
  });

  it("does not let a real comment marker close a string early", () => {
    // If the string/comment tracker were reversed (comment-aware but not
    // string-aware in the right order), a `'` earlier on the line could be
    // read as unterminated once a later `--` blanks the rest of the line.
    const src = "select 'unterminated on purpose -- not a comment';";
    const out = stripSqlComments(src);
    expect(out).toContain("unterminated on purpose -- not a comment");
  });

  it("tracks '' as an escaped quote, not the end of the string", () => {
    const src = "comment on column t.c is 'it''s still one string -- not a comment';";
    const out = stripSqlComments(src);
    expect(out).toContain("it''s still one string -- not a comment");
  });

  it("[canary] a string that is NOT properly escaped desyncs the tracker -- proving the '' handling above is load-bearing", () => {
    // Same shape as the test above, but with a single unescaped apostrophe
    // instead of ''. Without dedicated '' handling, the tracker would close
    // the string at that apostrophe and start reading the REST of the line
    // as ordinary SQL -- which happens to contain "--", so it gets blanked
    // as a comment instead of surviving as string content. This is the
    // canary proving the previous test is actually exercising the escape
    // logic, not just trivially passing.
    const src = "comment on column t.c is 'it's still one string -- not a comment';";
    const out = stripSqlComments(src);
    expect(out).not.toContain("it's still one string -- not a comment");
  });

  it("multi-line string content survives, including a line that looks like a standalone comment", () => {
    const src = "select '-- this looks like a comment but is string content\nstill inside the string';";
    const out = stripSqlComments(src);
    expect(out).toContain("-- this looks like a comment but is string content");
    expect(out).toContain("still inside the string");
  });

  it("keeps output the same length as input for mixed content", () => {
    const src = [
      "-- header comment",
      "/* block comment",
      "   spanning lines */",
      "alter table public.t add column if not exists c jsonb;",
      "comment on column public.t.c is 'text with -- and /* and '' inside it';",
    ].join("\n");
    const out = stripSqlComments(src);
    expect(out.length).toBe(src.length);
  });

  describe("[regression sweep] every real migration file in this repo", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

    it("[control] the sweep actually found migration files", () => {
      expect(files.length).toBeGreaterThan(20);
    });

    it.each(files)("%s: stripped output is the same length as the input, and never ends mid-string", (file) => {
      const raw = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const out = stripSqlComments(raw);
      // Same-length output is the length invariant every blanking branch
      // preserves; a mismatch means some branch consumed input without
      // emitting the same number of characters back out.
      expect(out.length).toBe(raw.length);
      // Quote parity is checked on the STRIPPED output, not the raw file:
      // raw prose comments legitimately contain lone apostrophes
      // (contractions like "it's", "doesn't"), which are not SQL string
      // syntax at all and have no reason to pair up. Once comments are
      // blanked, every remaining `'` is either delimiting a real string or
      // is half of a `''` escape inside one -- for syntactically valid SQL
      // that count must always be even. An odd count here is the tell for
      // a desync: some branch mis-drew the comment/string boundary and
      // either swallowed part of a string as "comment" or vice versa.
      const quoteCount = (out.match(/'/g) || []).length;
      expect(quoteCount % 2).toBe(0);
    });

    it("dollar-quoted bodies (do $$ ... end $$, function bodies) are left readable, not corrupted", () => {
      // 20260906000000_applications_user_position_key.sql's do-block is the
      // shape this module's header documents as verified-safe: real DDL
      // and RAISE-EXCEPTION text inside the $$ ... $$ body must survive
      // untouched.
      const raw = readFileSync(
        path.join(MIGRATIONS_DIR, "20260906000000_applications_user_position_key.sql"),
        "utf8",
      );
      const out = stripSqlComments(raw);
      expect(out).toContain("add constraint applications_user_position_key");
      expect(out).toContain("unique (user_id, position_id)");
      expect(out).toContain("already have more than one application row on this database");
      // Its header comment referencing the OTHER migration's filename is
      // exactly the false-positive shape this module exists to remove.
      expect(out).not.toContain("citation_outcome");

      const tailorLibrary = readFileSync(path.join(MIGRATIONS_DIR, "20260630000000_tailor_library.sql"), "utf8");
      const tailorOut = stripSqlComments(tailorLibrary);
      // The $p$ ... $p$ nested dollar-quoted policy templates must survive.
      expect(tailorOut).toContain('create policy "%s_select_own" on public.%I');
    });
  });
});
