// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- the walkthrough's NAVIGATION and SAVE-HEALING paths
// the landed StudyWalkthrough.* suites do not drive: "Previous card" (undo a
// mis-tap, design r2 OD-6), the outline jump, the session-local "Review all
// again", and the save-failed alert healing after a retry that lands. Same
// harness as the landed interaction suite: the REAL StudyWalkthrough over the
// REAL shipped progress store, a spy writer, and fake timers so the advance
// guard (STUDY_ADVANCE_GUARD_MS) is stepped past explicitly between taps.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { GRADE } from "@/lib/studyPlan/studyWalkthroughModel.js";
import { itemKey } from "@/lib/studyPlan/studyPlanSchema.js";
import {
  subscribe,
  getSnapshot,
  getStudyPlanRecord,
  loadStudyPlanRecord,
  resetStudyPlanProgressStore,
} from "@/lib/studyPlan/studyPlanProgressStore.js";

import StudyWalkthrough from "./StudyWalkthrough.js";
import { STUDY_ADVANCE_GUARD_MS } from "./useStudyWalkthrough.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP = "app-nav";
const Q1 = { topicHint: "t1", kind: "new", text: "ALPHA prompt text", reveal: "ALPHA answer text", citations: [] };
const Q2 = { topicHint: "t1", kind: "new", text: "BRAVO prompt text", reveal: "BRAVO answer text", citations: [] };
const Q3 = { topicHint: "t2", kind: "new", text: "CHARLIE prompt text", reveal: "CHARLIE answer text", citations: [] };
const ID1 = itemKey(Q1);

function rawPlan() {
  return {
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [
      {
        id: "m1",
        title: "Module",
        topics: [
          { id: "t1", title: "Topic One", items: [Q1, Q2] },
          { id: "t2", title: "Topic Two", items: [Q3] },
        ],
      },
    ],
  };
}

let container;
let root;
let writer;

function Harness() {
  useSyncExternalStore(subscribe, getSnapshot);
  const record = getStudyPlanRecord(APP);
  if (!record.loaded || !record.plan) return null;
  return createElement(StudyWalkthrough, {
    applicationId: APP,
    plan: record.plan,
    progress: record.progress,
    writer,
    saveError: record.error,
    researchedAt: null,
    researchReason: null,
    engine: "gemini",
    buildBusy: false,
  });
}

async function seedAndMount(seen = {}) {
  await act(async () => {
    await loadStudyPlanRecord(APP, () => Promise.resolve({ status: "ready", plan: rawPlan(), progress: { seen } }));
  });
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Harness)));
  });
}

function buttonByName(name) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
}
async function click(name) {
  const btn = buttonByName(name);
  expect(btn, `button "${name}" not found`).toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
}
// Past the advance guard, so the next tap is a deliberate one.
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(STUDY_ADVANCE_GUARD_MS);
  });
async function grade(name) {
  await click(STUDY_COPY.card.showAnswer);
  await click(name);
  await settle();
}
const text = () => document.body.textContent || "";

beforeEach(() => {
  vi.useFakeTimers();
  resetStudyPlanProgressStore();
  writer = vi.fn(() => Promise.resolve({ written: true, error: null }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetStudyPlanProgressStore();
  vi.useRealTimers();
});

describe("Previous card undoes a mis-tap", () => {
  it("is disabled on the very first card (nothing to go back to)", async () => {
    await seedAndMount();
    expect(buttonByName(STUDY_COPY.card.previous).disabled).toBe(true);
  });

  it("returns to the earlier card ALREADY revealed with its grade named, and a re-grade overwrites that one entry", async () => {
    await seedAndMount();
    await grade(STUDY_COPY.card.gotIt);
    expect(text()).toContain("BRAVO prompt text");

    await click(STUDY_COPY.card.previous);
    expect(text()).toContain("ALPHA prompt text");
    expect(text()).toContain("ALPHA answer text");
    expect(text()).toContain(STUDY_COPY.card.revisitGotIt);
    expect(buttonByName(STUDY_COPY.card.showAnswer)).toBeFalsy();
    expect(writer).toHaveBeenCalledTimes(1); // going back writes nothing
    await settle();

    await click(STUDY_COPY.card.missedIt);
    expect(writer).toHaveBeenCalledTimes(2);
    const [first, second] = writer.mock.calls.map((call) => call[0].seenDelta);
    expect(Object.keys(second)).toEqual([ID1]);
    expect(second[ID1].grade).toBe(GRADE.AGAIN);
    // The re-grade keeps the ORIGINAL reveal time of that card.
    expect(second[ID1].revealedAt).toBe(first[ID1].revealedAt);
  });
});

describe("The outline jump lands on the topic's first pending card", () => {
  it("opening the outline and picking Topic Two shows its card, writes nothing, and closes the outline", async () => {
    await seedAndMount();
    await click(STUDY_COPY.card.outline);
    const topicTwo = [...document.body.querySelectorAll("h5 button")].find((b) => b.textContent.includes("Topic Two"));
    await act(async () => topicTwo.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));

    expect(text()).toContain("CHARLIE prompt text");
    expect(text()).not.toContain("ALPHA prompt text");
    expect(writer).not.toHaveBeenCalled();
    expect(document.body.querySelectorAll("h5")).toHaveLength(0);
    expect(document.activeElement.tagName).toBe("H4");
  });
});

describe("Review all again is session-local", () => {
  it("restarts from the first card unrevealed without writing, and without a persisted reset", async () => {
    const stamp = { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" };
    await seedAndMount({ [itemKey(Q1)]: stamp, [itemKey(Q2)]: stamp, [itemKey(Q3)]: stamp });
    expect(text()).toContain(STUDY_COPY.complete.heading);

    await click(STUDY_COPY.complete.reviewAll);
    expect(text()).not.toContain(STUDY_COPY.complete.heading);
    expect(text()).toContain("ALPHA prompt text");
    expect(text()).not.toContain("ALPHA answer text");
    expect(writer).not.toHaveBeenCalled();
    // The stored entries are untouched by starting a review pass.
    expect(getStudyPlanRecord(APP).progress.seen[itemKey(Q2)]).toEqual(stamp);
  });
});

describe("The save-failed alert heals when the retry lands, and returns on the next failure", () => {
  it("hides after a successful Retry saving even though the store keeps the stale error, then shows again on a new failure", async () => {
    const outcomes = [
      { written: false, error: "Network down" },
      { written: true, error: null },
      { written: false, error: "Network down" },
    ];
    writer = vi.fn(() => Promise.resolve(outcomes.shift() ?? { written: true, error: null }));
    await seedAndMount();

    await grade(STUDY_COPY.card.gotIt); // write 1 fails
    expect(text()).toContain(STUDY_COPY.save.failed);

    await click(STUDY_COPY.save.retry); // write 2 lands
    expect(writer).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain(STUDY_COPY.save.failed);
    // The premise of the fix: the store itself never clears its error.
    expect(getStudyPlanRecord(APP).error).toBe("Network down");

    await grade(STUDY_COPY.card.gotIt); // write 3 fails
    expect(text()).toContain(STUDY_COPY.save.failed);
  });
});
