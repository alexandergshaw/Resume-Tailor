// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- the walkthrough INTERACTIONS: reveal, self-grade,
// mark-seen, and advance. Binds to design r2 Sec 3.2 (state table), Sec 3.3
// (nextCard order/wrap/never-done), Sec 3.4 (the progress-write contract) and
// Sec 7 copy.
//
// THE JOIN IS THE POINT. These cases mount the REAL StudyWalkthrough over a REAL
// shipped studyPlanProgressStore (seeded, subscribed) and a REAL injected writer
// spy -- never a prop-forwarding stub and never a mocked recordProgress. A grade
// must travel card -> recordProgress -> buildProgressDelta -> writer as a
// ONE-ITEM delta keyed by the card's content-derived id. That is the chain the
// server merge relies on; testing the component against a hand-built "what I
// think it sends" fixture would hide a break in it (loop-traps-tests: test the
// JOIN with the real consumer).
//
// Harness = what C-c does in production: subscribe to the store, read the record,
// feed record.plan / record.progress / record.error down as props. So the
// store's OPTIMISTIC merge is what re-renders the walkthrough and drives the
// advance -- the component keeps no copy of `seen` (Sec 5.5).
//
// RED REASON (greenfield): ./StudyWalkthrough.js is absent -> collection fails.
// Satisfiability + the index-advance / whole-map-delta mutant kills are proven
// against the discarded scratchpad reference (see handback).

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

const APP = "app-join";

// Distinct, unique prompt strings so "which card is on screen" is an exact
// substring test with no accidental overlap.
const Q1 = { topicHint: "t1", kind: "new", text: "ALPHA prompt text", reveal: "ALPHA answer text", citations: [] };
const Q2 = { topicHint: "t1", kind: "new", text: "BRAVO prompt text", reveal: "BRAVO answer text", citations: [] };
const Q3 = { topicHint: "t1", kind: "new", text: "CHARLIE prompt text", reveal: "CHARLIE answer text", citations: [] };
const READ = { topicHint: "t1", kind: "new", text: "DELTA read line", citations: [] };

const ID1 = itemKey(Q1);
const ID2 = itemKey(Q2);
const ID3 = itemKey(Q3);
const IDR = itemKey(READ);

function rawQuizPlan(items) {
  return {
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [{ id: "m1", title: "Module", topics: [{ id: "t1", title: "Topic", items }] }],
  };
}

let container;
let root;
let writer;

function Harness({ applicationId }) {
  useSyncExternalStore(subscribe, getSnapshot);
  const record = getStudyPlanRecord(applicationId);
  if (!record.loaded || !record.plan) return null;
  return createElement(StudyWalkthrough, {
    applicationId,
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

// Seed the store the way C-c's loadStudyPlanRecord does, then mount the harness.
async function seedAndMount({ items, seen = {}, cursorItemId = null }) {
  const reader = () =>
    Promise.resolve({
      status: "ready",
      plan: rawQuizPlan(items),
      progress: { cursor: { moduleId: "m1", topicId: "t1", itemId: cursorItemId }, seen },
    });
  await act(async () => {
    await loadStudyPlanRecord(APP, reader);
  });
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Harness, { applicationId: APP })));
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
  await act(async () => {
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

function text() {
  return document.body.textContent || "";
}

beforeEach(() => {
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
});

describe("Reveal shows the answer and writes NOTHING (F6: no write at reveal)", () => {
  it("clicking Show answer reveals the answer text; the injected writer is not called", async () => {
    await seedAndMount({ items: [Q1, Q2, Q3] });
    expect(text()).not.toContain("ALPHA answer text");

    await click(STUDY_COPY.card.showAnswer);
    expect(text()).toContain("ALPHA answer text");
    // A reveal with no grade has no done-ness meaning -> no progress write.
    expect(writer).not.toHaveBeenCalled();
  });
});

describe("Grade records ONE seen entry through the real recordProgress -> buildProgressDelta JOIN", () => {
  it("Got it writes exactly one delta keyed by card.id, grade got-it, and no userId (Sec 3.4)", async () => {
    // Seed a PRE-EXISTING seen entry for a DIFFERENT card (Q3). This is what
    // makes the clobber guard bite: a whole-`seen`-map write (the mutant) would
    // carry ID3 too, so "exactly one key, not ID3" distinguishes the faithful
    // single-item JOIN from the two-device clobber. Q3 done -> resume is Q1.
    await seedAndMount({
      items: [Q1, Q2, Q3],
      seen: { [ID3]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" } },
    });
    expect(text()).toContain("ALPHA prompt text");

    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt);

    expect(writer).toHaveBeenCalledTimes(1);
    const arg = writer.mock.calls[0][0];

    // The writer binding takes exactly { cursor, seenDelta } -- identity is
    // auth.uid() inside the RPC, so no userId ever crosses this boundary.
    expect(Object.keys(arg).sort()).toEqual(["cursor", "seenDelta"]);

    // THE CLOBBER GUARD, independent of itemKey: exactly one key, and it is NOT
    // the pre-existing ID3. A whole-`seen`-map write has >1 key (ID1 + ID3).
    expect(Object.keys(arg.seenDelta)).toHaveLength(1);
    expect(arg.seenDelta[ID3]).toBeUndefined();

    // And that one key is THIS card's content-derived id, graded got-it, stamped.
    expect(arg.seenDelta[ID1].grade).toBe(GRADE.GOT_IT);
    expect(typeof arg.seenDelta[ID1].revealedAt).toBe("string");
    expect(arg.cursor.itemId).toBe(ID1);
  });

  it("Missed it writes grade again for the same single card", async () => {
    await seedAndMount({ items: [Q1, Q2, Q3] });
    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.missedIt);

    expect(writer).toHaveBeenCalledTimes(1);
    const { seenDelta } = writer.mock.calls[0][0];
    expect(Object.keys(seenDelta)).toHaveLength(1);
    expect(seenDelta[ID1].grade).toBe(GRADE.AGAIN);
  });
});

describe("A read-through card marks seen with revealedAt and NO grade", () => {
  it("Next on a read card writes one delta with revealedAt and no grade", async () => {
    await seedAndMount({ items: [READ] });
    await click(STUDY_COPY.card.next);

    expect(writer).toHaveBeenCalledTimes(1);
    const { seenDelta } = writer.mock.calls[0][0];
    expect(Object.keys(seenDelta)).toHaveLength(1);
    expect(typeof seenDelta[IDR].revealedAt).toBe("string");
    // A read card is done by its timestamp, not a grade.
    expect(seenDelta[IDR].grade).toBeUndefined();
  });
});

describe("Advance uses nextCard -- never lands on a done card (kills the index-advance mutant)", () => {
  it("grading Q1 when Q2 is already done skips Q2 and shows Q3, not Q2", async () => {
    // Q2 pre-graded got-it (done) but never the array-neighbour a +1 would pick.
    await seedAndMount({
      items: [Q1, Q2, Q3],
      seen: { [ID2]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" } },
      cursorItemId: null,
    });
    // Resume lands on the first pending card = Q1.
    expect(text()).toContain("ALPHA prompt text");

    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt);

    // nextCard skips the done Q2 and lands on Q3. An index+1 advance would show
    // the done Q2 (BRAVO) -- the exact silent-skip defect R5 names.
    expect(text()).toContain("CHARLIE prompt text");
    expect(text()).not.toContain("BRAVO prompt text");
  });
});

describe("Advance wraps to an earlier pending card (nextCard wrapped:true)", () => {
  it("grading the last card returns to an earlier missed card, not completion, not a done card", async () => {
    // Start on Q3 (cursor at Q2, so resume = after Q2 = Q3). Q1 is pending
    // (graded again), Q2 is done.
    await seedAndMount({
      items: [Q1, Q2, Q3],
      seen: {
        [ID1]: { grade: GRADE.AGAIN, revealedAt: "2026-01-01T00:00:00.000Z" },
        [ID2]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" },
      },
      cursorItemId: ID2,
    });
    expect(text()).toContain("CHARLIE prompt text");

    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt);

    // Nothing pending after Q3 -> wrap to the first pending overall = Q1.
    expect(text()).toContain("ALPHA prompt text");
    expect(text()).not.toContain(STUDY_COPY.complete.heading); // not "complete"
    expect(text()).not.toContain("BRAVO prompt text"); // never the done Q2
  });
});

describe("Completion shows the summary when every card is done", () => {
  it("grading the final pending card renders the completion state (Sec 7 copy)", async () => {
    await seedAndMount({
      items: [Q1, Q2, Q3],
      seen: {
        [ID1]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" },
        [ID2]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" },
      },
      cursorItemId: ID2,
    });
    expect(text()).toContain("CHARLIE prompt text");

    await click(STUDY_COPY.card.showAnswer);
    await click(STUDY_COPY.card.gotIt);

    expect(text()).toContain(STUDY_COPY.complete.heading); // "All cards done"
    // body template filled: total = 3, no slot leak.
    expect(text()).toContain("You've been through all 3 cards.");
    expect(text()).not.toContain("<total>");
    expect(buttonByName(STUDY_COPY.complete.reviewAll)).toBeTruthy(); // "Review all again"
  });
});
