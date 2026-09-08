// AC-bullet-truncation r10 — AC-B.15 and AC-B.9's vocabulary export.
// FAILING TESTS, written before `headerDateSpan` / `TITLE_KEYWORDS_RE` exist.
//
// THE CONTRACT THIS FILE PINS:
//
//   lib/resume/parseEmployment.js gains TWO sibling exports and CHANGES NOTHING:
//     headerDateSpan(line) -> { start, end, matched, via } | null
//         `start` and `end` are CHARACTER OFFSETS INTO `line` (numbers).
//     TITLE_KEYWORDS_RE    -> the existing 48-word alternation, WORD-ANCHORED,
//                             with the (?:s|ing)? inflections.
//     extractDateRange     -> UNCHANGED. Still {start, end, matched} as date
//                             STRINGS. Five callers depend on that.
//
// WHY THE OFFSETS ARE THE WHOLE POINT (r10 §1.2). r8's header predicate sliced
// `s.slice(0, d.index)` and `s.slice(d.end)` off `extractDateRange`'s return.
// That object has no `index`, and its `end` is a STRING. Both defects are
// pinned below as characterisation tests, because they are the reason this
// export exists — and because r9's own account of the second one was wrong in
// a way only execution catches:
//
//     "Engineer, Acme | 2019 - 2021".slice(extractDateRange(...).end)  ->  ""
//         (ToIntegerOrInfinity("2021") = 2021, past the end of the string)
//     "Senior Engineer, Acme | 2019 - Present".slice(...)  ->  the whole line
//         (ToIntegerOrInfinity("Present") = NaN -> 0)
//
// A predicate built on the first silently satisfies its own "the date is
// terminal" conjunct for free on every bare-year end date.

import { describe, it, expect } from "vitest";
import * as parseEmployment from "@/lib/resume/parseEmployment.js";
import { extractDateRange } from "@/lib/resume/parseEmployment.js";

// r10 §1.9's 106 probe lines, verbatim. The tab-delimited header is written
// with an explicit \t so no editor can eat it.
const PROBE_106 = [
  // 22 employment headers
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
  // 33 work lines
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
  // Set A — 12 proper-noun-dense achievements
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
  // Set B — 8
  "Managed Engineering, Design and Product Teams, 2019 - 2021",
  "Led Developer Experience, Build and Release, 2020 - 2022",
  "Hired Engineers, Designers and Analysts, 2018 - 2021",
  "Owned Sales Engineering, Support and Onboarding | 2019 - 2022",
  "Coached Principal Engineers, Managers and Leads, 2020 - 2023",
  "Ran Operations, Support and Success, 2017 - 2019",
  "Built Developer Tooling, CI and Release Infrastructure, 2020 - 2022",
  "Grew Platform Engineering, SRE and Security, 2018 - 2022",
  // Set C — 9
  "Managing Director, Northwind Capital Partners | 2018 - 2022",
  "Engineering Lead – Payments, Acme Corporation, 2019 - 2022",
  "Head of Data, Globex Analytics | 2017 - 2020",
  "Founding Engineer, Initech Labs | 2015 - 2018",
  "Interim Chief Operating Officer, Soylent Corp | 2021 - 2022",
  "Research Scientist, Aperture Science Laboratories | 2016 - 2019",
  "Growth Marketer, Wonka Industries | 2019 - 2021",
  "Deputy General Counsel, Massive Dynamic | 2018 - 2021",
  "Barista, Central Perk | 2013 - 2015",
  // Set D — 5
  "Ran Operations, Support and Success across three regions, 2017 - 2019",
  "Oversaw Engineering, Design and Research, 2019 - 2022",
  "Head of Design work for Acme, Globex and Initech, 2018 - 2021",
  "Interim Engineering Manager for Payments and Billing, 2020 - 2021",
  "Drove Sales Engineering, Support and Renewals, 2019 - 2022",
  // Set M1 — 6
  "Engineer, Acme | 2019 - 2021",
  "Developer, Hooli | 2018 - 2020",
  "Manager, Globex | 2017 - 2019",
  "Analyst, Initech | 2016 - 2018",
  "CTO, Vandelay | 2020 - Present",
  "Freelance Consultant | 2015 - 2018",
  // Set M2 — 5
  "Senior Engineer, thoughtbot | 2019 - 2021",
  "Principal Designer, basecamp | 2017 - 2020",
  "Staff Engineer, van der Berg Systems | 2018 - 2021",
  "Senior Platform Engineer, Developer Tools, thoughtbot Remote | 2019 - 2022",
  "Principal Software Engineer, Release Infrastructure, basecamp | 2018 - 2021",
  // Set M3 — 6
  "Reduced Overhead, Waste and Rework, 2019 - 2021",
  "Cut Overhead Costs, Vendor Spend and Travel | 2020 - 2022",
  "Drove Headcount Planning, Budgeting and Forecasting, 2018 - 2021",
  "Improved Lead Times, Throughput and Quality | 2019 - 2022",
  "Tracked Sales Pipeline, Renewals and Churn, 2017 - 2020",
  "Ran Operations Reviews, Planning and Retros | 2019 - 2021",
];

describe("AC-B.15 — headerDateSpan exports CHARACTER OFFSETS", () => {
  it("is exported", () => {
    expect(typeof parseEmployment.headerDateSpan, "parseEmployment.js must export headerDateSpan").toBe("function");
  });

  it("the probe set is the one r10 §1.9 wrote out: 106 lines", () => {
    expect(PROBE_106.length).toBe(106);
    expect(new Set(PROBE_106).size).toBe(106);
  });

  it("slicing the line by the span reproduces `matched` — every line, no exceptions", () => {
    const { headerDateSpan } = parseEmployment;
    let ranges = 0;
    const bad = [];
    for (const line of PROBE_106) {
      const span = headerDateSpan(line);
      if (span === null) continue;
      if (span.via === "range") ranges += 1;
      expect(typeof span.start, `start must be a number on: ${line}`).toBe("number");
      expect(typeof span.end, `end must be a number on: ${line}`).toBe("number");
      expect(typeof span.matched).toBe("string");
      expect(span.end).toBeGreaterThan(span.start);
      if (line.slice(span.start, span.end) !== span.matched) bad.push(line);
    }
    expect(bad, `spans that do not reproduce their own matched text:\n${bad.join("\n")}`).toEqual([]);
    // NOT VACUOUS: a `headerDateSpan` returning null for everything satisfies
    // the invariant above trivially. r10 §1.2 executed "lines carrying a
    // DATE_RANGE_RE match = 84" over exactly this probe set; this agent
    // re-executed it at 1515a16 and got 84. The single-token branch adds two
    // more (asserted by name in the next case) rather than being pinned by a
    // total, because §1.3 states that branch's set-off vocabulary rather than
    // a count.
    expect(ranges, "probe lines whose span comes from DATE_RANGE_RE").toBe(84);
  });

  it("locates a RANGE at its true index, not at 0, and never at a decoy earlier in the line", () => {
    const { headerDateSpan } = parseEmployment;
    const line = "Senior Engineer, Acme Payments | 2019 - Present";
    const span = headerDateSpan(line);
    expect(span.start).toBe(33);
    expect(span.matched).toBe("2019 - Present");
    expect(line.slice(span.start, span.end)).toBe("2019 - Present");
    // The leftmost-match property r10 §1.2 relies on.
    const twice = "Ran the rotation 2019 - 2021, then again 2019 - 2021";
    expect(headerDateSpan(twice).start).toBe(17);
  });

  it("locates a SINGLE terminal date token, which no range regex can reach", () => {
    const { headerDateSpan } = parseEmployment;
    // r10 §1.9 line 18. Without this branch the line is a false negative.
    const line = "Backend Developer, Tyrell Corporation — 2020";
    const span = headerDateSpan(line);
    expect(span, "a single terminal date must be located").not.toBeNull();
    expect(line.slice(span.start, span.end)).toBe(span.matched);
    expect(span.matched).toBe("2020");
    expect(span.via).toBe("token");
  });

  it("reports WHICH branch found the span, so conjunct (2) can be reasoned about", () => {
    const { headerDateSpan } = parseEmployment;
    expect(headerDateSpan("Senior Engineer, Acme Payments | 2019 - Present").via).toBe("range");
    expect(headerDateSpan("Engineering Manager, Vandelay Industries")).toBeNull();
  });

  it("returns null rather than throwing on degenerate input", () => {
    const { headerDateSpan } = parseEmployment;
    for (const v of ["", "   ", null, undefined, "Experience"]) {
      expect(() => headerDateSpan(v)).not.toThrow();
      expect(headerDateSpan(v)).toBeNull();
    }
  });
});

describe("AC-B.15 — extractDateRange is NOT changed (five callers depend on it)", () => {
  it("still returns date STRINGS and still carries no offset", () => {
    const d = extractDateRange("Senior Engineer, Acme Payments | 2019 - Present");
    expect(Object.keys(d).sort()).toEqual(["end", "matched", "start"]);
    expect(d).toEqual({ start: "2019", end: "Present", matched: "2019 - Present" });
    expect(typeof d.end).toBe("string");
    expect(Object.prototype.hasOwnProperty.call(d, "index")).toBe(false);
  });

  it("CHARACTERISES r10 §1.2's trap: slicing by extractDateRange's `end` is nonsense", () => {
    // This is why headerDateSpan exists. If a future edit makes `end` numeric,
    // this test goes red and the five existing callers are the real casualty.
    const numeric = "Engineer, Acme | 2019 - 2021";
    expect(numeric.slice(extractDateRange(numeric).end)).toBe("");
    const present = "Senior Engineer, Acme | 2019 - Present";
    expect(present.slice(extractDateRange(present).end)).toBe(present);
  });
});

describe("AC-B.9 — the title vocabulary is exported ANCHORED, and declared once", () => {
  it("exports TITLE_KEYWORDS_RE", () => {
    expect(parseEmployment.TITLE_KEYWORDS_RE, "parseEmployment.js must export TITLE_KEYWORDS_RE").toBeInstanceOf(RegExp);
  });

  it("is WORD-ANCHORED — r10 §1.5's M3 class stops being a substring hit", () => {
    const re = parseEmployment.TITLE_KEYWORDS_RE;
    // The three M3 lines the anchor buys back: `head` inside *Overhead*,
    // `Head` inside *Headcount*.
    expect(re.test("Reduced Overhead, Waste and Rework")).toBe(false);
    expect(re.test("Cut Overhead Costs, Vendor Spend and Travel")).toBe(false);
    expect(re.test("Drove Headcount Planning, Budgeting and Forecasting")).toBe(false);
  });

  it("keeps the (?:s|ing)? inflections a job noun actually takes", () => {
    const re = parseEmployment.TITLE_KEYWORDS_RE;
    for (const w of ["Engineer", "Engineers", "Engineering", "Manager", "Managers", "Designer", "Designers", "Lead", "Sales", "Operations", "Head"]) {
      expect(re.test(w), `TITLE_KEYWORDS_RE must match ${w}`).toBe(true);
    }
  });

  it("carries the whole 48-word vocabulary, not a new shorter one", () => {
    const re = parseEmployment.TITLE_KEYWORDS_RE;
    for (const w of ["director", "analyst", "scientist", "consultant", "architect", "specialist", "coordinator", "associate", "officer", "president", "founder", "owner", "technician", "teacher", "professor", "instructor", "nurse", "accountant", "recruiter", "strategist", "marketer", "writer", "editor", "producer", "supervisor", "representative", "clerk", "assistant", "advisor", "adviser", "principal", "vp", "cto", "ceo", "cfo", "coo", "programmer"]) {
      expect(re.test(w), `TITLE_KEYWORDS_RE must match ${w}`).toBe(true);
    }
    // ...and it is not so wide it matches ordinary prose.
    for (const w of ["counsel", "barista", "monolith", "rotation", "ledger"]) {
      expect(re.test(w), `TITLE_KEYWORDS_RE must not match ${w}`).toBe(false);
    }
  });
});
