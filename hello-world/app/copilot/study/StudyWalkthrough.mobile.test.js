// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- MOBILE-FIRST + ACCESSIBILITY, the jsdom-decidable
// half. Binds to design r2 Sec 3.2 (cold reveal + focus), Sec 6 (touch floor,
// headings, focus, one primary per step), Sec 8 (J rows).
//
// WHAT IS NOT HERE, DELIBERATELY: rendered px, overflow at 320/375/390/430, and
// the grade-row-below-the-fold question are OWNER / phone-pane rows (Sec 8 "O",
// DES-N157-C19) -- jsdom has no layout and this file asserts none. The single
// role="status" live region is C-c's (StudyPlanClient, Sec 6); the walkthrough's
// own "announce a step change" mechanism is FOCUS movement, which is what is
// pinned here.
//
// The touch FLOOR is read through the real computed cascade (atWidth) and the
// shared MOBILE_TAP_MIN, never a hand-typed 44 -- the mobileSx no-copies sweep
// (app/theme/mobileSx.test.js) separately guards that the sx came from the token.
//
// RED REASON (greenfield): ./StudyWalkthrough.js absent -> collection fails.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { GRADE } from "@/lib/studyPlan/studyWalkthroughModel.js";
import { itemKey, normalizePlan, normalizeProgress } from "@/lib/studyPlan/studyPlanSchema.js";
import {
  subscribe,
  getSnapshot,
  getStudyPlanRecord,
  loadStudyPlanRecord,
  resetStudyPlanProgressStore,
} from "@/lib/studyPlan/studyPlanProgressStore.js";

import StudyWalkthrough from "./StudyWalkthrough.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noopWriter = () => Promise.resolve({ written: true, error: null });

const Q1 = { topicHint: "t1", kind: "new", text: "ALPHA prompt text", reveal: "ALPHA answer text", citations: [] };
const Q2 = { topicHint: "t1", kind: "new", text: "BRAVO prompt text", reveal: "BRAVO answer text", citations: [] };
const ID1 = itemKey(Q1);

function quizPlan() {
  return normalizePlan({
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [{ id: "m1", title: "Module", topics: [{ id: "t1", title: "Topic", items: [Q1, Q2] }] }],
  });
}

let container;
let root;

async function mount(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(StudyWalkthrough, {
          applicationId: "app-mobile",
          plan: quizPlan(),
          progress: normalizeProgress({}),
          writer: noopWriter,
          saveError: null,
          researchedAt: null,
          researchReason: null,
          engine: "gemini",
          buildBusy: false,
          ...props,
        }),
      ),
    );
  });
}

function buttonByName(name) {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === name || b.getAttribute("aria-label") === name,
  );
}

async function click(btn) {
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Touch floor: the primary control meets MOBILE_TAP_MIN at xs and is unchanged above it", () => {
  it("Show answer has min-height = MOBILE_TAP_MIN at 375 and auto at desktop", async () => {
    await mount();
    const primary = buttonByName(STUDY_COPY.card.showAnswer);
    expect(primary, "primary action missing").toBeTruthy();
    expect(atWidth(375, () => window.getComputedStyle(primary).minHeight)).toBe(`${MOBILE_TAP_MIN}px`);
    // The desktop rendering must not move -- the token's sm branch is "auto".
    expect(atWidth(1000, () => window.getComputedStyle(primary).minHeight)).toBe("auto");
  });

  it("after reveal, both grade controls meet the touch floor at xs", async () => {
    await mount();
    await click(buttonByName(STUDY_COPY.card.showAnswer));
    for (const name of [STUDY_COPY.card.gotIt, STUDY_COPY.card.missedIt]) {
      const b = buttonByName(name);
      expect(b, `${name} missing`).toBeTruthy();
      expect(atWidth(375, () => window.getComputedStyle(b).minHeight)).toBe(`${MOBILE_TAP_MIN}px`);
    }
  });
});

describe("One primary action per step (Sec 3.2)", () => {
  it("a quiz front has exactly one contained (primary) button", async () => {
    await mount();
    expect(container.querySelectorAll(".MuiButton-contained")).toHaveLength(1);
  });

  it("after reveal the single primary is the contained grade button, not two CTAs", async () => {
    await mount();
    await click(buttonByName(STUDY_COPY.card.showAnswer));
    // "Got it" contained + "Missed it" outlined => still exactly one primary.
    expect(container.querySelectorAll(".MuiButton-contained")).toHaveLength(1);
  });
});

describe("Headings and reachable controls (C1/C15)", () => {
  it("the card prompt is an h4 and the controls are reachable native buttons with names", async () => {
    await mount();
    const h4 = [...container.querySelectorAll("h4")].find((h) => (h.textContent || "").includes("ALPHA prompt text"));
    expect(h4, "card heading not an h4").toBeTruthy();

    const primary = buttonByName(STUDY_COPY.card.showAnswer);
    expect(primary.tagName).toBe("BUTTON");
    expect(buttonByName(STUDY_COPY.card.previous)).toBeTruthy(); // "Previous card"
    expect(buttonByName(STUDY_COPY.card.outline)).toBeTruthy(); // "Plan outline"
  });

  it("the revealed answer label is an h5 (no level skip past h4)", async () => {
    await mount();
    await click(buttonByName(STUDY_COPY.card.showAnswer));
    const h5 = [...container.querySelectorAll("h5")];
    expect(h5.length).toBeGreaterThan(0);
    // The answer group is labelled by an h5, not an h6 (MUI subtitle2 default).
    expect(h5.some((h) => /answer/i.test(h.textContent || ""))).toBe(true);
  });
});

describe("Focus movement announces step changes; never steals focus on mount (Sec 3.2 cold reveal)", () => {
  it("does not move focus to the card on mount", async () => {
    await mount();
    expect(document.activeElement).toBe(document.body);
  });

  it("reveal moves focus to the answer group (role=group), which carries the answer text", async () => {
    await mount();
    await click(buttonByName(STUDY_COPY.card.showAnswer));
    const active = document.activeElement;
    expect(active.getAttribute("role")).toBe("group");
    expect(active.textContent || "").toContain("ALPHA answer text");
  });

  it("advancing moves focus to the NEW card heading (store-driven, the production flow)", async () => {
    resetStudyPlanProgressStore();
    const reader = () =>
      Promise.resolve({ status: "ready", plan: { engine: "gemini", provenance: { research: "complete", unsourcedTopicIds: [] }, modules: [{ id: "m1", title: "Module", topics: [{ id: "t1", title: "Topic", items: [Q1, Q2] }] }] }, progress: {} });
    const writer = () => Promise.resolve({ written: true, error: null });
    function Harness() {
      useSyncExternalStore(subscribe, getSnapshot);
      const record = getStudyPlanRecord("app-mobile-adv");
      if (!record.loaded || !record.plan) return null;
      return createElement(StudyWalkthrough, {
        applicationId: "app-mobile-adv",
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
    await act(async () => {
      await loadStudyPlanRecord("app-mobile-adv", reader);
    });
    await act(async () => {
      root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Harness)));
    });

    await click(buttonByName(STUDY_COPY.card.showAnswer));
    await click(buttonByName(STUDY_COPY.card.gotIt));

    // Focus is now on the BRAVO card's heading (tabIndex -1), so a screen reader
    // reads the new card next. (ID1 was the one just graded; see it moved on.)
    expect(ID1).toBeTruthy();
    const active = document.activeElement;
    expect(active.tagName).toBe("H4");
    expect(active.textContent || "").toContain("BRAVO prompt text");

    resetStudyPlanProgressStore();
  });
});
