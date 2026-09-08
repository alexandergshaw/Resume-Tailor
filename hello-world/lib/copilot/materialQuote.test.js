// AC-bullet-truncation r10 — AC-B.9, AC-B.12's predicate, AC-S.3, AC-D.6.
// FAILING TESTS, written before `lib/copilot/materialQuote.js` exists.
//
// THE CONTRACT THIS FILE PINS:
//
//   lib/copilot/materialQuote.js exports
//     materialQuote(text, lines) -> { words, line, lineIndex }
//     isEmploymentHeaderLine(line) -> boolean
//
//   and DECLARES NO DATE PATTERN AND NO TITLE VOCABULARY OF ITS OWN — both
//   are imported from lib/resume/parseEmployment.js (AC-B.9). That is asserted
//   against the source text, because it is the thing a second copy quietly
//   re-derives.
//
// THE RATES BELOW ARE r10 §1.4's **PROPOSED** ROW, and this agent re-executed
// every cell of that row at 1515a16 against a reference implementation of
// §1.3 before writing them down. They reproduced exactly, including WHICH
// lines fail: the two accepted header false negatives, the two Set-C ones, and
// the three M3 survivors are all asserted BY NAME rather than by count, so a
// classifier that hits the same totals by failing different lines still goes
// red.
//
// r10 §1.7's residual is asserted as a residual, not hidden: Set B is 8/8 and
// Set D is 4/5 misclassified, and those assertions are here so that a future
// "improvement" that closes them silently — at the cost of the header class —
// shows up as a diff. §2.8's ruling is PRICED against exactly that class.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH = path.join(process.cwd(), "lib/copilot/materialQuote.js");
const SPECIFIER = "./materialQuote.js";

async function load() {
  expect(existsSync(SOURCE_PATH), "lib/copilot/materialQuote.js does not exist yet").toBe(true);
  return import(SPECIFIER);
}
function source() {
  expect(existsSync(SOURCE_PATH), "lib/copilot/materialQuote.js does not exist yet").toBe(true);
  return readFileSync(SOURCE_PATH, "utf8");
}

// ---------------------------------------------------------------- r10 §1.9
const HEADERS_22 = [
  "Senior Engineer, Acme Payments | 2019 - Present",
  "Engineering Manager, Vandelay Industries | March 2019 - Present",
  "Managed Services Engineer, Acme Payments | 2019 - Present",
  "Lead Developer, Initech | 2016 - 2018",
  "Software Engineer II, Hooli Cloud Platform | 01/2020 - 06/2022",
  "Staff Engineer – Globex Corporation, 2018 - 2021",
  "Product Designer (Contract), Umbrella Health, 2017 - 2019",
  "Director of Engineering\tNorthwind Traders\t2015 - 2018",
  "Principal Architect, Stark Industries, San Francisco, CA | 2019 - 2022",
  "Data Analyst, Initech, Remote | 2016 - 2018",
  "SENIOR ENGINEER, ACME PAYMENTS | 2019 - PRESENT",
  "senior engineer, acme payments | 2019 - present",
  "Engineering Manager, Vandelay Industries",
  "Chief Technology Officer, Vandelay Industries | 2020 - Present",
  "Quality Assurance Specialist, Wayne Enterprises | Jan 2018 - Dec 2020",
  "Head of Platform, Soylent Corp | 2019 - 2022",
  "VP of Engineering, Cyberdyne Systems | 2021 - Present",
  "Backend Developer, Tyrell Corporation — 2020",
  "Solutions Architect, Massive Dynamic (2017 - 2020)",
  "Technical Program Manager, Wonka Industries | 2014 - 2016",
  "Senior Staff Software Engineer, Developer Platform, Northwind International | 2018 - Present",
  "Site Reliability Engineer, Aperture Science | 2019 - 2021",
];
const ACCEPTED_HEADER_FN = [
  "senior engineer, acme payments | 2019 - present", // all-lowercase styling
  "Engineering Manager, Vandelay Industries", // no date at all
];

const WORK_33 = [
  "Ran the on-call rotation from 2019 to 2021 across three partner teams",
  "Rebuilt the reconciliation ledger from 2019 to 2021 so the books close overnight",
  "Rewrote the settlement pipeline from 2019 to 2021 with no customer downtime",
  "Oversaw the migration of four regions from 2019 to 2022 without a rollback",
  "Ran the on-call rotation from 2019 to 2021",
  "Spearheaded the fraud review programme from 2020 to 2022",
  "Streamlined vendor onboarding across 2019 - 2021",
  "Refactored the pricing engine over 2019 - 2021",
  "Introduced trunk-based development in 2021 - 2022",
  "Took the checkout rewrite from prototype to production, 2020 - 2022",
  "Negotiated the vendor contract renewal, 2019 - 2021",
  "Chaired the architecture review board from 2018 - 2020",
  "Partnered with Finance and Legal on SOX controls, 2020 - 2022",
  "Led the payments migration and cut deployment time by 40%",
  "Built and scaled the settlement service across three regions",
  "Migrated the monolith to Kubernetes with zero downtime",
  "Mentored four engineers on the billing service and ran the on-call rotation",
  "Reduced p99 latency on the checkout path from 900ms to 120ms",
  "Owned the release process from 2019 onward and reduced rollback rate by 60%",
  "Between 2018 and 2020 I rewrote the settlement pipeline end to end",
  "Customer churn fell by a third under the retention programme, 2020 - 2022",
  "The rate limiter I owned held p99 under 80ms through 2021",
  "Designed the developer platform's build cache and cut CI time in half",
  "Grew the platform team from four engineers to eleven",
  "Shipped the mobile checkout rewrite with no customer-visible downtime",
  "Automated the release pipeline so deploys stopped needing a human",
  "Improved onboarding so a new hire ships on day two",
  "Cut cloud spend by 30% by rightsizing the fleet",
  "Delivered the SOX audit evidence package two weeks early",
  "Skills: React, Node.js, AWS, Kubernetes, PostgreSQL",
  "I am applying for this role because I want to work on developer tooling",
  "Experience",
  "the reconciliation ledger we rebuilt now closes the books in under an hour every night",
];

const SET_A_12 = [
  "Led Payments Platform Engineering (2019)",
  "Built Acme Checkout, Billing and Settlement, 2019 - 2021",
  "Drove Northwind Logistics Modernisation, 2018 - 2020",
  "Owned Globex Trust and Safety Tooling, 2020 - 2022",
  "Shipped Initech Mobile Checkout, 2017 - 2019",
  "Scaled Hooli Search Infrastructure, 2019 - 2022",
  "Launched Umbrella Health Provider Portal, 2018 - 2021",
  "Migrated Stark Industries Billing, 2020 - 2022",
  "Designed Wayne Enterprises Fraud Review, 2019 - 2021",
  "Delivered Vandelay Import Compliance, 2017 - 2020",
  "Automated Soylent Supply Chain Reporting, 2019 - 2021",
  "Created Cyberdyne Model Evaluation Harness, 2020 - 2023",
];

const SET_B_8 = [
  "Managed Engineering, Design and Product Teams, 2019 - 2021",
  "Led Developer Experience, Build and Release, 2020 - 2022",
  "Hired Engineers, Designers and Analysts, 2018 - 2021",
  "Owned Sales Engineering, Support and Onboarding | 2019 - 2022",
  "Coached Principal Engineers, Managers and Leads, 2020 - 2023",
  "Ran Operations, Support and Success, 2017 - 2019",
  "Built Developer Tooling, CI and Release Infrastructure, 2020 - 2022",
  "Grew Platform Engineering, SRE and Security, 2018 - 2022",
];

const SET_C_9 = [
  "Managing Director, Northwind Capital Partners | 2018 - 2022",
  "Engineering Lead – Payments, Acme Corporation, 2019 - 2022",
  "Head of Data, Globex Analytics | 2017 - 2020",
  "Founding Engineer, Initech Labs | 2015 - 2018",
  "Interim Chief Operating Officer, Soylent Corp | 2021 - 2022",
  "Research Scientist, Aperture Science Laboratories | 2016 - 2019",
  "Growth Marketer, Wonka Industries | 2019 - 2021",
  "Deputy General Counsel, Massive Dynamic | 2018 - 2021",
  "Barista, Central Perk | 2013 - 2015",
];
const ACCEPTED_C_FN = [
  "Deputy General Counsel, Massive Dynamic | 2018 - 2021", // "counsel" not in the vocabulary
  "Barista, Central Perk | 2013 - 2015", // "barista" not in the vocabulary
];

const SET_D_5 = [
  "Ran Operations, Support and Success across three regions, 2017 - 2019",
  "Oversaw Engineering, Design and Research, 2019 - 2022",
  "Head of Design work for Acme, Globex and Initech, 2018 - 2021",
  "Interim Engineering Manager for Payments and Billing, 2020 - 2021",
  "Drove Sales Engineering, Support and Renewals, 2019 - 2022",
];

const SET_M1_6 = [
  "Engineer, Acme | 2019 - 2021",
  "Developer, Hooli | 2018 - 2020",
  "Manager, Globex | 2017 - 2019",
  "Analyst, Initech | 2016 - 2018",
  "CTO, Vandelay | 2020 - Present",
  "Freelance Consultant | 2015 - 2018",
];

const SET_M3_6 = [
  "Reduced Overhead, Waste and Rework, 2019 - 2021",
  "Cut Overhead Costs, Vendor Spend and Travel | 2020 - 2022",
  "Drove Headcount Planning, Budgeting and Forecasting, 2018 - 2021",
  "Improved Lead Times, Throughput and Quality | 2019 - 2022",
  "Tracked Sales Pipeline, Renewals and Churn, 2017 - 2020",
  "Ran Operations Reviews, Planning and Retros | 2019 - 2021",
];
// r10 §1.5: the anchor removes the three that were substring artifacts; the
// three that survive are genuinely Set B — whole job words in the head.
const M3_SURVIVORS = [
  "Improved Lead Times, Throughput and Quality | 2019 - 2022",
  "Tracked Sales Pipeline, Renewals and Churn, 2017 - 2020",
  "Ran Operations Reviews, Planning and Retros | 2019 - 2021",
];

describe("AC-B.9 — the module owns the predicate and borrows the primitives", () => {
  it("exports both halves", async () => {
    const m = await load();
    expect(typeof m.isEmploymentHeaderLine).toBe("function");
    expect(typeof m.materialQuote).toBe("function");
  });

  it("declares NO date pattern and NO title vocabulary of its own", () => {
    const src = source();
    // A second copy of either is exactly what drifts. Both must be imports.
    expect(src).toMatch(/from\s+["']@?\/?.*resume\/parseEmployment(?:\.js)?["']/);
    expect(src).toMatch(/headerDateSpan/);
    expect(src).toMatch(/TITLE_KEYWORDS_RE/);
    // No re-declared year/date pattern, no re-typed job-noun alternation.
    expect(src, "materialQuote.js must not declare its own year pattern").not.toMatch(/\\d\{4\}/);
    expect(src, "materialQuote.js must not re-declare the job vocabulary").not.toMatch(/engineer\|developer\|manager/i);
  });
});

describe("AC-B.12's predicate — r10 §1.4's PROPOSED row, re-executed at 1515a16", () => {
  const rates = async () => {
    const { isEmploymentHeaderLine } = await load();
    const h = (lines) => lines.filter((l) => isEmploymentHeaderLine(l));
    const miss = (lines) => lines.filter((l) => !isEmploymentHeaderLine(l));
    return { h, miss, isEmploymentHeaderLine };
  };

  it("FP 0 of 33 on the work set — the whole reason the rebuild happened", async () => {
    const { h } = await rates();
    expect(h(WORK_33), `work lines misread as headers:\n${h(WORK_33).join("\n")}`).toEqual([]);
  });

  it("FN 2 of 22 on the header set, and they are the TWO r10 accepts BY NAME", async () => {
    const { miss } = await rates();
    expect(miss(HEADERS_22).sort()).toEqual([...ACCEPTED_HEADER_FN].sort());
  });

  it("FP 0 of 12 on the proper-noun-dense class — this is what conjunct (4) buys", async () => {
    const { h } = await rates();
    expect(h(SET_A_12), `Set A misread:\n${h(SET_A_12).join("\n")}`).toEqual([]);
  });

  it("M1 6 of 6 — the top-frequency <Title>, <Employer> | <dates> shape (r10 §1.5)", async () => {
    const { miss } = await rates();
    // r8's `null >= 0.8` rejected all six. Conjunct (5) must ABSTAIN, not reject.
    expect(miss(SET_M1_6), `short headers rejected:\n${miss(SET_M1_6).join("\n")}`).toEqual([]);
  });

  it("M3 3 of 6 — the anchor removes exactly the three substring artifacts", async () => {
    const { h } = await rates();
    expect(h(SET_M3_6).sort()).toEqual([...M3_SURVIVORS].sort());
  });

  it("FN 2 of 9 on Set C, named — this is what conjunct (3)'s vocabulary COSTS", async () => {
    const { miss } = await rates();
    expect(miss(SET_C_9).sort()).toEqual([...ACCEPTED_C_FN].sort());
  });

  it("RESIDUAL, asserted so it cannot be closed silently: Set B 8/8, Set D 4/5", async () => {
    const { h } = await rates();
    // r10 §1.7/§2.8: these are structurally inseparable without a verb
    // detector, and AC-B.16's measured cost (+2 to +6 words per cell) is
    // priced against exactly this class. Pinning it means a change that
    // closes it — or widens it — is visible rather than incidental.
    expect(h(SET_B_8)).toEqual(SET_B_8);
    // The one Set-D line that escapes, named: its head carries a lowercase
    // "across three regions" tail, so conjunct (5) scores it 0.5 and rejects.
    // Naming it rather than counting to 4 means a classifier that hits 4 by
    // failing a DIFFERENT line still goes red.
    expect(h(SET_D_5).length).toBe(4);
    expect(h(SET_D_5)).not.toContain("Ran Operations, Support and Success across three regions, 2017 - 2019");
  });

  it("conjunct (5) reads a token's FIRST LETTER, not its first character (r10 §1.6)", async () => {
    const { isEmploymentHeaderLine } = await rates();
    // "(Contract)," fails /^[A-Z]/ and scores the head 0.75 -> rejected.
    expect(isEmploymentHeaderLine("Product Designer (Contract), Umbrella Health, 2017 - 2019")).toBe(true);
  });

  it("conjunct (2) — the date must be TERMINAL — is actually wired, not merely declared", async () => {
    const { isEmploymentHeaderLine } = await rates();
    // NOTE FOR THE IMPLEMENTER. On r10 §1.9's own 106 lines conjunct (2) is
    // MARGINALLY REDUNDANT: this agent measured that disabling it moves no
    // rate on any of the six sets, because every probe line it would reject
    // is already rejected by conjunct (3) or (5). r10 §1.3's claim that it
    // "rejects eight of the thirteen r6 false positives on its own" is true in
    // ISOLATION and zero at the margin. The pair below is therefore
    // constructed to isolate it: an identical head, title-cased and naming a
    // job, with real prose continuing past the date.
    expect(isEmploymentHeaderLine("Senior Engineer, Acme Payments | 2019 - 2021 before moving to Globex")).toBe(false);
    expect(isEmploymentHeaderLine("Senior Engineer, Acme Payments | 2019 - 2021")).toBe(true);
    // ...and a tail of <= MAX_HEADER_TAIL_WORDS is still a header (a location
    // suffix is the ordinary case), so this is not a "no tail at all" rule.
    expect(isEmploymentHeaderLine("Data Analyst, Initech | 2016 - 2018, Remote")).toBe(true);
    expect(isEmploymentHeaderLine("Ran the on-call rotation from 2019 to 2021 across three partner teams")).toBe(false);
  });

  it("strips a leading bullet marker before judging (cleanLine:124's strip)", async () => {
    const { isEmploymentHeaderLine } = await rates();
    expect(isEmploymentHeaderLine("• Senior Engineer, Acme Payments | 2019 - Present")).toBe(true);
    expect(isEmploymentHeaderLine("- Lead Developer, Initech | 2016 - 2018")).toBe(true);
  });

  it("AC-D.6 — a header CLAMPED past 140 characters is invisible, and that is recorded", async () => {
    const { isEmploymentHeaderLine } = await rates();
    const raw =
      "Senior Staff Software Engineer, Developer Platform and Release Infrastructure, Northwind International Logistics Holdings Limited | 2018 - Present";
    expect(raw.length).toBeGreaterThan(140);
    expect(isEmploymentHeaderLine(raw)).toBe(true);
    // The clamped form loses its date and therefore its verdict. r10 §9
    // states this as a recorded limitation rather than a fixed defect; it is
    // asserted so nobody writes the unconditional invariant r7 wrote, which
    // was false on the corpus it was asserted over.
    const clamped = `${raw.slice(0, 140).trim()}…`;
    expect(isEmploymentHeaderLine(clamped)).toBe(false);
  });

  it("is total on degenerate input", async () => {
    const { isEmploymentHeaderLine } = await rates();
    for (const v of ["", "  ", null, undefined, "Experience"]) {
      expect(() => isEmploymentHeaderLine(v)).not.toThrow();
      expect(isEmploymentHeaderLine(v)).toBe(false);
    }
  });
});

describe("AC-S.3 — materialQuote cannot be satisfied by the template's own words", () => {
  const RESUME_LINES = [
    "Experience",
    "Senior Engineer, Acme Payments | 2019 - Present",
    "Led the payments migration and cut deployment time by 40%",
    "Migrated the monolith to Kubernetes with zero downtime",
    "Skills: React, Node.js, AWS, Kubernetes, PostgreSQL",
  ];

  it("returns the longest verbatim span, its line, and that line's index", async () => {
    const { materialQuote } = await load();
    const q = materialQuote("led the payments migration and cut deployment time by 40%", RESUME_LINES);
    expect(q.words).toBeGreaterThanOrEqual(4);
    expect(q.line).toBe("Led the payments migration and cut deployment time by 40%");
    expect(q.lineIndex).toBe(2);
  });

  it("scores ZERO for the two strings r10 §5's own execution caught", async () => {
    const { materialQuote } = await load();
    // Four of the six matched tokens were the TEMPLATE's fixed prose. The
    // metric is computed against the SLOT VALUE only, so a point whose only
    // overlap is its own scaffold has no span at all.
    expect(
      materialQuote("hands-on experience with Distributed Systems, Node.js, PostgreSQL", RESUME_LINES).words,
    ).toBe(0);
  });

  it("scores ZERO against a header line — headers are OUT of the source set", async () => {
    const { materialQuote } = await load();
    const q = materialQuote("senior Engineer, Acme Payments | 2019 - Present", RESUME_LINES);
    expect(q.words, "an employment header must not be able to ground a point").toBe(0);
    expect(q.line).toBe("");
  });

  it("requires a run of at least GROUNDED_SPAN_MIN_WORDS, and does not stitch across lines", async () => {
    const { materialQuote } = await load();
    // Three tokens is below the floor.
    expect(materialQuote("cut deployment time", RESUME_LINES).words).toBe(0);
    // A run assembled from two different lines is not a quote of either:
    // "payments migration and" (3 tokens of line 2) + "Kubernetes with zero"
    // (3 tokens of line 3). Neither reaches 4 inside ONE line.
    expect(materialQuote("payments migration and Kubernetes with zero", RESUME_LINES).words).toBe(0);
    // ...and the same tokens DO ground when they really are one line's run.
    expect(materialQuote("the payments migration and cut", RESUME_LINES).words).toBeGreaterThanOrEqual(4);
  });

  it("is total on empty input", async () => {
    const { materialQuote } = await load();
    for (const args of [["", RESUME_LINES], ["anything", []], [null, null]]) {
      expect(() => materialQuote(...args)).not.toThrow();
      expect(materialQuote(...args).words).toBe(0);
    }
  });
});
