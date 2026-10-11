// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- the walkthrough card step, RENDER properties.
// Binds to docs/loop/N157.SC-C.design.r2.md Sec 3.2 (the card screen), Sec 5.5
// (the frozen StudyWalkthrough props contract) and Sec 7 (pinned copy).
//
// RED REASON (greenfield): `./StudyWalkthrough.js` does not exist yet, so this
// file fails at COLLECTION with "Cannot find module". That is the right red for
// a TDD hand-off: the component is the deliverable. Per-test red BEHAVIOUR is
// proven against a discarded scratchpad reference (see tests notes / handback),
// where every assertion here goes green and dies under its named mutant.
//
// This file builds ONLY on shipped C-a code -- it imports, never redefines:
//   STUDY_COPY            lib/studyPlan/studyPlanCopy.js  (raw-string templates)
//   normalizePlan,itemKey lib/studyPlan/studyPlanSchema.js
//   normalizeProgress     lib/studyPlan/studyPlanSchema.js
// The walkthrough consumes record.plan, which C-c feeds already normalized, so
// every fixture here is passed through normalizePlan first, exactly as prod does.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { normalizePlan, normalizeProgress } from "@/lib/studyPlan/studyPlanSchema.js";

import StudyWalkthrough from "./StudyWalkthrough.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A no-op writer: these are render-only cases, nothing should persist. Returns a
// settled success so a stray call (which these cases also assert against) never
// leaves a pending promise warning.
const noopWriter = () => Promise.resolve({ written: true, error: null });

function quizPlan() {
  return normalizePlan({
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [
      {
        id: "m1",
        title: "Behavioural round",
        topics: [
          {
            id: "t1",
            title: "Leadership",
            items: [
              { topicHint: "t1", kind: "new", text: "Tell me about a conflict you resolved.", reveal: "Use the STAR structure: situation, task, action, result.", citations: [] },
              { topicHint: "t1", kind: "review", text: "Describe a time you failed.", reveal: "Own it, then show the lesson.", citations: [] },
            ],
          },
        ],
      },
    ],
  });
}

// A read-through card: an item with NO reveal (embedded digest line shape).
function readPlan() {
  return normalizePlan({
    engine: "embedded",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [
      {
        id: "m1",
        title: "Company facts",
        topics: [
          {
            id: "t1",
            title: "Funding",
            items: [{ topicHint: "t1", kind: "new", text: "Acme raised a Series B in 2025.", citations: [] }],
          },
        ],
      },
    ],
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
          applicationId: "app-1",
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

// The whole rendered surface, portals included (MUI Dialog/Popper portal to
// document.body; a text-absence claim read off `container` alone would miss one).
function allText() {
  return document.body.textContent || "";
}

function buttonByName(name) {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === name || b.getAttribute("aria-label") === name,
  );
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

describe("C-b card render: quiz front hides the reveal until it is shown (cold reveal, C2/R8)", () => {
  it("shows the prompt but NOT the answer text anywhere in the DOM before reveal", async () => {
    const plan = quizPlan();
    await mount({ plan });

    // The prompt (question) is on screen.
    expect(allText()).toContain("Tell me about a conflict you resolved.");

    // The reveal string is absent from the ENTIRE document until activation --
    // not merely CSS-hidden. A mutant that renders it hidden (display:none) still
    // puts the text in the DOM, so a text-absence assertion is what kills it.
    expect(allText()).not.toContain("Use the STAR structure");

    // And it is never parked inside a live region (a reveal must not be spoken).
    for (const region of document.body.querySelectorAll('[aria-live], [role="status"], [role="alert"]')) {
      expect(region.textContent || "").not.toContain("Use the STAR structure");
    }
  });

  it("[control] a quiz card offers 'Show answer' as its primary action, not a grade", async () => {
    await mount({ plan: quizPlan() });
    // Over-/under-fire control: before reveal the grade buttons must NOT exist,
    // and Show answer MUST exist. A card stuck permanently revealed (or never
    // revealable) fails exactly one half of this.
    expect(buttonByName(STUDY_COPY.card.showAnswer)).toBeTruthy();
    expect(buttonByName(STUDY_COPY.card.gotIt)).toBeFalsy();
    expect(buttonByName(STUDY_COPY.card.missedIt)).toBeFalsy();
  });
});

describe("C-b card render: a read-through card shows its content and a Next primary (R0)", () => {
  it("renders the digest line as content and offers Next, never Show answer", async () => {
    await mount({ plan: readPlan(), engine: "embedded" });
    expect(allText()).toContain("Acme raised a Series B in 2025.");
    // A card with no reveal is first-class read-through, not an error.
    expect(buttonByName(STUDY_COPY.card.next)).toBeTruthy();
    expect(buttonByName(STUDY_COPY.card.showAnswer)).toBeFalsy();
  });
});

describe("C-b card render: slot templates filled from STUDY_COPY with no leak and no $& hazard", () => {
  it("fills the position line (Card <i> of <n> in this topic) with no literal slot token left", async () => {
    await mount({ plan: quizPlan() });
    const text = allText();
    // Positive: the resolved line for the first card of a two-card topic.
    expect(text).toContain("Card 1 of 2 in this topic");
    // Negative controls: no unfilled slot token leaks. These operands are
    // literals (not possibly-undefined imports), so the negation has real power.
    expect(text).not.toContain("<i>");
    expect(text).not.toContain("<n>");
  });

  it("fills the progress line (<done> of <total> done) with no literal slot token left", async () => {
    await mount({ plan: quizPlan() });
    const text = allText();
    expect(text).toContain("0 of 2 done");
    expect(text).not.toContain("<done>");
    expect(text).not.toContain("<total>");
  });

  it("the templates are filled WITHOUT $& hazards: regex-special card text survives verbatim (C-a copy note)", async () => {
    // The C-a studyPlanCopy header requires a replacer FUNCTION, never a string
    // replacement, so a value containing "$&" / "$1" is not re-interpreted. This
    // fixture smuggles those sequences into text the card assembles and renders;
    // a naive `src.replace(token, value)` with a string replacement mangles them.
    const plan = normalizePlan({
      engine: "gemini",
      provenance: { research: "complete", unsourcedTopicIds: [] },
      modules: [
        {
          id: "m1",
          title: "Edge $& module",
          topics: [{ id: "t1", title: "Regex $1 topic", items: [{ topicHint: "t1", kind: "new", text: "Explain the $& and $1 placeholders.", reveal: "They are regex replacement specials.", citations: [] }] }],
        },
      ],
    });
    await mount({ plan });
    expect(allText()).toContain("Explain the $& and $1 placeholders.");
    // LIMIT (stated, standing rule 12): this bites only if the card routes that
    // text through String.prototype.replace; it is a belt against the flagged
    // hazard, not a proof the component never uses a string replacement elsewhere.
  });
});

describe("C-b card render: chips derive from the card, colour never the sole signal (S2/S6)", () => {
  it("a new card with no citations shows the 'New' and 'No source' text chips", async () => {
    await mount({ plan: quizPlan() });
    const text = allText();
    expect(text).toContain(STUDY_COPY.card.chipNew); // "New"
    // "No source" is a TEXT chip on a zero-citation card, even on a ready plan.
    expect(text).toContain(STUDY_COPY.card.chipNoSource); // "No source"
  });
});

describe("C-b card render: the empty / degenerate plan renders nothing (planSignature([]) === '')", () => {
  it("a plan with zero modules renders no card and no primary control, and never throws", async () => {
    const empty = normalizePlan({ engine: "gemini", modules: [] });
    await mount({ plan: empty });
    // The belt to C-c's brace: a zero-module plan is a no-walkthrough. Nothing on
    // screen that implies a card, and specifically no primary action.
    expect(buttonByName(STUDY_COPY.card.showAnswer)).toBeFalsy();
    expect(buttonByName(STUDY_COPY.card.next)).toBeFalsy();
    expect(allText()).not.toContain("in this topic");
  });

  it("a null plan renders nothing and never throws", async () => {
    await mount({ plan: null });
    expect(buttonByName(STUDY_COPY.card.showAnswer)).toBeFalsy();
    expect(buttonByName(STUDY_COPY.card.next)).toBeFalsy();
  });
});
