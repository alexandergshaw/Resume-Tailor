// Deriving "which technologies does this user actually work with" from their
// own project pages. Written before lib/techwatch/watchlist.js exists.
//
// This is the reason the briefing lives on the Professional Experience tab
// rather than being generic tech news: the pages already name the stack.

import { describe, it, expect } from "vitest";
import { deriveWatchlist } from "./watchlist.js";
import { CATALOG, DEFAULT_WATCHLIST_IDS, MAX_WATCHLIST, catalogEntry } from "./catalog.js";

function page(overrides = {}) {
  return {
    id: "p1",
    title: "Payments service",
    body: "",
    generated_kind: null,
    ...overrides,
  };
}

const ids = (result) => result.entries.map((e) => e.id);

describe("deriveWatchlist", () => {
  it("finds a technology named in a page body", () => {
    const result = deriveWatchlist([page({ body: "Rebuilt the checkout in React." })]);
    expect(ids(result)).toContain("react");
    expect(result.usedDefaults).toBe(false);
  });

  it("finds a technology named only in a page title", () => {
    const result = deriveWatchlist([page({ title: "Next.js migration", body: "" })]);
    expect(ids(result)).toContain("nextjs");
  });

  it("matches on word boundaries, so reactive is not React", () => {
    // The page has to name SOME technology. A page that matches nothing at
    // all falls back to the default watchlist - which begins with React - so
    // an unanchored version of this test asserts the opposite of what its
    // name claims and fails against a perfectly correct matcher.
    const result = deriveWatchlist([
      page({ id: "p1", title: "Streaming", body: "A reactive pipeline with backpressure, built on Django." }),
    ]);
    expect(result.usedDefaults).toBe(false);
    expect(ids(result)).toContain("django");
    expect(ids(result)).not.toContain("react");

    // Positive control in the same shape: the same sentence WITH the real
    // word must find it. Asserting only the absence is satisfied by a
    // matcher that finds nothing at all, ever.
    const positive = deriveWatchlist([
      page({ id: "p1", title: "Streaming", body: "A React pipeline with backpressure, built on Django." }),
    ]);
    expect(ids(positive)).toContain("react");
  });

  it("does not let the two-letter aliases match inside a longer word", () => {
    // "GOLANG" is the obvious probe word and is the WRONG one: `golang` is
    // itself a legitimate full-word alias of `go`, so matching it proves
    // nothing about substring leakage from the two-letter alias. "cargo"
    // contains "go" and is no alias at all. Django anchors the page for the
    // same reason as the test above.
    const result = deriveWatchlist([
      page({ body: "We used cargo-adjacent tooling and a tsunami of tests, built on Django." }),
    ]);
    expect(result.usedDefaults).toBe(false);
    expect(ids(result)).not.toContain("go");
    expect(ids(result)).not.toContain("typescript");

    const positive = deriveWatchlist([page({ body: "Written in Go, typed with TS." })]);
    expect(ids(positive)).toEqual(expect.arrayContaining(["go", "typescript"]));
  });

  it("records which pages each technology was found in", () => {
    const result = deriveWatchlist([
      page({ id: "a", body: "React front end" }),
      page({ id: "b", body: "Postgres only" }),
      page({ id: "c", body: "React again, and React once more" }),
    ]);
    const react = result.entries.find((e) => e.id === "react");
    expect(react.detectedIn).toEqual(["a", "c"]);
    expect(react.hits).toBe(3);
  });

  it.each([
    ["React 17", "react", ["17"]],
    ["react v18.2", "react", ["18.2"]],
    ["React@19", "react", ["19"]],
    ["Next.js 14.2.3 in production", "nextjs", ["14.2.3"]],
    ["Node.js version 20", "nodejs", ["20"]],
  ])("captures the version written next to the name: %s", (body, id, expected) => {
    const result = deriveWatchlist([page({ body })]);
    const entry = result.entries.find((e) => e.id === id);
    expect(entry).toBeTruthy();
    expect(entry.detectedVersions).toEqual(expected);
  });

  it("leaves detectedVersions empty when the page names no version", () => {
    const result = deriveWatchlist([page({ body: "Built with React." })]);
    expect(result.entries.find((e) => e.id === "react").detectedVersions).toEqual([]);
  });

  it("ignores pages this app generated itself", () => {
    // A research report about Kubernetes is not evidence the user works with
    // Kubernetes - it is evidence they once pressed a button. Without this,
    // the watchlist drifts towards whatever the app last wrote about.
    const result = deriveWatchlist([
      page({ id: "real", body: "Django service" }),
      page({ id: "gen", body: "Kubernetes Kubernetes Kubernetes", generated_kind: "research" }),
    ]);
    expect(ids(result)).toContain("django");
    expect(ids(result)).not.toContain("kubernetes");
  });

  it("orders by how often a technology appears", () => {
    const result = deriveWatchlist([
      page({ id: "a", body: "Vue" }),
      page({ id: "b", body: "React React React" }),
      page({ id: "c", body: "React Vue Vue" }),
    ]);
    expect(ids(result).slice(0, 2)).toEqual(["react", "vue"]);
  });

  it("truncates to the cap and says that it did", () => {
    const body = CATALOG.map((e) => e.aliases[0]).join(" ");
    const result = deriveWatchlist([page({ body })]);
    expect(result.entries.length).toBe(MAX_WATCHLIST);
    expect(result.truncated).toBe(true);
  });

  it("does not claim truncation when everything fits", () => {
    const result = deriveWatchlist([page({ body: "React and Vue" })]);
    expect(result.truncated).toBe(false);
  });

  it("falls back to the default watchlist when nothing is detected", () => {
    for (const pages of [[], [page({ body: "" })], [page({ body: "Wrote some prose." })]]) {
      const result = deriveWatchlist(pages);
      expect(result.usedDefaults).toBe(true);
      expect(ids(result)).toEqual(DEFAULT_WATCHLIST_IDS);
      for (const entry of result.entries) expect(entry.detectedIn).toEqual([]);
    }
  });

  it("never returns an empty entries array", () => {
    expect(deriveWatchlist(null).entries.length).toBeGreaterThan(0);
    expect(deriveWatchlist(undefined).entries.length).toBeGreaterThan(0);
    expect(deriveWatchlist([]).entries.length).toBeGreaterThan(0);
  });

  it("carries the catalog's own fetch coordinates through, so the collector needs no second lookup", () => {
    const result = deriveWatchlist([page({ body: "Next.js app" })]);
    const entry = result.entries.find((e) => e.id === "nextjs");
    expect(entry.osv).toEqual(catalogEntry("nextjs").osv);
    expect(entry.eol).toEqual(catalogEntry("nextjs").eol);
    expect(entry.statuspage).toEqual(catalogEntry("nextjs").statuspage);
    expect(entry.label).toBe(catalogEntry("nextjs").label);
  });

  it("does not mutate the catalog", () => {
    const before = JSON.stringify(CATALOG);
    const result = deriveWatchlist([page({ body: "React 17" })]);
    result.entries[0].detectedVersions.push("mutated");
    expect(JSON.stringify(CATALOG)).toBe(before);
  });

  it("deep-copies each entry, so a downstream write cannot corrupt the catalog", () => {
    // `{...catalogEntry(id)}` passes the equality assertions above while
    // SHARING the nested objects. One consumer writing to `entry.osv.name`
    // then corrupts the module-level CATALOG for the life of the process,
    // and every later request for every user is wrong.
    const result = deriveWatchlist([page({ body: "Next.js app" })]);
    const entry = result.entries.find((e) => e.id === "nextjs");
    const source = catalogEntry("nextjs");
    expect(entry.osv).toEqual(source.osv);
    expect(entry.osv).not.toBe(source.osv);
    expect(entry.aliases).not.toBe(source.aliases);
    entry.osv.name = "corrupted";
    entry.aliases.push("corrupted");
    expect(catalogEntry("nextjs").osv.name).toBe("next");
    expect(catalogEntry("nextjs").aliases).not.toContain("corrupted");
  });

  it("honours the options object rather than ignoring its second parameter", () => {
    // Nothing else in this file passes options at all, so an implementation
    // with the signature `deriveWatchlist(pages)` passes every other test.
    const catalog = [
      { id: "cobol", label: "COBOL", aliases: ["cobol"], osv: null, eol: null, statuspage: null, kev: null },
      { id: "fortran", label: "Fortran", aliases: ["fortran"], osv: null, eol: null, statuspage: null, kev: null },
    ];
    const detected = deriveWatchlist([page({ body: "A COBOL batch job. React is not in this catalog." })], {
      catalog,
      defaults: ["fortran"],
    });
    expect(detected.entries.map((e) => e.id)).toEqual(["cobol"]);
    expect(detected.usedDefaults).toBe(false);

    const fellBack = deriveWatchlist([page({ body: "Nothing recognizable here." })], {
      catalog,
      defaults: ["fortran"],
    });
    expect(fellBack.entries.map((e) => e.id)).toEqual(["fortran"]);
    expect(fellBack.usedDefaults).toBe(true);

    const capped = deriveWatchlist([page({ body: "cobol fortran" })], { catalog, defaults: ["fortran"], max: 1 });
    expect(capped.entries).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it("tolerates pages with missing or non-string fields", () => {
    expect(() =>
      deriveWatchlist([{ id: "x" }, { id: "y", title: null, body: 42 }, null]),
    ).not.toThrow();
  });
});
