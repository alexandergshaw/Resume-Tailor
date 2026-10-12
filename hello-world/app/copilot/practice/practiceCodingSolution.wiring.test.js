// @vitest-environment jsdom
//
// N162 Wave D re-statement (owner reversal of N161, 2026-10-12; AC-N162 BLAST
// RADIUS item 6 — owner-authorized test rework). The coding answer is now
// ADDITIVE: a coding record carries real spoken `points` AND a codingSolution,
// and the render sites show the normal answer AND append the code. The render
// gate shows the appended code ONLY inside the `lines.length` arm, so every
// coding fixture below now carries points (the additive reality the Wave B
// route produces); the single "REPLACES" seam flips to "renders both". The
// pass-through / hook-carries-the-field seams are unchanged in intent — they
// still prove practice hands the coding pair down beside the points.
//
// N161 (original): the practice tab's wiring of the coding answer. The render
// components (CodeSolution, SampleAnswer, CurrentAnswerPanel, QuestionFeed) and
// the hooks (useSampleAnswer, useDraftAnswer) handle a `codingSolution` /
// `codingFallback` record, and each has its own suite; what none of them can
// see is whether PRACTICE actually hands the fields down. Four seams did not:
//
//   1. PracticeClient's synthesized one-entry array (`dashboardQuestions`) --
//      the entry CopilotDashboard's CurrentAnswerPanel reads -- listed the
//      sample answer's fields one by one and never named the coding pair.
//   2. PracticeClient's <QuestionCard> call passed neither field.
//   3. QuestionCard accepted neither prop, so SampleAnswer never received them.
//   4. useRoomQuestions' runDraft destructured the draft response by name and
//      dropped both, so a room-detected coding question rendered nothing.
//
// PracticeClient cannot be mounted under test (its own header comments say so),
// so seams 1 and 2 are read off its SOURCE -- but never by name alone: the
// synthesized-entry factory is EXECUTED (the real arrow function out of the
// real file, against a stand-in sample-answer return) and its output is
// rendered through the REAL CopilotDashboard, and the prop names PracticeClient
// really passes to <QuestionCard> are the names the REAL QuestionCard is then
// rendered with. A rename on either side of either join turns this red.
// Seams 3 and 4 are driven through the real components and the real hook, and
// asserted off the rendered DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import QuestionCard from "./QuestionCard.js";
import CopilotDashboard, { PRACTICE_COPY } from "../dashboard/CopilotDashboard.js";
import QuestionFeed from "../QuestionFeed.js";
import { useRoomQuestions } from "./useRoomQuestions.js";
import { draftAnswer } from "@/lib/copilot/answerClient";
import { stripLineComments } from "@/test/helpers/stripComments.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = stripLineComments(readFileSync(join(HERE, "PracticeClient.js"), "utf8"));

// The full call expression starting at `marker`, found by BALANCING brackets
// (a first-`)` slice ends inside an arrow function's own parentheses).
function callExpression(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

// The comma-separated ARGUMENTS of a call expression, split only at depth 0.
function argumentsOf(call) {
  const body = call.slice(call.indexOf("(") + 1, call.length - 1);
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// The opening tag of a JSX element, `{}`-balanced so an attribute value
// containing `>` cannot end it early.
function jsxOpeningTag(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

const CODE = [
  "def fizzbuzz(n):",
  "    for i in range(1, n + 1):",
  "        if i % 15 == 0:  # I test the combined case first",
  '            print("FizzBuzz")',
  "        elif i % 3 == 0:",
  '            print("Fizz")',
  "        else:",
  "            print(i)",
].join("\n");

const SOLUTION = {
  approach: "Loop 1..n, testing the 15 case before 3 and 5.",
  language: "Python",
  code: CODE,
  complexity: "Time O(n), space O(1).",
  edgeCases: ["n is zero: nothing prints.", "n is negative: nothing prints."],
};

const FALLBACK = "The on-device engine can't write a worked code solution. Switch to the AI engine for a worked solution.";
const QUESTION = "Write a function that prints FizzBuzz up to n.";
const SPOKEN_POINT = "SPOKEN_POINT_SENTINEL the normal answer the code is appended to.";
const MONO_RE = /mono|consolas|menlo|courier|monaco|ui-monospace/i;

// The innermost element whose text holds the code.
function codeEl(rootEl, code = CODE) {
  const matches = [...rootEl.querySelectorAll("*")].filter((el) => (el.textContent || "").includes(code));
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) || null;
}

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const text = () => container.textContent || "";

// ---------------------------------------------------------------------------
// Seam 1: the synthesized dashboard entry (PracticeClient -> CurrentAnswerPanel)
// ---------------------------------------------------------------------------
describe("PracticeClient's synthesized dashboard entry carries the coding pair (seam 1)", () => {
  const memoCall = callExpression(CLIENT, "const dashboardQuestions = useMemo(");

  // What useSampleAnswer returns for a done coding answer, with the fields
  // PracticeClient already forwarded present and the coding pair varied per case.
  const sampleAnswerReturn = (over = {}) => ({
    visible: true,
    status: "done",
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    pageSources: [],
    projectExample: undefined,
    projectExampleLive: undefined,
    techTerms: undefined,
    error: "",
    codingSolution: undefined,
    codingFallback: undefined,
    ...over,
  });

  // Runs the REAL factory out of PracticeClient.js's own source.
  function synthesizedEntries(sampleAnswer) {
    const factory = argumentsOf(memoCall)[0];
    const run = new Function("sampleAnswer", "currentQuestionText", `return (${factory})();`);
    return run(sampleAnswer, QUESTION);
  }

  async function renderDashboard(entries) {
    await act(async () => {
      root.render(
        createElement(CopilotDashboard, {
          questions: entries,
          copy: PRACTICE_COPY,
          answerHidden: false,
          pace: { measured: false },
          fillers: { measured: false },
        }),
      );
    });
  }

  it("[control] the memo call and its factory really were extracted from the source", () => {
    expect(memoCall).not.toBe(null);
    const entries = synthesizedEntries(sampleAnswerReturn());
    expect(entries).toHaveLength(1);
    expect(entries[0].question).toBe(QUESTION);
    expect(entries[0].status).toBe("done");
  });

  it("copies codingSolution off the sample-answer return, and the dashboard renders the code beside the answer", async () => {
    const [entry] = synthesizedEntries(
      sampleAnswerReturn({ codingSolution: SOLUTION, points: [SPOKEN_POINT], cues: ["FizzBuzz"] }),
    );
    expect(entry.codingSolution).toBe(SOLUTION);
    await renderDashboard([entry]);
    // Additive: the normal answer AND the code both render.
    expect(document.body.textContent).toContain("SPOKEN_POINT_SENTINEL");
    const code = codeEl(document.body);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(document.body.textContent).toContain(SOLUTION.complexity);
  });

  it("copies codingFallback off the sample-answer return, and the dashboard shows the marker beside the answer", async () => {
    const [entry] = synthesizedEntries(
      sampleAnswerReturn({ codingFallback: FALLBACK, points: [SPOKEN_POINT], cues: ["FizzBuzz"] }),
    );
    expect(entry.codingFallback).toBe(FALLBACK);
    await renderDashboard([entry]);
    expect(document.body.textContent).toContain("SPOKEN_POINT_SENTINEL");
    expect(document.body.textContent).toContain("Switch to the AI engine");
    expect(codeEl(document.body)).toBeNull();
  });

  it("[regression] an ordinary answer still renders its points and no code", async () => {
    const [entry] = synthesizedEntries(
      sampleAnswerReturn({ points: ["I would clarify the constraints first."], cues: ["Clarify"] }),
    );
    expect(entry.codingSolution).toBeUndefined();
    await renderDashboard([entry]);
    expect(document.body.textContent).toContain("I would clarify the constraints first.");
    expect(codeEl(document.body)).toBeNull();
  });

  it("re-derives the memo when either coding field changes (dependency array)", () => {
    // Without these in the deps a reveal that lands the coding answer leaves the
    // panel on the memoized entry from before it arrived.
    const deps = argumentsOf(memoCall).at(-1);
    expect(deps.startsWith("[")).toBe(true);
    expect(deps).toMatch(/\bsampleAnswer\.codingSolution\b/);
    expect(deps).toMatch(/\bsampleAnswer\.codingFallback\b/);
  });
});

// ---------------------------------------------------------------------------
// Seams 2 and 3: PracticeClient -> QuestionCard -> SampleAnswer
// ---------------------------------------------------------------------------
describe("QuestionCard forwards the coding pair to SampleAnswer (seam 3)", () => {
  async function renderCard(props) {
    await act(async () => {
      root.render(
        createElement(QuestionCard, {
          question: QUESTION,
          type: "technical",
          loading: false,
          error: "",
          exhausted: false,
          sessionActive: true,
          hasPosting: false,
          live: true,
          answering: false,
          settling: false,
          onNext: () => {},
          onRetry: () => {},
          onStartAnswer: () => {},
          onDoneAnswer: () => {},
          sampleVisible: true,
          sampleStatus: "done",
          sampleAnswerPoints: null,
          sampleCues: [],
          sampleBuzzwords: [],
          sampleAnchor: null,
          samplePageSources: [],
          sampleGrounding: null,
          sampleError: "",
          isEmbedded: false,
          onToggleSample: () => {},
          onRetrySample: () => {},
          onRegenerateSample: () => {},
          ...props,
        }),
      );
    });
  }

  it("a done coding answer renders the code block inside the card", async () => {
    await renderCard({ sampleCodingSolution: SOLUTION, sampleAnswerPoints: [SPOKEN_POINT], sampleCues: ["FizzBuzz"] });
    const code = codeEl(container);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(text()).toContain(SOLUTION.complexity);
  });

  it("the coding answer is ADDITIVE — the spoken answer renders beside the code", async () => {
    // N162 FLIP of N161's REPLACE: a build that still suppresses the spoken
    // answer when a codingSolution is present REDs on the first assertion.
    await renderCard({ sampleCodingSolution: SOLUTION, sampleAnswerPoints: [SPOKEN_POINT], sampleCues: ["FizzBuzz"] });
    expect(text()).toContain("SPOKEN_POINT_SENTINEL");
    expect(codeEl(container)).not.toBeNull();
  });

  it("the embedded engine's marker shows beside the answer, and no code block does", async () => {
    await renderCard({
      isEmbedded: true,
      sampleCodingFallback: FALLBACK,
      sampleAnswerPoints: [SPOKEN_POINT],
      sampleCues: ["FizzBuzz"],
    });
    expect(text()).toContain("SPOKEN_POINT_SENTINEL");
    expect(text()).toContain("Switch to the AI engine");
    expect(codeEl(container)).toBeNull();
  });

  it("[regression] an ordinary answer is unchanged: points, and no code block", async () => {
    await renderCard({ sampleAnswerPoints: ["I would clarify the constraints first."], sampleCues: ["Clarify"] });
    expect(text()).toContain("I would clarify the constraints first.");
    expect(codeEl(container)).toBeNull();
  });
});

describe("PracticeClient passes the coding pair to <QuestionCard> under the names QuestionCard reads (seam 2)", () => {
  const tag = jsxOpeningTag(CLIENT, "<QuestionCard");
  const codingAttrs = tag
    ? [...tag.matchAll(/\b(\w+)=\{\s*([^{}]*?)\s*\}/g)].filter((m) => /coding/i.test(m[1])).map((m) => ({ name: m[1], value: m[2] }))
    : [];
  const attr = (re) => codingAttrs.find((a) => re.test(a.name));

  it("passes both fields, read off the SAME sample-answer instance the card's other props come from", () => {
    expect(tag).not.toBe(null);
    expect(attr(/solution/i)?.value).toBe("sampleAnswer.codingSolution");
    expect(attr(/fallback/i)?.value).toBe("sampleAnswer.codingFallback");
  });

  it("the names it passes are the names the real QuestionCard renders from", async () => {
    // The join: build the card's props from the attribute NAMES PracticeClient
    // really writes, so a name QuestionCard does not read renders nothing here.
    const solutionProp = attr(/solution/i)?.name;
    const fallbackProp = attr(/fallback/i)?.name;
    expect(solutionProp, "PracticeClient passes no coding-solution prop").toBeTruthy();
    expect(fallbackProp, "PracticeClient passes no coding-fallback prop").toBeTruthy();

    const base = {
      question: QUESTION,
      type: "technical",
      loading: false,
      sampleVisible: true,
      sampleStatus: "done",
      // Additive: a coding answer carries points, and the appended code/marker
      // renders inside the normal-answer arm — so the card needs a spoken
      // answer for either to show.
      sampleAnswerPoints: [SPOKEN_POINT],
      sampleCues: ["FizzBuzz"],
      sampleBuzzwords: [],
      samplePageSources: [],
      onNext: () => {},
      onToggleSample: () => {},
    };
    await act(async () => {
      root.render(createElement(QuestionCard, { ...base, [solutionProp]: SOLUTION }));
    });
    expect(codeEl(container)).not.toBeNull();

    await act(async () => {
      root.render(createElement(QuestionCard, { ...base, isEmbedded: true, [fallbackProp]: FALLBACK }));
    });
    expect(text()).toContain("Switch to the AI engine");
    expect(codeEl(container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Seam 4: useRoomQuestions' draft response -> the detected-question card
// ---------------------------------------------------------------------------
describe("useRoomQuestions carries the coding pair on a drafted card (seam 4)", () => {
  const draft = (over = {}) => ({
    points: null,
    cues: [],
    buzzwords: [],
    resumeAnchor: null,
    pageSources: [],
    type: "technical",
    ...over,
  });

  let latest;
  function Harness() {
    const room = useRoomQuestions({ applicationId: "app-1", profile: "p", myTag: null, collecting: false });
    latest = room;
    return createElement(QuestionFeed, { questions: room.questions, onDraft: room.onDraft });
  }

  async function mountAndAsk(text = QUESTION) {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      latest.addManualQuestion(text);
    });
  }

  it("a coding draft lands codingSolution on the entry and renders the code beside the answer", async () => {
    draftAnswer.mockResolvedValue(draft({ codingSolution: SOLUTION, points: [SPOKEN_POINT], cues: ["FizzBuzz"], pageSources: [null] }));
    await mountAndAsk();
    expect(latest.questions[0].status).toBe("done");
    expect(latest.questions[0].codingSolution).toEqual(SOLUTION);
    expect(text()).toContain("SPOKEN_POINT_SENTINEL");
    expect(codeEl(container)).not.toBeNull();
  });

  it("an embedded draft lands codingFallback on the entry and renders the marker beside the answer, with no code", async () => {
    draftAnswer.mockResolvedValue(draft({ codingFallback: FALLBACK, points: [SPOKEN_POINT], cues: ["FizzBuzz"], pageSources: [null] }));
    await mountAndAsk();
    expect(latest.questions[0].codingFallback).toBe(FALLBACK);
    expect(latest.questions[0].codingSolution).toBeUndefined();
    expect(text()).toContain("SPOKEN_POINT_SENTINEL");
    expect(text()).toContain("Switch to the AI engine");
    expect(codeEl(container)).toBeNull();
  });

  it("[regression] an ordinary draft sprouts no coding value and renders its points", async () => {
    draftAnswer.mockResolvedValue(draft({ points: ["Name the constraint first."], cues: ["Constraint"], pageSources: [null] }));
    await mountAndAsk();
    expect(latest.questions[0].codingSolution).toBeUndefined();
    expect(latest.questions[0].codingFallback).toBeUndefined();
    expect(text()).toContain("Name the constraint first.");
  });

  it("a malformed coding value is dropped, not carried (the same rule the other two hooks apply)", async () => {
    draftAnswer.mockResolvedValue(
      draft({ points: ["Name the constraint first."], cues: ["Constraint"], pageSources: [null], codingSolution: "oops", codingFallback: "" }),
    );
    await mountAndAsk();
    expect(latest.questions[0].codingSolution).toBeUndefined();
    expect(latest.questions[0].codingFallback).toBeUndefined();
    expect(text()).toContain("Name the constraint first.");
  });

  it("a redraft that comes back ordinary does not keep the previous coding answer", async () => {
    draftAnswer.mockResolvedValue(draft({ codingSolution: SOLUTION, points: [SPOKEN_POINT], cues: ["FizzBuzz"], pageSources: [null] }));
    await mountAndAsk();
    expect(codeEl(container)).not.toBeNull();

    draftAnswer.mockResolvedValue(draft({ points: ["Name the constraint first."], cues: ["Constraint"], pageSources: [null] }));
    await act(async () => {
      latest.onDraft(latest.questions[0].id);
    });
    expect(latest.questions[0].codingSolution).toBeUndefined();
    expect(codeEl(container)).toBeNull();
    expect(text()).toContain("Name the constraint first.");
  });

  it("invalidateDrafts clears the coding answer with the rest of the draft", async () => {
    draftAnswer.mockResolvedValue(draft({ codingSolution: SOLUTION, points: [SPOKEN_POINT], cues: ["FizzBuzz"], pageSources: [null] }));
    await mountAndAsk();
    expect(latest.questions[0].codingSolution).toEqual(SOLUTION);
    await act(async () => {
      latest.invalidateDrafts();
    });
    expect(latest.questions[0].status).toBe("idle");
    expect(latest.questions[0].codingSolution).toBeUndefined();
    expect(latest.questions[0].codingFallback).toBeUndefined();
    expect(codeEl(container)).toBeNull();
  });
});
