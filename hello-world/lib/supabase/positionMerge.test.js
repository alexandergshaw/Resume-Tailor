import { describe, it, expect } from "vitest";
import {
  mergePositionRow,
  mergePositionEdit,
  POSITION_IDENTITY_FIELDS,
} from "./positionMerge.js";

// ---------------------------------------------------------------------------
// `public.positions` is a deliberately SHARED catalogue: no user_id column
// (supabase/migrations/20260901000000_drive.sql:28), keyed on external_id, and
// two different accounts collide on the same key by construction —
// app/page.js:2371 builds `url-${trimmedUrl}` as the external id, so any two
// users who tailor the same posting URL write the same row.
//
// Before this module the write was `.upsert(fullRow, { onConflict:
// "external_id" })`, i.e. every column overwritten unconditionally, INCLUDING
// with an explicit null (see test/helpers/supabaseFake.js note [5] for the
// PostgREST semantics). One account's re-tailor therefore replaced the
// company / url / description that another account's stored application
// points at — and blanked them whenever that run's extraction came back
// empty (app/page.js:2438 writes `company: nextCompany`, which is "" when the
// engine resolved no company).
//
// These tests pin the merge that replaces it. The rule is stated as a PATCH:
// the merge returns only the columns that should actually change, so a column
// nobody reasoned about cannot be clobbered by being carried along.
// ---------------------------------------------------------------------------

// In production the pair is snippetFrom's 400-character cut against a whole
// posting. What the merge actually turns on is the RELATION — one materially
// shorter than the other — so the fixtures keep that and stay readable in an
// assertion diff. The real magnitudes are pinned once, by length, below.
const TRUNCATION = "Responsibilities: ship things, own the roadmap, and…";
const FULL =
  "Responsibilities: ship things, own the roadmap, and partner with design. " +
  "Requirements: 5+ years. Benefits: dental, 401k, remote-first. Apply by Friday.";

describe("mergePositionRow — never blank", () => {
  it("does not replace a stored company with an empty incoming one", () => {
    const patch = mergePositionRow({ company: "Acme" }, { company: "" });
    expect(patch).not.toHaveProperty("company");
  });

  it("does not replace a stored company with a null incoming one", () => {
    const patch = mergePositionRow({ company: "Acme" }, { company: null });
    expect(patch).not.toHaveProperty("company");
  });

  it("does not replace a stored company with a whitespace-only incoming one", () => {
    const patch = mergePositionRow({ company: "Acme" }, { company: "   " });
    expect(patch).not.toHaveProperty("company");
  });

  it("does not blank url, title or description either", () => {
    const stored = { title: "Senior Engineer", url: "https://acme.example/1", description: FULL };
    const patch = mergePositionRow(stored, { title: "", url: null, description: "  " });
    expect(patch).not.toHaveProperty("title");
    expect(patch).not.toHaveProperty("url");
    expect(patch).not.toHaveProperty("description");
  });

  it("does not blank a refreshable scalar", () => {
    const patch = mergePositionRow({ salary_min: 100000, location: "Remote" }, { salary_min: null, location: "" });
    expect(patch).not.toHaveProperty("salary_min");
    expect(patch).not.toHaveProperty("location");
  });

  it("treats `false` and `0` as VALUES, not as blanks", () => {
    // is_remote=false and salary_min=0 are real answers. A truthiness test
    // here would silently refuse to ever record them.
    const patch = mergePositionRow({ is_remote: null, salary_min: null }, { is_remote: false, salary_min: 0 });
    expect(patch.is_remote).toBe(false);
    expect(patch.salary_min).toBe(0);
  });
});

describe("mergePositionRow — fills what is missing", () => {
  it("fills an empty stored identity field from a non-empty incoming one", () => {
    const patch = mergePositionRow({ company: null, url: "", title: "   " }, {
      company: "Acme",
      url: "https://acme.example/1",
      title: "Senior Engineer",
    });
    expect(patch.company).toBe("Acme");
    expect(patch.url).toBe("https://acme.example/1");
    expect(patch.title).toBe("Senior Engineer");
  });

  it("fills an empty stored row entirely (the first write after an insert)", () => {
    const patch = mergePositionRow({}, { company: "Acme", location: "Remote", employment_type: "FULLTIME" });
    expect(patch.company).toBe("Acme");
    expect(patch.location).toBe("Remote");
    expect(patch.employment_type).toBe("FULLTIME");
  });
});

describe("mergePositionRow — identity fields are conservative", () => {
  it.each(POSITION_IDENTITY_FIELDS)(
    "refuses to replace a stored non-empty %s with a DIFFERENT non-empty one",
    (field) => {
      const patch = mergePositionRow({ [field]: "stored-value" }, { [field]: "incoming-value" });
      expect(patch).not.toHaveProperty(field);
    },
  );

  it("names company, url and title as the identity set", () => {
    // Pinned as a set, not as behaviour, so widening it is a deliberate edit.
    expect([...POSITION_IDENTITY_FIELDS].sort()).toEqual(["company", "title", "url"]);
  });

  it("does not treat an unchanged identity value as a change", () => {
    const patch = mergePositionRow({ company: "Acme" }, { company: "Acme" });
    expect(patch).not.toHaveProperty("company");
  });

  it("still lets a refreshable scalar be corrected (it is not identity)", () => {
    const patch = mergePositionRow({ salary_min: 100000 }, { salary_min: 120000 });
    expect(patch.salary_min).toBe(120000);
  });

  it("treats `source` as provenance and never reclassifies an existing row", () => {
    // lib/feed/tailorAndQueue.js:22-25 records why: changing an existing
    // row's source silently reclassifies it.
    const patch = mergePositionRow({ source: "greenhouse" }, { source: "jsearch" });
    expect(patch).not.toHaveProperty("source");
  });

  it("never emits external_id — it is the conflict key, not a merged column", () => {
    const patch = mergePositionRow({ external_id: "gh-1", company: null }, { external_id: "gh-1", company: "Acme" });
    expect(patch).not.toHaveProperty("external_id");
  });
});

describe("mergePositionRow — description must be able to GROW", () => {
  // Commit aa98b17 ("stop storing a 400-character truncation as the job
  // description") stopped NEW writes persisting snippetFrom's 400-char cut.
  // Rows written before it still hold that truncation, and every later reader
  // — dedup, digests, downstream tailoring — treats positions.description as
  // the whole posting. A naive fill-empty-only rule would freeze those rows
  // truncated forever, i.e. it would regress aa98b17 for the existing corpus.
  it("replaces a stored truncation with the full text", () => {
    const patch = mergePositionRow({ description: TRUNCATION }, { description: FULL });
    expect(patch.description).toBe(FULL);
  });

  it("does NOT let a truncation overwrite the stored full text", () => {
    // app/page.js:2683 can still write the truncation when the full-text
    // lookup AND the server scrape both come back empty, so the two writes
    // genuinely arrive in both orders.
    const patch = mergePositionRow({ description: FULL }, { description: TRUNCATION });
    expect(patch).not.toHaveProperty("description");
  });

  it("is order-independent: either arrival order ends at the full text", () => {
    const a = mergePositionRow({ description: TRUNCATION }, { description: FULL }).description ?? TRUNCATION;
    const b = mergePositionRow({ description: FULL }, { description: TRUNCATION }).description ?? FULL;
    expect(a).toBe(FULL);
    expect(b).toBe(FULL);
  });

  it("keeps the stored text when the incoming one is the same length", () => {
    const patch = mergePositionRow({ description: "aaaa" }, { description: "bbbb" });
    expect(patch).not.toHaveProperty("description");
  });

  it("compares on trimmed length, so padding alone is not 'longer'", () => {
    const patch = mergePositionRow({ description: "abcd" }, { description: "   abcd   " });
    expect(patch).not.toHaveProperty("description");
  });
});

describe("mergePositionRow — raw_data grows, never shrinks", () => {
  it("keeps stored keys the incoming blob does not carry", () => {
    const patch = mergePositionRow(
      { raw_data: { id: "gh-1", benefits: "dental" } },
      { raw_data: { id: "gh-1", team: "platform" } },
    );
    expect(patch.raw_data).toEqual({ id: "gh-1", benefits: "dental", team: "platform" });
  });

  it("does not let a blank incoming value blank a stored key", () => {
    const patch = mergePositionRow({ raw_data: { company: "Acme" } }, { raw_data: { company: "" } });
    expect(patch).not.toHaveProperty("raw_data");
  });

  it("prefers the longer string for a key held by both", () => {
    const patch = mergePositionRow(
      { raw_data: { description: TRUNCATION } },
      { raw_data: { description: FULL } },
    );
    expect(patch.raw_data.description).toBe(FULL);
  });

  it("emits nothing when the merge would change nothing", () => {
    const patch = mergePositionRow({ raw_data: { id: "gh-1" } }, { raw_data: { id: "gh-1" } });
    expect(patch).not.toHaveProperty("raw_data");
  });
});

describe("mergePositionRow — monotone under every write order", () => {
  const FIELDS = ["company", "url", "title", "description", "location", "salary_min", "source"];

  function blank(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === "string") return v.trim() === "";
    return false;
  }

  function apply(row, incoming) {
    return { ...row, ...mergePositionRow(row, incoming) };
  }

  it("never turns a non-empty column into an empty one, over 400 random sequences", () => {
    const values = ["Acme", "Acme Inc.", "", null, "   ", TRUNCATION, FULL, 0, 100000];
    let seed = 7;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    for (let run = 0; run < 400; run += 1) {
      let row = { external_id: "gh-1" };
      for (let step = 0; step < 6; step += 1) {
        const incoming = { external_id: "gh-1" };
        for (const f of FIELDS) incoming[f] = values[rand(values.length)];
        const before = { ...row };
        row = apply(row, incoming);
        for (const f of FIELDS) {
          if (!blank(before[f])) {
            expect(blank(row[f]), `${f} was blanked in run ${run} step ${step}`).toBe(false);
          }
        }
        const beforeLen = typeof before.description === "string" ? before.description.trim().length : 0;
        const afterLen = typeof row.description === "string" ? row.description.trim().length : 0;
        expect(afterLen, `description shrank in run ${run} step ${step}`).toBeGreaterThanOrEqual(beforeLen);
      }
    }
  });

  it("is idempotent: re-applying the same incoming row a second time changes nothing", () => {
    const incoming = { external_id: "gh-1", company: "Acme", description: FULL, salary_min: 100000 };
    const once = apply({ external_id: "gh-1" }, incoming);
    expect(mergePositionRow(once, incoming)).toEqual({});
  });
});

describe("mergePositionEdit — the explicit, authorized user edit", () => {
  // A different operation from the catalogue merge above: the Edit
  // Application dialog, where a human typed the value for a row they hold an
  // application on. The dialog's own optimistic local update
  // (app/hooks/useApplicationDialogs.js:472-474) already reads
  // `editAppDialog.company.trim() || a.positions.company` — i.e. the UI has
  // always treated an empty box as "leave it alone" for company and title.
  // Never-blank makes the store agree with what the screen already showed.
  it("leaves a stored value alone when the user's box is empty", () => {
    const patch = mergePositionEdit({ company: "Acme", title: "Engineer", description: FULL }, {
      company: "",
      title: null,
      description: "   ",
    });
    expect(patch).toEqual({});
  });

  it("lets the user REPLACE a wrong company — the catalogue merge cannot", () => {
    // This is the escape hatch that pays for the conservative identity rule:
    // an identity a scrape got wrong is repaired here, by a human, on a row
    // they demonstrably hold an application on.
    expect(mergePositionEdit({ company: "Acme" }, { company: "Acme Corporation" }).company).toBe("Acme Corporation");
    expect(mergePositionEdit({ title: "Eng" }, { title: "Senior Eng" }).title).toBe("Senior Eng");
  });

  it("lets the user shorten a description they typed", () => {
    expect(mergePositionEdit({ description: FULL }, { description: "short note" }).description).toBe("short note");
  });

  it("accepts only title, company and description — nothing else from the body", () => {
    const patch = mergePositionEdit({}, {
      company: "Acme",
      title: "Engineer",
      description: "d",
      url: "https://evil.example",
      external_id: "gh-other",
      id: "another-row",
      source: "jsearch",
    });
    expect(Object.keys(patch).sort()).toEqual(["company", "description", "title"]);
  });
});
