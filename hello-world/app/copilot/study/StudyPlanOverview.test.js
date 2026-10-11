// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- the plan OUTLINE (StudyPlanOverview). The landed
// StudyWalkthrough.* suites never open it, so its three behaviours had no
// instrument: the disclosure + jump list (design r2 section 3.5), the rebuild
// control gated on the optional `onBuild` (section 5.5), and the N156-shaped
// armed confirmation that only appears when there is progress to lose
// (section 4.3). Mounted directly, over a plan built by the shipped
// flattenPlan / summarize so the counts are the model's, not a hand-built copy.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { itemKey, normalizePlan } from "@/lib/studyPlan/studyPlanSchema.js";
import { GRADE, flattenPlan, summarize } from "@/lib/studyPlan/studyWalkthroughModel.js";

import StudyPlanOverview, { REBUILD_CONFIRM_WINDOW_MS } from "./StudyPlanOverview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const A1 = { topicHint: "t1", kind: "new", text: "ALPHA prompt", reveal: "ALPHA answer", citations: [] };
const A2 = { topicHint: "t1", kind: "new", text: "BRAVO prompt", reveal: "BRAVO answer", citations: [] };
const B1 = { topicHint: "t2", kind: "new", text: "CHARLIE prompt", reveal: "CHARLIE answer", citations: [] };

const plan = normalizePlan({
  engine: "gemini",
  provenance: { research: "complete", unsourcedTopicIds: ["t2"] },
  modules: [
    { id: "m1", title: "Module One", topics: [{ id: "t1", title: "Topic One", items: [A1, A2] }, { id: "t2", title: "Topic Two", items: [B1] }] },
  ],
});
const cards = flattenPlan(plan);

const NOTHING_DONE = summarize(cards, {});
const ONE_DONE = summarize(cards, { [itemKey(A1)]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" } });

let container;
let root;

async function mount(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(StudyPlanOverview, {
          plan,
          summary: NOTHING_DONE,
          engine: "gemini",
          onBuild: undefined,
          buildBusy: false,
          onJump: () => {},
          ...props,
        }),
      ),
    );
  });
}

function buttonByName(name) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
}
async function click(btn) {
  expect(btn, "button not found").toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
}
const openOutline = () => click(buttonByName(STUDY_COPY.card.outline));
const text = () => document.body.textContent || "";
const statusText = () => document.body.querySelector('[role="status"]')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("The outline is a disclosure over the whole plan", () => {
  it("is closed by default, then lists modules (h4), topics (h5) with done/total and one Unsourced chip", async () => {
    await mount();
    const toggle = buttonByName(STUDY_COPY.card.outline);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("h4, h5")).toHaveLength(0);

    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls"))).toBeTruthy();
    expect([...container.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["Module One"]);
    expect([...container.querySelectorAll("h5")].map((h) => h.textContent)).toEqual(["Topic One0 of 2 done", "Topic Two0 of 1 done"]);
    // Only the topic the plan flags carries the chip, as text.
    expect(text().split(STUDY_COPY.card.chipUnsourced)).toHaveLength(2);
  });

  it("counts done over the plan's cards, per topic", async () => {
    await mount({ summary: ONE_DONE });
    await openOutline();
    expect(text()).toContain("1 of 2 done");
    expect(text()).toContain("0 of 1 done");
  });

  it("a topic button jumps to that topic and closes the outline", async () => {
    const onJump = vi.fn();
    await mount({ onJump });
    await openOutline();
    await click([...container.querySelectorAll("h5 button")].find((b) => b.textContent.includes("Topic Two")));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith("t2");
    expect(container.querySelectorAll("h5")).toHaveLength(0);
  });
});

describe("Rebuild plan is gated on onBuild (the single switch)", () => {
  it("ABSENT onBuild: no rebuild control and no egress notice, even with the outline open", async () => {
    await mount({ onBuild: undefined });
    await openOutline();
    expect(buttonByName(STUDY_COPY.remedy.rebuildPlan)).toBeFalsy();
    expect(text()).not.toContain(STUDY_COPY.notice.gemini);
  });

  it("PRESENT onBuild: the control and the engine's egress notice render next to each other", async () => {
    await mount({ onBuild: vi.fn() });
    await openOutline();
    expect(buttonByName(STUDY_COPY.remedy.rebuildPlan)).toBeTruthy();
    expect(text()).toContain(STUDY_COPY.notice.gemini);
  });

  it("the embedded engine shows the embedded notice, not the Gemini one", async () => {
    await mount({ onBuild: vi.fn(), engine: "embedded" });
    await openOutline();
    expect(text()).toContain(STUDY_COPY.notice.embedded);
    expect(text()).not.toContain(STUDY_COPY.notice.gemini);
  });

  it("buildBusy disables it", async () => {
    await mount({ onBuild: vi.fn(), buildBusy: true });
    await openOutline();
    expect(buttonByName(STUDY_COPY.remedy.rebuildPlan).disabled).toBe(true);
  });
});

describe("Rebuild confirmation appears only when there is progress to lose (minimize-clicks)", () => {
  it("with nothing done a single click builds, and nothing is armed", async () => {
    const onBuild = vi.fn();
    await mount({ onBuild, summary: NOTHING_DONE });
    await openOutline();
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onBuild).toHaveBeenCalledWith("rebuild");
    expect(buttonByName(STUDY_COPY.remedy.confirmRebuild)).toBeFalsy();
  });

  it("with progress the first click only ARMS (label + announced), the second builds once", async () => {
    const onBuild = vi.fn();
    await mount({ onBuild, summary: ONE_DONE });
    await openOutline();
    // The status region exists and is empty BEFORE arming, so the text change is
    // what gets announced.
    expect(statusText()).toBe("");

    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(onBuild).not.toHaveBeenCalled();
    expect(buttonByName(STUDY_COPY.remedy.confirmRebuild)).toBeTruthy();
    expect(statusText()).toBe(STUDY_COPY.remedy.armedAnnouncement);

    await click(buttonByName(STUDY_COPY.remedy.confirmRebuild));
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onBuild).toHaveBeenCalledWith("rebuild");
    expect(buttonByName(STUDY_COPY.remedy.rebuildPlan)).toBeTruthy();
    expect(statusText()).toBe("");
  });

  it("an armed Rebuild reverts on its own, and the next click arms again instead of building", async () => {
    const onBuild = vi.fn();
    await mount({ onBuild, summary: ONE_DONE });
    await openOutline();
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(buttonByName(STUDY_COPY.remedy.confirmRebuild)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REBUILD_CONFIRM_WINDOW_MS);
    });
    expect(buttonByName(STUDY_COPY.remedy.confirmRebuild)).toBeFalsy();
    expect(onBuild).not.toHaveBeenCalled();

    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(onBuild).not.toHaveBeenCalled();
    expect(buttonByName(STUDY_COPY.remedy.confirmRebuild)).toBeTruthy();
  });
});
