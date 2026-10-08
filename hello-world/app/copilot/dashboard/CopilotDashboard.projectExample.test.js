// @vitest-environment jsdom
//
// The two AnswerAids call sites that live INSIDE CopilotDashboard.js and are
// not exported: CurrentAnswerPanel (the answer being read right now) and
// HistoryItem (a past question, expanded). The sites census proves each mount
// passes the new props; this file proves the other half of the chain by
// rendering the real exported dashboard and reading the examples group off the
// DOM -- a site that forgot the props would render nothing at all here, which
// is indistinguishable from "feature off" everywhere else.
//
// HistoryItem is also where `finalOnly` is wired. A past question can only show
// a FINAL state, so a Row 2 that was still pending when its card moved into
// history must read as failed (and carry no skeleton and no aria-busy), not as
// a placeholder counting down on an answer given long ago.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CopilotDashboard from "./CopilotDashboard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GROUP_LABEL = "Example projects (invented)";
const R1_WARMING = "Still being prepared. Shows from your next question.";
const R2_PENDING = "Writing one for this question";
const R2_FAILED = "Couldn't write one this time.";

const READY = (title) => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title,
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
});

function entry(id, question, over = {}) {
  return {
    id,
    question,
    at: Date.now(),
    status: "done",
    points: [`Distinctive point for ${question}`],
    cues: [],
    buzzwords: [],
    anchor: null,
    pageSources: [],
    error: "",
    ...over,
  };
}

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

async function render(props) {
  await act(async () => {
    root.render(createElement(CopilotDashboard, { pace: { measured: false }, fillers: { measured: false }, ...props }));
  });
}

async function expandHistoryItem(index = 0) {
  const headers = [...container.querySelectorAll('button[aria-expanded="false"]')].filter(
    (b) => !(b.textContent || "").includes(GROUP_LABEL),
  );
  await act(async () => {
    headers[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("CurrentAnswerPanel supplies both props (site CopilotDashboard.js :452)", () => {
  it("renders the examples group, Row 1 content and a pending Row 2 skeleton for the current answer", async () => {
    const current = entry(2, "Current question", {
      projectExample: READY("Current row one"),
      projectExampleLive: { status: "pending" },
    });
    await render({ questions: [current], current, currentIsSeed: false, history: [] });

    const text = container.textContent || "";
    expect(text).toContain(GROUP_LABEL);
    expect(text).toContain("Current row one");
    expect(text).toContain(R2_PENDING);
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
  });

  it("renders no examples group when the entry carries neither row (no posting, or the embedded engine)", async () => {
    const current = entry(2, "Current question");
    await render({ questions: [current], current, currentIsSeed: false, history: [] });
    expect(container.textContent || "").not.toContain(GROUP_LABEL);
  });
});

describe("HistoryItem supplies both props and only ever shows a final state (site CopilotDashboard.js :742)", () => {
  it("renders a past question's ready Row 1 and settled Row 2 once expanded", async () => {
    const past = entry(1, "Past question", {
      projectExample: READY("Past row one"),
      projectExampleLive: READY("Past row two"),
    });
    const current = entry(2, "Current question");
    await render({ questions: [past, current], current, currentIsSeed: false, history: [past] });

    expect(container.textContent || "").not.toContain("Past row one");
    await expandHistoryItem();
    const text = container.textContent || "";
    expect(text).toContain(GROUP_LABEL);
    expect(text).toContain("Past row one");
    expect(text).toContain("Past row two");
  });

  it("reads a Row 2 that never settled as FAILED, with no skeleton, no aria-busy and no 'Writing one' line", async () => {
    const past = entry(1, "Past question", {
      projectExample: READY("Past row one"),
      projectExampleLive: { status: "pending" },
    });
    const current = entry(2, "Current question");
    await render({ questions: [past, current], current, currentIsSeed: false, history: [past] });
    await expandHistoryItem();

    const text = container.textContent || "";
    expect(text).toContain(R2_FAILED);
    expect(text).not.toContain(R2_PENDING);
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBe(0);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("keeps a warming Row 1 as its quiet line on a past question (no retry control, no pretending it is ready)", async () => {
    const past = entry(1, "Past question", { projectExample: { status: "pending" } });
    const current = entry(2, "Current question");
    await render({ questions: [past, current], current, currentIsSeed: false, history: [past] });
    await expandHistoryItem();

    const text = container.textContent || "";
    expect(text).toContain(R1_WARMING);
    expect(text).not.toMatch(/try again/i);
  });
});
