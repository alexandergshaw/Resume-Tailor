import { describe, it, expect } from "vitest";
import {
  DEFAULT_INTERVIEW_TYPE,
  INTERVIEW_TYPES,
  normalizeInterviewType,
  interviewType,
  interviewTypeLabel,
} from "./interviewTypes.js";

const QUESTION_GROUP_VOCAB = new Set([
  "behavioral",
  "technical",
  "system-design",
  "case-study",
  "leadership",
  "role",
]);

const EXPECTATION_CUE_VOCAB = new Set([
  "result-metric",
  "tradeoff",
  "approach",
  "star-result",
  "specific-example",
]);

describe("normalizeInterviewType", () => {
  it("maps a known value through unchanged", () => {
    expect(normalizeInterviewType("technical")).toBe("technical");
    expect(normalizeInterviewType("phone-screen")).toBe("phone-screen");
  });

  it("maps null to general", () => {
    expect(normalizeInterviewType(null)).toBe("general");
  });

  it("maps undefined to general", () => {
    expect(normalizeInterviewType(undefined)).toBe("general");
  });

  it("maps an empty string to general", () => {
    expect(normalizeInterviewType("")).toBe("general");
  });

  it("maps a number to general", () => {
    expect(normalizeInterviewType(42)).toBe("general");
  });

  it("maps an object to general", () => {
    expect(normalizeInterviewType({ value: "technical" })).toBe("general");
  });

  it("maps an unrecognized string to general", () => {
    expect(normalizeInterviewType("not-a-real-type")).toBe("general");
  });

  it("never throws across the full range of untrusted inputs", () => {
    const inputs = [null, undefined, "", 42, {}, [], true, false, NaN, () => {}, "not-a-real-type"];
    for (const input of inputs) {
      expect(() => normalizeInterviewType(input)).not.toThrow();
    }
  });
});

describe("interviewType", () => {
  it("always returns a descriptor object, never undefined", () => {
    const inputs = [null, undefined, "", 42, {}, [], "not-a-real-type", "technical", "general"];
    for (const input of inputs) {
      const descriptor = interviewType(input);
      expect(descriptor).not.toBeUndefined();
      expect(typeof descriptor).toBe("object");
      expect(descriptor).not.toBeNull();
    }
  });

  it("returns the matching descriptor for a known value", () => {
    const descriptor = interviewType("technical");
    expect(descriptor.value).toBe("technical");
    expect(descriptor.label).toBe("Technical / coding");
  });

  it("falls back to the general descriptor for invalid input", () => {
    expect(interviewType(null).value).toBe("general");
    expect(interviewType(123).value).toBe("general");
    expect(interviewType("bogus").value).toBe("general");
  });
});

describe("interviewTypeLabel", () => {
  it("returns the label of the resolved descriptor", () => {
    expect(interviewTypeLabel("behavioral")).toBe("Behavioral");
  });

  it("falls back to the general label for invalid input", () => {
    expect(interviewTypeLabel(undefined)).toBe(interviewType("general").label);
  });
});

describe("INTERVIEW_TYPES structural invariants", () => {
  it("has exactly 7 entries", () => {
    expect(INTERVIEW_TYPES.length).toBe(7);
  });

  it("has unique values across all entries", () => {
    const values = INTERVIEW_TYPES.map((descriptor) => descriptor.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("draws every questionGroups entry from the fixed vocabulary", () => {
    for (const descriptor of INTERVIEW_TYPES) {
      expect(Array.isArray(descriptor.questionGroups)).toBe(true);
      expect(descriptor.questionGroups.length).toBeGreaterThan(0);
      for (const group of descriptor.questionGroups) {
        expect(QUESTION_GROUP_VOCAB.has(group)).toBe(true);
      }
    }
  });

  it("draws every expectation cue from the fixed vocabulary", () => {
    for (const descriptor of INTERVIEW_TYPES) {
      expect(Array.isArray(descriptor.expectations)).toBe(true);
      for (const expectation of descriptor.expectations) {
        expect(EXPECTATION_CUE_VOCAB.has(expectation.cue)).toBe(true);
      }
    }
  });

  it("has a lengthTarget with minWords strictly less than maxWords", () => {
    for (const descriptor of INTERVIEW_TYPES) {
      expect(descriptor.lengthTarget.minWords).toBeLessThan(descriptor.lengthTarget.maxWords);
    }
  });
});

describe("general descriptor (behaviour-preservation contract)", () => {
  it("has DEFAULT_INTERVIEW_TYPE set to general", () => {
    expect(DEFAULT_INTERVIEW_TYPE).toBe("general");
  });

  it("has exactly the pre-existing three question groups, in order", () => {
    expect(interviewType("general").questionGroups).toEqual(["behavioral", "technical", "role"]);
  });

  it("has the exact pre-existing length target", () => {
    expect(interviewType("general").lengthTarget).toEqual({ minWords: 80, maxWords: 220 });
  });

  it("has no expectations, so it adds no format-specific critique output", () => {
    expect(interviewType("general").expectations).toEqual([]);
  });
});
