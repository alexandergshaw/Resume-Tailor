// @vitest-environment jsdom
//
// The practice-mode SEAM for the example-projects group, in the same shape and
// for the same reason as practiceSampleCitations.wiring.test.js: every piece can
// be correct and tested alone while the feature is inert, because the sample
// answer reaches the screen through two hand-written field lists (QuestionCard's
// props and PracticeClient's synthesized dashboard question) and a field nobody
// added to one of them arrives undefined, renders nothing, throws nothing and
// fails no other test. The sites census proves SampleAnswer's mount passes the
// props; this proves they get to SampleAnswer from the hook.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import QuestionCard from "./QuestionCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

const GROUP_LABEL = "Example projects (invented)";

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
  sampleGrounding: null,
  sampleError: "",
  isEmbedded: false,
  onToggleSample: () => {},
  onRetrySample: () => {},
  onRegenerateSample: () => {},
};

const READY = (title) => ({
  status: "ready",
  competency: "data modelling",
  domain: "payments",
  title,
  bullets: ["Split the ledger by tenant", "Cut p99 from 400ms to 90ms"],
  hypothetical: true,
});

async function render(props) {
  await act(async () => {
    root.render(createElement(QuestionCard, { ...BASE, ...props }));
  });
}

describe("practice mode shows the example rows under the sample answer", () => {
  it("carries both rows through QuestionCard to the rendered answer", async () => {
    await render({
      sampleProjectExample: READY("Row one title"),
      sampleProjectExampleLive: READY("Row two title"),
    });
    const text = container.textContent || "";
    expect(text).toContain(GROUP_LABEL);
    expect(text).toContain("Row one title");
    expect(text).toContain("Row two title");
    // Positive control: the answer itself still renders.
    expect(text).toContain("We sharded the ledger by tenant.");
  });

  it("renders no examples group when the sample answer carried neither row", async () => {
    await render({});
    expect(container.textContent || "").not.toContain(GROUP_LABEL);
    expect(container.textContent || "").toContain("We sharded the ledger by tenant.");
  });
});

describe("PracticeClient's hand-written field lists include the example rows", () => {
  const src = read("app/copilot/practice/PracticeClient.js");

  it("passes both rows down to the question card", () => {
    expect(src).toMatch(/sampleProjectExample=\{sampleAnswer\.projectExample\}/);
    expect(src).toMatch(/sampleProjectExampleLive=\{sampleAnswer\.projectExampleLive\}/);
  });

  it("includes both rows in the dashboard question it synthesizes", () => {
    const block = src.slice(src.indexOf("dashboardQuestions"));
    expect(block).toMatch(/projectExample:\s*sampleAnswer\.projectExample/);
    expect(block).toMatch(/projectExampleLive:\s*sampleAnswer\.projectExampleLive/);
  });

  it("keeps both rows in the memo's dependency list", () => {
    // Omitted from the deps, the synthesized question keeps whatever it was
    // built with the first time and never updates when Row 2 lands.
    const block = src.slice(src.indexOf("dashboardQuestions"));
    expect(block).toMatch(/sampleAnswer\.projectExample,/);
    expect(block).toMatch(/sampleAnswer\.projectExampleLive,/);
  });

  it("hands the sample answer's two rows to the practice session log and warms the selected posting's pool", () => {
    expect(src).toMatch(/projectExample:\s*sampleAnswer\.projectExample,\s*projectExampleLive:\s*sampleAnswer\.projectExampleLive,\s*\}\);/);
    expect(src).toMatch(/useApplicationProjectPool\(\{\s*selectedApplicationId:\s*posting\?\.id \|\| null\s*\}\)/);
  });
});

describe("QuestionCard forwards the example rows rather than dropping them", () => {
  it("declares both props and hands them to the sample answer panel", () => {
    const src = read("app/copilot/practice/QuestionCard.js");
    expect(src).toMatch(/projectExample=\{sampleProjectExample\}/);
    expect(src).toMatch(/projectExampleLive=\{sampleProjectExampleLive\}/);
  });
});

describe("the copilot (live mode) warms the selected posting's pool and logs through the session recorder", () => {
  it("mounts the prewarm with the selected posting's id and the session log's recorder", () => {
    const src = read("app/copilot/CopilotClient.js");
    expect(src).toMatch(/useApplicationProjectPool\(\{\s*selectedApplicationId:\s*posting\?\.id \|\| null,\s*logEvent\s*\}\)/);
    // The recorder it is handed must actually come out of useLiveSession.
    expect(read("app/copilot/useLiveSession.js")).toMatch(/\n\s*logEvent,\s*\n\s*\/\/ D7:/);
  });

  it("is mounted where the tracking table's rows are (page.js), beside the digests", () => {
    const src = read("app/page.js");
    expect(src).toMatch(/useApplicationProjectPool\(\{\s*applications:\s*applicationData\s*\}\)/);
  });
});
