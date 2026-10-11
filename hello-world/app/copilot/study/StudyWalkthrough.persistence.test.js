// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- progress PERSISTENCE / OPTIMISM. Binds to design r2
// Sec 3.2 (advance is optimistic and instant; save-failed overlay), Sec 5.5
// (saveError prop, Retry saving), and the shipped studyPlanProgressStore header
// ("a failed persist KEEPS the optimistic state ... surfaced on the record's
// error ... whether a failed write should visibly revert is a UX call left to
// the walkthrough").
//
// Harness mirrors C-c: subscribe to the store, feed record.progress and
// record.error (as saveError) down. The store's OPTIMISTIC merge is what the
// walkthrough re-renders from; the error the store stamps is what the S9 alert
// shows.
//
// RED REASON (greenfield): ./StudyWalkthrough.js absent -> collection fails.

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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP = "app-persist";
const Q1 = { topicHint: "t1", kind: "new", text: "ALPHA prompt text", reveal: "ALPHA answer text", citations: [] };
const Q2 = { topicHint: "t1", kind: "new", text: "BRAVO prompt text", reveal: "BRAVO answer text", citations: [] };
const ID1 = itemKey(Q1);

function rawPlan() {
  return {
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [{ id: "m1", title: "Module", topics: [{ id: "t1", title: "Topic", items: [Q1, Q2] }] }],
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

async function seedAndMount() {
  const reader = () => Promise.resolve({ status: "ready", plan: rawPlan(), progress: {} });
  await act(async () => {
    await loadStudyPlanRecord(APP, reader);
  });
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Harness)));
  });
}

function buttonByName(name) {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === name || b.getAttribute("aria-label") === name,
  );
}

async function click(name) {
  const btn = buttonByName(name);
  expect(btn, `button "${name}" not found`).toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
}

const text = () => document.body.textContent || "";

beforeEach(() => {
  resetStudyPlanProgressStore();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetStudyPlanProgressStore();
});

describe("Optimism: an advance reflects immediately, before the durable write settles", () => {
  it("grading with a NEVER-resolving writer still merges the entry and advances the card", async () => {
    // Writer is left pending forever: navigation must NOT wait on it (Sec 3.2).
    writer = vi.fn(() => new Promise(() => {}));
    await seedAndMount();

    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt);

    // The optimistic merge landed in the store synchronously -- the persist has
    // not (and never will) resolve.
    const seen = getStudyPlanRecord(APP).progress.seen;
    expect(seen[ID1]).toBeTruthy();
    expect(seen[ID1].grade).toBe(GRADE.GOT_IT);

    // And the UI already moved on to the next card.
    expect(text()).toContain("BRAVO prompt text");
    expect(text()).not.toContain("ALPHA prompt text");
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it("[control] a successful grade shows NO save-failed alert (the alert is not always-on)", async () => {
    writer = vi.fn(() => Promise.resolve({ written: true, error: null }));
    await seedAndMount();
    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt);
    expect(text()).not.toContain(STUDY_COPY.save.failed);
  });
});

describe("A failed write SURFACES and is not silently lost (R7 / store header)", () => {
  it("a failed persist shows the save-failed alert and keeps the optimistic entry", async () => {
    writer = vi.fn(() => Promise.resolve({ written: false, error: "Network down" }));
    await seedAndMount();

    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt);

    // The S9 overlay copy is shown...
    expect(text()).toContain(STUDY_COPY.save.failed);
    expect(buttonByName(STUDY_COPY.save.retry)).toBeTruthy(); // "Retry saving"
    // ...and the optimistic state is KEPT (the card is still recorded locally).
    expect(getStudyPlanRecord(APP).progress.seen[ID1]).toBeTruthy();
  });

  it("Retry saving RE-SENDS the last failed card, not the card now on screen", async () => {
    writer = vi.fn(() => Promise.resolve({ written: false, error: "Network down" }));
    await seedAndMount();

    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt); // fails; UI has optimistically advanced to Q2
    expect(text()).toContain("BRAVO prompt text");

    await click(STUDY_COPY.save.retry);

    // The retry resends the FAILED card (Q1 / ID1), even though Q2 is on screen.
    expect(writer).toHaveBeenCalledTimes(2);
    const second = writer.mock.calls[1][0];
    expect(Object.keys(second.seenDelta)).toHaveLength(1);
    expect(second.seenDelta[ID1]).toBeTruthy();
    expect(second.seenDelta[ID1].grade).toBe(GRADE.GOT_IT);
  });
});
