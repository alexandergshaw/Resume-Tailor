// N105 Step 3c - what the landed idealPipeline.test.js does not pin: AC-10 on the
// emitted document, the response accounting (removed / leftOut / counts, UXR-1),
// AC-8/AC-9 grounding on the response, the bytes rule, and the refusals.
//
// Everything runs the REAL decompose / gate / reconcile / recompose against a
// STUBBED engine; the assertions read the EMITTED application-ready text.
import { describe, it, expect } from "vitest";
import { runIdealPipeline } from "./idealPipeline.js";
import { UNVERIFIED_FLAG } from "./applicationReadyGate.js";

const REAL_BULLET = "Reduced support tickets at Acme Corp";
const PARTIAL = "Reduced support tickets at Acme Corp by 40%";
const FABRICATION = "Scaled the platform to 10,000,000 users";
const INVENTED_BULLET = "Ran search quality for billions of queries";

const CANDIDATE = [
  "Jane Doe",
  "",
  "PROFESSIONAL EXPERIENCE",
  "Acme Corp — Senior Engineer (2019-2024)",
  REAL_BULLET,
  PARTIAL,
  FABRICATION,
  "",
  "Google — Staff Engineer (2018-2022)",
  INVENTED_BULLET,
  "",
  "SKILLS",
  "JavaScript and Python",
];
const HYPOTHETICAL = ["Jane Doe", "", "Acme Corp — Principal Engineer (2019-2024)", FABRICATION];

const realMaterial = {
  spans: [
    { id: "r0", text: "Jane Doe", contextKey: "" },
    { id: "r1", text: REAL_BULLET, contextKey: "Acme Corp" },
    { id: "r2", text: "JavaScript and Python", contextKey: "" },
  ],
  chronology: { employers: [{ name: "Acme Corp", start: "2020", end: "2024" }] },
};

function stubEngine(overrides = {}) {
  return {
    name: "gemini",
    supportsIdeal: true,
    async tailorIdeal() {
      return {
        engine: "gemini",
        postingAnalysis: {
          requirements: [
            { id: "q1", text: "payments experience", kind: "requirement" },
            { id: "q2", text: "Kubernetes certification required", kind: "requirement" },
          ],
        },
        keywordMap: {
          entries: [
            { keyword: "payments", section: "summary", priority: 1, requirementId: "q1" },
            { keyword: "Rust", section: "skills", priority: 2, requirementId: null },
          ],
        },
        hypothetical: {
          result: HYPOTHETICAL.join("\n"),
          resultLines: HYPOTHETICAL,
          jobTitle: "Payments Engineer",
          companyName: "Acme Corp",
          docxB64: "HYPOTHETICAL-BYTES",
        },
        applicationReadyCandidate: {
          result: CANDIDATE.join("\n"),
          resultLines: CANDIDATE,
          jobTitle: "Payments Engineer",
          companyName: "Acme Corp",
          docxB64: "CANDIDATE-BYTES-WITH-FABRICATION",
        },
        ...overrides,
      };
    },
  };
}

const run = (engine = stubEngine()) =>
  runIdealPipeline({
    engine,
    args: { jobPosting: "We need payments experience. Strong Go skills.", resumeText: "Jane Doe" },
    realMaterial,
  });

describe("runIdealPipeline - AC-10 on the emitted application-ready", () => {
  it("an invented employer and everything under it are ABSENT; the real employer line survives", async () => {
    const out = await run();
    expect(out.result).not.toMatch(/Google|search quality/);
    expect(out.resultLines.join("\n")).not.toMatch(/Google|search quality/);
    expect(out.result).toMatch(/Acme Corp/);
  });

  it("a moved date is corrected to the real record on the emitted line", async () => {
    const out = await run();
    expect(out.result).toContain("Acme Corp — Senior Engineer (2020-2024)");
    expect(out.result).not.toMatch(/2019/);
  });

  it("the invented employer line is accounted for in leftOut (not silently lost)", async () => {
    const out = await run();
    expect(out.ideal.leftOut.map((r) => r.text).join("\n")).toMatch(/Google/);
  });

  it("keeps the unscoped lines (name, skills) the real material supports", async () => {
    const out = await run();
    expect(out.result).toMatch(/Jane Doe/);
    expect(out.result).toMatch(/JavaScript and Python/);
    expect(out.result).toMatch(/SKILLS/);
  });
});

describe("runIdealPipeline - response accounting (UXR-1)", () => {
  it("lists a flagged claim under removed with its flag, reason, context and anchor, and keeps it out of the file", async () => {
    const out = await run();
    expect(out.result).not.toContain(PARTIAL);
    expect(out.ideal.removed).toHaveLength(1);
    const [row] = out.ideal.removed;
    expect(row).toMatchObject({
      text: PARTIAL,
      section: "PROFESSIONAL EXPERIENCE",
      contextKey: "Acme Corp",
      reasonCode: "partial-match",
      flag: UNVERIFIED_FLAG,
      anchor: REAL_BULLET,
    });
    expect(typeof row.spanId).toBe("string");
  });

  it("lists a dropped claim under leftOut with a reason code", async () => {
    const out = await run();
    const row = out.ideal.leftOut.find((r) => r.text === FABRICATION);
    expect(row).toMatchObject({ reasonCode: "no-match" });
  });

  it("counts kept, kept accomplishments (employer-attributed only), removed and left out", async () => {
    const out = await run();
    // Kept: name line, the real Acme bullet, the skills line. One accomplishment.
    expect(out.ideal.counts).toEqual({
      kept: 3,
      keptAccomplishments: 1,
      removed: 1,
      leftOut: out.ideal.leftOut.length,
    });
    expect(out.ideal.leftOut.length).toBeGreaterThanOrEqual(3);
  });

  it("anchors to the employer line when nothing kept sits between it and the claim, and to null at a section start", async () => {
    const candidateOf = (lines) =>
      stubEngine({
        applicationReadyCandidate: { result: lines.join("\n"), resultLines: lines, jobTitle: "", companyName: "" },
      });
    const underEmployer = await run(
      candidateOf(["PROFESSIONAL EXPERIENCE", "Acme Corp — Senior Engineer (2020-2024)", PARTIAL]),
    );
    expect(underEmployer.ideal.removed[0].anchor).toBe("Acme Corp — Senior Engineer (2020-2024)");

    const atSectionStart = await run(candidateOf(["SKILLS", "Reduced support tickets by 40%"]));
    expect(atSectionStart.ideal.removed).toHaveLength(1);
    expect(atSectionStart.ideal.removed[0].anchor).toBeNull();
  });
});

describe("runIdealPipeline - posting grounding (AC-8 / AC-9) on the response", () => {
  it("drops a requirement and a keyword that the posting does not contain", async () => {
    const out = await run();
    expect(out.ideal.postingAnalysis.requirements.map((r) => r.text)).toEqual(["payments experience"]);
    expect(out.ideal.keywordMap.entries.map((e) => e.keyword)).toEqual(["payments"]);
  });
});

describe("runIdealPipeline - bytes and the hypothetical", () => {
  it("never forwards the candidate's docxB64 (it holds the pre-gate text)", async () => {
    const out = await run();
    expect(JSON.stringify(out)).not.toMatch(/CANDIDATE-BYTES/);
    expect(out.docxB64).toBeUndefined();
    expect(out.ideal.applicationReady.docxB64).toBeUndefined();
  });

  it("keeps the hypothetical's OWN text and bytes untouched by the gate", async () => {
    const out = await run();
    expect(out.ideal.hypothetical.resultLines).toEqual(HYPOTHETICAL);
    expect(out.ideal.hypothetical.docxB64).toBe("HYPOTHETICAL-BYTES");
    expect(out.ideal.hypothetical.jobTitle).toBe("Payments Engineer");
  });

  it("is deterministic for a given chain result", async () => {
    expect(await run()).toEqual(await run());
  });
});

describe("runIdealPipeline - fails closed", () => {
  it("an empty real corpus drops every content line and every employer line", async () => {
    const out = await runIdealPipeline({ engine: stubEngine(), args: {} });
    expect(out.result).not.toMatch(/Acme|Google|Scaled|Reduced|JavaScript/);
    expect(out.ideal.counts.kept).toBe(0);
  });

  it("refuses an engine without the Ideal capability, before any call", async () => {
    let called = false;
    const engine = {
      name: "embedded",
      supportsIdeal: false,
      tailorIdeal: async () => {
        called = true;
      },
    };
    await expect(runIdealPipeline({ engine, args: {}, realMaterial })).rejects.toMatchObject({
      name: "IdealChainError",
      code: "unsupported-engine",
    });
    expect(called).toBe(false);
    await expect(runIdealPipeline({ args: {}, realMaterial })).rejects.toMatchObject({ code: "unsupported-engine" });
  });

  it("throws, producing nothing, when the chain returns no document for either draft", async () => {
    await expect(run(stubEngine({ hypothetical: null }))).rejects.toMatchObject({ code: "invalid-shape" });
    await expect(run(stubEngine({ applicationReadyCandidate: {} }))).rejects.toMatchObject({ code: "invalid-shape" });
  });

  it("lets a chain error through unchanged", async () => {
    const boom = Object.assign(new Error("truncated"), { name: "IdealChainError", code: "truncated" });
    const engine = { name: "gemini", supportsIdeal: true, tailorIdeal: async () => Promise.reject(boom) };
    await expect(runIdealPipeline({ engine, args: {}, realMaterial })).rejects.toBe(boom);
  });
});
