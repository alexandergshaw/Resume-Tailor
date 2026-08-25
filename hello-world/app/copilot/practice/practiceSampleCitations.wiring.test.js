// @vitest-environment jsdom
//
// The practice-mode SEAM: does the page citation actually reach the screen,
// or does it stop one component short of it?
//
// WHY THIS FILE EXISTS. Every piece of the citation feature can be correct
// and fully tested on its own while the feature is inert, because each
// piece's test imports that piece directly. `useSampleAnswer` returns
// `pageSources`; `SampleAnswer` accepts a `pageSources` prop and renders it;
// both have passing tests. Between them sits `QuestionCard`, which declares
// its sample-answer props by NAME (`sampleCues`, `sampleAnchor`,
// `sampleIdealProject`, ...) and forwards them one by one — so a prop nobody
// added to that list arrives `undefined`, renders nothing, throws nothing,
// and fails no test. This repo has shipped exactly that shape before: three
// fully-tested components sitting beside a caller that never imported them.
//
// So this file asserts the JOIN, in the two places it can actually break:
// the render path through QuestionCard, and PracticeClient's two hand-written
// field lists.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import QuestionCard from "./QuestionCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

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

const BASE = {
  question: "Tell me about a time you sharded a ledger.",
  loading: false,
  exhausted: false,
  sessionActive: true,
  hasPosting: true,
  live: true,
  answering: false,
  settling: false,
  onNext: () => {},
  onRetry: () => {},
  onStartAnswer: () => {},
  onDoneAnswer: () => {},
  sampleVisible: true,
  sampleStatus: "done",
  sampleAnswerPoints: ["We sharded the ledger by tenant.", "It cut p99 by 40 percent."],
  sampleCues: ["The sharding", "The result"],
  sampleBuzzwords: [],
  sampleAnchor: null,
  sampleIdealProject: null,
  sampleGrounding: null,
  sampleError: "",
  isEmbedded: false,
  onToggleSample: () => {},
  onRetrySample: () => {},
  onRegenerateSample: () => {},
};

async function render(props) {
  await act(async () => {
    root.render(createElement(QuestionCard, { ...BASE, ...props }));
  });
}

describe("practice mode shows which page a sample answer point came from", () => {
  it("carries the citation through QuestionCard to the rendered answer", async () => {
    await render({
      samplePageSources: [{ id: "p1", title: "Payments migration" }, null],
    });
    expect(container.textContent).toContain("From your Payments migration page.");
    // Positive control: the points themselves still render. A component that
    // failed to render at all would satisfy an absence assertion below but
    // not this one.
    expect(container.textContent).toContain("We sharded the ledger by tenant.");
  });

  it("renders nothing extra for a point that came from no page", async () => {
    await render({ samplePageSources: [null, null] });
    expect(container.textContent).not.toContain("From your");
    expect(container.textContent).toContain("We sharded the ledger by tenant.");
  });

  it("renders nothing extra when the draft carried no citations at all", async () => {
    await render({ samplePageSources: [] });
    expect(container.textContent).not.toContain("From your");
  });
});

describe("PracticeClient's hand-written field lists include the citations", () => {
  // Source text, deliberately: the property being asserted IS the shape of
  // the source. Both of these are literal field lists a person maintains by
  // hand, and the failure mode is a field silently missing from one of them —
  // which renders as an answer that quietly has no sources, with nothing on
  // screen or in any log to say why.
  const src = read("app/copilot/practice/PracticeClient.js");

  it("passes the citations down to the question card", () => {
    expect(src).toMatch(/samplePageSources=\{sampleAnswer\.pageSources\}/);
  });

  it("includes the citations in the dashboard question it synthesizes", () => {
    // `dashboardQuestions` is built by naming each field explicitly, and it
    // feeds the same CopilotDashboard live mode uses — so a field missing
    // here is missing from practice's dashboard panel only, which is exactly
    // the kind of half-wired state that reads as "the feature is flaky".
    const block = src.slice(src.indexOf("dashboardQuestions"));
    expect(block).toMatch(/pageSources:\s*sampleAnswer\.pageSources/);
  });

  it("keeps the citations in the memo's dependency list", () => {
    // Omitted from the deps, the synthesized question keeps whatever
    // pageSources it was built with the first time and never updates when a
    // later draft lands — a stale citation against a newer answer, which is
    // worse than none.
    const block = src.slice(src.indexOf("dashboardQuestions"));
    expect(block).toMatch(/sampleAnswer\.pageSources,/);
  });
});

describe("QuestionCard forwards the citations rather than dropping them", () => {
  it("declares the prop and hands it to the sample answer panel", () => {
    const src = read("app/copilot/practice/QuestionCard.js");
    expect(src).toMatch(/samplePageSources/);
    expect(src).toMatch(/pageSources=\{samplePageSources\}/);
  });
});
