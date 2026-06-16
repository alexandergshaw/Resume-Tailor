import { describe, it, expect } from "vitest";
import {
  parseSalary,
  normalizeSalaryPair,
  salaryFromLever,
  salaryFromAshby,
  resolvePostingSalary,
  formatSalary,
} from "./salary.js";

describe("parseSalary", () => {
  it("parses a comma range with a leading $", () => {
    expect(parseSalary("Pay range: $120,000 - $150,000 per year")).toEqual({
      min: 120000,
      max: 150000,
    });
  });

  it("parses a k-suffixed range", () => {
    expect(parseSalary("Comp is $120k–$150k DOE")).toEqual({ min: 120000, max: 150000 });
  });

  it("parses a 'to' range and a second $ that is optional", () => {
    expect(parseSalary("$95,000 to 120,000")).toEqual({ min: 95000, max: 120000 });
  });

  it("treats a lone figure as a floor", () => {
    expect(parseSalary("Salary: $130,000")).toEqual({ min: 130000, max: null });
  });

  it("annualizes an hourly range", () => {
    // $50–$60/hr * 2080 = 104000–124800
    expect(parseSalary("$50 - $60 per hour")).toEqual({ min: 104000, max: 124800 });
  });

  it("ignores small dollar amounts (fees, bonuses)", () => {
    expect(parseSalary("$50 application fee; $2,000 referral bonus")).toEqual({
      min: null,
      max: null,
    });
  });

  it("ignores huge dollar amounts (funding rounds)", () => {
    expect(parseSalary("We raised $120,000,000 in Series C")).toEqual({
      min: null,
      max: null,
    });
  });

  it("skips a funding figure and finds the real salary range", () => {
    const text = "Backed by $50,000,000 in funding. Salary $120,000 - $140,000.";
    expect(parseSalary(text)).toEqual({ min: 120000, max: 140000 });
  });

  it("returns nulls when there is no salary", () => {
    expect(parseSalary("Great team, remote-friendly, unlimited PTO")).toEqual({
      min: null,
      max: null,
    });
    expect(parseSalary("")).toEqual({ min: null, max: null });
    expect(parseSalary(null)).toEqual({ min: null, max: null });
  });

  it("orders inverted bounds", () => {
    expect(parseSalary("$150,000 - $120,000")).toEqual({ min: 120000, max: 150000 });
  });
});

describe("normalizeSalaryPair", () => {
  it("annualizes per interval and clamps to the sane band", () => {
    expect(normalizeSalaryPair(60, 80, "hour")).toEqual({ min: 124800, max: 166400 });
    expect(normalizeSalaryPair(5, 6, "hour")).toEqual({ min: 10400, max: 12480 });
    expect(normalizeSalaryPair(120000, 150000, "1 YEAR")).toEqual({
      min: 120000,
      max: 150000,
    });
  });

  it("drops out-of-band values", () => {
    expect(normalizeSalaryPair(500, 5_000_000, "year")).toEqual({ min: null, max: null });
  });
});

describe("salaryFromLever", () => {
  it("reads a structured USD salaryRange", () => {
    const raw = { salaryRange: { min: 120000, max: 150000, currency: "USD", interval: "per-year-salary" } };
    expect(salaryFromLever(raw)).toEqual({ min: 120000, max: 150000 });
  });

  it("annualizes an hourly lever range", () => {
    const raw = { salaryRange: { min: 50, max: 60, currency: "USD", interval: "per-hour-wage" } };
    expect(salaryFromLever(raw)).toEqual({ min: 104000, max: 124800 });
  });

  it("ignores non-USD currencies", () => {
    const raw = { salaryRange: { min: 120000, max: 150000, currency: "EUR" } };
    expect(salaryFromLever(raw)).toEqual({ min: null, max: null });
  });

  it("returns nulls without a salaryRange", () => {
    expect(salaryFromLever({})).toEqual({ min: null, max: null });
  });
});

describe("salaryFromAshby", () => {
  it("reads structured summaryComponents", () => {
    const raw = {
      compensation: {
        shouldDisplayCompensationOnJobBoard: true,
        summaryComponents: [
          { compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 130000, maxValue: 160000 },
        ],
      },
    };
    expect(salaryFromAshby(raw)).toEqual({ min: 130000, max: 160000 });
  });

  it("falls back to the scrapeable summary string", () => {
    const raw = {
      compensation: {
        shouldDisplayCompensationOnJobBoard: true,
        summaryComponents: [],
        scrapeableCompensationSalarySummary: "$110K - $140K",
      },
    };
    expect(salaryFromAshby(raw)).toEqual({ min: 110000, max: 140000 });
  });

  it("respects the display flag", () => {
    const raw = {
      compensation: {
        shouldDisplayCompensationOnJobBoard: false,
        summaryComponents: [
          { compensationType: "Salary", currencyCode: "USD", minValue: 130000, maxValue: 160000 },
        ],
      },
    };
    expect(salaryFromAshby(raw)).toEqual({ min: null, max: null });
  });
});

describe("resolvePostingSalary", () => {
  it("prefers the structured pair", () => {
    expect(resolvePostingSalary({ min: 120000, max: 150000 }, "$1 - $2")).toEqual({
      min: 120000,
      max: 150000,
    });
  });

  it("falls back to parsing the text", () => {
    expect(resolvePostingSalary({ min: null, max: null }, "Salary $120,000 - $150,000")).toEqual({
      min: 120000,
      max: 150000,
    });
  });
});

describe("formatSalary", () => {
  it("formats both bounds, a floor, and a ceiling", () => {
    expect(formatSalary(120000, 150000)).toBe("$120k–$150k");
    expect(formatSalary(120000, null)).toBe("From $120k");
    expect(formatSalary(null, 150000)).toBe("Up to $150k");
    expect(formatSalary(null, null)).toBe("");
  });
});
