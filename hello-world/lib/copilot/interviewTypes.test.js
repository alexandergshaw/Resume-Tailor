import { describe, it, expect } from "vitest";
import {
  DEFAULT_INTERVIEW_TYPE,
  INTERVIEW_TYPES,
  normalizeInterviewType,
  interviewType,
  interviewTypeLabel,
  isCodeBearingInterviewType,
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

// AC-A1: isCodeBearingInterviewType is true for exactly "technical" and
// "system-design", false for the other five values and for every
// non-value, and never throws. Three named failure modes, each with its
// own assertion below because getting any one wrong misfires the feature:
//   1. Returning true for "case-study" — answerLocal.js's
//      TECHNICAL_SCAFFOLD_INTERVIEW_TYPES (a set that answers a DIFFERENT
//      question, "does this need a technical-vs-STAR scaffold") includes
//      "case-study", and this predicate must not be confused with it.
//   2. Implementing this as a second literal list of type values instead
//      of reading a per-entry registry property — interviewTypes.js's own
//      header says it is the ONLY place a format is defined, so a second
//      list here is exactly the defect it warns about.
//   3. Deriving the answer from descriptor.questionGroups instead — both
//      "general" (the default) and "system-design" list "technical" in
//      their questionGroups, so a derivation from that array returns true
//      for "general", which every caller that never touches the picker
//      would hit.
describe("isCodeBearingInterviewType (AC-A1)", () => {
  it("every registry entry carries an explicit boolean codeBearing property", () => {
    for (const descriptor of INTERVIEW_TYPES) {
      expect(typeof descriptor.codeBearing).toBe("boolean");
    }
  });

  it("agrees with each entry's own codeBearing property, i.e. it reads the registry rather than a second list", () => {
    for (const descriptor of INTERVIEW_TYPES) {
      expect(isCodeBearingInterviewType(descriptor.value)).toBe(descriptor.codeBearing);
    }
  });

  it("returns true for exactly technical and system-design, false for the other five", () => {
    const expectedTrue = new Set(["technical", "system-design"]);
    for (const descriptor of INTERVIEW_TYPES) {
      expect(isCodeBearingInterviewType(descriptor.value)).toBe(expectedTrue.has(descriptor.value));
    }
    expect(INTERVIEW_TYPES.length).toBe(7);
  });

  it("failure mode 1: returns false for case-study, not true (do not confuse with answerLocal.js's TECHNICAL_SCAFFOLD_INTERVIEW_TYPES, which includes it)", () => {
    expect(isCodeBearingInterviewType("case-study")).toBe(false);
  });

  it("failure mode 3: returns false for general even though its questionGroups contains \"technical\" (must not derive from questionGroups)", () => {
    expect(interviewType("general").questionGroups).toContain("technical");
    expect(isCodeBearingInterviewType("general")).toBe(false);
  });

  it("returns false for every non-value and never throws", () => {
    const inputs = [null, undefined, "", 0, {}, [], "Technical", "technical ", "not-a-real-type"];
    for (const input of inputs) {
      expect(() => isCodeBearingInterviewType(input)).not.toThrow();
      expect(isCodeBearingInterviewType(input)).toBe(false);
    }
  });
});

// TRIPWIRE, NOT A CONTRACT. This pins a string that is DELIBERATELY TEMPORARY.
// AC-A26: chunk A ships the technical blurb with "Answers are spoken points, not
// written code." because chunk A is a standalone release in which no code is
// produced. Chunk B makes that sentence FALSE the moment it lands.
//
// Nothing else pins this string (blurb has one consumer, InterviewTypePicker's
// helperText, and reaches no prompt builder), so without this assertion chunk B
// could ship code-bearing answers under a blurb still saying they are not
// produced -- a confident falsehood, which is worse than the silence AC-A26
// exists to fix.
//
// CHUNK B: delete this whole `it` block AND the sentence together. It failing is
// the reminder, and deleting it without deleting the sentence is the defect.
it("carries chunk A's interim 'no written code' clause until chunk B removes both", () => {
  expect(interviewType("technical").blurb).toContain("not written code");
});
