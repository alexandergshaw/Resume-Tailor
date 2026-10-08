// @vitest-environment jsdom
//
// N143 seam 7 (T13) — the forgotten-prop guard (R-C). A call site that forgets
// projectExample/projectExampleLive renders a clean NA indistinguishable from
// "feature off", with every behavioural test green. Per measurement-instruments
// ("the parent forwards it" is not "anyone supplies it"), each site is driven
// by its REAL parent and asserted off the rendered DOM — a prop-forwarding
// assertion would not catch it.
//
// Coverage split, stated honestly:
//   • QuestionCard (QuestionFeed) and SampleAnswer are exported, presentational
//     parents — mounted for real here and asserted off the DOM.
//   • CurrentAnswerPanel and HistoryItem are MODULE-INTERNAL to
//     CopilotDashboard.js (not exported; standing rule forbids adding an export
//     purely to reach them). They are covered by the four-site call-site census
//     below, which — paired with T14's proof that AnswerAids renders the group
//     given the props — establishes the same chain: AnswerAids renders given
//     the props AND each of the four sites supplies them. HistoryItem (:742) is
//     the site AC r1 and 1b r1 both dropped, so the census names it explicitly.
//
// RED on HEAD: AnswerAids ignores the props and no parent passes them, so the
// invented-examples group never renders and the census finds the props at zero
// of four sites.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import QuestionFeed from "./QuestionFeed.js";
import SampleAnswer from "./practice/SampleAnswer.js";
import { stripComments } from "../../lib/sourceScan/tokenizeSource.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GROUP_LABEL = "Example projects (invented)";

const READY = (over = {}) => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
  engine: "gemini",
  ...over,
});

const anchor = { title: "Senior Engineer", company: "Initech", project: "Payments migration", description: [], matched: true, source: "resume" };

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(el) {
  await act(async () => root.render(el));
  return container.textContent || "";
}

describe("real-parent render — the two exported presentational parents (T13)", () => {
  it("QuestionFeed's QuestionCard supplies both props so the group renders (site QuestionFeed.js:209)", async () => {
    const questions = [
      {
        id: "q1",
        question: "Tell me about an incident.",
        status: "done",
        cues: ["the incident"],
        points: ["I led the response to a production incident."],
        pageSources: [null],
        buzzwords: ["latency", "SLA"],
        anchor,
        projectExample: READY(),
        projectExampleLive: READY({ title: "Scaled a read-replica fleet" }),
      },
    ];
    const text = await render(createElement(QuestionFeed, { questions, onDraft: () => {} }));
    expect(text).toContain(GROUP_LABEL);
    expect(text).toContain("Rebuilt the paging rotation");
    expect(text).toContain("Scaled a read-replica fleet");
  });

  it("SampleAnswer supplies both props so the group renders (site SampleAnswer.js:214)", async () => {
    const props = {
      visible: true,
      status: "done",
      points: ["I led the response to a production incident."],
      cues: ["the incident"],
      buzzwords: ["latency"],
      anchor,
      pageSources: [null],
      grounding: {},
      error: "",
      isEmbedded: false,
      onToggle: () => {},
      onRetry: () => {},
      onRegenerate: () => {},
      projectExample: READY(),
      projectExampleLive: READY({ title: "Scaled a read-replica fleet" }),
    };
    const text = await render(createElement(SampleAnswer, props));
    expect(text).toContain(GROUP_LABEL);
    expect(text).toContain("Rebuilt the paging rotation");
  });
});

describe("four-site call-site census — every <AnswerAids> mount passes both props", () => {
  const sites = [
    { file: "app/copilot/dashboard/CopilotDashboard.js", count: 2, note: "CurrentAnswerPanel :452 + HistoryItem :742" },
    { file: "app/copilot/QuestionFeed.js", count: 1, note: "QuestionCard :209" },
    { file: "app/copilot/practice/SampleAnswer.js", count: 1, note: "SampleAnswer :214" },
  ];

  // Extract each <AnswerAids ... /> opening tag from comment-stripped source.
  function answerAidsTags(file) {
    const src = stripComments(readFileSync(path.resolve(process.cwd(), file), "utf8"));
    return src.match(/<AnswerAids\b[^>]*\/?>/g) || [];
  }

  it("[control] finds exactly four <AnswerAids> mounts across the three files, each already passing buzzwords", () => {
    let total = 0;
    for (const site of sites) {
      const tags = answerAidsTags(site.file);
      expect(tags.length, `${site.file} (${site.note})`).toBe(site.count);
      for (const tag of tags) expect(tag, `${site.file}: ${tag}`).toContain("buzzwords");
      total += tags.length;
    }
    expect(total).toBe(4);
  });

  it("every mount passes projectExample AND projectExampleLive (incl. HistoryItem, the dropped one)", () => {
    const offenders = [];
    for (const site of sites) {
      for (const tag of answerAidsTags(site.file)) {
        if (!tag.includes("projectExample") || !tag.includes("projectExampleLive")) {
          offenders.push(`${site.file}: ${tag}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
