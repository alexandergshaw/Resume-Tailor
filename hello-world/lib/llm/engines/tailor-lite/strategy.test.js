import { describe, it, expect } from "vitest";
import { mapSlots } from "./strategy.js";

const keywords = {
  technology: [
    { canonical: "React", score: 9, count: 1 },
    { canonical: "HTML", score: 8, count: 1 },
  ],
  tool_platform: [{ canonical: "Figma", score: 7, count: 1 }],
  domain: [{ canonical: "Web Development", score: 7, count: 1 }],
  soft_skill: [{ canonical: "Leadership", score: 5, count: 1 }],
};
const data = { profile: { values: { RANK: "Senior" } } };
const slot = (name, occ = 0) => ({ key: `${name}::${occ}`, name, occurrence: occ });

describe("mapSlots (template strategies)", () => {
  const slots = [
    slot("RANK"),
    slot("JOB_RELEVANT_TECHNOLOGIES"),
    slot("TECHNICAL_CAPABILITIES"),
    slot("2_LINES_OF_COMMA_SEPARATED_SKILLS", 1),
    slot("LIST_OF_3_COURSE_TOPICS_RELEVANT_TO_JOB_POSTING"),
    slot("ACTION"),
    slot("MEASURABLE_IMPACT"),
    slot("PROJECT_TYPE"),
    slot("WIDGET_FROBNICATOR"),
  ];
  const byKey = Object.fromEntries(mapSlots(slots, keywords, data).map((s) => [s.key, s]));

  it("PROFILE comes from profile.json", () => {
    expect(byKey["RANK::0"].strategy).toBe("profile");
    expect(byKey["RANK::0"].value).toBe("Senior");
  });

  it("KEYWORD_JOIN surfaces posting keywords by category", () => {
    expect(byKey["JOB_RELEVANT_TECHNOLOGIES::0"].value).toContain("React"); // technology
    // The opening tech list leads with impressive technologies, then tools.
    expect(byKey["TECHNICAL_CAPABILITIES::0"].value).toContain("React"); // technology
    expect(byKey["TECHNICAL_CAPABILITIES::0"].value).toContain("Figma"); // tool_platform too
    expect(byKey["JOB_RELEVANT_TECHNOLOGIES::0"].value).not.toContain("Figma");
  });

  it("SKILLS rows and COURSE_TOPICS fill non-empty", () => {
    expect(byKey["2_LINES_OF_COMMA_SEPARATED_SKILLS::1"].value.length).toBeGreaterThan(0);
    expect(byKey["LIST_OF_3_COURSE_TOPICS_RELEVANT_TO_JOB_POSTING::0"].value.length).toBeGreaterThan(0);
  });

  it("fragment/project pools fill accomplishment + project slots", () => {
    expect(byKey["ACTION::0"].value.length).toBeGreaterThan(0);
    expect(byKey["MEASURABLE_IMPACT::0"].value.length).toBeGreaterThan(0);
    expect(byKey["PROJECT_TYPE::0"].value.length).toBeGreaterThan(0);
  });

  it("unknown name falls to MANUAL (empty)", () => {
    expect(byKey["WIDGET_FROBNICATOR::0"].strategy).toBe("manual");
    expect(byKey["WIDGET_FROBNICATOR::0"].value).toBe("");
  });

  it("serialAnd joins prose lists with an Oxford 'and'; default stays comma-only", () => {
    const plain = mapSlots([slot("JOB_RELEVANT_TECHNOLOGIES")], keywords, data, { aggressiveness: 3 })[0].value;
    const anded = mapSlots([slot("JOB_RELEVANT_TECHNOLOGIES")], keywords, data, { aggressiveness: 3, serialAnd: true })[0].value;
    expect(plain).not.toMatch(/, and /);
    expect(anded).toMatch(/, and \S/);
  });
});

describe("mapSlots capability lines vary per occurrence", () => {
  // A capability category with more skills than the line shows, so repeats can
  // slide to distinct slices.
  const kw = {
    tool_platform: [
      { canonical: "AWS", score: 9, count: 1 },
      { canonical: "Docker", score: 8, count: 1 },
      { canonical: "Kubernetes", score: 7, count: 1 },
      { canonical: "Git", score: 6, count: 1 },
      { canonical: "Jira", score: 5, count: 1 },
      { canonical: "Jenkins", score: 4, count: 1 },
    ],
  };
  const valueAt = (occ) =>
    mapSlots([slot("TECHNICAL_CAPABILITIES", occ)], kw, { profile: { values: {} } }, { aggressiveness: 3 })[0].value;

  it("first occurrence is the top-k (unchanged), repeats differ", () => {
    const first = valueAt(0);
    const second = valueAt(1);
    const third = valueAt(2);
    expect(first.startsWith("AWS, Docker, Kubernetes")).toBe(true); // top-k unchanged
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });
});

describe("mapSlots areas of emphasis (per-role)", () => {
  const kw = {
    domain: [
      { canonical: "Payments", score: 9, count: 1 },
      { canonical: "Web Development", score: 8, count: 1 },
      { canonical: "Financial Services", score: 7, count: 1 },
      { canonical: "Cloud Computing", score: 6, count: 1 },
      { canonical: "Fraud Detection", score: 5, count: 1 },
    ],
  };
  const emphasis = (occ) =>
    mapSlots([slot("AREAS_OF_EMPHASIS", occ)], kw, { profile: { values: {} } }, { aggressiveness: 3 })[0].value;

  it("keeps each role in the posting's domain but not identical to the others", () => {
    const a = emphasis(0);
    const b = emphasis(1);
    const c = emphasis(2);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    // all drawn from the posting's domain keywords (same domain, related)
    for (const value of [a, b, c]) {
      for (const term of value.split(", ")) {
        expect(kw.domain.some((d) => d.canonical === term)).toBe(true);
      }
    }
  });

  it("uses the focus area's job_emphases for full-time job emphasis when the posting needs that area", () => {
    const data = {
      profile: {
        values: {},
        focus_areas: [
          { name: "Mathematics", match: ["College Algebra", "Precalculus"], subjects: ["College Algebra"], job_emphases: ["Data Analysis", "Mathematical Modeling", "Quantitative Analysis"] },
        ],
      },
    };
    // Any posting that calls for the area (here a math posting) — teaching or not.
    const opts = { aggressiveness: 3, posting: "Instructor needed for College Algebra and Precalculus." };
    const value = mapSlots([slot("AREAS_OF_EMPHASIS", 0)], {}, data, opts)[0].value;
    expect(value).toContain("Data Analysis");
    expect(value).toContain("Mathematical Modeling");

    // A software posting names no area term, so the engineering domains are kept.
    const csValue = mapSlots([slot("AREAS_OF_EMPHASIS", 0)], kw, data, { aggressiveness: 3, posting: "Senior Software Engineer building web apps." })[0].value;
    expect(csValue).not.toContain("Data Analysis");
  });

  it("never lists 'Education' in a job's emphasis or solutions, even for an education posting", () => {
    // An education-sector posting where "Education" outscores the real domains.
    const eduKw = {
      domain: [
        { canonical: "Education", score: 10, count: 3 },
        { canonical: "Web Development", score: 8, count: 1 },
        { canonical: "Payments", score: 6, count: 1 },
      ],
    };
    // The per-role "(Areas of Emphasis)" parenthetical and the
    // "…responsible for {{JOB_RELEVANT_SOLUTIONS}}…" bullet both draw domains
    // from the posting; neither may surface "Education".
    for (const name of ["AREAS_OF_EMPHASIS", "JOB_RELEVANT_SOLUTIONS"]) {
      for (let occ = 0; occ < 4; occ += 1) {
        const value = mapSlots([slot(name, occ)], eduKw, { profile: { values: {} } }, { aggressiveness: 3 })[0].value;
        expect(value.split(", ")).not.toContain("Education");
      }
    }
  });

  it("teaching emphasis defaults to the candidate's default teaching subjects for a non-teaching posting", () => {
    const data = { profile: { values: {}, default_teaching_subjects: ["Web Development", "Software Engineering", "Database Systems"] } };
    // A software posting (no teaching signal): emphasis stays in the authored order.
    const kw2 = { domain: [{ canonical: "Payments", score: 9, count: 1 }, { canonical: "ETL", score: 8, count: 1 }] };
    const teaching = [0, 1].map(
      (occ) => mapSlots([slot("AREA_OF_EMPHASIS", occ)], kw2, data, { aggressiveness: 3, posting: "Senior Software Engineer." })[0].value,
    );
    expect(teaching[0]).toBe("Web Development");
    expect(teaching[1]).toBe("Software Engineering");
    expect(teaching).not.toContain("Payments"); // never a posting domain
  });

  it("leads the adjunct emphasis and course topics with the resolved area's subjects", () => {
    const data = {
      profile: {
        values: {},
        default_teaching_subjects: ["Web Development", "Software Engineering"],
        focus_areas: [
          { name: "Mathematics", match: ["College Algebra", "Precalculus", "Statistics"], subjects: ["College Algebra", "Precalculus", "Statistics"] },
        ],
      },
    };
    const opts = { aggressiveness: 3, posting: "Instructor for College Algebra and Precalculus courses." };
    const emphasis = [0, 1].map(
      (occ) => mapSlots([slot("AREA_OF_EMPHASIS", occ)], {}, data, opts)[0].value,
    );
    expect(emphasis[0]).toBe("College Algebra"); // the area's first subject leads
    expect(emphasis[1]).toBe("Precalculus"); // next subject in the area, not a CS one
    expect(emphasis).not.toContain("Web Development");

    const topics = mapSlots([slot("LIST_OF_3_COURSE_TOPICS_RELEVANT_TO_JOB_POSTING", 0)], {}, data, opts)[0].value;
    expect(topics.startsWith("College Algebra")).toBe(true);
    expect(topics).not.toContain("Web Development");
  });

  it("teaching emphasis falls back to subjects + people skills (never job domains) without a taught list", () => {
    const kw2 = {
      domain: [{ canonical: "Enterprise Integration", score: 9, count: 1 }, { canonical: "ETL", score: 8, count: 1 }],
      technology: [{ canonical: "JavaScript", score: 9, count: 1 }],
      soft_skill: [{ canonical: "Communication", score: 8, count: 1 }],
    };
    const value = mapSlots([slot("AREA_OF_EMPHASIS", 0)], kw2, { profile: { values: {} } }, { aggressiveness: 3 })[0].value;
    expect(["Enterprise Integration", "ETL"]).not.toContain(value);
    expect(["JavaScript", "Communication"]).toContain(value);
  });
});

describe("mapSlots focus-area catering (skills row + summary focus + capability lines)", () => {
  const data = {
    profile: {
      values: {},
      focus_areas: [
        {
          name: "Mathematics",
          match: ["College Algebra", "Precalculus", "Statistics"],
          subjects: ["College Algebra", "Precalculus", "Statistics", "Trigonometry", "Calculus"],
          technical_capabilities: ["SQL", "Data Modeling", "Data Visualization"],
          domain_capabilities: ["Data Analysis", "Statistics", "Mathematical Modeling"],
        },
      ],
    },
  };
  const mathPosting = "Instructor for College Algebra and Precalculus courses.";
  const csKw = { domain: [{ canonical: "Web Development", score: 9, count: 1 }] };
  const csPosting = "Senior Software Engineer building web applications.";

  it("leads the first skills row with the area's subjects when the posting needs the area, domains otherwise", () => {
    const mathRow = mapSlots([slot("2_LINES_OF_COMMA_SEPARATED_SKILLS", 0)], {}, data, { aggressiveness: 3, posting: mathPosting })[0].value;
    expect(mathRow).toContain("College Algebra");

    const csRow = mapSlots([slot("2_LINES_OF_COMMA_SEPARATED_SKILLS", 0)], csKw, data, { aggressiveness: 3, posting: csPosting })[0].value;
    expect(csRow).not.toContain("College Algebra");
    expect(csRow).toContain("Web Development");
  });

  it("ROLE_RELEVANT_FOCUS (summary tail) leads with the area's subjects for a teaching posting, domains otherwise", () => {
    const mathFocus = mapSlots([slot("ROLE_RELEVANT_FOCUS")], {}, data, { aggressiveness: 3, posting: mathPosting })[0].value;
    expect(mathFocus.startsWith("College Algebra")).toBe(true);

    const csFocus = mapSlots([slot("ROLE_RELEVANT_FOCUS")], csKw, data, { aggressiveness: 3, posting: csPosting })[0].value;
    expect(csFocus).not.toContain("College Algebra");
  });

  it("swaps in the area's curated tech/domain capability lines for a teaching posting", () => {
    const tech = mapSlots([slot("TECHNICAL_CAPABILITIES")], {}, data, { aggressiveness: 3, posting: mathPosting })[0].value;
    expect(tech).toContain("Data Modeling");
    const dom = mapSlots([slot("DOMAIN_CAPABILITIES")], {}, data, { aggressiveness: 3, posting: mathPosting })[0].value;
    expect(dom).toContain("Mathematical Modeling");

    // A software posting ignores the area and uses the candidate's real skills.
    const csTech = mapSlots([slot("TECHNICAL_CAPABILITIES")], csKw, data, { aggressiveness: 3, posting: csPosting })[0].value;
    expect(csTech).not.toContain("Data Modeling");
  });
});

describe("mapSlots leadership capabilities (no summary redundancy)", () => {
  // The summary sentence already says "leading cross-functional teams through …",
  // so these echoing capabilities must be suppressed.
  const kw = {
    soft_skill: [
      { canonical: "Mentoring", score: 9, count: 1 },
      { canonical: "Cross-Functional Collaboration", score: 8, count: 1 },
      { canonical: "Leadership", score: 7, count: 1 },
      { canonical: "Collaboration", score: 6, count: 1 },
      { canonical: "Project Management", score: 5, count: 1 },
    ],
  };
  const value = mapSlots(
    [slot("LEADERSHIP_CAPABILITIES")],
    kw,
    { profile: { values: {} } },
    { aggressiveness: 3 },
  )[0].value;

  it("drops capabilities that echo 'leading cross-functional teams'", () => {
    expect(value).not.toContain("Leadership");
    expect(value).not.toContain("Cross-Functional Collaboration");
    expect(value).toContain("Mentoring");
  });

  it("does not list the same concept twice", () => {
    const terms = value.split(", ");
    expect(new Set(terms).size).toBe(terms.length);
  });
});

describe("mapSlots skills-row gap insertion (aggressiveness)", () => {
  // Kubernetes is a domain/tool gap the candidate lacks; it should only appear at
  // high aggressiveness, swapped into the matching skills row.
  const kw = { tool_platform: [{ canonical: "Kubernetes", score: 9, count: 1 }] };
  const universe = new Set(["figma", "git", "github", "docker", "aws"]); // lacks Kubernetes
  const skillRow2 = (aggressiveness) =>
    mapSlots(
      [{ key: "2_LINES_OF_COMMA_SEPARATED_SKILLS::2", name: "2_LINES_OF_COMMA_SEPARATED_SKILLS", occurrence: 2 }],
      kw,
      { profile: { values: {} } },
      { aggressiveness, universe },
    )[0].value;

  it("does not fabricate at aggressiveness 1", () => {
    expect(skillRow2(1)).not.toContain("Kubernetes");
  });

  it("swaps in the gap keyword at high aggressiveness", () => {
    expect(skillRow2(5)).toContain("Kubernetes");
  });
});
