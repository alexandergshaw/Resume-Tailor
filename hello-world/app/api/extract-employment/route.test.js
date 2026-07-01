import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/extractEmployment", () => ({ extractEmploymentFromResumeText: vi.fn() }));

import { POST } from "./route.js";
import { extractEmploymentFromResumeText } from "@/lib/llm/extractEmployment";

function jsonRequest(body) {
  return { json: async () => body };
}

const RESUME = [
  "EXPERIENCE",
  "Senior Software Engineer, Acme Corp — Remote",
  "Jan 2020 – Present",
  "- Built and scaled the platform.",
  "- Led a team of five engineers.",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/extract-employment", () => {
  it("400s when resumeText is missing", async () => {
    const res = await POST(jsonRequest({ engine: "embedded" }));
    expect(res.status).toBe(400);
  });

  it("uses the deterministic parser on the embedded engine — no LLM call", async () => {
    const res = await POST(jsonRequest({ resumeText: RESUME, engine: "embedded" }));
    const data = await res.json();
    expect(data.engine).toBe("embedded");
    expect(Array.isArray(data.positions)).toBe(true);
    expect(data.positions.length).toBeGreaterThan(0);
    expect(data.positions[0].company).toMatch(/Acme/i);
    expect(extractEmploymentFromResumeText).not.toHaveBeenCalled();
  });

  it("uses Gemini when that engine is requested", async () => {
    extractEmploymentFromResumeText.mockResolvedValue([{ company: "Gemini Co", title: "Eng" }]);
    const res = await POST(jsonRequest({ resumeText: RESUME, engine: "gemini" }));
    const data = await res.json();
    expect(data.engine).toBe("gemini");
    expect(data.positions[0].company).toBe("Gemini Co");
    expect(extractEmploymentFromResumeText).toHaveBeenCalledOnce();
  });

  it("falls back to the deterministic parser when Gemini extraction throws", async () => {
    extractEmploymentFromResumeText.mockRejectedValue(new Error("no key"));
    const res = await POST(jsonRequest({ resumeText: RESUME, engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.engine).toBe("embedded");
    expect(data.positions.length).toBeGreaterThan(0);
  });
});
