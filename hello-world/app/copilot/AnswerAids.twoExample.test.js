// @vitest-environment jsdom
//
// N125 §3.7/§11 (L11/L12): AnswerAids renders TWO worked examples — a READY
// one (always present, labelled "A ready example") and, when it resolves, a
// TAILORED one below it (labelled "Tailored to this question"), added
// progressively so the READY block never moves or clears. A pending TAILORED
// shows a non-error "Tailoring to this question…" cue; a failed/idle/done one
// shows no cue; a null one leaves exactly today's single-example tree; a
// malformed tailored payload (sections OR outcomes missing) renders NOTHING
// extra — never a half block.
//
// RED on HEAD: AnswerAids today takes only { buzzwords, anchor, idealProject }
// and labels the one block "Ideal project for this posting". The new
// idealProjectTailored/tailoredStatus props are ignored, so the second block,
// the labels and the cue do not render until step 7 lands.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerAids from "./AnswerAids.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(AnswerAids, props));
  });
  // Read document.body, not just container: MUI portals (and anything using
  // one) land on document.body, and a portal would otherwise read as empty.
  return document.body.textContent || "";
}

const aid = (title) => ({
  shape: "Education, Agile",
  summary: "They want a project built around Education and Agile, owned end to end, with a measurable outcome.",
  metrics: ["adoption rate", "time-to-ship"],
  project: {
    title,
    sections: [
      { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the flow ran to seven screens." },
      { label: "Built", body: "A single-screen flow with the roster pre-filled, and an assistant flagging incomplete records before submission entirely." },
      { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so trade-offs stayed settled." },
      { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the one part that did not move at all." },
    ],
    outcomes: [
      { metric: "adoption rate", figure: "34% to 71% active weekly" },
      { metric: "NPS", figure: "+9 to +38" },
      { metric: "time-to-ship", figure: "9 weeks to 3" },
    ],
  },
});

const READY = aid("READY EXAMPLE TITLE");
const TAILORED = aid("TAILORED EXAMPLE TITLE");

describe("AnswerAids — two examples, progressive add (N125 L11)", () => {
  it("renders the READY example under the 'A ready example' label", async () => {
    const text = await render({ idealProject: READY });
    expect(text).toContain("A ready example");
    expect(text).toContain("READY EXAMPLE TITLE");
  });

  it("adds a SECOND 'Tailored to this question' block below READY when a tailored example resolves", async () => {
    const text = await render({ idealProject: READY, idealProjectTailored: TAILORED, tailoredStatus: "done" });
    // Both labels, both example titles, each present.
    expect(text).toContain("A ready example");
    expect(text).toContain("Tailored to this question");
    expect(text).toContain("READY EXAMPLE TITLE");
    expect(text).toContain("TAILORED EXAMPLE TITLE");
  });

  it("keeps the READY block exactly once and in place when TAILORED lands (progressive ADD, not swap)", async () => {
    const before = await render({ idealProject: READY, idealProjectTailored: null, tailoredStatus: "loading" });
    expect((before.match(/READY EXAMPLE TITLE/g) || []).length).toBe(1);
    expect(before).not.toContain("TAILORED EXAMPLE TITLE");

    const after = await render({ idealProject: READY, idealProjectTailored: TAILORED, tailoredStatus: "done" });
    // READY still present, still exactly once — not duplicated, not cleared.
    expect((after.match(/READY EXAMPLE TITLE/g) || []).length).toBe(1);
    expect(after).toContain("READY EXAMPLE TITLE");
  });

  it("renders NOTHING extra for a malformed tailored payload — no half block", async () => {
    const malformed = { ...TAILORED, project: { title: "TAILORED EXAMPLE TITLE", sections: TAILORED.project.sections, outcomes: [] } };
    const text = await render({ idealProject: READY, idealProjectTailored: malformed, tailoredStatus: "done" });
    expect(text).toContain("READY EXAMPLE TITLE");
    // The tailored title must not surface without a complete block behind it.
    expect(text).not.toContain("TAILORED EXAMPLE TITLE");
    expect(text).not.toContain("Tailored to this question");
  });
});

describe("AnswerAids — the three TAILORED states (N125 L12)", () => {
  it("shows a non-error 'Tailoring to this question…' cue while loading", async () => {
    const text = await render({ idealProject: READY, idealProjectTailored: null, tailoredStatus: "loading" });
    expect(text).toMatch(/Tailoring to this question/i);
    // Never an error node, and READY stays fully readable beside the cue.
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(text).toContain("READY EXAMPLE TITLE");
  });

  it("shows NO cue for failed / idle / done", async () => {
    for (const tailoredStatus of ["failed", "idle", "done"]) {
      const text = await render({ idealProject: READY, idealProjectTailored: null, tailoredStatus });
      expect(text, tailoredStatus).not.toMatch(/Tailoring to this question/i);
      expect(text, tailoredStatus).toContain("READY EXAMPLE TITLE");
    }
  });

  it("with a null tailored and no status, renders exactly today's single-example tree", async () => {
    const text = await render({ idealProject: READY, idealProjectTailored: null });
    expect(text).toContain("READY EXAMPLE TITLE");
    expect(text).not.toContain("TAILORED EXAMPLE TITLE");
    expect(text).not.toMatch(/Tailoring to this question/i);
    expect(text).not.toContain("Tailored to this question");
  });
});
