// AC-T1.9 / F3 / F13. `latestQuestionEntry` moved to lib/copilot/currentQuestion.js
// so a pure lib module (pinnedQuestionEntry) could build on it. QuestionFeed.js
// still imports it from THIS module, so the re-export has to keep working —
// and, more importantly, has to be the same function, not a second copy that
// can drift. That is the exact standard BUG-3 / R-121 group-L set: one
// decision, one place.
//
// F3: the identity assertion ALONE is not enough. `export { x } from "mod"`
// creates no local binding, so this compiles and passes it:
//
//     export { latestQuestionEntry } from "@/lib/copilot/currentQuestion";
//     function latestQuestionEntry(questions) { ...stale copy... }  // what the
//                                                                   // panels call
//
// An adversarial review demonstrated exactly that mutant green. Hence the
// source-text bans below alongside the identity check: the property being
// tested is partly the shape of the source, so a source-text test is the right
// tool for that half.
//
// This file lives on the app side, not in lib/, because it is the one that has
// to import a component.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { latestQuestionEntry } from "@/lib/copilot/currentQuestion";
import * as dashboard from "./CopilotDashboard.js";

const SOURCE = readFileSync(fileURLToPath(new URL("./CopilotDashboard.js", import.meta.url)), "utf8");

describe("CopilotDashboard re-exports the moved decision (AC-T1.9)", () => {
  it("exposes the identical function object from lib/", () => {
    expect(dashboard.latestQuestionEntry).toBe(latestQuestionEntry);
  });

  it("keeps no local definition of its own", () => {
    expect(SOURCE).not.toMatch(/export function latestQuestionEntry/);
    expect(SOURCE).not.toMatch(/function latestQuestionEntry\s*\(/);
    expect(SOURCE).not.toMatch(/(?:const|let|var)\s+latestQuestionEntry\s*=/);
  });

  it("sources it from lib/copilot/currentQuestion", () => {
    expect(SOURCE).toMatch(/currentQuestion/);
  });

  it("[control] the local-definition bans can fail", () => {
    // Guards against the bans silently checking nothing (e.g. a regex that can
    // never match anything at all).
    const shadowed = 'export { latestQuestionEntry } from "@/lib/copilot/currentQuestion";\nfunction latestQuestionEntry(q) { return null; }\n';
    expect(shadowed).toMatch(/function latestQuestionEntry\s*\(/);
  });

  it("renders the panels from that same decision", () => {
    // The dashboard's own use of it, not just the re-export line — a component
    // that re-exports correctly and then reads questions[questions.length - 1]
    // internally is the drift this whole move exists to prevent.
    expect(SOURCE).toMatch(/latestQuestionEntry\(/);
    expect(SOURCE).not.toMatch(/questions\[questions\.length - 1\]/);
  });
});
