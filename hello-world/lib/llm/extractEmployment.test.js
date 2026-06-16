import { describe, it, expect } from "vitest";
import { parseModelJson, sanitizeExtractedPositions } from "./extractEmployment.js";

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson('{"positions":[]}')).toEqual({ positions: [] });
  });

  it("strips ```json code fences", () => {
    const text = "```json\n{ \"positions\": [{ \"company\": \"Acme\" }] }\n```";
    expect(parseModelJson(text)).toEqual({ positions: [{ company: "Acme" }] });
  });

  it("recovers a JSON block from surrounding prose", () => {
    const text = 'Here you go: {"positions":[{"title":"Engineer"}]} Hope that helps!';
    expect(parseModelJson(text)).toEqual({ positions: [{ title: "Engineer" }] });
  });

  it("returns null for unparseable input", () => {
    expect(parseModelJson("not json at all")).toBeNull();
    expect(parseModelJson("")).toBeNull();
    expect(parseModelJson(null)).toBeNull();
  });
});

describe("sanitizeExtractedPositions", () => {
  it("normalizes an object with a positions array", () => {
    const raw = {
      positions: [
        {
          company: "  Acme   Corp ",
          title: "Senior Engineer",
          location: "San Francisco, CA",
          startDate: "Jan 2020",
          endDate: "Present",
          notes: ["Built X", "  Led Y  ", ""],
        },
      ],
    };
    expect(sanitizeExtractedPositions(raw)).toEqual([
      {
        company: "Acme Corp",
        title: "Senior Engineer",
        location: "San Francisco, CA",
        startDate: "Jan 2020",
        endDate: "Present",
        notes: "Built X\nLed Y",
      },
    ]);
  });

  it("accepts a bare array and alternate field names", () => {
    const raw = [
      { employer: "Beta Inc", role: "Developer", start: "2017", end: "2020", description: "Did things" },
    ];
    expect(sanitizeExtractedPositions(raw)[0]).toEqual({
      company: "Beta Inc",
      title: "Developer",
      location: "",
      startDate: "2017",
      endDate: "2020",
      notes: "Did things",
    });
  });

  it("drops entries with neither company nor title and caps the count", () => {
    const raw = {
      positions: [
        { notes: "orphan note" },
        { company: "A" },
        { title: "B" },
        { company: "C" },
        { company: "D" },
        { company: "E" },
      ],
    };
    const out = sanitizeExtractedPositions(raw);
    expect(out).toHaveLength(4);
    expect(out.map((p) => p.company || p.title)).toEqual(["A", "B", "C", "D"]);
  });

  it("returns an empty array for non-array / nullish input", () => {
    expect(sanitizeExtractedPositions(null)).toEqual([]);
    expect(sanitizeExtractedPositions({})).toEqual([]);
    expect(sanitizeExtractedPositions("nope")).toEqual([]);
  });

  it("respects a custom maxEntries", () => {
    const raw = { positions: [{ company: "A" }, { company: "B" }, { company: "C" }] };
    expect(sanitizeExtractedPositions(raw, { maxEntries: 2 })).toHaveLength(2);
  });
});
