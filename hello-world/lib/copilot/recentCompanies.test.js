// N124 -- the pure half of "remember the companies the user recently practiced
// or interviewed for": the normalizer, the recency insert, and the ordering that
// pins the remembered companies' postings to the top of the picker.
//
// Written BEFORE the module exists, so every case fails on the missing import
// until the module lands. Default (node) environment: this directory is React-free.
//
// What each describe block defends, so a future edit knows what it may not trade:
//   * addCompany      -- recency (most recent first), case-insensitive dedupe that
//                        MOVES the entry to the front, the hard cap, and "a blank
//                        company is never written" (same reference back).
//   * sanitize        -- the storage normalizer: a hand-edited or corrupt value
//                        degrades to "nothing remembered", never to a throw or a
//                        list past the cap.
//   * orderRecentFirst-- the inert-when-empty contract (same array reference when
//                        there is nothing to surface) and the permutation +
//                        contiguous-prefix properties MUI `groupBy` depends on.

import { describe, it, expect } from "vitest";
import {
  RECENT_COMPANIES_STORAGE_KEY,
  RECENT_COMPANIES_CAP,
  NO_RECENT_COMPANIES,
  sanitizeRecentCompanies,
  addCompany,
  isRecentCompany,
  orderRecentFirst,
} from "./recentCompanies.js";

const entry = (company, lastUsedAt = 1) => ({ company, lastUsedAt });
const opt = (id, company) => ({ id, company, title: `Role ${id}`, label: `Role ${id} — ${company}` });

describe("constants", () => {
  it("pins the persisted key as a literal (a rename silently drops every viewer's list)", () => {
    expect(RECENT_COMPANIES_STORAGE_KEY).toBe("copilot-recent-companies");
  });

  it("caps the list at a small positive number", () => {
    expect(Number.isInteger(RECENT_COMPANIES_CAP)).toBe(true);
    expect(RECENT_COMPANIES_CAP).toBeGreaterThanOrEqual(3);
    expect(RECENT_COMPANIES_CAP).toBeLessThanOrEqual(10);
  });

  it("exposes one frozen empty list to use as the store default", () => {
    expect(Object.isFrozen(NO_RECENT_COMPANIES)).toBe(true);
    expect(NO_RECENT_COMPANIES).toHaveLength(0);
  });
});

// The company identity (trimmed, case-insensitive) is internal to the module; it is
// pinned through the behaviour that depends on it: addCompany's dedupe, sanitize's
// dedupe, isRecentCompany's match and orderRecentFirst's grouping, below.

describe("addCompany", () => {
  it("prepends, so the list is most-recent-first", () => {
    const list = addCompany(addCompany([], entry("Acme")), entry("Globex"));
    expect(list.map((e) => e.company)).toEqual(["Globex", "Acme"]);
  });

  it("re-selecting a remembered company (any casing/spacing) moves it to the front and does not duplicate it", () => {
    const start = [entry("Globex"), entry("Acme")];
    const list = addCompany(start, entry("  acme "));
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.company)).toEqual(["acme", "Globex"]);
  });

  it("the entry that is written wins: its casing and timestamp replace the old one", () => {
    const list = addCompany([entry("Acme", 5)], entry("ACME", 99));
    expect(list).toEqual([{ company: "ACME", lastUsedAt: 99 }]);
  });

  it("never exceeds the cap, and the oldest entries fall off", () => {
    let list = [];
    for (let i = 0; i < RECENT_COMPANIES_CAP + 3; i += 1) list = addCompany(list, entry(`Company ${i}`, i));
    expect(list).toHaveLength(RECENT_COMPANIES_CAP);
    expect(list[0].company).toBe(`Company ${RECENT_COMPANIES_CAP + 2}`);
    expect(list.map((e) => e.company)).not.toContain("Company 0");
  });

  it("honours an explicit smaller cap", () => {
    const list = addCompany([entry("A"), entry("B")], entry("C"), 2);
    expect(list.map((e) => e.company)).toEqual(["C", "A"]);
  });

  it("a blank, whitespace-only or missing company writes nothing and returns the SAME list", () => {
    const list = [entry("Acme")];
    expect(addCompany(list, entry(""))).toBe(list);
    expect(addCompany(list, entry("   "))).toBe(list);
    expect(addCompany(list, { lastUsedAt: 1 })).toBe(list);
    expect(addCompany(list, null)).toBe(list);
    expect(addCompany(list, undefined)).toBe(list);
  });

  it("does not mutate the list it was given", () => {
    const list = Object.freeze([Object.freeze(entry("Acme"))]);
    expect(() => addCompany(list, entry("Globex"))).not.toThrow();
    expect(list).toHaveLength(1);
  });
});

describe("sanitizeRecentCompanies", () => {
  it("anything that is not an array becomes the frozen empty list", () => {
    for (const bad of [null, undefined, "x", 3, {}, { company: "Acme" }, true]) {
      expect(sanitizeRecentCompanies(bad)).toBe(NO_RECENT_COMPANIES);
    }
  });

  it("drops entries without a non-empty string company, and trims what it keeps", () => {
    const out = sanitizeRecentCompanies([
      entry("  Acme  ", 7),
      entry("", 1),
      entry("   ", 1),
      { lastUsedAt: 3 },
      { company: 42, lastUsedAt: 3 },
      null,
      "Globex",
    ]);
    expect(out).toEqual([{ company: "Acme", lastUsedAt: 7 }]);
  });

  it("coerces a missing or non-finite timestamp to 0 rather than dropping the entry", () => {
    expect(sanitizeRecentCompanies([{ company: "Acme" }, { company: "Globex", lastUsedAt: Infinity }])).toEqual([
      { company: "Acme", lastUsedAt: 0 },
      { company: "Globex", lastUsedAt: 0 },
    ]);
  });

  it("dedupes case-insensitively, keeping the FIRST (most recent) occurrence", () => {
    const out = sanitizeRecentCompanies([entry("Acme", 9), entry("acme", 5), entry("Globex", 4)]);
    expect(out).toEqual([entry("Acme", 9), entry("Globex", 4)]);
  });

  it("is a hard cap even when storage was hand-edited past it", () => {
    const many = Array.from({ length: RECENT_COMPANIES_CAP + 10 }, (_, i) => entry(`C${i}`, i));
    const out = sanitizeRecentCompanies(many);
    expect(out).toHaveLength(RECENT_COMPANIES_CAP);
    expect(out[0].company).toBe("C0");
  });

  it("an empty result is the shared frozen empty list, so a store default compares equal by reference", () => {
    expect(sanitizeRecentCompanies([])).toBe(NO_RECENT_COMPANIES);
    expect(sanitizeRecentCompanies([entry("")])).toBe(NO_RECENT_COMPANIES);
  });
});

describe("isRecentCompany", () => {
  const recent = [entry("Acme"), entry("Globex")];

  it("matches by company key, ignoring case and surrounding spaces", () => {
    expect(isRecentCompany("acme", recent)).toBe(true);
    expect(isRecentCompany("  GLOBEX ", recent)).toBe(true);
    expect(isRecentCompany("Initech", recent)).toBe(false);
  });

  it("a blank or missing company is never recent, and nothing is recent in an empty list", () => {
    expect(isRecentCompany("", recent)).toBe(false);
    expect(isRecentCompany(undefined, recent)).toBe(false);
    expect(isRecentCompany("Acme", [])).toBe(false);
    expect(isRecentCompany("Acme", undefined)).toBe(false);
  });
});

describe("orderRecentFirst", () => {
  const options = [opt("a", "Initech"), opt("b", "Acme"), opt("c", "Hooli"), opt("d", "Globex"), opt("e", "Acme")];

  it("returns the ORIGINAL array when there are no remembered companies", () => {
    expect(orderRecentFirst(options, [])).toBe(options);
    expect(orderRecentFirst(options, undefined)).toBe(options);
    expect(orderRecentFirst(options, NO_RECENT_COMPANIES)).toBe(options);
  });

  it("returns the ORIGINAL array when no remembered company matches a fetched option (a deleted posting)", () => {
    expect(orderRecentFirst(options, [entry("Umbrella")])).toBe(options);
  });

  it("returns the ORIGINAL array for an empty option list", () => {
    const none = [];
    expect(orderRecentFirst(none, [entry("Acme")])).toBe(none);
  });

  it("moves matching options to the front, most-recent company first, ties in original order", () => {
    const out = orderRecentFirst(options, [entry("Globex"), entry("Acme")]);
    expect(out.map((o) => o.id)).toEqual(["d", "b", "e", "a", "c"]);
  });

  it("is a permutation: every option appears exactly once, and nothing is invented", () => {
    const out = orderRecentFirst(options, [entry("Acme"), entry("Hooli")]);
    expect(out).toHaveLength(options.length);
    expect([...out.map((o) => o.id)].sort()).toEqual([...options.map((o) => o.id)].sort());
    for (const o of out) expect(options).toContain(o);
  });

  it("makes the remembered companies' options a contiguous prefix (the property groupBy needs)", () => {
    const recent = [entry("Acme"), entry("Hooli")];
    const out = orderRecentFirst(options, recent);
    const k = options.filter((o) => isRecentCompany(o.company, recent)).length;
    expect(k).toBeGreaterThan(0);
    out.forEach((o, i) => expect(isRecentCompany(o.company, recent)).toBe(i < k));
  });

  it("matches case-insensitively and ignores a remembered company that has no option", () => {
    const out = orderRecentFirst(options, [entry("Umbrella"), entry("  hooli ")]);
    expect(out.map((o) => o.id)).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("does not mutate the options it was given", () => {
    const frozen = Object.freeze([...options]);
    expect(() => orderRecentFirst(frozen, [entry("Acme")])).not.toThrow();
    expect(frozen.map((o) => o.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
