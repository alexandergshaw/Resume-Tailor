import { describe, it, expect } from "vitest";
import {
  resolveEngineName,
  getEngine,
  listEngineNames,
  registerEngine,
} from "./index.js";

describe("resolveEngineName", () => {
  it("returns a registered engine name as-is (case-insensitive)", () => {
    expect(resolveEngineName("gemini")).toBe("gemini");
    expect(resolveEngineName("GEMINI")).toBe("gemini");
    expect(resolveEngineName("  Gemini  ")).toBe("gemini");
  });

  it("falls back to the provided default when the request is unknown/empty", () => {
    expect(resolveEngineName("", "gemini")).toBe("gemini");
    expect(resolveEngineName("nope", "gemini")).toBe("gemini");
  });

  it("falls back to gemini when neither request nor default is registered", () => {
    expect(resolveEngineName("external", "external")).toBe("gemini");
    expect(resolveEngineName(undefined, undefined)).toBe("gemini");
  });
});

describe("getEngine", () => {
  it("returns the gemini engine for known and unknown names", () => {
    expect(getEngine("gemini").name).toBe("gemini");
    expect(getEngine("does-not-exist").name).toBe("gemini");
  });
});

describe("registerEngine", () => {
  it("makes a newly registered engine resolvable", () => {
    expect(listEngineNames()).toContain("gemini");
    const fake = { name: "external-test", async tailorResume() {}, async tailorCoverLetter() {} };
    registerEngine(fake);
    expect(listEngineNames()).toContain("external-test");
    expect(resolveEngineName("external-test")).toBe("external-test");
    expect(getEngine("external-test")).toBe(fake);
  });
});
