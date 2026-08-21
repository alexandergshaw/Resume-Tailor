// @vitest-environment jsdom
//
// AC-R1.1/AC-R1.2/AC-R1.4/AC-R1.9. The dashboard both modes render must no
// longer show a predicted next question, a pre-drafted answer for it, or
// the switch that used to hide them — and must still show everything else.
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`).
// These acceptance criteria ARE the markup: which panels exist, what the
// headings are, whether a control is on screen. There is no pure function
// to extract them into, and this repo's precedent for rendering a whole
// component under test is app/components/JobDescriptionTab.test.js.
//
// Absence assertions here are all paired with a positive control in the
// same test, for the usual reason: "the predicted panel is not on screen"
// is equally true of a component that renders nothing at all.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CopilotDashboard, { LIVE_COPY, PRACTICE_COPY } from "./CopilotDashboard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const QUESTION = "Tell me about a time you disagreed with your manager.";

function entry(overrides = {}) {
  return {
    id: "q1",
    question: QUESTION,
    status: "done",
    points: ["Point one.", "Point two."],
    cues: ["Cue one", "Cue two"],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    error: "",
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    questions: [entry()],
    pace: { measured: true, wordsPerMinute: 140, paceLabel: "conversational" },
    fillers: { measured: true, fillerCount: 1, fillerRate: 1.2, fillerLabel: "clean" },
    ...overrides,
  };
}

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
    root.render(createElement(CopilotDashboard, props));
  });
}

// Deliberately `document.body`, not `container`. `beforeEach` makes
// `container` body's only child, so for a component that renders entirely
// into its own tree the two are identical — and they stop being identical
// for exactly the case that matters. A review rendered a full speculative
// panel, with real h4 headings and full wording, through
// `createPortal(…, document.body)`: `container.textContent` never saw it and
// every assertion in this file stayed green. That is not exotic — every MUI
// Popper, Tooltip, Dialog, Menu and Snackbar portals to body, so "show
// what's coming as a floating card" produces it by default.
function text() {
  return document.body.textContent || "";
}

function headings() {
  return [...document.body.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((el) => ({
    level: Number(el.tagName.slice(1)),
    text: el.textContent.trim(),
  }));
}

// Every user-visible trace of the removed pair. Checked as rendered TEXT,
// which is what a candidate glancing at this mid-interview actually sees.
const GONE = [
  "Predicted next question",
  "Answer to the predicted question",
  "Show predicted question and answer",
  "Pre-draft predicted answer",
  "Pre-drafted for the predicted question",
  "it is only a guess at what might come next",
];

describe("the copilot dashboard renders no predicted question or answer", () => {
  it("live mode: shows the current question, its answer and the delivery strip, and nothing predicted", async () => {
    await render(baseProps());

    // Positive control: the panels that must survive.
    expect(text()).toContain(LIVE_COPY.currentQuestionTitle);
    expect(text()).toContain(QUESTION);
    expect(text()).toContain(LIVE_COPY.currentAnswerTitle);
    expect(text()).toContain(LIVE_COPY.deliveryTitle);

    for (const phrase of GONE) expect(text()).not.toContain(phrase);
    expect(text()).not.toMatch(/predict/i);
  });

  it("practice mode: same, with practice's own wording", async () => {
    await render(baseProps({ copy: PRACTICE_COPY, answerHidden: true, onRevealAnswer: () => {} }));

    expect(text()).toContain(PRACTICE_COPY.title);
    expect(text()).toContain(PRACTICE_COPY.currentQuestionTitle);
    expect(text()).toContain("Show sample answer");

    for (const phrase of GONE) expect(text()).not.toContain(phrase);
    expect(text()).not.toMatch(/predict/i);
  });

  it("renders no visibility control of ANY kind, whatever element it is built from", async () => {
    // An earlier version counted `input[type="checkbox"]` alone, reasoning
    // that MUI's Switch renders one. True, and insufficient: a review
    // rebuilt the same visibility toggle as a `<Button role="switch"
    // aria-checked>` — a perfectly accessible control — and the checkbox
    // count stayed 0. Assert the whole interactive surface instead. Live
    // mode's dashboard has no controls at all in this state.
    await render(baseProps({ onToggleShowPredictions: () => {}, showPredictions: true }));

    // Positive control first: the component really did render.
    expect(text()).toContain(LIVE_COPY.deliveryTitle);
    const controls = [
      ...container.querySelectorAll(
        'button, input, select, textarea, [role="switch"], [role="checkbox"], [role="button"], [aria-pressed]',
      ),
    ].map((el) => el.textContent.trim());
    expect(controls).toEqual([]);
    // Passing the old props must not resurrect anything either — a caller
    // left un-updated is a plausible way for this to come back.
    for (const phrase of GONE) expect(text()).not.toContain(phrase);
  });

  it("practice mode's only control is the answer reveal", async () => {
    // The counterpart to the case above, and the reason it is a separate
    // test rather than a looser assertion in one: practice mode legitimately
    // has exactly one control here, so "no controls" is the wrong bar for it
    // and "some controls" would be the wrong bar for live mode.
    await render(baseProps({ copy: PRACTICE_COPY, answerHidden: true, onRevealAnswer: () => {} }));
    const controls = [
      ...container.querySelectorAll('button, input, select, textarea, [role="switch"], [role="checkbox"]'),
    ].map((el) => el.textContent.trim());
    expect(controls).toEqual(["Show sample answer"]);
  });

  it("neither copy object still carries the removed strings", async () => {
    for (const copy of [LIVE_COPY, PRACTICE_COPY]) {
      // Positive control: these are real, populated copy objects.
      expect(copy.currentQuestionTitle).toBeTruthy();
      expect(copy.deliveryTitle).toBeTruthy();
      expect(JSON.stringify(copy)).not.toMatch(/predict/i);
      expect(JSON.stringify(copy)).not.toMatch(/pre-draft/i);
    }
  });
});

describe("what the removal must not have taken with it", () => {
  it('[R-166] a provisional entry still gets the accent card and its "Unconfirmed" chip', async () => {
    // This branch describes a REAL detected utterance of unclear speaker —
    // the opposite uncertainty from a guess about the future — and shares
    // the accent wrapper the prediction panels used. Removing the wrapper
    // along with its other callers would silently take this with it, and
    // the candidate's own speech would then be presented as the
    // interviewer's question with nothing to tell them apart.
    await render(baseProps({ questions: [entry({ provisional: true })] }));

    expect(text()).toContain("Unconfirmed");
    expect(text()).toContain(QUESTION);
    expect(text()).toContain("Not confirmed as the interviewer");
    expect(text()).not.toMatch(/predict/i);
  });

  it("the pace and filler readings still render, and still report unmeasured as unmeasured", async () => {
    await render(baseProps());
    expect(text()).toContain("140 words/min");
    expect(text()).toContain("Conversational");
    expect(text()).toContain("Clean");

    await render(baseProps({ pace: { measured: false, wordsPerMinute: null }, fillers: { measured: false } }));
    expect(text()).toContain(LIVE_COPY.deliveryTitle);
    // Asserted POSITIVELY. `not.toContain("0 wpm")` is equally true of a
    // strip that renders no reading at all, which is the opposite of the
    // "an unmeasured signal is reported as unmeasured" rule this pins.
    expect(text()).toContain("speed: not measured yet");
    expect(text()).toContain("filler: not measured yet");
    expect(text()).not.toContain("0 wpm");
  });
});

// The strongest assertion in this file, and the one that survives a rename.
// Everything above bans the removed feature's VOCABULARY; a review
// reintroduced both panels verbatim under the word "lookahead" — "Likely
// next question", "Answer to the likely next question", a fresh disclaimer,
// two model calls per session — and every vocabulary check stayed green
// because the copy no longer said "predict". The shape of the dashboard is
// the property that actually matters, so pin the shape.
describe("the dashboard's panel set is exactly three, by structure rather than by wording", () => {
  it.each([
    ["live", undefined, LIVE_COPY],
    ["practice", PRACTICE_COPY, PRACTICE_COPY],
  ])("%s mode renders those headings and no fourth panel", async (_mode, copy, expected) => {
    await render(baseProps(copy ? { copy } : {}));
    // Tripwire, stated as its own assertion so it reads as intent: nothing
    // was rendered outside the component's own tree. See `text()` above.
    expect(document.body.textContent).toBe(container.textContent);
    const found = headings();

    // Exact list, exact order. An added panel fails on the length alone,
    // whatever it is called — which a `toBeGreaterThanOrEqual(3)` count of
    // h4s could never do, since the only direction this change can go wrong
    // is a panel coming BACK.
    expect(found.map((h) => h.text)).toEqual([
      expected.title,
      expected.currentQuestionTitle,
      expected.currentAnswerTitle,
      expected.deliveryTitle,
    ]);
    // [a11y] one h3 for the dashboard, h4 for each panel under it, nothing
    // else — the tab's own h2 lives in TabHeader.js, outside this component.
    expect(found.map((h) => h.level)).toEqual([3, 4, 4, 4]);
  });

  it("renders exactly the three panels' text and nothing else at all", async () => {
    // The strongest assertion in the file, and the only one that catches a
    // HEADLESS panel. Two reviewed mutants rendered a full speculative
    // question-and-answer pair built from `<Typography component="span">`
    // and from a `<Box onClick>` toggle: no heading element, no `button`,
    // no `role`, so the heading list stayed `[3,4,4,4]` and the
    // interactive-surface sweep stayed empty, and both shipped green. Text
    // is the one channel every variant of this must use, because a panel
    // nobody can read is not a feature.
    //
    // Yes, this fails on any copy change. That is deliberate: the copy here
    // is stable, and a deliberate edit updating one string is exactly the
    // moment someone should have to look at what else is on screen.
    await render(baseProps());
    expect(text()).toBe(
      [
        LIVE_COPY.title,
        LIVE_COPY.currentQuestionTitle,
        QUESTION,
        LIVE_COPY.currentAnswerTitle,
        "Answer ready, 2 points",
        "Point one.Point two.",
        LIVE_COPY.deliveryTitle,
        "140 words/minConversational1.2% fillerClean",
      ].join(""),
    );
  });

  it("practice mode renders exactly its three panels' text and nothing else at all", async () => {
    // Run for practice as well as live, and NOT because it is symmetrical.
    // Practice mode is where the sample-answer feature already lives, so it
    // is the MORE likely of the two to grow a "here's what's coming next"
    // panel, not the less — and a review demonstrated exactly that, headless
    // and with the prop arriving through `...rest`, entirely green while the
    // live-only text assertion sat one describe block away.
    await render(baseProps({ copy: PRACTICE_COPY, answerHidden: true, onRevealAnswer: () => {} }));
    expect(document.body.textContent).toBe(container.textContent);
    expect(text()).toBe(
      [
        PRACTICE_COPY.title,
        PRACTICE_COPY.currentQuestionTitle,
        QUESTION,
        PRACTICE_COPY.currentAnswerTitle,
        "Show sample answer",
        PRACTICE_COPY.deliveryTitle,
        "140 words/minConversational1.2% fillerClean",
      ].join(""),
    );
  });

  it("neither copy object carries wording for a speculative panel under any synonym", () => {
    // The vocabulary bans elsewhere name the old feature. This names the
    // shape of a NEW one, so bringing it back under a different word has to
    // get past a second, differently-worded gate.
    for (const copy of [LIVE_COPY, PRACTICE_COPY]) {
      const serialized = JSON.stringify(copy);
      for (const banned of [
        /predict/i,
        /pre-draft/i,
        /look[- ]?ahead/i,
        // Qualified rather than a bare /next question/i, which would fire on
        // practice mode's perfectly innocent "press Start practice to get
        // your first one" being reworded to "…your next question."
        /(predicted|likely|upcoming|coming|anticipated) next question/i,
        /upcoming/i,
        /anticipat/i,
        /forecast/i,
        /might ask/i,
      ]) {
        expect(serialized, `${copy.title}: ${banned}`).not.toMatch(banned);
      }
    }
  });

  it("declares no prop that could feed a speculative panel", () => {
    // The heading and text assertions above are only as strong as the props
    // the fixture happens to pass. A reviewed mutant gated its panel on a
    // `lookahead` prop that `baseProps()` never supplies — fully rendered in
    // production, entirely invisible under test. Reading the declared
    // parameter list closes that: a panel needs data, and data arrives here.
    // Matched, not sliced between the first "{" and the first "}) {".
    // Wrapping the component in `React.memo` — an ordinary perf refactor
    // that changes nothing here — makes `toString()` return
    // "[object Object]", the slice yield "", and the positive control fail
    // with `expected '' to match /questions/`, which tells the next reader
    // nothing about what actually happened. Same defect the
    // buildPrivacyNotice parameter check had, and the same fix.
    const match = CopilotDashboard.toString().match(/^\s*function\s+\w+\s*\(\s*\{([\s\S]*?)\}\s*\)\s*\{/);
    expect(
      match,
      "CopilotDashboard is no longer a plain function with one destructured parameter object — if it was wrapped (memo/forwardRef), unwrap it here rather than deleting this check",
    ).not.toBeNull();
    const params = match[1];
    // Positive control: this really is the parameter list.
    expect(params).toMatch(/questions/);
    expect(params).toMatch(/pace/);
    expect(params).toMatch(/fillers/);
    // A rest parameter would make every ban below unenforceable: the panel's
    // prop simply never appears in the declared list. This is the structural
    // half of the check — the vocabulary bans that follow only work because
    // the surface is fully declared here.
    expect(params, "a rest parameter hides the component's real prop surface").not.toMatch(/\.\.\./);
    for (const banned of [/predict/i, /look[- ]?ahead/i, /upcoming/i, /anticipat/i, /forecast/i]) {
      expect(params, String(banned)).not.toMatch(banned);
    }
  });
});
