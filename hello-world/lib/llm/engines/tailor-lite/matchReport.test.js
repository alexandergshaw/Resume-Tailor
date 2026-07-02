import { describe, it, expect } from "vitest";
import { computeMatch, combineMatches, MATCH_THRESHOLD } from "./matchReport.js";
import { embeddedEngine } from "./engine.js";
import { defaultLibraryData } from "./library/defaults.js";

const TAXONOMY = defaultLibraryData.taxonomy;

// An in-vocabulary posting (same fixture family the engine tests use).
const TECH_POSTING = [
  "Senior Software Engineer.",
  "Requirements:",
  "React, JavaScript, TypeScript, SQL, PostgreSQL, REST APIs, Agile, leadership.",
  "Nice to have: Kubernetes, Docker.",
].join("\n");

// An off-domain posting whose vocabulary the bundled taxonomy largely lacks.
const NURSE_POSTING = [
  "Registered Nurse — Med-Surg Unit.",
  "Requirements:",
  "Active RN license, BLS certification, telemetry monitoring, Epic EHR charting,",
  "IV insertion and phlebotomy, medication administration, patient triage,",
  "wound care, HIPAA compliance, care-plan documentation.",
].join("\n");

describe("computeMatch (unit)", () => {
  it("full coverage scores 1 with no gaps", () => {
    const posting = "We need React and SQL experience.";
    const doc = "Built dashboards with React and SQL.";
    const m = computeMatch(posting, doc, TAXONOMY);
    expect(m.score).toBe(1);
    expect(m.belowThreshold).toBe(false);
    expect(m.missing).toEqual([]);
    expect(m.covered.map((c) => c.canonical)).toEqual(expect.arrayContaining(["React", "SQL"]));
  });

  it("is alias-aware: k8s in the posting is covered by Kubernetes in the doc", () => {
    const m = computeMatch("Must know k8s.", "Deployed services on Kubernetes.", TAXONOMY);
    expect(m.missing.map((t) => t.canonical)).not.toContain("Kubernetes");
    expect(m.score).toBe(1);
  });

  it("lists known-but-uncovered terms as missing and lowers the score", () => {
    const posting = "We need React, SQL, Kubernetes, Docker, Terraform.";
    const doc = "Built dashboards with React and SQL.";
    const m = computeMatch(posting, doc, TAXONOMY);
    expect(m.score).toBeLessThan(1);
    expect(m.missing.map((t) => t.canonical)).toEqual(
      expect.arrayContaining(["Kubernetes", "Docker"]),
    );
  });

  it("reports vocabulary the taxonomy doesn't know as unrecognized", () => {
    const posting = "Experience with telemetry monitoring and phlebotomy procedures required.";
    const m = computeMatch(posting, "Some unrelated document text.", TAXONOMY);
    expect(m.unrecognized.length).toBeGreaterThan(0);
  });

  it("handles the empty posting as vacuously matched", () => {
    const m = computeMatch("", "any document", TAXONOMY);
    expect(m.score).toBe(1);
    expect(m.belowThreshold).toBe(false);
  });

  it("is deterministic", () => {
    const a = computeMatch(TECH_POSTING, "React SQL PostgreSQL document", TAXONOMY);
    const b = computeMatch(TECH_POSTING, "React SQL PostgreSQL document", TAXONOMY);
    expect(a).toEqual(b);
  });
});

describe("combineMatches", () => {
  it("takes the weakest score and unions the gap lists", () => {
    const combined = combineMatches([
      { score: 0.9, missing: [{ canonical: "Docker", category: "tool_platform" }], unrecognized: [] },
      { score: 0.4, missing: [{ canonical: "Kubernetes", category: "technology" }], unrecognized: [{ term: "service mesh", score: 2 }] },
    ]);
    expect(combined.score).toBe(0.4);
    expect(combined.belowThreshold).toBe(true);
    expect(combined.missing.map((t) => t.canonical)).toEqual(["Docker", "Kubernetes"]);
    expect(combined.unrecognized.map((t) => t.term)).toEqual(["service mesh"]);
  });

  it("returns null with nothing to combine", () => {
    expect(combineMatches([])).toBeNull();
    expect(combineMatches([null])).toBeNull();
  });
});

describe("engine match integration (threshold calibration)", () => {
  it("an in-vocabulary posting scores comfortably above the threshold", async () => {
    const res = await embeddedEngine.tailorResume({ jobPosting: TECH_POSTING });
    const m = res.report.match;
    console.log("[calibration] tech posting resume match:", JSON.stringify({ score: m.score, missing: m.missing, unrecognized: m.unrecognized }));
    expect(m.score).toBeGreaterThan(MATCH_THRESHOLD);
    expect(m.belowThreshold).toBe(false);
  });

  it("an off-domain posting falls below the threshold and reports the gap", async () => {
    const res = await embeddedEngine.tailorResume({ jobPosting: NURSE_POSTING });
    const m = res.report.match;
    console.log("[calibration] nurse posting resume match:", JSON.stringify({ score: m.score, missing: m.missing, unrecognized: m.unrecognized }));
    expect(m.belowThreshold).toBe(true);
    expect(m.missing.length + m.unrecognized.length).toBeGreaterThan(0);
  });

  it("cover letters carry their own match block", async () => {
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: TECH_POSTING,
      jobTitle: "Senior Software Engineer",
      companyName: "Acme",
    });
    const m = res.report.match;
    console.log("[calibration] tech posting cover match:", JSON.stringify({ score: m.score }));
    expect(m).toBeTruthy();
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(1);
  });
});
