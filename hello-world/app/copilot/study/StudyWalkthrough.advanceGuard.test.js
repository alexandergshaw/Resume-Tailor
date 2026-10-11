// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- the ADVANCE GUARD. Binds to design r2 Sec 3.2
// ("controls are inert for STUDY_ADVANCE_GUARD_MS after an advance ... a
// double-tap lands on whatever now sits under the thumb -- for a READ card that
// is 'Next', which would silently skip an unread card", R4 SILENT).
//
// The guard window is a NAMED CONSTANT, single-sourced in C-b's module and
// IMPORTED here (orchestrator ruling; the N156 CLEAR_CONFIRM_WINDOW_MS pattern):
// the test drives fake timers by the constant, so retuning the value on a phone
// never reds this test. The implementer must export STUDY_ADVANCE_GUARD_MS from
// ./useStudyWalkthrough.js.
//
// Fake-timer hygiene (loop-traps-tests): no shared helper awaits a raw
// setTimeout(0); every settle goes through act(async) which flushes microtasks
// regardless of faked timers, and the guard window is advanced explicitly.
//
// RED REASON (greenfield): ./useStudyWalkthrough.js and ./StudyWalkthrough.js
// are absent -> the constant import and the component import both fail at
// collection.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
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

const APP = "app-guard";
// Three read-through cards (no reveal): the Next -> Next double-tap is the
// unsafe case the guard exists for.
const R1 = { topicHint: "t1", kind: "new", text: "READ-ONE line", citations: [] };
const R2 = { topicHint: "t1", kind: "new", text: "READ-TWO line", citations: [] };
const R3 = { topicHint: "t1", kind: "new", text: "READ-THREE line", citations: [] };

function rawPlan() {
  return {
    engine: "embedded",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [{ id: "m1", title: "Module", topics: [{ id: "t1", title: "Topic", items: [R1, R2, R3] }] }],
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
    engine: "embedded",
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

function nextButton() {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === STUDY_COPY.card.next);
}

async function clickNext() {
  const btn = nextButton();
  expect(btn, "Next button not found").toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
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

describe("STUDY_ADVANCE_GUARD_MS: a rapid double-advance neither skips a card nor double-records", () => {
  it("the second Next inside the guard window is inert; after the window it advances again", async () => {
    expect(STUDY_ADVANCE_GUARD_MS).toBeGreaterThan(0); // the import resolved to a real number

    await seedAndMount();
    expect(text()).toContain("READ-ONE line");

    // First advance: records R1, moves to R2, arms the guard.
    await clickNext();
    expect(text()).toContain("READ-TWO line");
    expect(writer).toHaveBeenCalledTimes(1);

    // Rapid second tap, still inside the window (no timer advance): it must be
    // INERT -- no new write, and still on R2 (R3 was not silently skipped).
    await clickNext();
    expect(writer).toHaveBeenCalledTimes(1); // no double-record (R4)
    expect(text()).toContain("READ-TWO line"); // no skip
    expect(text()).not.toContain("READ-THREE line");

    // Let the guard window elapse; the control becomes live again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUDY_ADVANCE_GUARD_MS);
    });

    // [control] a now-deliberate tap advances and records -- the guard releases,
    // it does not wedge the player shut.
    await clickNext();
    expect(writer).toHaveBeenCalledTimes(2);
    expect(text()).toContain("READ-THREE line");
  });
});
