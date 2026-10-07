// N128: refinement of the N125 comp-shaped digit guard in
// idealProjectPrompt.js (compensationShapedNumbers). Two moves, one hard floor.
//
// THE HARD FLOOR is R-135: a posting's own pay (its salary band, an hourly
// rate, a stipend, a signing bonus) must never reach the screen as a project
// figure. Every REJECT row below is that floor; the refinement may only change
// what is ACCEPTED, and only for numbers that cannot plausibly be pay.
//
//   1. NUMBER-ONLY-LINE LABEL INHERITANCE closes a residual the N125 delta
//      verify named: a no-currency comp LABEL on its own line, further than the
//      16-character window from its figure ("Compensation range:\n120000").
//      A line that is just a number (separators, a currency code, a range)
//      inherits the pay-word status of the nearest preceding label line.
//   2. A MAGNITUDE FLOOR on the PAY-WORD-ONLY path cuts over-rejection: a small
//      count that merely shares a sentence with a pay word ("competitive pay;
//      a team of 8") is not pay. The floor applies ONLY when the pay word is
//      the sole reason — a currency sign before the number or a rate unit
//      after it rejects at ANY magnitude, so "$8/hr" and "$950 stipend" still
//      reject. A "k"/"m" suffix (and the lower bound of a "95-120k" range)
//      counts as large, so "Salary: 95k" does not slip under the floor.
//
// This file ADDS cases; the landed N125 cases in idealProjectGenerated.test.js
// are untouched and still hold.

import { describe, it, expect } from "vitest";

import { normalizeIdealProject } from "./idealProjectPrompt.js";

// A well-formed response in the shape the prompt asks for. None of its own
// figures (34, 71, 9, 38, 3) appear in any posting fixture below.
function goodResponse() {
  return {
    title: "Rebuilding the enrolment workflow teachers actually use, in Education.",
    sections: [
      { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the enrolment flow ran to seven screens." },
      { label: "Built", body: "A single-screen flow with the roster pre-filled from the student system, and an assistant that flagged incomplete records before submission." },
      { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so settled trade-offs stayed settled." },
      { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the part that did not move at all." },
    ],
    outcomes: [
      { metric: "adoption rate", figure: "34% → 71% of teachers active weekly" },
      { metric: "user satisfaction / NPS", figure: "teacher NPS +9 → +38" },
      { metric: "time-to-ship", figure: "median idea-to-production 9 weeks → 3" },
    ],
  };
}

// The example echoes `figure` as a ticket count (2100 appears in no posting).
function echoing(figure) {
  const response = goodResponse();
  response.outcomes[0] = { metric: "adoption rate", figure: `cut the open backlog from ${figure} tickets to 2100 over two quarters` };
  return response;
}

// An example whose own outcome line is `figureText`, verbatim.
function withFigure(figureText) {
  const response = goodResponse();
  response.outcomes[1] = { metric: "team size managed", figure: figureText };
  return response;
}

const posting = (...lines) => ["Senior Engineer, Platform", ...lines, "You will join a small team."].join("\n");

describe("N128 R-135 floor — a posting's own pay still rejects", () => {
  describe.each([
    ["the low end of a $78,496/$105,974 band", "Pay band: $78,496/$105,974 depending on level.", "78496"],
    ["the high end of a $78,496/$105,974 band", "Pay band: $78,496/$105,974 depending on level.", "105974"],
    ["a $42/hr rate", "Contract role. Pay is $42/hr for the duration.", "42"],
    ["a $950 stipend", "Includes a $950 stipend per month.", "950"],
    ["a $5k signing bonus", "We offer a $5k signing bonus on day one.", "5"],
    ["an $8/hr wage (currency + rate, far below any magnitude floor)", "Starting wage is $8/hr.", "8"],
    ["a currency-less 42/hr (rate unit after)", "Pay: 42/hr for the duration.", "42"],
    ["a currency-less '42 an hour'", "Contract role, pays 42 an hour.", "42"],
    ["a currency-less '42 hourly'", "Rate: 42 hourly on contract.", "42"],
    ["a currency-less salary in its own sentence (95000)", "The annual salary for this position, after a probation period, is 95000 flat.", "95000"],
    ["a k-suffixed salary with no currency sign ('Salary: 95k')", "Salary: 95k plus equity.", "95"],
    ["the lower bound of a k-suffixed range ('95-120k')", "Salary range 95-120k plus equity.", "95"],
    ["the upper bound of a k-suffixed range ('95-120k')", "Salary range 95-120k plus equity.", "120"],
    ["a thousands-grouped salary in a pay sentence", "Base salary lands at 95,000 for this level.", "95000"],
  ])("%s", (_label, line, figure) => {
    it("rejects an example that echoes the number", () => {
      expect(normalizeIdealProject(echoing(figure), { description: posting(line) })).toBeNull();
    });
  });
});

describe("N128 closes the cross-line label residual — a number-only line inherits the preceding label's pay word", () => {
  describe.each([
    ["a comp label on its own line (the named residual)", "Compensation range:\n120000", "120000"],
    ["a blank line between label and number", "Compensation range:\n\n120000", "120000"],
    ["a thousands-separated number-only line", "Compensation range:\n120,000", "120000"],
    ["a number-only line with a trailing currency code", "Compensation range:\n120000 USD", "120000"],
    ["the low end of a range on the number-only line", "Compensation range:\n95000 - 120000", "95000"],
    ["the high end of a range on the number-only line", "Compensation range:\n95000 - 120000", "120000"],
    ["a second number-only line, inheriting through the first", "Compensation range:\n95000\n120000", "120000"],
    ["Windows (CRLF) line endings", "Compensation range:\r\n120000\r\nBenefits follow.", "120000"],
    ["a k-suffixed figure on its own line", "Compensation range:\n95k", "95"],
    ["a currency-less label that is not 'comp'-spelled (Pay range)", "Pay range for this level:\n105000", "105000"],
  ])("%s", (_label, lines, figure) => {
    it("rejects an example that echoes the number", () => {
      expect(normalizeIdealProject(echoing(figure), { description: posting(lines) })).toBeNull();
    });
  });

  // Positive controls: the rejection above is label inheritance and nothing
  // more. A number-only line under a label with NO pay word is just a number,
  // even when an earlier, unrelated line mentioned compensation.
  it("admits a large number-only line whose nearest label has no pay word, even with a pay word higher up", () => {
    const description = posting("Compensation: competitive", "Open positions:", "2500");
    expect(normalizeIdealProject(echoing("2500"), { description })).not.toBeNull();
  });

  it("admits the same figure when the label line above it is not a pay label at all", () => {
    expect(normalizeIdealProject(echoing("120000"), { description: posting("Monthly active users:\n120000") })).not.toBeNull();
  });
});

describe("N128 magnitude floor — a small count that merely shares a pay sentence is not pay", () => {
  describe.each([
    ["'a team of 8' beside 'pay'", "We offer competitive pay; you will manage a team of 8.", "a team of 8, up from 3"],
    ["'5+ years' beside 'salary'", "Salary is competitive for candidates with 5+ years of experience.", "5+ years of tenure on the team"],
    ["'99.95%' beside 'pay'", "Pay is tied to our 99.95% uptime target.", "monthly availability 99.2% → 99.95% of the month"],
    ["a count beside 'Bonus'", "Bonus eligible for the 12 campuses on the east side.", "rolled out to 12 campuses in a quarter"],
    ["the cents of a salary figure ('.00')", "Salary range: $78,496.00 - $105,974.00 annually.", "standup moved from 09:00 to 10:30"],
  ])("%s", (_label, line, figureText) => {
    it("now admits an example that reuses the small number", () => {
      expect(normalizeIdealProject(withFigure(figureText), { description: posting(line) })).not.toBeNull();
    });
  });

  // The boundary on the pay-word-ONLY path (1000): one below is a count, at it
  // is pay-sized. "The salary ... is N" has no currency sign and no rate unit.
  describe("the floor boundary on the pay-word-only path", () => {
    const sentence = (n) => posting(`The salary for this role is ${n} for the first year.`);

    it("admits 999, one below the floor", () => {
      expect(normalizeIdealProject(echoing("999"), { description: sentence("999") })).not.toBeNull();
    });

    it("rejects 1000, exactly at the floor", () => {
      expect(normalizeIdealProject(echoing("1000"), { description: sentence("1000") })).toBeNull();
    });

    it("rejects 1,000 written with a thousands separator", () => {
      expect(normalizeIdealProject(echoing("1000"), { description: sentence("1,000") })).toBeNull();
    });

    it("rejects 1k (a k suffix reads as 1000)", () => {
      expect(normalizeIdealProject(echoing("1"), { description: sentence("1k") })).toBeNull();
    });
  });

  // The floor must not reach the currency or rate paths: the SAME sub-floor
  // number rejects the moment a currency sign or rate unit is attached.
  describe("the floor does not apply to currency or rate adjacency", () => {
    it("rejects 999 once a currency sign precedes it", () => {
      expect(normalizeIdealProject(echoing("999"), { description: posting("The salary for this role is $999 for the first year.") })).toBeNull();
    });

    it("rejects 8 once a rate unit follows it", () => {
      expect(normalizeIdealProject(echoing("8"), { description: posting("The salary for this role is 8/hr for the first year.") })).toBeNull();
    });

    it("rejects 8 once a currency sign precedes it, with no pay word anywhere", () => {
      expect(normalizeIdealProject(echoing("8"), { description: posting("You will run a $8 weekly lunch budget.") })).toBeNull();
    });
  });
});
