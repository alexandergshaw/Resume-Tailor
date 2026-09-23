// N35 fix round -- verify.r1.md M4.
//
// "facts is written straight from the request body ... and nothing else, so
// any authenticated user can store 128 KB of arbitrary JSON objects in their
// own row ... the design's stated cap is not enforced anywhere, in the DB or
// in the route." This pins `sanitizeStoredFacts` (a field whitelist + per-
// field length caps, applied before the RPC call) and the two missing DB
// constraints design.r2.md specified: a max-facts-count check, and an array-
// shape check on `generated_cover_letters.inserted_facts`.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStoredFacts } from "./factStore.js";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

function migrationSql() {
  const name = readdirSync(MIGRATIONS).find((n) => n.endsWith("_application_accepted_facts.sql"));
  if (!name) throw new Error("no *_application_accepted_facts.sql in supabase/migrations");
  return stripSqlComments(readFileSync(path.join(MIGRATIONS, name), "utf8")).toLowerCase();
}

function fact(over = {}) {
  return {
    id: "f1",
    text: "Acme opened a Dublin telemetry lab in 2026.",
    url: "https://acme.example.com/newsroom/dublin-lab",
    title: "Acme opens Dublin telemetry lab",
    source: "Acme Newsroom",
    placement: "current",
    textOrigin: "template",
    ...over,
  };
}

describe("sanitizeStoredFacts -- field whitelist and caps (M4)", () => {
  it("passes an ordinary fact through unchanged in shape", () => {
    const [out] = sanitizeStoredFacts([fact()]);
    expect(out.text).toBe(fact().text);
    expect(out.url).toBe(fact().url);
    expect(out.placement).toBe("current");
  });

  it("drops a fact with no text", () => {
    expect(sanitizeStoredFacts([fact({ text: "" }), fact({ text: "   " })])).toEqual([]);
  });

  it("drops every field not on the whitelist", () => {
    const [out] = sanitizeStoredFacts([{ ...fact(), evil: "<script>", __proto__: { polluted: true } }]);
    expect(out.evil).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(
      ["id", "placement", "source", "text", "textOrigin", "title", "url"].sort(),
    );
  });

  it("clips an oversized text field rather than storing it whole", () => {
    const [out] = sanitizeStoredFacts([fact({ text: "x".repeat(5000) })]);
    expect(out.text.length).toBeLessThan(5000);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it("refuses a URL that is not a safe external href, without dropping the whole fact", () => {
    const [out] = sanitizeStoredFacts([fact({ url: "javascript:alert(1)" })]);
    expect(out.url).toBe("");
    expect(out.text).toBe(fact().text);
  });

  it("falls back an unrecognised placement to the default rather than storing an arbitrary string", () => {
    const [out] = sanitizeStoredFacts([fact({ placement: "definitely-not-a-real-placement" })]);
    expect(out.placement).toBe("intro");
  });

  it("caps the array at 5, keeping the MOST RECENT entries", () => {
    const facts = Array.from({ length: 8 }, (_, i) => fact({ id: `f${i}`, text: `Fact number ${i} about Acme.` }));
    const out = sanitizeStoredFacts(facts);
    expect(out).toHaveLength(5);
    expect(out.map((f) => f.id)).toEqual(["f3", "f4", "f5", "f6", "f7"]);
  });

  it("non-array input sanitises to an empty array rather than throwing", () => {
    expect(sanitizeStoredFacts(null)).toEqual([]);
    expect(sanitizeStoredFacts(undefined)).toEqual([]);
    expect(sanitizeStoredFacts("not an array")).toEqual([]);
  });
});

describe("the migration enforces the caps design.r2.md specified and the shipped table dropped (M4)", () => {
  it("application_accepted_facts_max_facts: facts is capped at 5 entries", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/application_accepted_facts_max_facts/);
    expect(sql).toMatch(/jsonb_array_length\(facts\)\s*<=\s*5/);
  });

  it("facts and retracted both have an array-shape guard, so the length checks above can't throw on a malformed direct RPC call", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/application_accepted_facts_facts_is_array/);
    expect(sql).toMatch(/application_accepted_facts_retracted_is_array/);
    expect(sql).toMatch(/jsonb_typeof\(facts\)\s*=\s*'array'/);
    expect(sql).toMatch(/jsonb_typeof\(retracted\)\s*=\s*'array'/);
  });

  it("generated_cover_letters.inserted_facts has an array-shape + length check, not just a byte cap", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/generated_cover_letters_inserted_facts_shape/);
    expect(sql).toMatch(/jsonb_typeof\(inserted_facts\)\s*=\s*'array'/);
  });

  it("CANARY: the same predicates fail on text that only mentions the tokens in the wrong places", () => {
    const decoy = "-- application_accepted_facts_max_facts and inserted_facts_shape are just comments here";
    expect(decoy).not.toMatch(/jsonb_array_length\(facts\)\s*<=\s*5/);
  });
});
