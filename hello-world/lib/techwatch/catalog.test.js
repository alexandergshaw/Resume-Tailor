// The technology catalog: the map from a name a user writes on a project page
// to the public feeds that can say something about it.
//
// Written before lib/techwatch/catalog.js exists. Most of what is asserted
// here is data correctness rather than logic, and that is the point - an
// endoflife.date slug that does not exist upstream produces a 404 that the
// collector dutifully reports as "source unavailable" forever, which reads on
// screen exactly like "that vendor is having a bad day".

import { describe, it, expect } from "vitest";
import { CATALOG, DEFAULT_WATCHLIST_IDS, MAX_WATCHLIST, catalogEntry } from "./catalog.js";

// Slugs confirmed to exist in https://endoflife.date/api/all.json on
// 2026-08-17 (464 products). `typescript` and `java` were confirmed ABSENT.
const CONFIRMED_EOL_SLUGS = new Set([
  "react", "nextjs", "nodejs", "angular", "angularjs", "vue", "python", "django",
  "rails", "ruby", "dotnet", "php", "laravel", "postgresql", "mysql", "mariadb",
  "mongodb", "redis", "kubernetes", "docker-engine", "go", "rust", "kotlin",
  "terraform", "ansible", "nginx", "apache-http-server", "electron", "deno",
  "bun", "elasticsearch", "rabbitmq", "tomcat", "sqlite", "jenkins", "gitlab",
  "spring-framework", "spring-boot", "symfony", "drupal", "wordpress",
  "ubuntu", "debian", "centos", "rhel", "amazon-linux", "windows", "macos",
  "android", "ios", "bootstrap", "jquery", "composer", "pnpm", "yarn",
]);

const REQUIRED_IDS = [
  "react", "nextjs", "typescript", "nodejs", "github", "cloudflare", "npm",
  "supabase", "postgresql", "python", "docker", "kubernetes", "vue", "angular",
  "django", "go", "rust", "redis", "mongodb", "mysql", "terraform", "electron",
  "tomcat", "jenkins", "gitlab", "elasticsearch",
];

describe("CATALOG", () => {
  it("carries every technology the briefing is expected to cover", () => {
    const ids = CATALOG.map((e) => e.id);
    for (const id of REQUIRED_IDS) expect(ids).toContain(id);
  });

  it("gives every entry the full coordinate shape, even when a coordinate is absent", () => {
    for (const entry of CATALOG) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.aliases)).toBe(true);
      expect(entry.aliases.length).toBeGreaterThan(0);
      // Present-but-null is required, not optional: the collector branches on
      // `entry.eol === null` to report "no lifecycle feed" by name. An
      // `undefined` from a forgotten key reads the same to `==` but not to a
      // reader, and hides which entries were a deliberate decision.
      expect(entry).toHaveProperty("osv");
      expect(entry).toHaveProperty("eol");
      expect(entry).toHaveProperty("statuspage");
      expect(entry).toHaveProperty("kev");
    }
  });

  it("uses only endoflife.date slugs confirmed to exist upstream", () => {
    const used = CATALOG.map((e) => e.eol).filter(Boolean);
    expect(used.length).toBeGreaterThan(8);
    for (const slug of used) expect(CONFIRMED_EOL_SLUGS).toContain(slug);
  });

  it("leaves TypeScript with no lifecycle feed, because endoflife.date has none", () => {
    // This is the user's own example of a technology "going under". Claiming
    // a slug here would 404 on every request; the honest encoding is null,
    // which the UI turns into a stated gap.
    expect(catalogEntry("typescript").eol).toBeNull();
    expect(catalogEntry("typescript").osv).toEqual({ name: "typescript", ecosystem: "npm" });
  });

  it("points each statuspage entry at an Atlassian Statuspage host, not a marketing page", () => {
    const withStatus = CATALOG.filter((e) => e.statuspage);
    expect(withStatus.length).toBeGreaterThan(3);
    for (const entry of withStatus) {
      expect(entry.statuspage.host).toMatch(/^[a-z0-9.-]+$/);
      expect(entry.statuspage.host).not.toMatch(/^https?:/);
      expect(typeof entry.statuspage.vendor).toBe("string");
      expect(entry.statuspage.vendor.length).toBeGreaterThan(0);
    }
    expect(catalogEntry("github").statuspage.host).toBe("www.githubstatus.com");
  });

  it("never lets two technologies claim the same alias", () => {
    // An alias owned by two entries silently mis-attributes every item that
    // follows it - the briefing would say Vue when the page said Vite.
    const seen = new Map();
    const collisions = [];
    for (const entry of CATALOG) {
      for (const alias of entry.aliases) {
        const key = alias.toLowerCase();
        if (seen.has(key)) collisions.push(`${key}: ${seen.get(key)} and ${entry.id}`);
        seen.set(key, entry.id);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("keeps aliases lowercase so watchlist matching can normalize once", () => {
    for (const entry of CATALOG) {
      for (const alias of entry.aliases) expect(alias).toBe(alias.toLowerCase());
    }
  });

  it("allows only ts and go as very short aliases, and ties each to its owner", () => {
    const short = CATALOG.flatMap((e) => e.aliases.map((a) => [a, e.id])).filter(
      ([a]) => a.replace(/\W/g, "").length <= 2,
    );
    // Counting them is not enough: a `terraform` entry claiming the alias
    // "ts" would satisfy a bare count and mis-attribute every TypeScript
    // advisory in the briefing.
    expect(short.sort()).toEqual([
      ["go", "go"],
      ["ts", "typescript"],
    ]);
  });

  it("leaves the JavaScript frameworks out of the CISA matchers on purpose", () => {
    // CISA names vendors the way a procurement department does and has never
    // listed a JS framework by name. A matcher here would either never fire
    // or fire on something unrelated; these technologies are reached through
    // the CVE cross-mark in collect.js instead.
    expect(catalogEntry("react").kev).toBeNull();
    expect(catalogEntry("nextjs").kev).toBeNull();
    expect(catalogEntry("typescript").kev).toBeNull();
    // Positive control: the infrastructure CISA does name keeps its matchers.
    expect(catalogEntry("tomcat").kev).toEqual(expect.arrayContaining(["tomcat"]));
  });

  it("has ids unique across the catalog", () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("DEFAULT_WATCHLIST_IDS", () => {
  it("caps the fan-out at a literal value, not just at whatever the symbol says", () => {
    // Both this file and watchlist.test.js compare against the symbol, so
    // MAX_WATCHLIST = 3 would satisfy every other assertion in the suite
    // while quietly briefing a user on a quarter of their stack.
    expect(MAX_WATCHLIST).toBe(12);
  });

  it("names real catalog entries and fits inside the fan-out cap", () => {
    expect(DEFAULT_WATCHLIST_IDS.length).toBeGreaterThan(2);
    expect(DEFAULT_WATCHLIST_IDS.length).toBeLessThanOrEqual(MAX_WATCHLIST);
    for (const id of DEFAULT_WATCHLIST_IDS) expect(catalogEntry(id)).not.toBeNull();
  });
});

describe("catalogEntry", () => {
  it("finds an entry by id", () => {
    expect(catalogEntry("react").label).toBe("React");
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(catalogEntry("cobol")).toBeNull();
    expect(catalogEntry("")).toBeNull();
    expect(catalogEntry(undefined)).toBeNull();
  });
});
