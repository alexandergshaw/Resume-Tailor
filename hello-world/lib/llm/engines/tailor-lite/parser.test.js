import { describe, it, expect } from "vitest";
import { parsePosting } from "./parser.js";

describe("parsePosting (in-house)", () => {
  const posting = "Healthcare Integration Engineer. Requirements: HL7, FHIR, REST APIs, SQL, healthcare data exchange, systems integration.";

  it("extracts keywords locally and surfaces domain emphases", () => {
    const { keywords, emphases } = parsePosting(posting);
    expect(keywords.technology.some((k) => k.canonical === "REST")).toBe(true);
    expect(Array.isArray(emphases)).toBe(true);
    expect(emphases).toContain("Healthcare");
  });

  it("is deterministic for the same input", () => {
    expect(parsePosting(posting)).toEqual(parsePosting(posting));
  });
});
