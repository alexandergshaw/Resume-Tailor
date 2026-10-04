// N105 Step 3c - AC-10: the orchestrator's real-chronology check on employer and
// education lines (the gate never sees them).
//
// Every row decomposes a real candidate document, reconciles it, recomposes it,
// and reads the EMITTED text, so the property under test is "what ships", not a
// helper's return value.
import { describe, it, expect } from "vitest";
import { decomposeToSpans, recomposeFromSpans } from "./spanDocument.js";
import { buildRealEmployers, employerKey, findRealEmployer, reconcileChronology } from "./idealChronology.js";

const real = buildRealEmployers({
  chronology: {
    employers: [
      { name: "Acme Corp", start: "Jan 2020", end: "2024" },
      { name: "Beta LLC", start: "2017", end: "Present" },
    ],
    education: [{ institution: "State University", degree: "B.S. Computer Science", start: "2013", end: "2017" }],
  },
  spans: [{ id: "r1", text: "Wrote tests", contextKey: "Gamma Labs" }],
});

// Decompose -> reconcile -> recompose with EVERY content span retained, so any
// line missing from the output was taken out by the chronology check alone.
function ship(lines) {
  const { spans, layout } = decomposeToSpans(lines.join("\n"), lines);
  const checked = reconcileChronology(layout, real);
  const retained = spans.filter((s) => !checked.invalidSpanIds.has(s.id));
  return { checked, text: recomposeFromSpans(checked.layout, retained).resultLines.join("\n") };
}

describe("employerKey", () => {
  it("ignores case, punctuation and corporate suffixes, but not a different name", () => {
    expect(employerKey("Acme Corporation")).toBe(employerKey("ACME Corp."));
    expect(employerKey("Acme Inc")).toBe("acme");
    expect(employerKey("Acme Labs")).not.toBe(employerKey("Acme Corp"));
    expect(employerKey("Co")).toBe("co");
    expect(employerKey("")).toBe("");
  });
});

describe("reconcileChronology - employer names", () => {
  it("leaves a real employer line byte-identical", () => {
    const { text } = ship(["PROFESSIONAL EXPERIENCE", "Acme Corp — Senior Engineer (2020-2024)", "Fixed the build"]);
    expect(text).toContain("Acme Corp — Senior Engineer (2020-2024)");
  });

  it("removes an INVENTED employer line and the content under it, keeps the real one", () => {
    const { checked, text } = ship([
      "PROFESSIONAL EXPERIENCE",
      "Acme Corp — Senior Engineer (2020-2024)",
      "Fixed the build",
      "Google — Staff Engineer (2018-2022)",
      "Ran search quality",
    ]);
    expect(text).not.toMatch(/Google/);
    expect(text).not.toMatch(/Ran search quality/);
    expect(text).toMatch(/Acme Corp/);
    expect(text).toMatch(/Fixed the build/);
    expect(checked.removedEmployers).toHaveLength(1);
    expect(checked.removedEmployers[0].text).toMatch(/Google/);
    expect([...checked.invalidSpanIds]).toHaveLength(1);
  });

  it("drops the section heading too when the invented employer was all that sat under it", () => {
    const { text } = ship(["PROFESSIONAL EXPERIENCE", "Google — Staff Engineer (2018-2022)", "Ran search quality"]);
    expect(text).not.toMatch(/PROFESSIONAL EXPERIENCE|Google/);
  });

  it("corrects a corporate-suffix variant of a real name to the real name", () => {
    const { text } = ship(["PROFESSIONAL EXPERIENCE", "Acme Corporation — Senior Engineer (2020-2024)"]);
    expect(text).toContain("Acme Corp — Senior Engineer (2020-2024)");
    expect(text).not.toMatch(/Corporation/);
  });

  it("accepts an employer that is known only from a real span's context key", () => {
    const { checked } = ship(["PROFESSIONAL EXPERIENCE", "Gamma Labs — Engineer (2015-2017)"]);
    expect(checked.removedEmployers).toHaveLength(0);
  });

  it("fails closed: with no real records every employer line is removed", () => {
    const { spans, layout } = decomposeToSpans("", ["PROFESSIONAL EXPERIENCE", "Acme Corp — Engineer (2020-2024)", "Did work"]);
    const checked = reconcileChronology(layout, buildRealEmployers({}));
    expect(checked.removedEmployers).toHaveLength(1);
    expect(spans).toHaveLength(1);
    const text = recomposeFromSpans(checked.layout, []).result;
    expect(text).not.toMatch(/Acme/);
  });
});

describe("reconcileChronology - dates", () => {
  it("corrects a moved start year to the real one, keeping the line's punctuation", () => {
    const { text } = ship(["PROFESSIONAL EXPERIENCE", "Acme Corp — Senior Engineer (2018-2024)"]);
    expect(text).toContain("Acme Corp — Senior Engineer (Jan 2020-2024)");
  });

  it("corrects a moved end date and an end date inflated to Present", () => {
    expect(ship(["PROFESSIONAL EXPERIENCE", "Acme Corp — Engineer (Jan 2020 - 2026)"]).text).toContain("(Jan 2020 - 2024)");
    expect(ship(["PROFESSIONAL EXPERIENCE", "Acme Corp — Engineer (2020 – Present)"]).text).toContain("(2020 – 2024)");
  });

  it("does not treat less precision as a contradiction, but does treat an invented month as one", () => {
    expect(ship(["PROFESSIONAL EXPERIENCE", "Acme Corp — Engineer (2020-2024)"]).text).toContain("(2020-2024)");
    expect(ship(["PROFESSIONAL EXPERIENCE", "Acme Corp — Engineer (Mar 2020-2024)"]).text).toContain("(Jan 2020-2024)");
    expect(ship(["PROFESSIONAL EXPERIENCE", "Beta LLC — Lead (2017-2022)"]).text).toContain("(2017-Present)");
  });

  it("treats Current and Present as the same open end", () => {
    expect(ship(["PROFESSIONAL EXPERIENCE", "Beta LLC — Lead (2017 - Current)"]).text).toContain("(2017 - Current)");
  });

  it("picks the stint whose dates the line agrees with when an employer appears twice", () => {
    const twice = buildRealEmployers({
      chronology: {
        employers: [
          { name: "Acme Corp", start: "2010", end: "2012" },
          { name: "Acme Corp", start: "2020", end: "2024" },
        ],
      },
    });
    expect(findRealEmployer(twice, "Acme Corp", "2020-2024").start).toBe("2020");
    expect(findRealEmployer(twice, "Acme Corp", "2010-2012").start).toBe("2010");
  });
});

describe("reconcileChronology - education", () => {
  it("keeps a real institution and restores the real degree", () => {
    const { text } = ship(["EDUCATION", "State University — M.S. Computer Science (2013-2017)"]);
    expect(text).toContain("State University — B.S. Computer Science (2013-2017)");
  });

  it("removes an institution the user never attended", () => {
    const { text } = ship(["EDUCATION", "MIT — M.S. Computer Science (2017-2019)"]);
    expect(text).not.toMatch(/MIT/);
  });
});
