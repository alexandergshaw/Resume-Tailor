// @vitest-environment jsdom
//
// AC-6.2: "both surfaces show it: live mode's aids and practice mode's
// sample answer." QuestionFeed/CopilotDashboard cover live mode; this file
// is the practice-mode half — proving `pageSources` actually reaches
// AnswerLines through this component's own `answerLines(cues, points,
// pageSources)` call, not merely that the prop exists on SampleAnswer's
// signature.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import SampleAnswer from "./SampleAnswer.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

async function render(props) {
  await act(async () => {
    root.render(
      createElement(SampleAnswer, {
        visible: true,
        status: "done",
        points: ["We moved settlement onto Kafka."],
        cues: ["The migration"],
        buzzwords: [],
        anchor: null,
        idealProject: null,
        pageSources: [],
        grounding: null,
        error: "",
        isEmbedded: false,
        onToggle: () => {},
        onRetry: () => {},
        onRegenerate: () => {},
        ...props,
      }),
    );
  });
  return container.textContent || "";
}

describe("SampleAnswer — the reveal panel shows the point's knowledge-base source", () => {
  it("names the page a point came from", async () => {
    const text = await render({
      pageSources: [{ id: "p1", title: "Payments migration" }],
    });
    expect(text).toMatch(/Payments migration/);
    // The AnswerLines citation specifically, not sourceCaption's unrelated
    // "from your prep context only" sentence below it (which never mentions
    // a page) — matched narrowly so a change to that other sentence can't
    // make this assertion pass by accident.
    expect(text).toMatch(/from your .*page/i);
  });

  it("says nothing new when no point has a source", async () => {
    const text = await render({ pageSources: [] });
    expect(text).not.toMatch(/from your .*page/i);
    expect(text).not.toMatch(/Payments migration/);
  });
});
