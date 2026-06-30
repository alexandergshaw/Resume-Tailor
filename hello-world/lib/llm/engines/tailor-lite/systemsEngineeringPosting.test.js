import { describe, it, expect, beforeAll } from "vitest";
import { embeddedEngine } from "./engine.js";

// Regression guard for the Missouri S&T "Lecturer - Systems Engineering / Digital
// Engineering" posting (SYS ENG 6543): the systems-engineering buzzwords must be
// recognized and surfaced in BOTH documents, and the Systems Engineering focus area
// must drive the framing (subjects, emphasis) rather than the default software shape.
const SE_POSTING = [
  "Lecturer - Department of Engineering Management and Systems Engineering",
  "Missouri University of Science and Technology - Category: Other Engineering Faculty",
  "Lecturer faculty position in Systems Engineering, developing graduate-level coursework in Digital Engineering (SYS ENG 6543 Digital Engineering).",
  "Develop course materials on systems engineering concepts, methods, and tools in digital engineering, distributed systems architecting, modeling, analysis, simulation, and representation.",
  "Emphasize the transition from document-centric systems engineering to model-centric and digital engineering approaches, with applications in complex engineered systems.",
  "Distributed modeling techniques and model decomposition methods using simulation modeling and scalability.",
  "Develop content on digital engineering, distributed systems architecting, systems modeling, model decomposition, simulation-based analysis, and representation of complex engineered systems.",
].join("\n");

const BUZZWORDS = [
  "Systems Engineering", "Digital Engineering", "Model-Based Systems Engineering",
  "Systems Architecture", "Systems Modeling", "Modeling and Simulation",
  "Distributed Systems", "Complex Systems",
];

function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[ ,(])${escaped}([ ,.)]|$)`, "m").test(text);
}

describe("Systems Engineering / Digital Engineering posting tailoring", () => {
  let resume;
  let cover;

  beforeAll(async () => {
    resume = (await embeddedEngine.tailorResume({ jobPosting: SE_POSTING })).result;
    cover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: SE_POSTING,
        jobTitle: "Lecturer, Systems Engineering",
        companyName: "Missouri University of Science and Technology",
      })
    ).result;
  });

  it("surfaces every systems-engineering buzzword in the résumé", () => {
    for (const term of BUZZWORDS) expect(has(resume, term), `résumé missing: ${term}`).toBe(true);
    expect(resume).not.toContain("{{");
  });

  it("surfaces every systems-engineering buzzword in the cover letter", () => {
    for (const term of BUZZWORDS) expect(has(cover, term), `cover letter missing: ${term}`).toBe(true);
    expect(cover).not.toContain("{{");
  });

  it("activates the Systems Engineering focus area (subjects + emphasis), not the default software shape", () => {
    const lines = resume.split("\n");
    const skillsRow1 = (lines[lines.findIndex((l) => l.trim() === "Skills") + 2] || "").trim();
    expect(skillsRow1).toContain("Systems Engineering");
    expect(skillsRow1).toContain("Digital Engineering");

    const adjunct = lines.find((l) => /Adjunct Professor/.test(l)) || "";
    expect(/Systems Engineering|Digital Engineering/.test(adjunct), `adjunct emphasis: ${adjunct}`).toBe(true);

    const firstRole = lines.find((l) => /\| Mutual of Omaha \| July 2023/.test(l)) || "";
    const emphasis = (firstRole.match(/\(([^)]*)\)/) || [, ""])[1];
    expect(/Systems Architecture|Distributed Systems|Modeling and Simulation/.test(emphasis), `full-time emphasis: ${emphasis}`).toBe(true);
  });
});
