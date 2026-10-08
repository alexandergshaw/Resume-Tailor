// N143 seam 3 (T4 parser/constants, T5 the posting-figure guard). Falsifier
// for lib/copilot/projectExampleGen.js, which does not exist on HEAD — RED at
// the import line until the module lands.
//
// CONTRACTS pinned here (design r2 §1.1/§3, plan §E), stated so the implementer
// knows exactly what greens these:
//   • parsePoolResponse(rawText) -> { projects: Entry[] }   (rawText = model JSON string)
//   • parseOnTheSpotResponse(rawText) -> Entry | null
//   • stripPostingFigures(entry, posting) -> Entry | null
//   • Entry = { competency, domain, title, bullets: string[], hypothetical: true }
//   • constants: PROJECT_POOL_SIZE, POOL_BULLETS_MAX, POOL_BULLET_MAX_WORDS,
//     POOL_TITLE_MAX_WORDS
//
// The parser REJECTS (drops the entry), never truncates: truncating an invented
// figure to fit a cap is a worse lie than dropping the whole example (UX A3).
// The number guard reuses lib/feed/salary.js (parseSalary/resolvePostingSalary)
// for the salary/comp half (plan §E) and must KEEP invented small integers and
// percentages (AC-15), which is the control that stops it over-stripping.

import { describe, it, expect } from "vitest";
import {
  parsePoolResponse,
  parseOnTheSpotResponse,
  stripPostingFigures,
  PROJECT_POOL_SIZE,
  POOL_BULLETS_MAX,
  POOL_BULLET_MAX_WORDS,
  POOL_TITLE_MAX_WORDS,
} from "./projectExampleGen.js";

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

// A valid entry as the model is asked to emit it.
const rawEntry = (over = {}) => ({
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise sharply", "Mean time to ack improved"],
  ...over,
});

const poolJson = (entries) => JSON.stringify({ projects: entries });

describe("constants are named and owner-tunable (AC-5 / A3)", () => {
  it("exposes the pool size and length caps as numbers, not prompt literals", () => {
    expect(PROJECT_POOL_SIZE).toBe(5);
    expect(typeof POOL_BULLETS_MAX).toBe("number");
    expect(typeof POOL_BULLET_MAX_WORDS).toBe("number");
    expect(typeof POOL_TITLE_MAX_WORDS).toBe("number");
    expect(POOL_BULLETS_MAX).toBeGreaterThanOrEqual(2);
  });
});

describe("parsePoolResponse — bullets are a validated ARRAY, hypothetical forced (T4 / AC-3)", () => {
  it("[positive control] keeps a well-formed entry and forces hypothetical:true", () => {
    // Written first: the parser MUST pass a real entry through, or every
    // rejection below is vacuous.
    const { projects } = parsePoolResponse(poolJson([rawEntry()]));
    expect(projects).toHaveLength(1);
    expect(projects[0].competency).toBe("incident response");
    expect(Array.isArray(projects[0].bullets)).toBe(true);
    expect(projects[0].bullets).toHaveLength(2);
    expect(projects[0].hypothetical).toBe(true);
  });

  it("forces hypothetical:true even when the model omits it or sends false", () => {
    for (const bad of [undefined, false, "yes", null]) {
      const { projects } = parsePoolResponse(poolJson([rawEntry({ hypothetical: bad })]));
      expect(projects).toHaveLength(1);
      expect(projects[0].hypothetical).toBe(true);
    }
  });

  it("[blocker-direction control] REJECTS an entry whose bullets is a STRING, never splits it", () => {
    // The named blocker (design r2 §1.1): a bullets built from string.split(...)
    // breaks on "$1.2M"/"e.g." A string bullets field is not an array and the
    // entry must be dropped, not salvaged by splitting.
    const { projects } = parsePoolResponse(
      poolJson([rawEntry({ bullets: "First claim. Second claim. $1.2M saved." })]),
    );
    expect(projects).toHaveLength(0);
  });

  it("rejects an entry with absent, empty, over-count or over-length bullets", () => {
    const cases = [
      rawEntry({ bullets: undefined }),
      rawEntry({ bullets: [] }),
      rawEntry({ bullets: Array.from({ length: POOL_BULLETS_MAX + 1 }, () => "a short bullet") }),
      rawEntry({ bullets: ["ok one here", words(POOL_BULLET_MAX_WORDS + 1)] }),
    ];
    for (const bad of cases) {
      const { projects } = parsePoolResponse(poolJson([bad]));
      expect(projects, JSON.stringify(bad.bullets)).toHaveLength(0);
    }
  });

  it("rejects an entry whose title exceeds POOL_TITLE_MAX_WORDS (rejected, not truncated)", () => {
    const { projects } = parsePoolResponse(poolJson([rawEntry({ title: words(POOL_TITLE_MAX_WORDS + 1) })]));
    expect(projects).toHaveLength(0);
  });

  it("returns pairwise-distinct competencies — a duplicate does not survive twice (AC-5)", () => {
    const dup = [
      rawEntry({ competency: "incident response", title: "a" }),
      rawEntry({ competency: "incident response", title: "b" }),
      rawEntry({ competency: "capacity planning", title: "c" }),
    ];
    const { projects } = parsePoolResponse(poolJson(dup));
    const competencies = projects.map((p) => p.competency);
    expect(new Set(competencies).size).toBe(competencies.length);
  });

  it("never throws on malformed model output — returns an empty pool", () => {
    for (const junk of ["not json", "", "{}", "null", JSON.stringify({ projects: "nope" })]) {
      expect(() => parsePoolResponse(junk)).not.toThrow();
      const { projects } = parsePoolResponse(junk);
      expect(Array.isArray(projects)).toBe(true);
    }
  });
});

describe("parseOnTheSpotResponse — a single validated entry (T4 / AC-10)", () => {
  it("[positive control] returns one hypothetical entry", () => {
    const out = parseOnTheSpotResponse(JSON.stringify(rawEntry()));
    expect(out).not.toBeNull();
    expect(out.hypothetical).toBe(true);
    expect(Array.isArray(out.bullets)).toBe(true);
  });

  it("returns null for a malformed or invalid entry, never a half-built one", () => {
    for (const junk of ["not json", JSON.stringify(rawEntry({ bullets: "split me on sentences" }))]) {
      expect(parseOnTheSpotResponse(junk)).toBeNull();
    }
  });
});

describe("stripPostingFigures — strips posting comp, KEEPS invented small numbers (T5 / AC-15)", () => {
  // A posting whose compensation band parseSalary resolves to {120000, 150000}.
  const posting = { description: "About the role. Compensation: $120k–$150k per year, plus equity." };

  it("[KEEP control, written first] leaves invented small integers and percentages untouched", () => {
    // The over-strip failure direction: if the guard collects bare integers or
    // percentages it would gut legitimate story figures. This MUST survive.
    const kept = stripPostingFigures(
      {
        competency: "incident response",
        domain: "SRE",
        title: "Rebuilt the paging rotation",
        bullets: ["Cut deploys from 5 to 1 per week", "Raised pass rate 61% to 78% over two terms"],
        hypothetical: true,
      },
      posting,
    );
    expect(kept).not.toBeNull();
    expect(kept.bullets).toHaveLength(2);
    expect(kept.bullets.join(" ")).toContain("5 to 1");
    expect(kept.bullets.join(" ")).toContain("61% to 78%");
  });

  it("strips a bullet that echoes the posting's salary band (R-135 regression)", () => {
    const entry = {
      competency: "incident response",
      domain: "SRE",
      title: "Rebuilt the paging rotation",
      bullets: [
        "Cut deploys from 5 to 1 per week",
        "Raised pass rate 61% to 78% over two terms",
        "Negotiated a budget of $120,000 for the migration",
      ],
      hypothetical: true,
    };
    const out = stripPostingFigures(entry, posting);
    expect(out).not.toBeNull();
    // The colliding figure is gone; the two legitimate bullets remain.
    const joined = out.bullets.join(" ");
    expect(joined).not.toContain("120,000");
    expect(joined).not.toMatch(/\$120[,.]?0?00/);
    expect(out.bullets).toHaveLength(2);
    expect(joined).toContain("5 to 1");
  });

  it("drops the whole entry when stripping leaves fewer than 2 usable bullets", () => {
    const entry = {
      competency: "incident response",
      domain: "SRE",
      title: "Rebuilt the paging rotation",
      bullets: ["Negotiated a budget of $120,000 for the migration", "Target compensation around $150,000 total"],
      hypothetical: true,
    };
    expect(stripPostingFigures(entry, posting)).toBeNull();
  });

  it("never lets the posting band survive verbatim in the title", () => {
    const entry = {
      competency: "incident response",
      domain: "SRE",
      title: "A $120,000 incident-response rebuild",
      bullets: ["Cut deploys from 5 to 1 per week", "Raised pass rate 61% to 78% over two terms"],
      hypothetical: true,
    };
    const out = stripPostingFigures(entry, posting);
    // Entry still viable on its two clean bullets; the posting figure must not
    // ride through in the title text.
    if (out) expect(out.title).not.toContain("120,000");
  });
});
