// N105 Step 4 - the real material the route hands the Ideal pipeline, read from
// the resume text alone. The pipeline's AC-10 check removes any employer or
// school line it cannot match to a real record, so what matters here is that
// every employer and school the resume states is registered (with the dates and
// degree it states) and that content lines carry the right contextKey.
import { describe, it, expect } from "vitest";
import { buildIdealRealMaterial } from "./idealRealMaterial.js";

const FREE_FORM = [
  "Jane Doe",
  "jane@example.com",
  "",
  "PROFESSIONAL EXPERIENCE",
  "Senior Engineer, Acme Corp | Jan 2019 - Present",
  "- Reduced support tickets by 40%",
  "- Led a team of 5 engineers",
  "",
  "Software Engineer, Globex Inc. | 2015 - 2018",
  "- Built the billing service",
  "",
  "EDUCATION",
  "State University — B.S. Computer Science (2011-2015)",
  "Dean's list",
  "",
  "SKILLS",
  "JavaScript and Python",
].join("\n");

const names = (list, key) => list.map((e) => e[key]);

describe("buildIdealRealMaterial — chronology", () => {
  it("registers each employer the resume states, with its dates", () => {
    const { chronology } = buildIdealRealMaterial(FREE_FORM);
    expect(names(chronology.employers, "name")).toEqual(expect.arrayContaining(["Acme Corp"]));
    const acme = chronology.employers.find((e) => e.name === "Acme Corp");
    expect(acme).toMatchObject({ start: "Jan 2019", end: "Present" });
    expect(names(chronology.employers, "name").some((n) => /^Globex/.test(n))).toBe(true);
  });

  it("registers the school, its degree and its dates as EDUCATION, not as an employer", () => {
    const { chronology } = buildIdealRealMaterial(FREE_FORM);
    expect(chronology.education).toEqual([
      { institution: "State University", degree: "B.S. Computer Science", start: "2011", end: "2015" },
    ]);
    expect(names(chronology.employers, "name")).not.toContain("State University");
  });

  it("reads a school written over several lines (name, then degree, then year)", () => {
    const text = ["EDUCATION", "University of Texas at Austin", "Bachelor of Science in Biology", "2016"].join("\n");
    expect(buildIdealRealMaterial(text).chronology.education).toEqual([
      { institution: "University of Texas at Austin", degree: "Bachelor of Science in Biology", start: "", end: "2016" },
    ]);
  });

  it("registers 'Head, Place' school names under both spellings", () => {
    const text = ["EDUCATION", "University of California, Berkeley — B.A. History (2010-2014)"].join("\n");
    const schools = names(buildIdealRealMaterial(text).chronology.education, "institution");
    expect(schools).toEqual(["University of California", "University of California, Berkeley"]);
  });

  it("registers a resume written in the candidate's own '<Name> — <Title> (<dates>)' shape", () => {
    const text = ["EXPERIENCE", "Acme Corp — Senior Engineer (2019-2024)", "Reduced support tickets"].join("\n");
    expect(buildIdealRealMaterial(text).chronology.employers).toContainEqual({ name: "Acme Corp", start: "2019", end: "2024" });
  });

  it("registers one spelling per employer ('Acme Corp' and 'Acme Corporation' are one)", () => {
    const text = ["EXPERIENCE", "Engineer, Acme Corp | 2019 - 2020", "Engineer, Acme Corporation | 2021 - 2022"].join("\n");
    const acme = buildIdealRealMaterial(text).chronology.employers.filter((e) => /^Acme/.test(e.name));
    expect(new Set(names(acme, "name")).size).toBe(1);
  });
});

describe("buildIdealRealMaterial — spans", () => {
  it("keys each content line to the employer or school above it", () => {
    const { spans } = buildIdealRealMaterial(FREE_FORM);
    const keyOf = (fragment) => spans.find((s) => s.text.includes(fragment))?.contextKey;
    expect(keyOf("Reduced support tickets")).toBe("Acme Corp");
    expect(keyOf("Led a team")).toBe("Acme Corp");
    expect(keyOf("billing service")).toMatch(/^Globex/);
    expect(keyOf("Dean's list")).toBe("State University");
  });

  it("leaves the name, contact and skills lines unkeyed (section headings reset the context)", () => {
    const { spans } = buildIdealRealMaterial(FREE_FORM);
    const keyOf = (fragment) => spans.find((s) => s.text.includes(fragment))?.contextKey;
    expect(keyOf("Jane Doe")).toBe("");
    expect(keyOf("jane@example.com")).toBe("");
    expect(keyOf("JavaScript and Python")).toBe("");
  });

  it("does not emit section headings or blank lines as spans, and mints distinct ids", () => {
    const { spans } = buildIdealRealMaterial(FREE_FORM);
    expect(spans.some((s) => /^(PROFESSIONAL EXPERIENCE|EDUCATION|SKILLS)$/.test(s.text))).toBe(false);
    expect(spans.some((s) => s.text === "")).toBe(false);
    expect(new Set(spans.map((s) => s.id)).size).toBe(spans.length);
  });

  it("does not let a sentence that mentions an employer and a year switch the context", () => {
    const text = [
      "EXPERIENCE",
      "Engineer, Acme Corp | 2019 - 2020",
      "Engineer, Globex Inc. | 2015 - 2018",
      "- Migrated the Globex data center to Acme Corp tooling in 2017",
    ].join("\n");
    const bullet = buildIdealRealMaterial(text).spans.find((s) => s.text.includes("Migrated"));
    expect(bullet.contextKey).toMatch(/^Globex/);
  });

  it("returns an empty corpus for empty text (the route refuses before this matters)", () => {
    expect(buildIdealRealMaterial("")).toEqual({ spans: [], chronology: { employers: [], education: [] } });
    expect(buildIdealRealMaterial(undefined).spans).toEqual([]);
  });
});
